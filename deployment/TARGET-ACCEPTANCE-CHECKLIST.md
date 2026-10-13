# 目标环境验收清单（发布版 app-mediated E2E）

本清单把 Ticket 09 剩下的「发布版 runtime 全链路验收」拆成可逐步执行、每步都有可观测证据的步骤。
它**只能在发布成功后**执行；当前执行版本为 release `7695978028435049655`，状态 `finished`（见 `EXTERNAL-BLOCKER-RUNBOOK.md` 中的历史发布阻塞记录）。

前置约束（不要越过）：
- 完整流水线 E2E 仍只用**隔离的 POC 测试 Base** 与**合成夹具**；不得把真实需求送入 AI、写入 Base 或通知干系人。
- 2026-10-13 用户另行明确授权：允许在 Dev 对所选项目执行一次 `source_only` 同步，范围严格为原始 Teambition API 返回的 311 个唯一 ID；该例外不解释 UI `311/314` 的额外 3 条，也不允许运行默认完整流水线。
- 通知只发当前登录用户本人；不得扩展到其他干系人。
- **周计划保持关闭**：来源创建时 `schedule.enabled=false`。
- 全程不打印任何密钥。

## 当前获准的一次性源数据对齐（不属于完整流水线 E2E）

仅在 Dev 工作台预览已显示“API 已连接”且来源/批次/需求加载完成后执行：确认项目为 `室外产品-码表软固件需求池`、来源已启用、周计划关闭、没有运行批次或作业；在总览或批次页点击 **“仅同步源数据”**，不要点击“立即同步”。

验收：批次完成且 311 条成功、0 条失败；与本次 Teambition API 的 311 个非空唯一需求 ID 对齐；保留 7 条合成夹具。检查同步期间没有新建 analysis / Base push / 通知工作，没有改变既有 PM/Base 字段或负责人，周计划仍关闭。UI `311/314` 的计数语义继续单独待查，不能据此认定多出的 3 条是测试工具。

所有 `lark-cli` 命令都需要先加这个前缀（本机既有上下文里有干扰凭证）：

```sh
E="env -u LARKSUITE_CLI_APP_ID -u LARKSUITE_CLI_USER_ACCESS_TOKEN -u LARKSUITE_CLI_BRAND"
APP=app_17fqkjwyx1u
```

---

## 0. 前置检查（发布完成后）

```sh
# 0.1 确认发布绑定了目标 commit，且没有错误日志
$E lark-cli apps +release-list --app-id $APP | head -20
# 取最新 release_id 后：
$E lark-cli apps +release-get --app-id $APP --release-id <release_id>
# 期望：status=finished 且 error_logs 为空

# 0.2 确认 Dev 环境变量齐全（只列名称，不看值）
$E lark-cli apps +env-list --app-id $APP --environment dev --format json
# 期望包含：TEAMBITION_GATEWAY_URL, GATEWAY_API_KEY, AI_API_KEY,
#          FEISHU_APP_ID, FEISHU_APP_SECRET, BASE_APP_TOKEN, BASE_TABLE_ID,
#          RQSYS_ENABLE_TEST_FIXTURES

# 0.3 确认死锁状态已清空（不应有 running 批次/作业）
$E lark-cli apps +db-execute --app-id $APP --environment dev --yes \
  --sql "select (select count(*)::int from sync_batches where status='running') as running_batches, (select count(*)::int from pipeline_jobs where status='running') as running_jobs"
# 期望：0 / 0
```

---

## 1. 冷启动与来源创建

1. 用**已登录**账号打开开发态：`https://miaoda.feishu.cn/app/app_17fqkjwyx1u`
2. **期望**：先显示「正在检查 API / 正在加载配置…」，随后变为「API 已连接」。
   （若一开始就显示空数据即为缺陷——早前修过这个提前 ready 的问题。）
3. 进入「数据源配置」，确认表单**只需要项目名称**（默认 `室外产品-码表软固件需求池`），
   **不再**要求填写项目 ID / 需求类型 ID / 字段映射。
4. 保持**周计划关闭**、勾选启用同步，保存。

**证据**：保存后回读来源，确认服务端解析出了 ID：

```sh
$E lark-cli apps +db-execute --app-id $APP --environment dev --yes \
  --sql "select external_project_name, external_project_id, requirement_type_id, enabled, schedule_enabled from source_configs"
# 期望：6960a3187384fa11aa07d7e6 / 6960a3b76586dfa001dc14df，schedule_enabled=false
```

这一步同时验证了此前 `FORBIDDEN` 是否真的消失。

---

## 2. 合成夹具走通主链路

夹具端点**忽略请求体**，只入队一条固定合成需求（不访问真实 Teambition）：

```sh
# 2.1 记录基线
$E lark-cli apps +db-execute --app-id $APP --environment dev --yes \
  --sql "select (select count(*)::int from sync_batches) as batches, (select count(*)::int from requirements) as reqs"
```

在已登录的工作台里触发一次夹具同步（或调用 `POST /api/dev/fixtures/sync`）。
`RQSYS_ENABLE_TEST_FIXTURES=true` 且 Base 指向 POC 表时该端点才可用。

```sh
# 2.2 等 1–2 分钟后核对各阶段
$E lark-cli apps +db-execute --app-id $APP --environment dev --yes \
  --sql "select pull_state, analysis_state, owner_state, push_state, base_record_id is not null as pushed from requirements order by created_at desc limit 3"
# 期望：pull_state=synced，analysis_state=analyzed，push_state=pushed，pushed=true
```

**注意**：合成需求没有 TB 负责人，因此 `owner_state` 应为 `not_required`
（而不是 `pending_mapping`）——这正是「无负责人仍可推送」不变量的体现。

```sh
# 2.3 确认 Base 里出现对应记录（只读）
#     用 POC Base 的 app token/table，读回标题为【RQ-Sys安全测试】的记录
```

**若 analysis_state 失败**：先在日志里搜 `AI provider authentication failed`；
若出现，说明 Dev 的 `AI_API_KEY` 又失效了（本轮已修过一次）。

---

## 3. 负责人通知（只发本人）

1. 在 POC Base 中把该合成记录的**执行人**设为当前登录用户；
2. 记录编辑器的「同时发送通知」保持关闭；
3. 在 Base 的自动化运行日志中确认「监控执行人字段变更」与「发送分配通知」两步成功，收件人只有本人。

**边界**：这是 Base 自动化验收，**不等于**发布版 runtime 发起的通知；不要把两者混为一谈。

---

## 4. 审计追溯

```sh
$E lark-cli apps +db-execute --app-id $APP --environment dev --yes \
  --sql "select event_type, result, safe_details from audit_events order by occurred_at desc limit 8"
```
**期望**：能看到 sync / analysis / base.push 事件，且 `safe_details` 中**不含**密钥、姓名、用户 ID、联系方式。

---

## 5. 恢复触发器（错窗恢复语义）

本轮已验证**投递与关闭态安全**（见 Ticket 08）。真正的「错窗恢复」需要：
1. 有一个**启用中**的周计划来源（这一步属于真实同步范围，须先完成第 6 步的归因）；
2. 让一个周窗口「错过」后，确认 recovery 能补跑该窗口。

在真实来源获批前**不要**为此启用周计划。

---

## 6. 收尾

1. 把 Dev 的 `RQSYS_ENABLE_TEST_FIXTURES` 关掉（`online` 已在 2026-10-12 置 `false`）。
2. 清理 POC Base 中本次产生的合成记录（保留你需要的证据）。
3. 把每一步的实际结果（含失败截图/日志）写回 Ticket 09；**没有证据的步骤不要标记通过**。

---

## 判定口径

只有以下全部成立，才能说 MVP 主链路「已验收」：
- 发布成功且 `error_logs` 为空；
- 来源创建成功（不再 403）；
- 合成夹具走通 sync → AI → Base，且 Base 记录可只读回读；
- 无负责人需求可空负责人推送；
- 通知只到本人；
- 审计可查且无敏感字段泄漏；
- 周计划与真实需求导入仍保持关闭。
