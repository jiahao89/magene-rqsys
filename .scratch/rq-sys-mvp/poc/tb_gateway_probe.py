#!/usr/bin/env python3
"""Ticket 01 read-only Teambition gateway POC probes.

Outputs masked evidence only: counts, statuses, value shapes.
Never prints requirement content, user names, personal values, or tokens.
"""
import json
import sys
import time
from collections import Counter

sys.path.insert(0, "/Users/jacko/Projects/RQ-Sys/skills/teambition/scripts")
import requests  # noqa: E402
import teambition_api as tb  # noqa: E402

PROJECT_ID = "674e77e9ee4037da9d4b9f8e"
REQ_CONFIG_ID = "674e7a7e5f95a1404621bb4c"

CANDIDATE_FIELDS = {
    "674e7c2ceed2e651764a0d6f": "description_rtf",
    "674e8d321f580fe19bee3a32": "acceptance_rtf",
    "68be4f5f4f5b7255e6fda8d6": "proposer_lookup",
    "674e7a7e5f95a1404621bb40": "category_commongroup",
    "674e7bab5f95a1404621c2f0": "type_dropDown",
}

results = {"probe_date": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "probes": {}}


def call(method, path, params=None, payload=None, headers=None, timeout=90):
    url = f"{tb.BASE_URL}{path}"
    t0 = time.time()
    try:
        r = requests.request(
            method, url, headers=headers or tb.HEADERS, params=params,
            json=payload, timeout=timeout,
        )
        try:
            body = r.json()
        except ValueError:
            body = r.text[:300]
        return {"status": r.status_code, "ms": int((time.time() - t0) * 1000), "body": body}
    except Exception as e:
        return {"status": None, "ms": int((time.time() - t0) * 1000), "error": type(e).__name__}


def shape_of(v):
    if v is None:
        return "null"
    if isinstance(v, list):
        return "array[%d]" % len(v)
    if isinstance(v, dict):
        return "object{%s}" % ",".join(sorted(v.keys())[:8])
    return type(v).__name__


def probe(name, data):
    results["probes"][name] = data
    print(f"[{name}] done", file=sys.stderr)


# P1: full requirement list fetch + field stats
def fetch_requirements():
    r = call("GET", "/getProjectTasks", params={
        "project_id": PROJECT_ID, "scenariofield_config_id": REQ_CONFIG_ID,
    })
    out = {"http_status": r["status"], "latency_ms": r["ms"]}
    tasks = r["body"] if isinstance(r["body"], list) else []
    out["record_count"] = len(tasks)
    if tasks:
        top_keys = Counter()
        for t in tasks:
            top_keys.update(t.keys())
        out["top_level_keys"] = dict(top_keys)
        ids = [t.get("id") for t in tasks]
        out["id_stats"] = {
            "total": len(ids),
            "unique": len(set(ids)),
            "null_or_empty": sum(1 for i in ids if not i),
            "sample_prefix": str(ids[0])[:2] + "..." if ids else None,
            "all_24hex": all(isinstance(i, str) and len(i) == 24 for i in ids),
        }
        out["unique_id_stats"] = {
            "present": sum(1 for t in tasks if t.get("unique_id") not in (None, "")),
            "type": shape_of(next((t.get("unique_id") for t in tasks if t.get("unique_id") is not None), None)),
        }
        out["empty_value_counts"] = {
            "executor_id_null": sum(1 for t in tasks if not t.get("executor_id")),
            "creator_id_null": sum(1 for t in tasks if not t.get("creator_id")),
            "content_null": sum(1 for t in tasks if not t.get("content")),
            "duedate_null": sum(1 for t in tasks if not t.get("duedate")),
            "startdate_null": sum(1 for t in tasks if not t.get("startdate")),
            "custom_fields_null": sum(1 for t in tasks if not t.get("custom_fields")),
            "sprint_id_null": sum(1 for t in tasks if not t.get("sprint_id")),
        }
        out["has_updated_or_modified_field"] = any(
            k in t for t in tasks[:50] for k in ("updated", "modified", "updated_at", "modified_at")
        )
        # custom_fields parsing + candidate field value shapes
        parsed = 0
        failed = 0
        cand_stats = {k: Counter() for k in CANDIDATE_FIELDS}
        for t in tasks:
            raw = t.get("custom_fields")
            if not raw:
                continue
            try:
                arr = json.loads(raw) if isinstance(raw, str) else raw
                parsed += 1
            except (ValueError, TypeError):
                failed += 1
                continue
            if not isinstance(arr, list):
                continue
            for item in arr:
                fid = item.get("_customfieldid")
                if fid in cand_stats:
                    stats = cand_stats[fid]
                    if "value" in item and item["value"] is not None and item["value"] != "":
                        stats["value_shape:" + shape_of(item["value"])] += 1
                    if "values" in item and item["values"] not in (None, []):
                        stats["values_shape:" + shape_of(item["values"])] += 1
                    if item.get("value") in (None, "") and not item.get("values"):
                        stats["empty"] += 1
        out["custom_fields_parse"] = {"parsed_ok": parsed, "parse_failed": failed}
        out["candidate_field_shapes"] = {CANDIDATE_FIELDS[k]: dict(v) for k, v in cand_stats.items()}
    return out


t0 = time.time()
fetch1 = fetch_requirements()
fetch1["total_elapsed_ms"] = int((time.time() - t0) * 1000)
probe("full_fetch_1", fetch1)

# P2: repeat fetch for ID stability
t0 = time.time()
fetch2 = fetch_requirements()
fetch2["total_elapsed_ms"] = int((time.time() - t0) * 1000)
ids1 = set()
ids2 = set()
if "id_stats" in fetch1:
    probe("full_fetch_2", fetch2)
# recompute raw id sets by refetching minimal info is wasteful; store via second fetch ids
def fetch_ids_only():
    r = call("GET", "/getProjectTasks", params={
        "project_id": PROJECT_ID, "scenariofield_config_id": REQ_CONFIG_ID,
    })
    tasks = r["body"] if isinstance(r["body"], list) else []
    return set(t.get("id") for t in tasks), r["status"], r["ms"]

idset_a, sa, ma = fetch_ids_only()
time.sleep(20)
idset_b, sb, mb = fetch_ids_only()
probe("id_stability", {
    "count_a": len(idset_a), "count_b": len(idset_b),
    "identical_sets": idset_a == idset_b,
    "added": len(idset_b - idset_a), "removed": len(idset_a - idset_b),
    "interval_seconds": 20, "status_a": sa, "status_b": sb, "ms_a": ma, "ms_b": mb,
})

# P3: pagination probes — does the gateway honor extra params?
page_probes = {}
for label, params in {
    "baseline": {},
    "page_1_size_10": {"page": 1, "pageSize": 10},
    "page_2_size_10": {"page": 2, "pageSize": 10},
    "limit_10_offset_10": {"limit": 10, "offset": 10},
    "count_10": {"count": 10},
    "pageSize_only_10": {"pageSize": 10},
}.items():
    r = call("GET", "/getProjectTasks", params={
        "project_id": PROJECT_ID, "scenariofield_config_id": REQ_CONFIG_ID, **params,
    })
    n = len(r["body"]) if isinstance(r["body"], list) else None
    page_probes[label] = {"status": r["status"], "ms": r["ms"], "record_count": n,
                          "same_as_baseline": n == fetch1.get("record_count")}
probe("pagination_params", page_probes)

# P4: sort / updated-time filter probes
sort_probes = {}
for label, params in {
    "order_by_updated": {"orderBy": "updated", "order": "desc"},
    "updated_filter": {"updatedFrom": "2026-09-01", "updatedTo": "2026-10-08"},
    "modified_filter": {"modifiedFrom": "2026-09-01"},
}.items():
    r = call("GET", "/getProjectTasks", params={
        "project_id": PROJECT_ID, "scenariofield_config_id": REQ_CONFIG_ID, **params,
    })
    n = len(r["body"]) if isinstance(r["body"], list) else None
    sort_probes[label] = {"status": r["status"], "record_count": n,
                          "honored": n is not None and n != fetch1.get("record_count")}
probe("sort_and_update_filter", sort_probes)

# P5: error behavior probes
err_probes = {}
r = call("GET", "/getProjectTasks", params={"project_id": "000000000000000000000000"})
err_probes["invalid_project"] = {"status": r["status"], "body_shape": shape_of(r.get("body")),
                                 "body_preview": str(r.get("body"))[:200]}
r = call("GET", "/getProjectTasks", params={"project_id": PROJECT_ID, "scenariofield_config_id": "000000000000000000000000"})
err_probes["invalid_config"] = {"status": r["status"], "body_shape": shape_of(r.get("body")),
                                "record_count": len(r["body"]) if isinstance(r["body"], list) else None}
r = call("GET", "/getProjectTasks", params={})
err_probes["missing_project_id"] = {"status": r["status"], "body_shape": shape_of(r.get("body")),
                                    "body_preview": str(r.get("body"))[:200]}
r = call("GET", "/getProjectTasks", params={"project_id": PROJECT_ID},
         headers={"Authorization": "Bearer invalid-key-for-poc"})
err_probes["invalid_auth"] = {"status": r["status"], "body_shape": shape_of(r.get("body")),
                              "body_preview": str(r.get("body"))[:200]}
r = call("GET", "/nonexistentEndpoint", params={"project_id": PROJECT_ID})
err_probes["unknown_endpoint"] = {"status": r["status"], "body_shape": shape_of(r.get("body"))}
probe("error_behavior", err_probes)

# P6: modest rate-limit probe — 6 sequential metadata calls, watch for 429/throttle
rate = []
for i in range(6):
    r = call("GET", "/getProjectScenarioFieldConfigs", params={"project_id": PROJECT_ID})
    rate.append({"i": i, "status": r["status"], "ms": r["ms"]})
probe("rate_limit_burst_6", {"calls": rate,
                             "any_429": any(c["status"] == 429 for c in rate),
                             "all_200": all(c["status"] == 200 for c in rate)})

# P7: task detail availability — check one task's activity (no content recorded)
sample_ids = None
r = call("GET", "/getProjectTasks", params={"project_id": PROJECT_ID, "scenariofield_config_id": REQ_CONFIG_ID})
if isinstance(r["body"], list) and r["body"]:
    sample_ids = [t.get("id") for t in r["body"][:2]]
detail = {}
if sample_ids:
    r2 = call("POST", "/getTaskActivityList", payload={"taskId": sample_ids[0]})
    acts = r2["body"] if isinstance(r2["body"], list) else []
    detail["getTaskActivityList"] = {"status": r2["status"], "is_list": isinstance(r2["body"], list),
                                     "activity_count": len(acts),
                                     "has_ancestor_key": any("ancestor" in a for a in acts if isinstance(a, dict))}
    r3 = call("POST", "/getTasksActivityList", payload={"taskIds": sample_ids})
    detail["getTasksActivityList"] = {"status": r3["status"], "is_dict": isinstance(r3["body"], dict),
                                      "keys": len(r3["body"]) if isinstance(r3["body"], dict) else None}
probe("task_detail_and_activity", detail)

with open("/Users/jacko/Projects/RQ-Sys/.scratch/rq-sys-mvp/poc/teambition-poc-probe.json", "w", encoding="utf-8") as f:
    json.dump(results, f, ensure_ascii=False, indent=2)
print(json.dumps(results, ensure_ascii=False, indent=2))
