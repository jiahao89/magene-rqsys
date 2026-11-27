"""Minimal Feishu Base reader/writer for acceptance evidence.

Credentials come from the repository's local .env / .env.local (never printed).
Usage:
  python3 base_tool.py get <base_token> <table_id> <record_id>
  python3 base_tool.py dump <base_token> <table_id> <record_id> <out.json>
  python3 base_tool.py update <base_token> <table_id> <record_id> <fields.json>
"""
import json
import os
import sys
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def load_env():
    for name in (".env", ".env.local"):
        path = os.path.join(ROOT, name)
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def token():
    payload = json.dumps({
        "app_id": os.environ["FEISHU_APP_ID"],
        "app_secret": os.environ["FEISHU_APP_SECRET"],
    }).encode()
    req = urllib.request.Request(
        "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    body = json.load(urllib.request.urlopen(req, timeout=20))
    if body.get("code") != 0:
        raise SystemExit(f"tenant token failed: {body.get('code')} {body.get('msg')}")
    return body["tenant_access_token"]


def call(method, url, tok, payload=None):
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode()
    headers = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        return json.load(urllib.request.urlopen(req, timeout=30))
    except urllib.error.HTTPError as error:
        return json.loads(error.read().decode())


def record_url(base, table, record_id):
    return f"https://open.feishu.cn/open-apis/bitable/v1/apps/{base}/tables/{table}/records/{record_id}"


def main():
    load_env()
    cmd = sys.argv[1]
    tok = token()
    if cmd == "get":
        base, table, record = sys.argv[2:5]
        body = call("GET", record_url(base, table, record), tok)
        print(json.dumps(body, ensure_ascii=False))
    elif cmd == "dump":
        base, table, record, out = sys.argv[2:6]
        body = call("GET", record_url(base, table, record), tok)
        with open(out, "w", encoding="utf-8") as handle:
            json.dump(body, handle, ensure_ascii=False, indent=2)
        fields = (body.get("data") or {}).get("record", {}).get("fields", {})
        print(json.dumps({"code": body.get("code"), "fields": len(fields), "out": out}, ensure_ascii=False))
    elif cmd == "update":
        base, table, record, payload_path = sys.argv[2:6]
        with open(payload_path, encoding="utf-8") as handle:
            fields = json.load(handle)
        body = call("PUT", record_url(base, table, record), tok, {"fields": fields})
        print(json.dumps({"code": body.get("code"), "msg": body.get("msg")}, ensure_ascii=False))
    else:
        raise SystemExit(f"unknown command {cmd}")


if __name__ == "__main__":
    main()
