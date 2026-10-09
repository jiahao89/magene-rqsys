# [resolved] 11 — 开通 spark:app:write 用户授权

## 目标
让当前 TRAE lark-cli 环境的用户访问令牌获得妙搭（Spark）应用的写 scope `spark:app:write`，使 agent 在高风险写确认门禁下可执行妙搭应用的写命令（协作成员管理、协作设置、环境变量、部署发布等），支撑 Ticket 00 的妙搭运行时 POC 及后续本地开发链路（git 推送、发布验证）。

## ✅ 通道更新（2026-10-09，根因确认）
- **根因（同 Ticket 10）**：此前读侧 `missing_scope` 的根因是 **TraeWork 注入的环境变量凭证（`LARKSUITE_CLI_APP_ID` / `LARKSUITE_CLI_USER_ACCESS_TOKEN` / `LARKSUITE_CLI_BRAND`）缺少 spark 权限并遮蔽了本地已授权配置**；授权服务/CLI 交互授权两条通道的失败与"申请成功但 scope 不下发"现象均为注入凭证遮蔽。
- **解法（用户提供，已验证读侧通过）**：所有妙搭命令统一加前缀回退本地已授权配置：
  `env -u LARKSUITE_CLI_APP_ID -u LARKSUITE_CLI_USER_ACCESS_TOKEN -u LARKSUITE_CLI_BRAND lark-cli <command> --as user`
- 读侧 `spark:app:read` 已验证通过（`apps +list`/`+get`/`+release-list`/`+release-get` 全部成功）；写 scope 按同一本地配置推断可用，**待写验证实测确认**。

## ✅ Ticket 11 验收尝试（2026-10-09，用户指定 app）
- 用户指定 `app_17fqkjwyx1u`，本次命令统一使用本地 Spark 凭证前缀；协作者 ID 选择当前发起用户，仅拟添加 `view` 权限。
- `+member-add --dry-run` 与 `+member-remove --dry-run` 均生成了预期请求；随后用户明确授权执行 add → remove。
- 正式 `+member-add ... --yes` 被服务端拒绝，返回 `feature_not_available` / 3340005：该 full_stack app 的协作者管理不支持通过 lark-cli。该错误不是 `missing_scope: spark:app:write`，也不是写入成功；没有发生协作者变更，因此未执行 remove。
- 结论：本次目标应用无法用于 Ticket 11 的 API 写侧 scope 验收。需在真正支持 CLI 协作者 API 的安全测试应用，或平台提供适用的其他无害 write probe 后重新验收。不能据此判定 spark:app:write 已开通。

## ✅ 验证记录（2026-10-09，写验证通过）
- 同一 `env -u` 前缀规则（本地已授权配置，identity=user）下真实执行：
  `env -u LARKSUITE_CLI_APP_ID -u LARKSUITE_CLI_USER_ACCESS_TOKEN -u LARKSUITE_CLI_BRAND lark-cli apps +release-create --app-id app_17fqkjwyx1u --branch sprint/default --apply-reason "发布链路验证（方案A）…" --as user`
- ✅ 返回 `ok:true`，release `7694661855108893966`（publishing → **finished**，error_logs 为空）——**写 scope 验证通过，无 missing_scope**。
- 用户通过方案 A（发布链路验证）显式确认本次发布目标；发布内容为当前 scaffold shell commit `1a2910b`（RQ-Sys 实现适配属工单 00/09 后续，见 specs README 验收边界段）。
- 命令事实：`+release-create` 风险级为 write（无 --yes 确认门禁 flag），full_stack 应用需要 `--apply-reason`。
- 验收标准：写操作成功且错误类型非 missing_scope ✅；未绕过高风险门禁（本命令无该门禁）✅；Ticket 00 spark 写侧 blocker 解除 ✅。

## 实测证据（2026-10-08，历史）
- 托管令牌 scope 不含任何 `spark:` scope。
- `spark:app:write` 缺失为**推断**而非直接实测：
  - 写命令带高风险确认门禁：实测 `lark-cli apps +member-add ... --as user`（不带 `--yes`）以退出码 10 停止（`confirmation_required`，`risk: high-risk-write`），请求未发出，服务端权限校验未发生。
  - `--dry-run` 仅本地构造请求（实测 `dry_run: true`），不做 scope 校验，不能作为持有写权限的证据。

## 验收标准（完成后由 agent 验证，需用户提供测试目标）
- [ ] 在用户指定的真实测试应用上执行一次最小无害写操作：`env -u LARKSUITE_CLI_APP_ID -u LARKSUITE_CLI_USER_ACCESS_TOKEN -u LARKSUITE_CLI_BRAND lark-cli apps +member-add --app-id <测试 app_id> --member-type openid --member-id ou_xxx --perm view --dry-run --as user` 预览通过，经用户确认后加 `--yes` 真实执行成功。
- [ ] 随即用 `+member-remove --dry-run` → 用户确认 → `--yes` 还原现场，前后状态一致。
- [ ] 写操作失败时错误类型不再为 `missing_scope: spark:app:write`（可为资源不存在等业务错误）。
- [ ] 全程未绕过高风险确认门禁（无未经确认的 `--yes`）。
- [ ] Ticket 00 解除 spark 写侧 blocker。

## 风险与确认门禁
- 所有 `spark:app:write` 命令按高风险写处理：`--dry-run` 预览 → 用户确认 → 追加 `--yes`；禁止静默确认。
- 本验收仅允许在用户指定的测试应用/测试环境执行；禁止对生产妙搭应用或真实协作者做验证性写入。

## 不在范围
- 妙搭应用本身的开发与部署。
