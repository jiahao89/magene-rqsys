# [blocked] 11 — 开通 spark:app:write 用户授权

## 目标
让当前 TRAE lark-cli 环境的用户访问令牌获得妙搭（Spark）应用的写 scope `spark:app:write`，使 agent 在高风险写确认门禁下可执行妙搭应用的写命令（协作成员管理、协作设置、环境变量、部署发布等），支撑 Ticket 00 的妙搭运行时 POC 及后续本地开发链路（git 推送、发布验证）。

## 实测证据（2026-10-08）
- 同 Ticket 10 的环境与凭证限制：托管令牌 scope 不含任何 `spark:` scope；`auth login`、TRAE 授权服务两条通道均不可用。
- `spark:app:write` 缺失为**推断**而非直接实测：
  - 写命令带高风险确认门禁：实测 `lark-cli apps +member-add ... --as user`（不带 `--yes`）以退出码 10 停止（`confirmation_required`，`risk: high-risk-write`），请求未发出，服务端权限校验未发生。
  - `--dry-run` 仅本地构造请求（实测 `dry_run: true`），不做 scope 校验，不能作为持有写权限的证据。
  - 依据令牌 scope 集合与读侧 `missing_scope` 实测，推断写 scope 同样缺失。
- 相关命令族：`+member-add/update/remove`、`+member-settings-set`、`+env-set/env-delete`、`+release-create`、`+git-credential-init`、`+file-upload`、`+db-*` 变更类、`+role-*` 写操作等。

## 需要开发/配置的内容（由具备相应权限的一方完成）
与 Ticket 10 同一通道，增加 `spark:app:write`：
1. TRAE 授权服务将 `spark:app:write` 纳入可授权 scope 清单（经 `RequestAuthorization` 流程下发），或
2. 托管凭证签发时预置 `spark:app:write`，或
3. 允许本环境 lark-cli 走标准设备流完成 `auth login --scope spark:app:write` 增量授权。

## 验收标准（完成后由 agent 验证，需用户提供测试目标）
- [ ] 在用户指定的真实测试应用上执行一次最小无害写操作：`lark-cli apps +member-add --app-id <测试 app_id> --member-type openid --member-id ou_xxx --perm view --dry-run` 预览通过，经用户确认后加 `--yes` 真实执行成功。
- [ ] 随即用 `+member-remove --dry-run` → 用户确认 → `--yes` 还原现场，前后状态一致。
- [ ] 写操作失败时错误类型不再为 `missing_scope: spark:app:write`（可为资源不存在等业务错误）。
- [ ] 全程未绕过高风险确认门禁（无未经确认的 `--yes`）。
- [ ] Ticket 00 解除 spark 写侧 blocker。

## 风险与确认门禁
- 所有 `spark:app:write` 命令按高风险写处理：`--dry-run` 预览 → 用户确认 → 追加 `--yes`；禁止静默确认。
- 本验收仅允许在用户指定的测试应用/测试环境执行；禁止对生产妙搭应用或真实协作者做验证性写入。

## 不在范围
- `spark:app:read` 授权（见 Ticket 10）。
- 妙搭应用本身的开发与部署。
