#!/usr/bin/env python3
import argparse
import json
import os
import sys
from urllib.parse import urlencode

import requests

API_KEY = os.environ.get("GATEWAY_API_KEY", "")
BASE_URL = os.environ.get("TEAMBITION_GATEWAY_URL", "")

HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json",
}


def _print_json(data):
    print(json.dumps(data, ensure_ascii=False, indent=2))


def _get_completed_status_ids(tasks):
    """Given a list of tasks, identify which status IDs represent completed-equivalent states."""
    # Collect unique status IDs from the task list
    status_ids = set()
    for t in tasks:
        sid = t.get("taskflow_status_id")
        if sid:
            status_ids.add(sid)
    if not status_ids:
        return set()

    ids_param = ",".join(status_ids)
    res = requests.get(f"{BASE_URL}/getTaskFlowStatus", headers=HEADERS, params={"tfsIds": ids_param})
    res.raise_for_status()
    all_statuses = res.json()
    if not all_statuses:
        return set()

    completed = set()
    for sid, name in all_statuses.items():
        if "完成" in name:
            completed.add(sid)
    return completed


def cmd_get_members(_args):
    res = requests.get(f"{BASE_URL}/getMembers", headers=HEADERS)
    res.raise_for_status()
    _print_json(res.json())


def cmd_get_projects(_args):
    res = requests.get(f"{BASE_URL}/getProjects", headers=HEADERS)
    res.raise_for_status()
    _print_json(res.json())


def cmd_get_project(args):
    res = requests.post(f"{BASE_URL}/getProject", headers=HEADERS, json={"project_id": args.project_id})
    res.raise_for_status()
    _print_json(res.json())


def cmd_get_custom_fields(args):
    res = requests.get(f"{BASE_URL}/getProjectCustomFields", headers=HEADERS, params={"project_id": args.project_id})
    res.raise_for_status()
    _print_json(res.json())


def cmd_get_scenariofield_configs(args):
    res = requests.get(f"{BASE_URL}/getProjectScenarioFieldConfigs", headers=HEADERS, params={"project_id": args.project_id})
    res.raise_for_status()
    _print_json(res.json())


def cmd_get_task_flows(args):
    res = requests.get(f"{BASE_URL}/getProjectTaskFlows", headers=HEADERS, params={"project_id": args.project_id})
    res.raise_for_status()
    _print_json(res.json())


def cmd_get_task_flow_status(args):
    taskflow_ids_str = ",".join(args.taskflow_ids)
    res = requests.get(f"{BASE_URL}/getProjectTaskFlowStatus", headers=HEADERS, params={"taskflow_ids": taskflow_ids_str})
    res.raise_for_status()
    _print_json(res.json())


def cmd_get_bug_groups(args):
    res = requests.get(f"{BASE_URL}/getProjectBugGroups", headers=HEADERS, params={"project_id": args.project_id})
    res.raise_for_status()
    _print_json(res.json())


def cmd_get_sprints(args):
    res = requests.get(f"{BASE_URL}/getProjectSprints", headers=HEADERS, params={"project_id": args.project_id})
    res.raise_for_status()
    _print_json(res.json())


def cmd_get_tasks(args):
    params = {"project_id": args.project_id}
    if args.scenariofield_config_id:
        params["scenariofield_config_id"] = args.scenariofield_config_id
    res = requests.get(f"{BASE_URL}/getProjectTasks", headers=HEADERS, params=params)
    res.raise_for_status()
    tasks = res.json()

    if not args.include_archived:
        completed_ids = _get_completed_status_ids(tasks)
        tasks = [t for t in tasks if t.get("taskflow_status_id") not in completed_ids]

    _print_json(tasks)


def cmd_get_tasks_by_name(args):
    payload = {
        "project_id": args.project_id,
        "scenariofield_names": args.names.split(","),
    }
    if args.sprintIds:
        payload["sprintIds"] = args.sprintIds.split(",")
    if args.bugGroupIds:
        payload["bugGroupIds"] = args.bugGroupIds.split(",")
    if args.limit:
        payload["limit"] = args.limit
    res = requests.post(f"{BASE_URL}/getProjectTasksByScenarioFieldName", headers=HEADERS, json=payload)
    res.raise_for_status()
    tasks = res.json()

    if not args.include_archived:
        # Note: getProjectTasksByScenarioFieldName typically excludes archived tasks
        # natively. The status name filter is a secondary guard for edge cases.
        tasks = [t for t in tasks if t.get("taskflow_status") not in ("已完成",)]

    _print_json(tasks)


def cmd_get_bugs(args):
    params = {"project_id": args.project_id}
    if args.scenariofield_config_id:
        params["scenariofield_config_id"] = args.scenariofield_config_id
    if args.sprintIds:
        params["sprintIds"] = args.sprintIds
    if args.bugGroupIds:
        params["bugGroupIds"] = args.bugGroupIds
    res = requests.get(f"{BASE_URL}/getProjectBugs", headers=HEADERS, params=params)
    res.raise_for_status()
    _print_json(res.json())


def cmd_get_full_bugs(args):
    payload = {"project_id": args.project_id}
    if args.scenariofield_config_id:
        payload["scenariofield_config_id"] = args.scenariofield_config_id
    if args.sprintIds:
        payload["sprintIds"] = args.sprintIds.split(",")
    if args.bugGroupIds:
        payload["bugGroupIds"] = args.bugGroupIds.split(",")
    if args.limit:
        payload["limit"] = args.limit
    res = requests.post(f"{BASE_URL}/getFullProjectBugs", headers=HEADERS, json=payload)
    res.raise_for_status()
    _print_json(res.json())


def cmd_get_task_activity(args):
    res = requests.post(f"{BASE_URL}/getTaskActivityList", headers=HEADERS, json={"taskId": args.task_id})
    res.raise_for_status()
    _print_json(res.json())


def cmd_get_tasks_activity(args):
    task_ids = args.task_ids.split(",")
    res = requests.post(f"{BASE_URL}/getTasksActivityList", headers=HEADERS, json={"taskIds": task_ids})
    res.raise_for_status()
    _print_json(res.json())


def main():
    parser = argparse.ArgumentParser(description="Teambition API CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("get_members", help="获取组织成员")

    subparsers.add_parser("get_projects", help="获取所有项目")

    p = subparsers.add_parser("get_project", help="获取项目详情")
    p.add_argument("project_id")

    p = subparsers.add_parser("get_custom_fields", help="获取项目自定义字段配置")
    p.add_argument("project_id")

    p = subparsers.add_parser("get_scenariofield_configs", help="获取项目任务类型配置")
    p.add_argument("project_id")

    p = subparsers.add_parser("get_task_flows", help="获取项目任务流")
    p.add_argument("project_id")

    p = subparsers.add_parser("get_task_flow_status", help="获取任务流状态")
    p.add_argument("taskflow_ids", nargs="+", help="任务流ID列表")

    p = subparsers.add_parser("get_bug_groups", help="获取缺陷分组")
    p.add_argument("project_id")

    p = subparsers.add_parser("get_sprints", help="获取迭代列表")
    p.add_argument("project_id")

    p = subparsers.add_parser("get_tasks", help="获取项目任务")
    p.add_argument("project_id")
    p.add_argument("--scenariofield_config_id", default=None, help="任务类型配置ID")
    p.add_argument("--include-archived", action="store_true", default=False, help="包含已归档任务(默认排除)")

    p = subparsers.add_parser("get_tasks_by_name", help="按名称获取项目任务(推荐)")
    p.add_argument("project_id")
    p.add_argument("--names", required=True, help="任务类型名称(逗号分隔)")
    p.add_argument("--sprintIds", default=None, help="迭代ID列表(逗号分隔)")
    p.add_argument("--bugGroupIds", default=None, help="缺陷分组ID列表(逗号分隔)")
    p.add_argument("--limit", type=int, default=None, help="拉取条数限制(默认100)")
    p.add_argument("--include-archived", action="store_true", default=False, help="包含已归档任务(默认排除)")

    p = subparsers.add_parser("get_bugs", help="获取项目缺陷")
    p.add_argument("project_id")
    p.add_argument("--scenariofield_config_id", default=None, help="缺陷类型配置ID")
    p.add_argument("--sprintIds", default=None, help="迭代ID列表(逗号分隔)")
    p.add_argument("--bugGroupIds", default=None, help="缺陷分组ID列表(逗号分隔)")

    p = subparsers.add_parser("get_full_bugs", help="获取完整缺陷(含关联信息)")
    p.add_argument("project_id")
    p.add_argument("--scenariofield_config_id", default=None, help="缺陷类型配置ID")
    p.add_argument("--sprintIds", default=None, help="迭代ID列表(逗号分隔)")
    p.add_argument("--bugGroupIds", default=None, help="缺陷分组ID列表(逗号分隔)")
    p.add_argument("--limit", type=int, default=None, help="拉取条数限制(默认100)")

    p = subparsers.add_parser("get_task_activity", help="获取单个任务活动日志")
    p.add_argument("task_id")

    p = subparsers.add_parser("get_tasks_activity", help="批量获取多个任务活动日志")
    p.add_argument("task_ids", help="任务ID列表(逗号分隔)")

    args = parser.parse_args()

    commands = {
        "get_members": cmd_get_members,
        "get_projects": cmd_get_projects,
        "get_project": cmd_get_project,
        "get_custom_fields": cmd_get_custom_fields,
        "get_scenariofield_configs": cmd_get_scenariofield_configs,
        "get_task_flows": cmd_get_task_flows,
        "get_task_flow_status": cmd_get_task_flow_status,
        "get_bug_groups": cmd_get_bug_groups,
        "get_sprints": cmd_get_sprints,
        "get_tasks": cmd_get_tasks,
        "get_tasks_by_name": cmd_get_tasks_by_name,
        "get_bugs": cmd_get_bugs,
        "get_full_bugs": cmd_get_full_bugs,
        "get_task_activity": cmd_get_task_activity,
        "get_tasks_activity": cmd_get_tasks_activity,
    }

    try:
        commands[args.command](args)
    except requests.exceptions.HTTPError as e:
        print(f"HTTP Error: {e.response.status_code}", file=sys.stderr)
        print(e.response.text, file=sys.stderr)
        sys.exit(1)
    except requests.exceptions.ConnectionError:
        print(f"Connection Error: Cannot connect to {BASE_URL}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
