# [blocked] 10 — 开通 spark:app:read 用户授权

## 目标
让当前 TRAE lark-cli 环境的用户访问令牌获得妙搭（Spark）应用的只读 scope `spark:app:read`，使 agent 可执行妙搭应用的读取类命令（应用列表/详情、协作者列表、协作设置、日志与观测指标等），支撑 Ticket 00 的妙搭运行时 POC。

## 实测证据（2026-10-08）
- 环境：TRAE SOLO CN 0.1.69 插件托管版 lark-cli 1.0.94，应用 `cli_a965abcba6fadbd3`，用户身份 贾浩（`ou_894482287d1f95aff25b5550604167fb`），`doctor` 全部通过。
- 托管令牌 scope 集合（自访问令牌解码核验）：`auth:user.id:read`、`offline_access`、`trae:approval/base/calendar/contact/docs/mail/meetings/messenger/mindnotes/sheets/slides/space/tasks/wiki:manage`；不含任何 `spark:` scope。
- 实际调用 `lark-cli apps +member-settings-get --app-id app_test_probe --as user` 返回：
  `unauthorized: user authorization does not cover the required scope(s): spark:app:read`，`missing_scopes: ["spark:app:read"]`（OpenAPI code 99991679）。
- 授权通道均不可用：
  1. CLI 侧：`auth login`/`auth scopes`/`auth check` 返回 `credentials are provided externally and do not support interactive management`。
  2. TRAE 授权服务：显式申请 `spark:app:read` 返回 `these scopes are not supported for authorization by the service`。

## 需要开发/配置的内容（由具备相应权限的一方完成）
任选其一或组合：
1. TRAE 授权服务（trae-remote-official:lark::feishu）将 `spark:app:read` 纳入可授权 scope 清单，并支持经 `RequestAuthorization` 流程下发。
2. TRAE 托管凭证在签发 `LARKSUITE_CLI_USER_ACCESS_TOKEN` 时预置 `spark:app:read`（最小集合：`spark:app:read`，如需 `+list` 全量列举按平台要求补充配套 scope）。
3. 允许本环境的 lark-cli 走标准设备流（`auth login --scope spark:app:read`）完成用户增量授权。

## 验收标准（完成后由 agent 验证）
- [ ] `lark-cli apps +list --as user` 成功返回应用列表（或对任一真实 `app_` 应用执行 `+get` 成功）。
- [ ] `lark-cli apps +member-list --app-id <真实 app_id> --as user` 或 `+member-settings-get --app-id <真实 app_id> --as user` 不再返回 `missing_scope`（缺失原因只能是权限/资源不存在，不是 scope）。
- [ ] 授权结果与最小权限原则一致：未引入任务范围之外的额外写 scope。
- [ ] Ticket 00 解除 spark 读取侧 blocker 并可继续执行。

## 不在范围
- `spark:app:write` 授权（见 Ticket 11）。
- 妙搭应用本身的开发与部署。
