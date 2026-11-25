"""Full-table Base dump / diff for acceptance baselines (read-only).

Usage:
  python3 base_full.py dump   <base_token> <table_id> <out.json>
  python3 base_full.py diff   <before.json> <after.json>
"""
import json
import sys

import base_tool


def list_records(base, table, tok):
    items, token = [], None
    while True:
        url = f"https://open.feishu.cn/open-apis/bitable/v1/apps/{base}/tables/{table}/records?page_size=500"
        if token:
            url += f"&page_token={token}"
        body = base_tool.call("GET", url, tok)
        if body.get("code") != 0:
            raise SystemExit(f"list failed: {body.get('code')} {body.get('msg')}")
        data = body.get("data") or {}
        items.extend(data.get("items") or [])
        token = data.get("page_token")
        if not data.get("has_more"):
            return items


def main():
    base_tool.load_env()
    cmd = sys.argv[1]
    tok = base_tool.token()
    if cmd == "dump":
        base, table, out = sys.argv[2:5]
        items = list_records(base, table, tok)
        payload = {item["record_id"]: item.get("fields") or {} for item in items}
        with open(out, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
        print(json.dumps({"rows": len(payload), "out": out}, ensure_ascii=False))
    elif cmd == "diff":
        before_path, after_path = sys.argv[2:4]
        before = json.load(open(before_path, encoding="utf-8"))
        after = json.load(open(after_path, encoding="utf-8"))
        added = sorted(set(after) - set(before))
        removed = sorted(set(before) - set(after))
        changed = []
        for rid in sorted(set(before) & set(after)):
            if before[rid] != after[rid]:
                keys = sorted(set(before[rid]) | set(after[rid]))
                fields = [k for k in keys if before[rid].get(k) != after[rid].get(k)]
                changed.append({"record": rid, "fields": fields})
        print(json.dumps({
            "before_rows": len(before), "after_rows": len(after),
            "added": added, "removed": removed, "changed": changed,
        }, ensure_ascii=False, indent=2))
    else:
        raise SystemExit(f"unknown command {cmd}")


if __name__ == "__main__":
    main()
