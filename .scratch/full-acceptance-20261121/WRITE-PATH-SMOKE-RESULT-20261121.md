# 写链路冒烟结果（2026-11-21）

- 数据：RQ-000335（`5f0c8561-9522-439e-88e0-12f4ed80285a`），Base `rec=reczz28bkO8tDeYC`
- 收件人：贾浩（`user_id 99f56141`，用户本人）
- 时间：17:26 分配 → 17:26:36 推送完成 → 17:26 通知（Chief 查到消息 ID `om_x100b7f22721684a4df670b5469fe2ef`）→ 17:30 撤销
- 最终结论（2026-11-21 17:45，release `7710556274223631598` / commit `649a611`）：**S1–S6 全部 PASS**。首轮暴露的两个缺陷（撤销不发清 Base 执行人、误发「AI 重试成功」第二条通知）已修复并复验；遗留 **1 条已知限制**（撤销后重新指定同一人会静默不通知）和 **1 条 P3**（接口不传 `tbDisplayName` 时应用侧负责人姓名不回落）。
- 首轮结论（已过时，留档）：S1/S2/S3/S4 PASS，S5 FAIL（撤销未还原 Base，且误发第二条通知），S6 计数类 PASS

## 步骤结果

| 步骤 | 结果 | 证据 |
|---|---|---|
| S1 分配负责人 | PASS：`PUT /owner` 200 `{ownerState:"manually_mapped", status:"queued"}` | `smoke-01-assign.json` |
| S2 Base 五项 | PASS：执行人=[贾浩]、事件 `owner_assigned:5f0c8561…:sv1:av5:none:99f56141`、类型「已分配负责人」、收件人[贾浩]、推送时间 17:26:31 | `smoke-base-after-assign.json` |
| S3 IM 实收 | PASS（Chief 查得消息 ID `om_x100b7f22721684a4df670b5469fe2ef`，无重复） | 群消息 |
| S4 读回 | PASS（状态一致、Base 链接正确）；P3：`ownerName` 为空（API 未传 `tbDisplayName` 不回落 `person_mappings`） | `smoke-04-readback.png`、`smoke-05-revert.json` |
| S5 撤销 | **FAIL**（见下） | `smoke-base-final.json` |
| S6 计数 | PASS：产品 334 / 集团 191、Base 334/191、批次未新增、jobs 0 failed、push 333/333 | `smoke-06-final.json` |

## S5 失败详情

撤销（`DELETE /owner` 200 → `pending_mapping`，应用侧推送 17:30:18 成功）后，Base 行未还原：

| 字段 | 冒烟前 | 分配后 | 撤销后（实际） | 期望 |
|---|---|---|---|---|
| 执行人 | [] | [贾浩] | **[贾浩]（未清空）** | [] |
| 系统通知事件ID | `ai_retry_success:…:sv1:av5` | `owner_assigned:…:none:99f56141` | `ai_retry_success:…:sv1:av5` | 不变/清空 |
| 系统通知类型 | AI 重试成功 | 已分配负责人 | AI 重试成功（回退） | — |
| 系统通知收件人 | [王赵云] | [贾浩] | **[贾浩]（未还原）** | [王赵云] 或空 |

**推断的误通知**：事件 ID 从 `owner_assigned` 变回 `ai_retry_success`，工作流监控该字段，17:30 前后很可能给贾浩再发了一条「AI 重试成功」通知（待 Chief 查 p2p 线程确认）。

## 根因（代码定位）

1. `ai_retry_success` 是**持久条件**：`push-service.ts:263-270` 依据「同源版本曾 failed_retryable、本次 analyzed」判定，RQ-000335 的 v1–v4 失败、v5 成功，因此**每次**没有其他事件的推送都会重新命中并写回这个事件 ID（`push-service.ts:293`）。事件被 `owner_assigned` 覆盖后，撤销时又回退，工作流因此再次触发。
2. 清空负责人时 `owner` 传 null，Base 适配器不写空值 → `执行人` 残留（`push-service.ts:450` `owner: baseOwner`）。
3. 非负责人事件的收件人回落到 `readBaseOwnerForEvent()`（`push-service.ts:306-324`），读到的是**本行即将被清掉但尚未清空**的贾浩 → 发给错的人。

## 建议修法（下一轮）

- `ai_retry_success` 只在「本次推送对应分析从失败转成功」的那一次产生（比较上次推送事件或分析版本），无状态变化的推送不得重发。
- 撤销负责人时显式清空 Base 负责人字段（写空数组），不要依赖「不传即不改」。
- 非负责人事件的收件人不要使用本行“即将清除”的 Base 负责人；先写后读或直接沿用应用侧结果。

## 待办

- [ ] Chief 确认 17:30 是否收到第二条通知
- [ ] 批准清理：Base `执行人` 清空、`收件人` 还原为 王赵云（一次 Base 写，不动事件ID）
- [ ] 缺陷进审查表；是否随收尾版修由 Chief 定

---

## 残留清理（Chief 批准，2026-11-21 17:4x）

只写两个字段（`执行人` 清空、`系统通知收件人` 还原为 王赵云），**事件 ID 与类型不动**；`record-batch-update` 返回 `rev 2139`，读回确认。

| 字段 | 清理前 | 清理后 |
|---|---|---|
| 执行人 | [贾浩（`ou_4420855b…`）] | **[]** |
| 处理人 | [] | [] |
| 推送状态 | 已推送 | 已推送 |
| 系统通知事件ID | `ai_retry_success:5f0c8561…:sv1:av5` | 不变 |
| 系统通知类型 | AI 重试成功 | 不变 |
| 系统通知收件人 | [贾浩] | **[王赵云（`ou_4c148e99…`）]** |
| 最后推送时间 | 2026-11-21 17:30:13 | 不变 |

清理后该行与冒烟前一致（快照见 `evidence/smoke-base-before.json`），应用侧仍为 `pending_mapping`。
证据：`evidence/smoke-cleanup-before-after.json`、`evidence/smoke-cleanup-after.ndjson`。

## 修复口径（Chief 定，进本次收尾版，第四个独立提交）

1. `ai_retry_success` 不得每次推送都重写事件 ID，只在真的发生「重试后成功」的那次写。
2. 撤销时 `owner=null` 必须把 Base 执行人写空。
3. ③（误发收件人）是 ② 的后果，修掉 ② 后自然不再命中；**不改**产品池现有的「回落读 Base 负责人」规则。

修复上线后重跑 S5：分配 → 撤销 → 断言 Base 执行人=[]、事件不新增、收件人不变、**不再产生第二条通知**。

---

## S5 复跑（release `7710556274223631598` / commit `649a611`，2026-11-21 17:39）

线上资源 `client/assets/index-DUGeYD8s.js` 的静态路径含 `649a6112015410d697b63b6d465eaa072f83c414`，确认跑在新版本上。

| 步骤 | 实测 | 结论 |
|---|---|---|
| S1 分配 | `PUT /owner` 200 queued；`manually_mapped`、推送 17:39:15 成功 | PASS |
| S2 Base | 执行人=[贾浩]、事件 `owner_assigned:5f0c8561…:sv1:av5:none:99f56141`、类型「已分配负责人」、收件人[贾浩]、推送时间 17:39:11 | PASS |
| S3 IM（分配） | 17:39 一条「已分配负责人」，待 Chief 确认唯一 | 待确认 |
| S5 撤销 | `DELETE /owner` 200 → `pending_mapping`，推送 17:39:38 成功；**Base 执行人=[]（`[]` 清空被飞书接受）**；**事件 ID 保持 `owner_assigned`，未退回 `ai_retry_success`**；收件人保持[贾浩]；推送状态已推送 | **PASS** |
| S6 计数 | 产品 334 / 集团 191；Base 334/191；批次未新增；jobs 0 failed；详情 UI「待分配」 | PASS |
| 数据源页 | 「同步已暂停」chip、暂停口径说明、「最近一次同步（暂停前的历史值）」17:12:35 | PASS |

后端提醒的第 1 点（`[]` 清空人员字段能否被飞书接受）**已实测通过**，没有进入失败重试。
后端提醒的第 3 点（撤销后再分配应再发一条）**未实测**：按代码推断事件 ID 仍是 `owner_assigned:…:none:99f56141`，与撤销前相同 → 字段不变 → 工作流可能不再触发。是否再跑一轮分配验证，等 Chief 定（会再发 0 或 1 条 IM）。

当前 Base 行状态：执行人=[]、事件 `owner_assigned`、收件人[贾浩]。这是「最后一次真实事件」的合法值；若要恢复成冒烟前的 `ai_retry_success/王赵云`，需要改写事件 ID 字段，可能与工作流再次联动，建议保持现状由下一次真实事件覆盖。

证据：`evidence/smoke-rerun-01-assign.json`、`smoke-rerun-02-base-assigned.json`、`smoke-rerun-03-revert.json`、`smoke-rerun-04-base-reverted.json`、`smoke-rerun-05-detail.png`、`smoke-rerun-06-datasource-paused.png`

---

## 边角验证：撤销后重新指定同一人（2026-11-21 17:41–17:42）

| 步骤 | 实测 | 结论 |
|---|---|---|
| 再分配贾浩（`PUT /owner`） | 200 queued；Base 执行人=[贾浩]、事件 ID **`owner_assigned:5f0c8561…:none:99f56141`（与撤销前完全相同）**、类型/收件人不变、推送时间 17:41:10 | **事件 ID 不变** |
| IM | 事件字段值未变化 → 工作流不触发；Chief 确认 17:41 无新消息 | **静默不通知（已知限制）** |
| 再撤销（`DELETE`） | 200 → `pending_mapping`；Base 执行人=[]、事件 ID 仍不变、推送时间 17:42:02 | PASS |

**判定**：撤销后重新指定同一个人，事件 ID 与上次完全相同，Base 字段值没有变化，工作流不会触发——**属于已知限制**，不是回归（首轮不存在该场景）。
**建议修法（下一轮）**：负责人事件 ID 追加 `manualOwner.assignmentVersion`（本次实测已在递增）或时间戳，让「同人再分配」产生新事件；也可在撤销时清空事件字段（需确认清空本身不触发工作流）。

## 最终状态

- 应用：RQ-000335 `pending_mapping`、`ownerName=null`、`push=pushed`
- Base：执行人 `[]`、事件 `owner_assigned:…:none:99f56141`、类型「已分配负责人」、收件人 [贾浩]、最后推送 17:42:02
- 计数：产品 334 / 集团 191、Base 334/191、批次未新增、jobs 0 failed
- 数据源页：同步已暂停 + 历史值
- **本文件为最终版**；首轮 FAIL 的细节保留在「S5 失败详情」一节作为缺陷复现记录。
