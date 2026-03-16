import os
import re
from datetime import timedelta
from functools import wraps

from flask import Flask, Response, jsonify, request, session, send_from_directory

from services import auth_service, s3_service

from botocore.exceptions import ClientError, NoCredentialsError, EndpointConnectionError

app = Flask(__name__, static_folder="static")

# ---------------------------------------------------------------------------
# App configuration
# ---------------------------------------------------------------------------
config = auth_service.get_config()
app.secret_key = config["app"]["secret_key"]
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(
    minutes=config["app"].get("session_timeout_minutes", 60)
)
app.config["MAX_CONTENT_LENGTH"] = 500 * 1024 * 1024  # 500 MB

# Initialize S3
s3_service.init(config["s3"])


# ---------------------------------------------------------------------------
# Auth decorators
# ---------------------------------------------------------------------------
def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if "username" not in session:
            return jsonify({"error": "Authentication required"}), 401
        return f(*args, **kwargs)
    return decorated


def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if "username" not in session:
            return jsonify({"error": "Authentication required"}), 401
        if session.get("role") != "admin":
            return jsonify({"error": "Admin access required"}), 403
        return f(*args, **kwargs)
    return decorated


def _check_folder_access(username, prefix):
    user = auth_service.get_user(username)
    if not user:
        return False
    folders = user.get("allowed_folders", [])
    if "*" in folders:
        return True
    for folder in folders:
        if prefix == folder or prefix.startswith(folder):
            return True
    return False


def _get_accessible_root_folders(username):
    user = auth_service.get_user(username)
    if not user:
        return []
    folders = user.get("allowed_folders", [])
    if "*" in folders:
        return ["*"]
    return folders


def _sanitize_key(key):
    key = key.lstrip("/")
    parts = key.split("/")
    clean = [p for p in parts if p and p != ".."]
    return "/".join(clean)


# ---------------------------------------------------------------------------
# Serve SPA
# ---------------------------------------------------------------------------
@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/api/health")
def health():
    return jsonify({"status": "ok"})


# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------
@app.route("/api/login", methods=["POST"])
def api_login():
    data = request.get_json()
    if not data or not data.get("username") or not data.get("password"):
        return jsonify({"error": "Username and password required"}), 400
    user = auth_service.authenticate(data["username"], data["password"])
    if not user:
        return jsonify({"error": "Invalid credentials"}), 401
    session.permanent = True
    session["username"] = user["username"]
    session["role"] = user["role"]
    return jsonify({
        "username": user["username"],
        "role": user["role"],
        "must_change_password": user.get("must_change_password", False),
        "allowed_folders": user.get("allowed_folders", []),
    })


@app.route("/api/logout", methods=["POST"])
@login_required
def api_logout():
    session.clear()
    return jsonify({"message": "Logged out"})


@app.route("/api/me")
@login_required
def api_me():
    user = auth_service.get_user(session["username"])
    if not user:
        session.clear()
        return jsonify({"error": "User not found"}), 401
    return jsonify({
        "username": user["username"],
        "role": user["role"],
        "must_change_password": user.get("must_change_password", False),
        "allowed_folders": user.get("allowed_folders", []),
    })


@app.route("/api/change-password", methods=["POST"])
@login_required
def api_change_password():
    data = request.get_json()
    if not data or not data.get("old_password") or not data.get("new_password"):
        return jsonify({"error": "Old and new password required"}), 400
    if len(data["new_password"]) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400
    try:
        auth_service.change_password(session["username"], data["old_password"], data["new_password"])
        return jsonify({"message": "Password changed successfully"})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400


# ---------------------------------------------------------------------------
# S3 routes
# ---------------------------------------------------------------------------
@app.route("/api/s3/info")
@login_required
def api_s3_info():
    cfg = auth_service.get_config()
    s3_cfg = cfg.get("s3", {})
    return jsonify({
        "bucket": s3_cfg.get("bucket", ""),
        "region": s3_cfg.get("region", ""),
    })


@app.route("/api/s3/folders")
@admin_required
def api_s3_folders():
    """List all top-level folders in the bucket for admin user management."""
    try:
        items = s3_service.list_objects("")
        folders = [item["name"] for item in items if item["type"] == "folder"]
        return jsonify({"folders": folders})
    except Exception as e:
        return jsonify({"folders": [], "error": str(e)})


@app.route("/api/s3/list")
@login_required
def api_s3_list():
    prefix = request.args.get("prefix", "")
    prefix = _sanitize_key(prefix)
    if prefix and not prefix.endswith("/"):
        prefix += "/"
    try:
        # Root listing: show only accessible folders
        if not prefix:
            accessible = _get_accessible_root_folders(session["username"])
            if "*" in accessible:
                items = s3_service.list_objects("")
            else:
                items = []
                for folder in accessible:
                    folder_name = folder.rstrip("/") + "/"
                    items.append({"name": folder_name, "type": "folder", "size": 0, "last_modified": None})
                items.sort(key=lambda x: x["name"].lower())
            return jsonify({"prefix": "", "items": items})
        if not _check_folder_access(session["username"], prefix):
            return jsonify({"error": "Access denied to this folder"}), 403
        items = s3_service.list_objects(prefix)
        return jsonify({"prefix": prefix, "items": items})
    except (ClientError, NoCredentialsError, EndpointConnectionError) as e:
        return jsonify({"error": "S3 error: {}".format(str(e))}), 502
    except Exception as e:
        return jsonify({"error": "S3 error: {}".format(str(e))}), 502


@app.route("/api/s3/upload", methods=["POST"])
@login_required
def api_s3_upload():
    prefix = request.form.get("prefix", "")
    prefix = _sanitize_key(prefix)
    if prefix and not prefix.endswith("/"):
        prefix += "/"
    if not _check_folder_access(session["username"], prefix):
        return jsonify({"error": "Access denied to this folder"}), 403
    files = request.files.getlist("files")
    if not files:
        return jsonify({"error": "No files provided"}), 400
    try:
        uploaded = []
        for f in files:
            relative_path = request.form.get("path_{}".format(f.filename), f.filename)
            relative_path = _sanitize_key(relative_path)
            key = prefix + relative_path
            s3_service.upload_file(key, f.stream)
            uploaded.append(key)
        return jsonify({"message": "Uploaded {} file(s)".format(len(uploaded)), "keys": uploaded})
    except (ClientError, NoCredentialsError, EndpointConnectionError) as e:
        return jsonify({"error": "S3 error: {}".format(str(e))}), 502


@app.route("/api/s3/create-folder", methods=["POST"])
@login_required
def api_s3_create_folder():
    data = request.get_json()
    if not data or not data.get("name"):
        return jsonify({"error": "Folder name required"}), 400
    prefix = _sanitize_key(data.get("prefix", ""))
    if prefix and not prefix.endswith("/"):
        prefix += "/"
    name = re.sub(r'[^\w\-. ]', '', data["name"]).strip()
    if not name:
        return jsonify({"error": "Invalid folder name"}), 400
    full_path = prefix + name + "/"
    if not _check_folder_access(session["username"], prefix or full_path):
        return jsonify({"error": "Access denied to this folder"}), 403
    try:
        s3_service.create_folder(full_path)
        return jsonify({"message": "Folder '{}' created".format(name), "key": full_path})
    except (ClientError, NoCredentialsError, EndpointConnectionError) as e:
        return jsonify({"error": "S3 error: {}".format(str(e))}), 502


@app.route("/api/s3/download")
@login_required
def api_s3_download():
    key = request.args.get("key", "")
    key = _sanitize_key(key)
    if not key:
        return jsonify({"error": "File key required"}), 400
    # Check folder access using the parent path
    parent = key.rsplit("/", 1)[0] + "/" if "/" in key else ""
    if not _check_folder_access(session["username"], parent):
        return jsonify({"error": "Access denied"}), 403
    try:
        resp = s3_service.get_object(key)
        filename = key.rsplit("/", 1)[-1]
        content_type = resp.get("ContentType", "application/octet-stream")
        headers = {
            "Content-Disposition": 'attachment; filename="{}"'.format(filename),
            "Content-Type": content_type,
        }
        return Response(resp["Body"].iter_chunks(1024 * 64), headers=headers)
    except (ClientError, NoCredentialsError, EndpointConnectionError) as e:
        return jsonify({"error": "S3 error: {}".format(str(e))}), 502


@app.route("/api/s3/delete", methods=["POST"])
@login_required
def api_s3_delete():
    data = request.get_json()
    key = data.get("key", "") if data else ""
    key = _sanitize_key(key)
    if not key:
        return jsonify({"error": "File key required"}), 400
    parent = key.rsplit("/", 1)[0] + "/" if "/" in key else ""
    if not _check_folder_access(session["username"], parent):
        return jsonify({"error": "Access denied"}), 403
    try:
        s3_service.delete_object(key)
        return jsonify({"message": "File '{}' deleted successfully".format(key), "key": key})
    except (ClientError, NoCredentialsError, EndpointConnectionError) as e:
        return jsonify({"error": "S3 error: {}".format(str(e))}), 502


@app.route("/api/s3/preview")
@login_required
def api_s3_preview():
    key = request.args.get("key", "")
    key = _sanitize_key(key)
    if not key:
        return jsonify({"error": "File key required"}), 400
    parent = key.rsplit("/", 1)[0] + "/" if "/" in key else ""
    if not _check_folder_access(session["username"], parent):
        return jsonify({"error": "Access denied"}), 403
    try:
        resp = s3_service.get_object(key)
        content_type = resp.get("ContentType", "application/octet-stream")
        filename = key.rsplit("/", 1)[-1]
        headers = {
            "Content-Disposition": 'inline; filename="{}"'.format(filename),
            "Content-Type": content_type,
        }
        return Response(resp["Body"].iter_chunks(1024 * 64), headers=headers)
    except (ClientError, NoCredentialsError, EndpointConnectionError) as e:
        return jsonify({"error": "S3 error: {}".format(str(e))}), 502


# ---------------------------------------------------------------------------
# Admin routes
# ---------------------------------------------------------------------------
@app.route("/api/admin/users", methods=["GET"])
@admin_required
def api_admin_list_users():
    config = auth_service.get_config()
    users = []
    for u in config["users"]:
        users.append({
            "username": u["username"],
            "role": u["role"],
            "must_change_password": u.get("must_change_password", False),
            "allowed_folders": u.get("allowed_folders", []),
        })
    return jsonify({"users": users})


@app.route("/api/admin/users", methods=["POST"])
@admin_required
def api_admin_add_user():
    data = request.get_json()
    if not data or not data.get("username") or not data.get("password"):
        return jsonify({"error": "Username and password required"}), 400
    username = data["username"].strip()
    if not re.match(r'^[\w.\-@]+$', username):
        return jsonify({"error": "Invalid username format"}), 400
    try:
        auth_service.add_user(
            username=username,
            temp_password=data["password"],
            role=data.get("role", "user"),
            allowed_folders=data.get("allowed_folders", []),
        )
        return jsonify({"message": "User '{}' created".format(username)})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/admin/users/<username>", methods=["PUT"])
@admin_required
def api_admin_update_user(username):
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400
    try:
        auth_service.update_user(
            username=username,
            role=data.get("role"),
            allowed_folders=data.get("allowed_folders"),
        )
        if data.get("reset_password"):
            auth_service.admin_reset_password(username, data["reset_password"])
        return jsonify({"message": "User '{}' updated".format(username)})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/admin/users/<username>", methods=["DELETE"])
@admin_required
def api_admin_delete_user(username):
    if username == session["username"]:
        return jsonify({"error": "Cannot delete your own account"}), 400
    auth_service.delete_user(username)
    return jsonify({"message": "User '{}' deleted".format(username)})


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    port = config["app"].get("port", 5000)
    app.run(host="0.0.0.0", port=port, debug=True)
