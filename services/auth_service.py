import json
import secrets
import threading
from pathlib import Path

import bcrypt

CONFIG_DIR = Path(__file__).parent.parent / "config"
CONFIG_FILE = CONFIG_DIR / "app_config.json"
_lock = threading.Lock()

DEFAULT_CONFIG = {
    "s3": {
        "bucket": "s3-file-manager-source-system-east-2",
        "region": "us-east-2",
        "endpoint_url": None,
    },
    "app": {
        "secret_key": None,
        "port": 5000,
        "session_timeout_minutes": 60,
    },
    "users": [],
}


def _load_config():
    if not CONFIG_FILE.exists():
        return _init_config()
    with open(CONFIG_FILE, "r") as f:
        return json.load(f)


def _save_config(config):
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_FILE, "w") as f:
        json.dump(config, f, indent=2)


def _init_config():
    config = json.loads(json.dumps(DEFAULT_CONFIG))
    config["app"]["secret_key"] = secrets.token_hex(32)
    admin_hash = hash_password("admin123")
    config["users"].append({
        "username": "admin",
        "password_hash": admin_hash,
        "role": "admin",
        "must_change_password": True,
        "allowed_folders": ["*"],
    })
    _save_config(config)
    return config


def hash_password(plain):
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(plain, hashed):
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def get_config():
    with _lock:
        return _load_config()


def get_user(username):
    config = get_config()
    for user in config["users"]:
        if user["username"] == username:
            return user
    return None


def authenticate(username, password):
    user = get_user(username)
    if user and verify_password(password, user["password_hash"]):
        return user
    return None


def add_user(username, temp_password, role="user", allowed_folders=None):
    with _lock:
        config = _load_config()
        for user in config["users"]:
            if user["username"] == username:
                raise ValueError("User '{}' already exists".format(username))
        config["users"].append({
            "username": username,
            "password_hash": hash_password(temp_password),
            "role": role,
            "must_change_password": True,
            "allowed_folders": allowed_folders or [],
        })
        _save_config(config)


def update_user(username, role=None, allowed_folders=None):
    with _lock:
        config = _load_config()
        for user in config["users"]:
            if user["username"] == username:
                if role is not None:
                    user["role"] = role
                if allowed_folders is not None:
                    user["allowed_folders"] = allowed_folders
                _save_config(config)
                return user
        raise ValueError("User '{}' not found".format(username))


def delete_user(username):
    with _lock:
        config = _load_config()
        config["users"] = [u for u in config["users"] if u["username"] != username]
        _save_config(config)


def change_password(username, old_password, new_password):
    with _lock:
        config = _load_config()
        for user in config["users"]:
            if user["username"] == username:
                if not verify_password(old_password, user["password_hash"]):
                    raise ValueError("Current password is incorrect")
                user["password_hash"] = hash_password(new_password)
                user["must_change_password"] = False
                _save_config(config)
                return True
        raise ValueError("User '{}' not found".format(username))


def admin_reset_password(username, new_password):
    with _lock:
        config = _load_config()
        for user in config["users"]:
            if user["username"] == username:
                user["password_hash"] = hash_password(new_password)
                user["must_change_password"] = True
                _save_config(config)
                return True
        raise ValueError("User '{}' not found".format(username))
