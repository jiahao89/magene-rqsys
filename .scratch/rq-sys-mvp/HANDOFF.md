# RQ-Sys 交接摘要（2026-10-22）

> 用于压缩上下文。新会话从这里开始即可，不必重读历史。

## 一、系统是什么

Teambition（需求原文，只读）→ 应用数据库（工作流状态）→ DeepSeek 分析 → 负责人映射 → 飞书多维表格（PM 字段 + 通知）→ Base 自动化发消息。

**铁律**：系统从不回写 Teambition。

## 二、两个仓库

| 位置 | 角色 | 说明 |
|---|---|---|
| `/Users/jacko/Projects/RQ-Sys`（root） | 权威实现 | `apps/api` + `apps/web`，ESM 用 `.js` 后缀 |
| `rq-sys-miaoda/` | 妙搭运行时 | **线上跑的是这个**；`client/src/rqsys/` 是部署的客户端；import **不带后缀** |

对齐门禁：`npm run check:alignment`（38 模块，23/23 共享逻辑）。

## 三、当前状态

- **仓库**：root `86ce55b` / app `338e66a`，两仓干净、已推送、与远程同步
- **线上发布**：`7699336736766102766`（commit `338e66a`），finished，error_logs 空，30 分钟请求 error=0
- **线上 = 仓库 HEAD**（app）
- **数据**：314 需求 / **314 已分析** / **266 已推送** / 48 未映射 / 0 排队作业
- **周计划**：**周一 09:00** Asia/Shanghai，已启用（下次 10/26 09:00）
- **恢复触发器** `rqsysWeeklySyncRecovery`：enabled（实测投递频率远低于配置，3 小时 1 次）
- **平台需求 ID**：`RQ-000001` ~ `RQ-000314`，DB 与 Base 双向一致
- **人员名单**：8 人（`source_configs.owner_names`）；映射 12 条，8 条有姓名

### 关键资源 ID

| 项 | 值 |
|---|---|
| 妙搭 app | `app_17fqkjwyx1u` |
| 应用公网地址 | `https://ecn8egz1lhkq.feishu.link/app/app_17fqkjwyx1u` |
| 正式 Base | token `GRnEboCIga7Omas8RwgcDmmgnib` / table `tbl6Gfi0KJ2a1llK` |
| 通知工作流 | `wkfMnsnvaDS4Auj4`（enabled） |
| TB 自建站 | `https://teambition.magene.cn/task/<TB需求ID>` |
| PM Leader | 王赵云 `70f70339efd660d54d1e84ab8f6e01a4`（user_id） |

## 四、已确认的产品规则

1. **通知收件人（D-12，有意偏离 PRD 4.4）**
   - 批量首推（自动匹配）→ **静默**
   - **人工分配负责人 → 通知被分配人**（含首推）
   - 负责人变更 → 新负责人
   - 内容实质变更 / AI 重试成功 → 当前负责人，无则 PM Leader
   - 提出人 → 不通知
   - **PRD 4.4 待你修订**
2. 四个状态机独立：分析失败不阻断推送，负责人空缺也能推
3. 并发锁：同一需求串行（`pg_advisory_xact_lock`，返回值必须 `::text`，否则妙搭池包装器 JSON 解析报错）
4. 只看 PC，**移动端不再投入**

## 五、验证基线

```
root:  typecheck 0 | build OK | API 368/368 | Web 78/78 | alignment clean | contract 20/0
app :  typecheck 0 | lint 0 | stylelint 0 | build OK | route tests 106/106
```
> 2026-10-22 本轮（P1-1）复验：本地 PostgreSQL 上直接驱动仓储走通 绑定→（需求详情式）改绑→解除绑定、同名多账号冲突、同账号跨人员拒绝、改名携带/目标冲突拒绝；`+db` 契约检查未涉及新表（复用 `person_mappings`，无迁移）。

本地 PostgreSQL：`/opt/homebrew/opt/postgresql@16/bin/pg_ctl -D ~/.local/share/rq-sys/postgres -o "-k ~/.local/share/rq-sys/postgres" start`（不设开机自启）

运维脚本：`npm run rqsys:maintenance status|requeue-failed|requeue-pending|all`

## 六、剩余工作（按优先级）

| # | 项 | 要点 |
|---|---|---|
| ~~**P1-1**~~ | ~~人员页「绑定飞书账号」~~ **已完成（未提交/未发布/未目标验证）** | 人员页每行「绑定飞书账号 / 重新绑定 / 解除绑定」→ 搜索飞书用户 → 写 `person_mappings`（`PUT`/`DELETE /api/people/{name}/feishu`）；`GET /api/people` 返回绑定状态；新绑定写 `unique_name`（按姓名唯一匹配、首推静默、owner=auto_mapped），需求详情人工映射仍是 `manual`；改名携带映射、删除/解绑停用映射；同名多账号显示冲突并 409；同一飞书账号不能绑给两位人员。root + 妙搭两仓已同步，映射归并逻辑在共享 `domain/team-directory.ts`。 |
| P2-2 | 列表摘要仍用草稿数；搜索框文案提到批次 ID | 改用已生效数量；文案去掉"批次 ID" |
| P2-5 | 标识不统一 | 总览/映射页仍显示 `REQ-长ID`；TB 状态显示原始 ID |
| P2-6 | 分页无提示 | 映射只取 25 条、审计 50 条，需"还有更多" |
| P2-8 | `.rules-table` 样式没接 DOM | 上轮写了 CSS 没改表格结构 |
| P2-9 | "自动刷新"文案无轮询 | 要么真轮询，要么改文案；总览补"下次同步时间" |
| P2-10 | Base 记录直链 | 需确认 Base 域名格式（尚未拿到真实样例），建议用环境变量配置而非硬编码 |

## 六·补、2026-10-22 菜单收敛（已完成，未提交/未发布）

- 侧栏合并：人员 + 负责人映射 → **团队管理**（页签）；同步批次 + 审计日志 → **同步记录**（页签，顶栏“活动记录”入口删除）；模块词典版本历史从“规则”移回 **功能模块**。
- 规则页只保留版本列表；“创建草稿 / U-M-S-C 英文评分映射 / JSON 校准证据”收进 **高级设置** 折叠区。
- 数据源配置 → **设置 → 数据源与计划**；优先级规则留在设置组。
- 使用指南不再占侧栏菜单，只保留顶栏一个帮助入口；侧栏底部帮助卡删除。
- “仅同步源数据”和合成验收（测试场景）收进 **高级操作** 下拉，不再占主操作区。
- 删除无功能装饰：工作区下拉、固定头像、`需求运营组 / 本地工作区` 文案、页脚“本地开发工作区”。
- 删除原型残留 `/home` 路由与 `pages/Home`（含数据库浏览入口），并移除为它兜底的旧 CSS 覆盖块。
- 旧链接兼容：`#people/#mappings → #team`、`#batches/#audit → #sync-records`（`workbench-routing.ts` 解析），需求深链不变。
- 浏览器实测（本地 API + Vite）：总览、团队管理、同步记录、功能模块（含词典版本历史）、规则页均正常，无控制台错误/横向溢出。
- **2026-10-22 已发布**：`+release-create` release `7699336736766102766`，commit `338e66a`，finished；未登录访问线上 app 与 `/api/health` 均 302 到飞书登录（登录门禁有效）；`+log-list --level error --since 0.5h` 为空；`+metric-list requests` error=0。功能级在线验证（需登录账号）仍待人工点检：团队管理两个页签、人员绑定飞书账号、同步记录页签、功能模块版本历史、规则页高级设置。
- 本地 `npm run build`（app 的 build.sh 包装）因 `~/.npm` 缓存目录存在 root 属主文件而失败（环境问题，非代码）；`build:server` / `build:client` 均通过，平台发布构建成功。

## 六·补2、2026-10-22 线上人员绑定修复（运维，非代码）

- 现象：团队管理页「刘媛媛」显示未绑定；点「绑定飞书账号」选到她本人后报 `CONFLICT 该飞书账号已绑定到「其他人员」`。
- 根因：她本人的飞书账号（user_id `19c423aa…7ee4`，通讯录按姓名核验）在 10-18 已有一条 **负责人映射行**，但 `normalized_name`/`teambition_display_name` 为空（需求级人工映射时 TB 执行人姓名为空），所以人员页无法归属；按姓名再次绑定时，账号唯一性校验命中这条无名行并返回 409。
- 处理：就地补全该行姓名（保留 `teambition_user_id=69c0ce…` 关联），未新增重复映射；写入 `audit_events`（`team_person.feishu_bound`，actor NULL，safe_details.source=agent_ops）。处理后可归属映射：8 位人员各 1 个身份。
- 「毕梓浩」无需处理：13:36 已产生 `unique_name` 绑定行（UI 截图早于该写入），刷新页面即显示已绑定。
- **产品缺陷（待修）**：绑定流程应自动接管“同一飞书账号、但姓名为空的映射行”，而不是报“其他人员”409；下个版本可加。

## 六·补4、2026-10-22 全量回归验证（发布后）

- 静态：root typecheck 0 / build OK / API 369/369 / Web 78/78 / alignment clean / contract 20-0 / diff-check clean；app typecheck 0 / lint 0 / stylelint 0 / build:server+client OK / route 106/106 / diff-check clean。
- 运行时（本地 PostgreSQL + 真实 API）：HTTP E2E 11/11 —— 创建人员、绑定、重复绑定幂等、同账号绑定第二人 409、无姓名映射接管、分配负责人 200 + ownerState + Base 推送入队、解除绑定、删除人员；测试数据已清理（活跃映射恢复为 0）。
- Drizzle 通道（与线上同一适配层 + 真实 PG）：`upsertManual(tbUserId=null)`、无姓名行接管（保留 tb id）、解除绑定，4/4 通过。
- UI：总览与需求详情深链在本地 web + API 下正常渲染，无控制台错误/横向溢出。
- 线上：release `7699396318843079917`（commit `32bbc61`）finished，`error_logs` 空；发布后 45 分钟请求 error=0；8 位人员各 1 条活跃映射；未登录 `/api/health` 302 到飞书登录。
- **边界**：线上需登录的功能点（点「保存负责人并入队推送」）仍需人工点一次；日志无新错误说明该路径未再触发 503。

## 六·补3、2026-10-22 线上“分配负责人 503”与绑定接管（已修复并发布）

- 现象：需求详情「保存负责人并入队推送」返回 503 `DEPENDENCY_UNAVAILABLE`（线上 14:17/14:42 多次复现）。
- 根因：P1-1 给 `upsertManual` 的 UPDATE 增加了 `($3 IS NOT NULL OR normalized_name IS NOT DISTINCT FROM $4)`。Drizzle 传输层（`drizzle-pool.ts`）会把**重复出现的 `$3` 拆成两个独立参数**；其中只出现在 `IS NOT NULL` 里的那个参数没有类型上下文，PostgreSQL 报 `could not determine data type of parameter`，HTTP 层捕获后统一映射成 503。本地用 Drizzle 适配器 + 本地 PG 已精确复现。
- 修复：SQL 改为 `($3::text IS NOT NULL OR ...)`，给该参数显式类型；本地复测人工映射成功。
- 一并修复：人员页绑定时，若同一飞书账号已有**无姓名**的活跃映射（历史需求级映射没取到执行人姓名），自动补全姓名并复用该行（保留 TB user ID 和 match_method）；若账号已属于**另一位有姓名**的人员，仍返回 409。
- 测试：root API 369/369（新增接管用例 + SQL 类型断言）；app 路由 106/106（Drizzle 通道接管 + upsert SQL 断言）；两仓 typecheck/lint/build/alignment 通过。
- **2026-10-22 15:54 发布**：release `7699396318843079917`（commit `32bbc61`）finished；`error_logs` 空；发布后 10 分钟请求 error=0；未登录仍 302 到飞书登录。请在需求详情页重试「保存负责人并入队推送」确认恢复。

## 六·补5、2026-10-22 标题去重数据清洗（已发布并完成存量清理）

- 背景：TB 原始数据存在“需求 ID 不同、标题内容相同”的重复项（线上 27 组 / 54 条）。
- 导入去重：`sync/service.ts` 在拉取后按规范化标题（NFKC + trim + 合并空白 + 小写）分组，只保留最早一条（`created` 升序，再按需求 ID）；其余不进入导入流程，批次计数按实际处理数。空标题不参与去重。
- 兜底：即使 TB 侧以后新增同标题重复项，也只会在下一次同步被筛掉，不会重新进入需求池。
- 存量清理：发布后用同一规则（保留每组最早的 requirement）删除已导入的 27 条重复需求及其本地依赖（sync_items / source_snapshots / analysis_runs / pm_snapshots / base_push_runs / 相关 pipeline_jobs）。**Feishu Base 里的重复记录不删除**（MVP 不回写/不删 Base）。
- 测试：root API 371/371（新增标题去重用例），两仓 typecheck/lint/build/alignment 通过。
- **2026-10-22 17:04 发布**：release `7699409141857750254`（commit `7d77dcf`）finished，`error_logs` 空。
- **存量清理已执行**（发布会话内、用户确认）：按“每组保留 source_created_at 最早（并列取需求 ID 最小）”删除 27 条重复需求，同时删除其本地依赖：`sync_items` 135、`source_snapshots` 27、`analysis_runs` 27、`pm_snapshots` 0、`base_push_runs` 24、`pipeline_jobs` 51；需求总数 314 → 287，重复标题组 0，删除 id 无残留。`(source_config_id, teambition_requirement_id)` 唯一索引保持。
- **Feishu Base 未清理**：24 条已推送的重复记录仍留在 Base；MVP 不回写/不删除 Base 记录。如要清 Base，需要单独确认（属于 Base 侧数据操作）。
- 本地库同步清理（311 → 284），便于后续本地验证。

## 六·补6、2026-10-22 全量流程验证 + Base 重复清理

- **Base 重复清理**：按“TB需求ID 不在当前 287 条需求中”定位到 27 条重复记录并删除（用户最初看到 24 条，实际有 27 组；Base 314 → 287）。删除后 Base 记录数 = 287 = 需求数，重复标题组 0，保留记录均为各组最早需求对应的行。
- **Pull + 去重验证**：以 `source_only` 模式在线上跑了一次同步（batch `00677699-1605-476c-b559-478279eb8a35`）：288 条（287 unchanged + 1 created）、0 failed。原始 315 条 TB 记录中 27 条同标题重复被过滤，未进入需求池；新增 1 条需求 `6ad8265bdf4c64454b8b99e7`（分析 pending，等下一次 full sync）。
- **指派试点（3 条待分配需求）**：
  - `顽鹿运动app首页连接状态显示矛盾` → 贾浩
  - `【海外C606 v1.956】多名海外用户反馈…Climb Pro` → 史东升
  - `【Beta反馈】【优化意见或建议】【C706V2.007】…` → 兰诣伟
  - 结果：3 条均 `owner_state=manually_mapped`、`push_state=pushed`、`base_record_id` 已回填；base_push 任务 succeeded；Base 行 `执行人/系统通知类型=已分配负责人/系统通知收件人` 均正确，Base 记录数保持 287（未产生重复行）；审计 3 条 `owner.manually_mapped`（actor 1861259273201738）。
  - 副作用：3 个 TB 执行人账号分别映射到上述三人（这是当前“分配=映射执行人”模型的语义）；三人的人员绑定保持不变。
- **发现（非阻塞）**：剩余 42 条待分配需求在 Base 中已有行，但本地 `base_record_id` 为空（历史批量推送未回填）；本次 3 条推送已验证按 TB 需求键对账并回填，后续分配推送不会在 Base 造重复行。历史 failed 作业均为 10/15–10/19 的 fixture/重试记录，当前无 queued/running 失败。
- **通知送达**：Base 四个系统通知字段已写入；实际飞书消息由 Base 自动化发送，需三位收件人确认。

## 六·补7、2026-10-22/23 验收循环（3 轮，当前全绿）

- **第 1 轮发现并修复**：
  - 42 条待分配需求在 Base 中已有行但本地 `base_record_id` 为空（历史预置/回填缺失）→ 按 Base 的 TB需求ID 批量回填 42 条；只剩新增未推送需求为空，后随推送自动回填。
  - 新增需求 `6ad8265b…` 由 source-only 同步导入后分析 pending → 触发一次 full sync，分析成功并自动匹配到王赵云、推送成功（Base 行回填）。
- **第 2 轮（source-only 同步）**：288/288 unchanged，0 失败；16 项不变量检查全部通过。
- **第 3 轮（full sync 幂等复验）**：288/288 succeeded，0 失败；未产生新分析/推送任务；再次 16 项检查全部通过（连续两轮同步成功、需求/Base 无重复、Base 无孤儿、全部已分析、队列无 queued/running、修复发布后 0 错误日志）。
- 历史 26 条错误日志均为 10-22 13:36–13:44 修复前的两个已知问题（409 绑定冲突、503 分配负责人），发布后至今 0 错误。
- 剩余 42 条需求为 `pending_mapping`（TB 执行人未匹配），属于等待人工映射的正常业务状态，不是系统缺陷。

## 六·补8、2026-10-23 单条负责人 / 疑似重复 / 低风险问题修复

- **单条负责人（高）**：`PUT /api/requirements/{id}/owner` 现在一律写 `requirements.manual_owner_*`，**绝不**再调用 `person_mappings.upsertManual`；同 TB 执行人的其他需求与全局默认映射不受影响。推送解析顺序改为「逐条人工负责人 > TB 执行人映射 > 空」。新增 `DELETE /api/requirements/{id}/owner`（清除后恢复 TB 默认负责人并重新入队）。V0.2 组合根/推进器同步改为优先识别逐条人工负责人。
- **通知语义（高，D-12）**：自动匹配（无论底层映射是 manual 还是 unique_name）首推一律静默；只有“这一条需求被人为指定”才发「已分配负责人」。新增 `requirements.last_pushed_owner_*` 记录最近一次成功推送的负责人，负责人变更事件不再用当前映射反推历史（修复 manual→TB 切换误报「已分配负责人」的问题）。
- **疑似重复（中）**：同步不再静默丢弃同名标题；全部导入并写 `duplicate_of_requirement_id`（最早 `created`，再按 TB ID），重复项不进入默认池、不分析、不推送、不改 Base；详情页显示红色提示与对方详情链接；标题变回唯一时下次同步自动清除标记。发布后下一次全量同步会把此前清理掉的 27 条重新导入为“疑似重复”，不会重建 Base 行。
- **其他**：分配分支 enqueue 失败由裸 500 改为 503；`writeSyncItem` 写库失败不再拖垮整批（记单条失败继续）；AI 上下文提取为共享 `analysis/context.ts`（root/妙搭同实现，均含 scope+验收标准）；app `server/database/schema.ts` 补齐 0004/0006/0007；`.scratch/` 源码包/导出文件加入 gitignore。
- 迁移：`0007_requirement_owner_conflict_duplicates.sql`（last_pushed_owner_*、duplicate_of_requirement_id、索引）。
- 本地验证：root API 392 tests、web 79 tests、app transport 106 tests、两仓 typecheck、alignment 24/24 + 16 declared 全部通过。

### 上线记录（2026-10-23）

- 两仓提交：root `bcf207d`（main）、app `3a1e4fa`（sprint/default）；妙搭 release `7699766681938496751`，commit `3a1e4fa`，status=finished。
- 迁移 `0007`：先在 dev 执行 DDL，`apps +db-env-diff` 只显示本次 10 项变更，再 `+db-env-migrate` 发布到 online；online 直接 DDL 会被拒绝（multi-env 限制）。
- Base `AI优先级建议` 增加 P3 选项；`BASE_FIELDS_JSON.selectOptions.priority` 更新为 P0–P3（module 列表保持 50 项）。
- 发布后全量同步：batch 315/315 succeeded；27 条历史清理掉的重复需求重新导入并标记 `duplicate_of`；默认池仍 288；Base 仍 288 行、0 新增；重复项未分析/未推送/无 Base 链接；队列 0；发布后错误日志 0。
- 回填 `last_pushed_owner_*`：从 Base 现有执行人（245 条，open_id）回填，使后续负责人变更通知不必靠当前映射反推历史。
- **未在目标环境做真实指派**（避免给无关负责人发通知）：单条负责人 PUT/DELETE 已由本地 API 395 tests、web 79 tests、app 106 tests、真实 Postgres/Drizzle 路径覆盖；目标验证仅做只读与同步/去重验证。需要一次真实指派验收时，请指定需求与负责人（或允许我选一条待分配需求）。

## 六·补9、2026-10-23 重复项语义改为「仅提示」并发布 UI

- 产品确认：同标题只做疑似重复提示，**仍按自身来源 ID 独立分析、分配、推送**（语义 A）。已移除后端“重复项不进池/不分析/不推送”的拦截及对应测试；UI 文案与按钮改为独立操作。
- 提交：root `c422a0e`、app `7493524`；妙搭 release `7699805493326204199`（commit `7493524`，error_logs=[]）。
- 发布后全量同步：**315/315 succeeded**；315 条全部 `analysis=analyzed`；Base 从 288 增至 **312** 行（24 条重复项自动匹配后推送 + 原有 288），Base 无孤儿/无重复 TB ID；24 条重复项首推均静默（通知类型/收件人为空）。
- 剩余 3 条重复项：TB 执行人无活跃映射 → `pending_mapping`，等待人工分配后才推送（符合既有规则）。
- **滚动发布竞态**：发布瞬间仍有旧实例在跑，15 条 duplicate analysis 被旧实例的重复拦截跳过、5 条 duplicate push 被旧实例以 `duplicate_requirement` 拒绝；已用 recovery 作业重新入队后全部补齐。之后发布需确认旧实例退出，或检查“需求 pending + 作业 succeeded”组合。
- Base 记录数统计：单次 `+record-list --limit 2000` 实际只返回 287，需用 offset 分页统计；分页后为 312。
- 队列 0、近 4 小时失败作业 0、发布后错误日志 0。
- 本地验证：root API 399 / web 79、app 107、typecheck/build/alignment/contract 全绿；UI 逐页 smoke（总览、需求池、详情、团队、模块、同步记录、数据源、规则、指南）无控制台错误/溢出；修正 API 断开时 `REQUEST_FAILED` 的中文提示。

## 七、踩过的坑（不要再踩）

- **Drizzle 传输层的重复占位符**：妙搭运行时把每次 `$N` 出现拆成独立参数（`drizzle-pool.ts`）。同一个 `$N` 若有一处只出现在 `IS NOT NULL` / `IS NULL` 这类无类型上下文里，必须写成 `$N::text IS NOT NULL`，否则 PostgreSQL 报 `could not determine data type of parameter`，HTTP 层会误报成 503 `DEPENDENCY_UNAVAILABLE`。**只有 root 的 `pg` 测试通过不算数**。
- **改过 SQL 的发布前必跑**：① 用 `createDrizzlePostgresPool` + 真实 PostgreSQL 直接驱动 app 仓储，跑 `upsertManual`（tbUserId=null）与 `bindPersonFeishu`（接管无姓名行）等写路径；② 起本地 API 做 HTTP E2E（绑定/改绑/409/接管/分配负责人/解除）；③ 再跑两仓全量测试。2026-10-22 的 503 就是这样漏掉的：root 用 `pg`、线上用 Drizzle，root 测试全绿但目标环境报错。


- `+db-execute` **线上禁 DDL**；改结构走「dev 执行 DDL → `+db-env-migrate` 同步到 online」，数据回填用 DML 直接在 online 跑
- 迁移顺序：加可空列 → 回填 → 加约束
- 妙搭客户端**不能引入 HeroUI**（曾导致构建失败），用等效 CSS
- `pg_advisory_xact_lock` 返回 void，妙搭池会 JSON 报错 → 必须 `::text`
- 飞书 `user_id_type` 是请求级的，写人字段要分两次请求
- 移动端旧 `pages/Home/Home.css` 未隔离，曾有全局 `.nav-item{display:none}` 污染
- 局部改动别动全局样式（曾把全局标题 26px 改成 22px、把表格 `min-width:880px` 打掉）
- 团成员上限 8，`agent_teams_remove_member` 在本会话不可用，`spawn_teammate` 满员后只能自己做
- `person_mappings.upsertManual` 曾按 `(source_config_id, tb_user_id)` 停用：`tb_user_id` 为 NULL 时会把**所有人员维度绑定一起停用**。本轮已修：NULL 维度按 `normalized_name` 去重，并在插入前检查账号是否属于另一位人员（冲突抛 `PersonMappingConflict` → HTTP 409）。人员页新绑定的 `match_method` 是 `unique_name`（首推静默），需求详情人工映射是 `manual`（首推通知被分配人，D-12），不要混用
- 人员页绑定与需求详情的人工映射共用 `person_mappings`，同一姓名只保留一条有效身份（改名到已被其他账号占用的姓名会 409）；否则 `resolveActive` 按姓名匹配会因多行返回 null → 需求停在待匹配
- 人员页绑定只解决“负责人下拉 + 无 TB 用户 ID 的按姓名匹配”；带 TB 用户 ID 的需求仍需在需求详情分配一次（会落 `tb_user_id` 维度映射），或等后续做按姓名回填
- 妙搭 `drizzle-pool` 按 **SQL 文本出现顺序**重绑 `$N` 参数（不是按编号顺序）；写参数顺序敏感的测试桩/手写 SQL 时注意（本地 pg 才是按编号）

