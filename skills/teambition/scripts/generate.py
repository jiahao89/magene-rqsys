"""
周报数据生成器 — 从 Teambition API 拉取项目数据，生成结构化周报 JSON。

用法:
    python generate.py <project_id> [--week-start YYYY-MM-DD] [--output path.json] [--project-name "XX"]
"""
import json
import os
import re
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone

# ── 路径 ──────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
API_SCRIPT = os.path.join(BASE_DIR, "..", "scripts", "teambition_api.py")
CST = timezone(timedelta(hours=8))

# ── CLI ───────────────────────────────────────────────
def parse_args():
    args = {"project_id": None, "week_start": None, "output": None, "project_name": None, "primary_config": None}
    argv = sys.argv[1:]
    i = 0
    while i < len(argv):
        if argv[i] == "--week-start" and i + 1 < len(argv):
            args["week_start"] = argv[i + 1]; i += 2
        elif argv[i] == "--output" and i + 1 < len(argv):
            args["output"] = argv[i + 1]; i += 2
        elif argv[i] == "--project-name" and i + 1 < len(argv):
            args["project_name"] = argv[i + 1]; i += 2
        elif argv[i] == "--primary-config" and i + 1 < len(argv):
            args["primary_config"] = argv[i + 1]; i += 2
        elif not argv[i].startswith("--") and args["project_id"] is None:
            args["project_id"] = argv[i]; i += 1
        else:
            i += 1
    return args

# ── API 调用 ──────────────────────────────────────────
def run_api(*api_args):
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    result = subprocess.run(
        ["python", API_SCRIPT] + list(api_args),
        capture_output=True, text=True, timeout=120,
        encoding="utf-8", errors="replace", env=env,
    )
    if result.returncode != 0:
        print(f"  API error [{api_args[0]}]: {result.stderr[:200]}", file=sys.stderr)
        return None
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return None

# ── 时间工具 ──────────────────────────────────────────
def parse_ts(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None

def week_boundaries(monday_str):
    """给定周一日期，返回 (周一开始, 周日结束, 周五, 下周一开始, 下周日结束)"""
    monday = datetime.strptime(monday_str, "%Y-%m-%d").replace(tzinfo=CST)
    return (
        monday,
        monday + timedelta(days=6, hours=23, minutes=59, seconds=59),
        monday + timedelta(days=4, hours=23, minutes=59, seconds=59),
        monday + timedelta(days=7),
        monday + timedelta(days=13, hours=23, minutes=59, seconds=59),
    )

def parse_duedate(task, tz=CST):
    dd = task.get("duedate", "")
    if not dd:
        return None
    try:
        parts = dd.split(" ")
        if len(parts) >= 5 and "CST" in dd:
            month_map = {"Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6,
                         "Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12}
            m = month_map.get(parts[1], 1)
            d = int(parts[2])
            t = parts[3].split(":")
            y = int(parts[5])
            return datetime(y, m, d, int(t[0]), int(t[1]), 0, tzinfo=tz)
    except (ValueError, IndexError):
        pass
    try:
        return datetime.fromisoformat(dd.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        pass
    return None

# ── 主逻辑 ────────────────────────────────────────────
def generate(project_id, week_start_str, output_path, project_name=None):
    WEEK_START, WEEK_END, WEEK_FRIDAY, NEXT_WEEK_START, NEXT_WEEK_END = week_boundaries(week_start_str)

    # ── 项目名 ──
    if not project_name:
        proj = run_api("get_project", project_id)
        project_name = (proj or {}).get("name", project_id[:8])

    # ── 成员 ──
    print("Fetching members...")
    members = run_api("get_members") or {}

    def member_name(uid):
        if not uid: return "未分配"
        m = members.get(uid, {})
        return m.get("name", uid[:8])

    # ── 任务类型配置 ──
    print("Fetching scenario field configs...")
    configs = run_api("get_scenariofield_configs", project_id) or {}
    # 自动识别主任务配置：优先不含"交付物"的"任务"配置（如"任务-(硬件项目)"）
    # 其次按 ID 降序取含"任务"的配置，可用 --primary-config 覆盖
    task_configs = [(cid, name) for cid, name in configs.items() if "任务" in name]
    # 优先选不含"交付物"的配置
    non_deliverable = [(cid, name) for cid, name in task_configs if "交付物" not in name]
    if non_deliverable:
        primary_configs = [max(non_deliverable, key=lambda x: x[0])[0]]
    elif task_configs:
        primary_configs = [max(task_configs, key=lambda x: x[0])[0]]
    else:
        primary_configs = []
    primary_config_override = args.get("primary_config")
    if primary_config_override:
        primary_configs = [primary_config_override]
    print(f"  Primary config: {primary_configs[0] if primary_configs else 'N/A'}")
    other_configs = [cid for cid in configs if cid not in primary_configs]
    all_config_ids = primary_configs + other_configs

    # ── 任务流状态 ──
    print("Fetching task flows...")
    flows = run_api("get_task_flows", project_id) or {}
    flow_ids = ",".join(flows.keys()) if flows else ""
    status_names = {}
    completed_status_ids = set()
    if flow_ids:
        tfs = run_api("get_task_flow_status", flow_ids) or {}
        for sid, sname in tfs.items():
            status_names[sid] = sname
            if sname == "已完成":
                completed_status_ids.add(sid)

    # ── 所有任务 ──
    print("Fetching all tasks...")
    all_tasks = []
    for cid in all_config_ids:
        data = run_api("get_tasks", project_id, "--scenariofield_config_id", cid, "--include-archived")
        if isinstance(data, list):
            for t in data:
                t["_config_id"] = cid
            all_tasks.extend(data)
    print(f"  {len(all_tasks)} tasks across {len(all_config_ids)} configs")

    # ── 活动日志 ──
    print("Fetching activity logs...")
    all_task_ids = [t["id"] for t in all_tasks if t.get("id")]
    activities_by_task = {}
    archived_task_ids = set()
    BATCH = 50
    for i in range(0, len(all_task_ids), BATCH):
        batch = all_task_ids[i:i + BATCH]
        data = run_api("get_tasks_activity", ",".join(batch))
        if isinstance(data, dict):
            activities_by_task.update(data)
    # 检测已归档任务
    for tid, acts in activities_by_task.items():
        for act in acts:
            try:
                if json.loads(act.get("content", "{}")).get("isarchived"):
                    archived_task_ids.add(tid)
                    break
            except (json.JSONDecodeError, TypeError):
                pass
    # 收集已归档的任务名（用于幽灵任务过滤）
    archived_names = set()
    for task in all_tasks:
        if task.get("id") in archived_task_ids:
            archived_names.add(task.get("content", ""))

    # 检测幽灵子任务（任务拆解自动生成，活动日志含 ancestor）
    ghost_task_ids = set()
    for tid, acts in activities_by_task.items():
        for act in acts:
            try:
                if json.loads(act.get("content", "{}")).get("ancestor"):
                    ghost_task_ids.add(tid)
                    break
            except (json.JSONDecodeError, TypeError):
                pass

    # 幽灵且同名真实任务已归档 → 排除
    orphan_ghost_ids = {tid for tid in ghost_task_ids
                        if next((t.get("content","") for t in all_tasks if t.get("id") == tid), "") in archived_names}

    print(f"  {len(activities_by_task)} tasks with activities, {len(archived_task_ids)} archived, {len(orphan_ghost_ids)} orphan ghosts")

    def should_exclude(task):
        tid = task.get("id", "")
        return task.get("isarchived") or tid in archived_task_ids or tid in orphan_ghost_ids

    def is_completed(task):
        return task.get("taskflow_status_id", "") in completed_status_ids

    def status_name(sid):
        return status_names.get(sid, sid[:8] if sid else "?")

    # ── 1. 本周已完成 ─────────────────────────────────
    def get_completed():
        results = []
        seen = set()
        phase_patterns = ["立项阶段", "计划阶段", "EVT阶段", "DVT阶段", "PVT阶段", "量产爬坡阶段"]
        for task in all_tasks:
            content = task.get("content", "")
            if content in phase_patterns or should_exclude(task):
                continue
            acts = activities_by_task.get(task.get("id"), [])
            status_changes = []
            for act in acts:
                created = parse_ts(act.get("created"))
                if not created or not (WEEK_START <= created <= WEEK_END):
                    continue
                try:
                    c = json.loads(act["content"])
                except (json.JSONDecodeError, TypeError):
                    continue
                tfs = c.get("taskflowstatus", "")
                if tfs and tfs != c.get("oldtaskflowstatus", tfs):
                    status_changes.append((created, tfs))
            if status_changes:
                status_changes.sort(key=lambda x: x[0])
                if status_changes[-1][1] == "已完成" and content not in seen:
                    seen.add(content)
                    results.append({
                        "title": content,
                        "executor": member_name(task.get("executor_id")),
                        "date": status_changes[-1][0].strftime("%Y-%m-%d"),
                    })
        return results

    # ── 2. 延期任务 ────────────────────────────────────
    def get_delayed(completed_names):
        # 延期检查覆盖任务、问题、缺陷、风险等工作项配置，排除模板残留类配置
        delayed_configs = []
        for cid, cname in configs.items():
            if any(kw in cname for kw in ["任务", "问题", "缺陷", "风险"]) and "交付物" not in cname:
                delayed_configs.append(cid)
        if not delayed_configs:
            return []

        delayed_tasks = [t for t in all_tasks
                         if t.get("_config_id") in delayed_configs and not should_exclude(t)]

        completed_set = set(completed_names)
        _completed_task_ids = set()
        # 从活动日志中补充所有已完成任务（取最终状态，兜底 taskflow_status API 返回空的情况）
        for tid, acts in activities_by_task.items():
            latest_status = None
            latest_time = None
            for act in acts:
                try:
                    tfs = json.loads(act.get("content", "{}")).get("taskflowstatus")
                    if tfs:
                        created = parse_ts(act.get("created"))
                        if created and (latest_time is None or created > latest_time):
                            latest_time = created
                            latest_status = tfs
                except (json.JSONDecodeError, TypeError):
                    pass
            if latest_status == "已完成":
                name = next((t.get("content","") for t in all_tasks if t.get("id") == tid), "")
                if name:
                    completed_set.add(name)
                    _completed_task_ids.add(tid)

        phase_patterns = ["立项阶段", "计划阶段", "EVT阶段", "DVT阶段", "PVT阶段", "量产爬坡阶段"]

        name_to_tasks = defaultdict(list)
        for task in delayed_tasks:
            content = task.get("content", "")
            if content not in phase_patterns:
                name_to_tasks[content].append(task)

        results = []
        for name, tasks in name_to_tasks.items():
            if name in completed_set:
                continue
            # 排除所有实例均为幽灵子任务（含 ancestor 引用）的模板残留
            if all(t.get("id") in ghost_task_ids for t in tasks):
                continue
            best = max(tasks, key=lambda t: (1 if t.get("executor_id") else 0,))
            if best.get("id") in _completed_task_ids:
                continue
            dd = parse_duedate(best)
            if dd and dd <= WEEK_FRIDAY:
                days = (WEEK_END - dd).days
                if days >= 0:
                    results.append({
                        "title": name,
                        "executor": member_name(best.get("executor_id")),
                        "duedate": dd.strftime("%Y-%m-%d"),
                        "delay_days": days,
                    })
        results.sort(key=lambda x: x["delay_days"], reverse=True)
        return results

    # ── 3. 进展更新 ────────────────────────────────────
    def get_progress():
        results = []
        seen = set()
        for task in all_tasks:
            if should_exclude(task):
                continue
            tid = task.get("id")
            content = task.get("content", "")
            acts = activities_by_task.get(tid, [])
            text_items = []
            for act in acts:
                created = parse_ts(act.get("created"))
                if not created or not (WEEK_START <= created <= WEEK_END):
                    continue
                try:
                    c = json.loads(act["content"])
                except (json.JSONDecodeError, TypeError):
                    continue
                if "redirecturl" in c and "comment" in c:
                    text_items.append((created, c["comment"]))
                elif "isonlynotifymentions" in c and "comment" in c:
                    comment = c["comment"]
                    if "依赖任务状态变更" not in comment and "该任务标题已被变更" not in comment:
                        text_items.append((created, comment))
            if text_items and content not in seen:
                seen.add(content)
                latest = max(text_items, key=lambda x: x[0])
                dd = parse_duedate(task)
                comment = re.sub(r'@\S+\s*', '', latest[1])
                comment = re.sub(r'​', '', comment)
                results.append({
                    "title": content,
                    "executor": member_name(task.get("executor_id")),
                    "duedate": dd.strftime("%Y-%m-%d") if dd else "无",
                    "detail": comment.strip(),
                    "time": latest[0].strftime("%m-%d %H:%M"),
                })
        results.sort(key=lambda x: x["time"], reverse=True)
        return results

    # ── 4. 下周截止 ────────────────────────────────────
    def get_next_week():
        results = []
        seen = set()
        for task in all_tasks:
            if should_exclude(task):
                continue
            dd = parse_duedate(task)
            if dd and NEXT_WEEK_START <= dd <= NEXT_WEEK_END:
                content = task.get("content", "")
                if content not in seen:
                    seen.add(content)
                    results.append({
                        "title": content,
                        "executor": member_name(task.get("executor_id")),
                        "duedate": dd.strftime("%Y-%m-%d"),
                        "status": status_name(task.get("taskflow_status_id")),
                    })
        results.sort(key=lambda x: x["duedate"])
        return results

    # ── 执行 ───────────────────────────────────────────
    completed = get_completed()
    delayed = get_delayed([t["title"] for t in completed])
    progress = get_progress()
    next_week = get_next_week()

    # ── 打印 ───────────────────────────────────────────
    week_num = WEEK_START.isocalendar()[1]
    print(f"\n{'='*70}")
    print(f"{project_name} 项目周报【2026第{week_num}周】")
    print(f"周期：{WEEK_START.strftime('%Y-%m-%d')} ~ {WEEK_END.strftime('%Y-%m-%d')}")
    print(f"{'='*70}")

    for label, items, cols, key_map in [
        ("一、本周已完成任务", completed,
         [("标题", 40), ("责任人", 12), ("完成时间", 12)],
         [("title", 40), ("executor", 12), ("date", 12)]),
        ("二、延期任务", delayed,
         [("标题", 40), ("责任人", 12), ("截止时间", 12), ("延期天数", 8)],
         [("title", 40), ("executor", 12), ("duedate", 12), ("delay_days", 8, "天")]),
    ]:
        print(f"\n{'='*70}")
        print(f"{label}（{len(items)}项）")
        print(f"{'='*70}")
        header = "".join(c[0].ljust(c[1]) for c in cols)
        print(header)
        print("-" * 70)
        for item in items:
            row = ""
            for km in key_map:
                val = str(item.get(km[0], ""))
                suffix = km[2] if len(km) > 2 else ""
                val = (val[:km[1]-3] + "..") if len(val) > km[1] else val
                row += (val + suffix).ljust(km[1])
            print(row)

    print(f"\n{'='*70}")
    print(f"三、本周任务进展更新的详情（{len(progress)}项）")
    print(f"{'='*70}")
    for i, t in enumerate(progress):
        print(f"\n[{i+1}] {t['title']}")
        print(f"    责任人: {t['executor']} | 截止: {t['duedate']} | 更新: {t['time']}")
        print(f"    进展: {t['detail']}")

    print(f"\n{'='*70}")
    print(f"四、截止时间为下周完成的任务（{len(next_week)}项）")
    print(f"{'='*70}")
    print(f"{'标题':<40} {'责任人':<12} {'截止时间':<12} {'状态'}")
    print("-" * 70)
    for t in next_week:
        title = t["title"][:38] + ".." if len(t["title"]) > 40 else t["title"]
        print(f"{title:<40} {t['executor']:<12} {t['duedate']:<12} {t['status']}")

    # ── 输出 JSON ──────────────────────────────────────
    report = {
        "project_id": project_id,
        "project_name": project_name,
        "week_start": WEEK_START.strftime("%Y-%m-%d"),
        "week_end": WEEK_END.strftime("%Y-%m-%d"),
        "week_num": f"2026年第{week_num}周",
        "completed": completed,
        "delayed": delayed,
        "progress": progress,
        "next_week": next_week,
    }

    if not output_path:
        output_path = os.path.join(os.path.dirname(BASE_DIR), "..", "..", "..", "output",
                                   f"{project_name}-周报-{WEEK_START.strftime('%Y%m%d')}.json")
    output_path = os.path.abspath(output_path)
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"\nJSON saved to {output_path}")
    return report

# ── 入口 ───────────────────────────────────────────────
if __name__ == "__main__":
    args = parse_args()
    if not args["project_id"]:
        print("Usage: python generate.py <project_id> [--week-start YYYY-MM-DD] [--project-name XX] [--output path.json]")
        sys.exit(1)

    if not args["week_start"]:
        # 默认上周一
        today = datetime.now(CST)
        last_monday = today - timedelta(days=today.weekday() + 7)
        args["week_start"] = last_monday.strftime("%Y-%m-%d")

    generate(
        project_id=args["project_id"],
        week_start_str=args["week_start"],
        output_path=args.get("output"),
        project_name=args.get("project_name"),
    )
