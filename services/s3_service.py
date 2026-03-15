import boto3
from botocore.exceptions import ClientError

_client = None
_bucket = None
_config = None


def init(s3_config):
    global _client, _bucket, _config
    _config = s3_config
    _bucket = s3_config["bucket"]
    kwargs = {"region_name": s3_config.get("region", "us-east-1")}
    if s3_config.get("endpoint_url"):
        kwargs["endpoint_url"] = s3_config["endpoint_url"]
    _client = boto3.client("s3", **kwargs)


def get_client():
    if _client is None:
        raise RuntimeError("S3 service not initialized. Call init() first.")
    return _client


def list_objects(prefix=""):
    client = get_client()
    items = []
    kwargs = {
        "Bucket": _bucket,
        "Prefix": prefix,
        "Delimiter": "/",
    }
    while True:
        resp = client.list_objects_v2(**kwargs)
        for cp in resp.get("CommonPrefixes", []):
            name = cp["Prefix"][len(prefix):]
            if name:
                items.append({"name": name, "type": "folder", "size": 0, "last_modified": None})
        for obj in resp.get("Contents", []):
            key = obj["Key"]
            if key == prefix:
                continue
            name = key[len(prefix):]
            if name:
                items.append({
                    "name": name,
                    "type": "file",
                    "size": obj["Size"],
                    "last_modified": obj["LastModified"].isoformat(),
                })
        if resp.get("IsTruncated"):
            kwargs["ContinuationToken"] = resp["NextContinuationToken"]
        else:
            break
    items.sort(key=lambda x: (0 if x["type"] == "folder" else 1, x["name"].lower()))
    return items


def upload_file(key, file_obj):
    client = get_client()
    client.upload_fileobj(file_obj, _bucket, key)
    return {"key": key, "bucket": _bucket}


def create_folder(prefix):
    if not prefix.endswith("/"):
        prefix += "/"
    client = get_client()
    client.put_object(Bucket=_bucket, Key=prefix, Body=b"")
    return {"key": prefix, "bucket": _bucket}


def delete_object(key):
    client = get_client()
    client.delete_object(Bucket=_bucket, Key=key)
    return {"key": key, "bucket": _bucket}


def generate_presigned_url(key, expiration=300):
    client = get_client()
    url = client.generate_presigned_url(
        "get_object",
        Params={"Bucket": _bucket, "Key": key},
        ExpiresIn=expiration,
    )
    return url


def get_object(key):
    client = get_client()
    resp = client.get_object(Bucket=_bucket, Key=key)
    return resp
