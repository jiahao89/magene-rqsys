# [resolved] 10 — 开通 spark:app:read 用户授权

## 目标
让当前 TRAE lark-cli 环境的用户访问令牌获得妙搭（Spark）应用的只读 scope `spark:app:read`，使 agent 可执行妙搭应用的读取类命令（应用列表/详情、协作者列表、协作设置、日志与观测指标等），支撑 Ticket 00 的妙搭运行时 POC。

## ✅ 复测记录（2026-10-09，根因确认并验证通过）
- **根因修正**：此前所有 `missing_scope: spark:app:read` 的根因不是授权服务能力缺失，而是 **TraeWork 注入的环境变量凭证（`LARKSUITE_CLI_APP_ID` / `LARKSUITE_CLI_USER_ACCESS_TOKEN` / `LARKSUITE_CLI_BRAND`）缺少 spark 权限并遮蔽了本地已授权配置**。授权流程每次都成功，但 CLI 用的是注入凭证。
- **解法（用户提供）**：所有妙搭命令统一加前缀回退本地已授权配置：
  `env -u LARKSUITE_CLI_APP_ID -u LARKSUITE_CLI_USER_ACCESS_TOKEN -u LARKSUITE_CLI_BRAND lark-cli <command> --as user`
- **验证通过（identity=user，本地配置）**：
  - `apps +list --as user` ✅ 返回应用列表（含目标应用 `app_17fqkjwyx1u` = RQ-Sys，full_stack，enabled，is_published=true，online_url 返回）
  - `apps +get --app-id app_17fqkjwyx1u --as user` ✅ 返回应用详情（app_type/meta_token/发布状态）
  - `apps +release-list` / `+release-get` ✅ 返回发布记录（最新 finished release `7694630996987743435` 的 commit `1a2910bb` 仍为妙搭 scaffold shell——RQ-Sys 实现未部署，属工单 00/09 范围）
- 验收标准 1 达成；未引入任何写 scope。

## 实测证据（2026-10-08，历史）
- 环境：TRAE SOLO CN 0.1.69 插件托管版 lark-cli 1.0.94，应用 `cli_a965abcba6fadbd3`，用户身份 贾浩（`ou_894482287d1f95aff25b5550604167fb`），`doctor` 全部通过。
- 托管令牌 scope 集合（自访问令牌解码核验）：`auth:user.id:read`、`offline_access`、`trae:approval/base/calendar/contact/docs/mail/meetings/messenger/mindnotes/sheets/slides/space/tasks/wiki:manage`；不含任何 `spark:` scope。
- 实际调用 `lark-cli apps +member-settings-get --app-id app_test_probe --as user` 返回：`missing_scopes: ["spark:app:read"]`（99991679）——即注入凭证遮蔽现象的首次记录。
- 复测（2026-10-08 晚）：RequestAuthorization 返回成功但令牌仍 missing_scope——同为注入凭证遮蔽，非授权服务下发链路问题。

## 后续复测（2026-10-09，正确凭证前缀）
- `apps +list/+get` 及 release 查询成功，确认本地凭证可执行这部分 Spark 读取。
- `+member-list` 与 `+member-settings-get` 对目标 app 仍返回 `feature_not_available` / 3340005，提示协作者管理不通过 CLI 提供；此项属于应用能力限制，不作为 scope blocker。
- `+log-list` / `+trace-list`、`+metric-list`、`+analytics-list` 均可调用；近 24h log/trace 与 requests/latency 为空、CPU/memory 有样本、PV/UV 值为 null。只证明命令可读，不证明数据保留期或 analytics 完整性。

## 后续
- [ ] `+member-list` / `+member-settings-get` 对真实 app 用前缀命令复测（此前 feature_not_available 的结论需在新通道下复核）。
- [ ] Ticket 11（`spark:app:write`）按同一前缀规则验证写操作；写操作仍须遵守高风险门禁。

## 不在范围
- 妙搭应用本身的开发与部署。
