# 5c-2 自测结果（2026-11-19）

> 被测版本：根仓 `77798cb`（含 `7f41158` 推送映射 + `77798cb` 回填记录）；Base 字段 `fldyflUEVv`。
> 清单：[5C2-SELFTEST.md](</Volumes/Files/A_Projects/RQ-Sys/.scratch/iteration-5/5C2-SELFTEST.md>)；回填记录：[SOURCE-BACKFILL-20261119.md](</Volumes/Files/A_Projects/RQ-Sys/.scratch/iteration-5/evidence/SOURCE-BACKFILL-20261119.md>)。
> 结论：**代码侧通过**；22 项中 19 PASS（C2-B05 基于后端工作区补丁）、1 PARTIAL（C2-10 设计取舍已接受）、2 N/A（回填执行未走脚本），无行为缺陷；剩余全部是目标环境动作。

## 1. 门禁

| 项 | 命令 | 结果 | 证据 |
| --- | --- | --- | --- |
| 定向 API | `node --import=tsx --test base/client.test.ts base/push-service.test.ts base/transport.test.ts` | **91/91** | `evidence/20261119/c2-api-targeted.txt` |
| 全量 API | `npm --workspace @rq-sys/api run test` | **655 用例 / 596 过 / 59 失败**，59 条全是本机无 Postgres 的 `ENOENT` | `evidence/20261119/c2-api-full.txt` |
| Web | `npm --workspace @rq-sys/web run test` | **161/161** | `evidence/20261119/c2-web.txt` |
| typecheck + build | `npm run typecheck && npm run build` | 通过 | `evidence/20261119/c2-typecheck-build.txt` |
| 两仓对齐 | `npm run check:alignment` | **36/36**，无未声明漂移 | `evidence/20261119/c2-gates.txt` |
| 迁移 | `npm run check:migrations` | 29 个文件、最大前缀 **0029**、下一空号 0030 | 同上 |
| 空白 | `git diff --check` | 干净 | 同上 |
| 妙搭 | `type:check:server/client` + `build:server` + `test:rqsys-route` | **140/140** | `evidence/20261119/c2-miaoda.txt` |

## 2. 本地自测 22 项

| ID | 结果 | 依据 / 说明 |
| --- | --- | --- |
| C2-01 | PASS | `client.test.ts` 断言四值 + 未知来源 `null` |
| C2-02 | PASS | `web_manual` 无 `intakeOrigin` → `Web 手工`，用例覆盖 |
| C2-03 | PASS | 配 `sourceMethod` 写入；未配置不写、不报错，均有断言 |
| C2-04 | PASS（代码核对） | `parseBaseFields` 非法 JSON 回落默认；`sourceMethod` 非字符串/空值不配置。无直接单测（函数未导出） |
| C2-05 | PASS | 写入值是字符串；fake Base 捕获到 `"聊天粘贴"`，无数组形态 |
| C2-06 | PASS | push-service 用例覆盖 Teambition / 聊天粘贴 / Web 手工 / 多维表格 |
| C2-07 | PASS（代码+既有用例） | 来源方式进第一次写 delta；通知四字段只在有 `notification` 时二次写；既有「不写通知字段」用例通过 |
| C2-08 | PASS（代码路径） | 每次 `pushRequirement` 都重新计算来源方式，重试复用同一路径；既有重试/幂等用例通过，但未单独断言重试请求里的来源方式 |
| C2-09 | PASS | `base_form` → `多维表格` 有用例；未配置字段时推送仍成功 |
| C2-10 | **PARTIAL（已接受）** | 服务端只有 `baseSourceMethodValue` 一个 helper；回填脚本 `expectedSourceMethod` 是**独立副本**（当前逻辑逐行相同）。Chief 决定保持独立副本，理由是不依赖 TS 构建产物、可在无构建环境运行；漂移风险由清单/用例约束，不阻塞本轮 |
| C2-B01 | PASS | 脚本按 `limit=100` + `nextCursor` 分页；目标 dry-run `scanned=333` |
| C2-B02 | PASS | CSV 列：平台 ID / sourceType / intakeOrigin / 期望值 / Base record / 当前值 / action；不含标题、描述、PII |
| C2-B03 | PASS | `wouldWrite 333 / alreadyCorrect 0 / baseRowMissing 0 / noPlatformId 0 / unknownSource 0 / errors 0`；CSV 333 行与汇总一致 |
| C2-B04 | PASS | 脚本只有 GET 路径，无 update/create 代码；目标证据也确认未写单元格 |
| C2-B05 | PASS（工作区补丁） | 本地 mock Feishu 验证：字段 type=1 → 退出 1「类型必须是单选」；type=3 缺「聊天粘贴」→ 退出 1「选项不完整」；type=3 四选项齐全 → 正常输出 `already_correct` / `would_write`。证据 `evidence/20261119/c2-b05-mock.txt`、`c2-b05-mock-harness.mjs`；脚本 sha `c1f764e…`，后端提交后按最终版本复跑 |
| C2-B06 | PASS | 第二次只读 dry-run：`scanned 333 / alreadyCorrect 333 / wouldWrite 0 / errors 0`，两次结果一致、零写入；证据 `evidence/source-backfill-rerun-20261119.csv` |
| C2-B07 | PASS | 对照表分布 Teambition 332、Web 手工 1（`RQ-000316`）、unknown 0；无 `chat_paste` 残留 |

## 3. 回填执行 5 项（按 Chief 记录核）

> 执行方式与清单不一致：用 `lark-cli` 按对照表批量更新，**没有走脚本**（脚本只有 dry-run）。以下按记录判定。

| ID | 结果 | 依据 |
| --- | --- | --- |
| C2-E01 | PASS（按记录） | 分 2 批 200 + 133，只写「来源方式」；记录声明未触碰 `系统通知事件ID`。未独立回放写 payload |
| C2-E02 | PASS | 回填后第二次只读 dry-run：`alreadyCorrect 333 / wouldWrite 0`，再跑不产生任何写入；与首次执行结果逐行一致 |
| C2-E03 | N/A | 两批都成功，无失败/重试场景；执行是人工工具，无脚本失败处理可测 |
| C2-E04 | PASS | 重新导出 333 行核对：Teambition 332、Web 手工 1、空白 0，与 dry-run 预测一致 |
| C2-E05 | N/A | 执行未走脚本，脚本没有 execute 模式；「未 dry-run 拒绝执行」的闸门不存在 |

## 4. 发现与建议

1. **C2-10 映射副本（已接受）**：服务端与回填脚本各一份四行判定，当前完全一致。Chief 决定保留独立副本（脚本不依赖 TS 构建产物、可在无构建环境运行），漂移风险由清单约束；本轮不再改。
2. **C2-B05 预检（工作区补丁已验）**：后端已补「类型=3、四选项齐全」检查；我用本地 mock 独立验了失败/成功四态（证据见上表），补丁提交后按最终版本复跑一次即可。
3. **C2-B06 / C2-E02 已闭合**：第二次只读 dry-run `scanned 333 / alreadyCorrect 333 / wouldWrite 0 / errors 0`，证明脚本可重复、回填后 0 写入；只读，无需再动 Base。
4. **C2-04 无直接单测**：`parseBaseFields` 未导出，非法配置靠代码核对；风险低。

## 5. 剩余目标环境 BLOCKED（更新后）

| ID | 项 | 状态 |
| --- | --- | --- |
| T-01 | 应用 0029 到目标库 | **BLOCKED**（无 DB 执行工具） |
| T-02 | 线上 `BASE_FIELDS_JSON` 配 `"sourceMethod":"来源方式"` | **待确认/BLOCKED**：不配则新推送不会写该列 |
| T-03 | Base 字段核对 | **已闭合**（字段存在、回填已写入并复核） |
| T-04 | 通知零触发核对 | 按记录/工作流配置为 0；建议抽查一次自动化运行记录 |
| T-05 | 四类来源新推送冒烟 | **BLOCKED**（需 0029/目标写入与清理） |
| T-06 | 历史回填 dry-run | **已闭合**（333 行） |
| T-07 | 历史回填 execute | **已闭合**（手动 lark-cli，2 批；回填后二次 dry-run 已证幂等） |
| T-08 | 5b 三行验收 | **BLOCKED**（0029 + 收集表） |
| T-09 | 20 段线上回归 | **BLOCKED**（清库工具） |
| T-10 | 5c-1 目标验收 | **BLOCKED**（需线上真实数据） |
| T-11 | 发版 | **BLOCKED**（以上未完成） |
| T-12 | 本机 59 条 PG 契约用例 | **BLOCKED**（本机无 Postgres；CI 可跑） |

## 6. 判定

- 5c-2 **代码侧可判通过**：22 项中 19 PASS（C2-B05 基于工作区补丁）、1 PARTIAL（C2-10 已接受）、2 N/A；映射、配置开关、推送、`base_form` 路径、回填 dry-run 与目标回填结果都有证据。
- C2-10 是设计取舍，不按缺陷计；B05 补丁提交后复跑；E03/E05 因执行未走脚本记 N/A，不冒充通过。
- 目标环境仍未证明「新推送写入 Base 来源方式」——需要 T-01/T-02 后做一次推送冒烟；不能拿历史回填代替。
