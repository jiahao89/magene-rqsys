# 发布验证记录 — 2026-11-18

## 发布

| 项 | 值 |
| --- | --- |
| app | `app_17fqkjwyx1u` |
| 发布分支 | `sprint/default` |
| 发布提交 | `583605ed74e67f3c6a025a6a8676aff2d677ec17`（镜像根仓 `6d0d78d`） |
| 上一次线上提交 | `bcda172eb8ecbbc8acffe1cd24d08a77ce847526`（release `7708655655062506734`） |
| 本次 release | `7709379277322833151` |
| 状态 | `finished`，`error_logs: []` |
| 线上地址 | https://ecn8egz1lhkq.feishuapp.com/app/app_17fqkjwyx1u |
| 发布人 | 贾浩（`--as user`，scope 含 `spark:app:write`） |

发布内容：PRD-26 聊天文本 → 需求草稿。新增 `POST /api/requirements/intake-draft`（PII 脱敏、字段校验、按人限流、AI 暂停守卫），平台联系人选人需求表单，`RATE_LIMITED` 错误码与平台审计文本长度键。**本次无数据库迁移**（`+db-env-diff` 返回 `changes: []`）。

## 本地门禁（部署前）

| 检查 | 结果 |
| --- | --- |
| 根仓 `npm run typecheck` / `npm run build` | 通过 |
| 根仓 Web 测试 | 127/127 |
| 根仓 API 测试 | 554 通过 / 59 失败——全部为需要本地 PostgreSQL 的 repository contract 用例；本机未安装 Postgres（`/Users/jacko/.local/share/rq-sys/postgres` 不存在），属环境缺口，非代码回归 |
| 根仓 `check:alignment` | 36/36 共用逻辑一致，无未声明漂移 |
| 根仓 `check:migrations` | 通过（28 个文件，下一个空号 0029） |
| 妙搭仓 `type:check` / `build:prod` | 通过 |
| 妙搭仓 `test:rqsys-route` | 124/124（含 `rqsys-intake-draft.test.cjs`） |
| `git diff --check` | 干净 |

## 目标环境验证

- 线上页面加载为已登录态，右上角显示 **API 已连接**；总览读到 333 条需求及 P0–P3 分级统计（评分 v3）。
- 需求池存在 **从聊天粘贴** 入口；粘贴合成文本后点 **整理成需求草稿**，服务端返回草稿并回填：
  - 标题：`低温下码表电量掉得快，希望骑行中显示剩余电量百分比并在低于20%时提醒`
  - 来源渠道：`终端用户`
  - 需求描述：按「提出人／问题／诉求／目的」分段落生成
- 界面标注「AI 填充」；草稿未入库，测试后已点「收起」，**未点击「提交并进入分析」**，未创建任何需求。
- 发布后 12 分钟内线上 ERROR 日志 0 条。

证据截图：`online-intake-extracted.png`（草稿回填后）、`online-requirements.png`（需求池入口）、`online-after-release.png`（总览）。

## 未完成 / 待办

- 根仓 `feature/arco-design`（`6d0d78d`）尚未推送到 GitHub：本机 `github.com` 连接超时（npm registry 与飞书域名正常）。
- `specs/rq-sys-mvp/LOCAL-AND-TARGET-STATUS.md`、`RELEASE-CLOSEOUT.md` 尚未补记本次 release，需在根仓可推送后一并提交。
- 上述 59 个 PostgreSQL 契约用例需在具备本地 Postgres 的环境重跑后才能标记全绿。
