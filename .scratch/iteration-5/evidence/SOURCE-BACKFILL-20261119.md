# 5c-2「来源方式」历史回填记录（2026-11-19）

## dry-run（只读）
命令：`node scripts/base-source-backfill.mjs --csv evidence/source-backfill-dryrun-20261119.csv`
（脚本已补 `X-Suda-Csrf-Token` 头支持；凭据只走环境变量，未落盘、未打印。）

汇总：`{"scanned":333,"wouldWrite":333,"alreadyCorrect":0,"baseRowMissing":0,"noPlatformId":0,"unknownSource":0,"errors":0}`

对照表分布：Teambition **332**、Web 手工 **1**（`RQ-000316`）。
说明：5a 期间产生的聊天粘贴行已在 5a 验收后清理，因此没有 `chat_paste` 残留；333 行全部能按「需求平台ID」定位到 Base 行，无缺行、无未知来源。

## execute（写 Base）
按 dry-run 对照表分 2 批（200 + 133）调用 `+record-batch-update`，**只写「来源方式」一列**，未触碰 `系统通知事件ID`。

## 复读校验
重新导出 333 行统计：Teambition **332**、Web 手工 **1**、空白 **0**，与 dry-run 预测完全一致。

## 为什么不会触发通知
`wkfMnsnvaDS4Auj4` 的 `field_watch_info` 只有 `系统通知事件ID`，且 `trigger_control_list` 含 `openAPIBatchUpdate` / `pasteUpdate` / `appendImport` / `automationBatchUpdate`，均被忽略；本次只写「来源方式」，因此零通知、无需停用工作流。

## 回填后复跑 dry-run（2026-11-19 12:29，只读）
汇总：`{"scanned":333,"wouldWrite":0,"alreadyCorrect":333,"baseRowMissing":0,"noPlatformId":0,"unknownSource":0,"errors":0}`

结论：回填结果与对照表逐行一致，再跑一次不会产生任何写入——幂等性（C2-B06）与「执行后 0 writes」（C2-E02）同时闭合。命令同首次 dry-run，额外加 `--delay-ms 0`。
