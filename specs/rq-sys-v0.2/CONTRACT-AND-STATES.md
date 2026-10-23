# API和状态增量方案（已确认的行为方案，非第二份API真相源）

正式实施时只更新当前唯一OpenAPI；本页记录拟定行为，不创建并行的可执行契约。

| 行为 | 拟沿用/新增契约 | 关键规则 |
|---|---|---|
| 新建 | POST /api/requirements | 可信actor，Idempotency-Key，返回稳定需求/平台ID和已收录状态；不宣称已推送 |
| 编辑手工定义 | PATCH /api/requirements/{id} | 期望来源版本+幂等键；TB事实拒绝编辑；无变化不新版本 |
| 查询 | 现有GET列表/详情 | 加来源类型/渠道/收录状态/上下文；历史TB调用兼容，手工无TB地址 |
| 分配 | 现有PUT /api/requirements/{id}/owner增量兼容 | 需求级分配版本和 typed identity；手工不写TB人员映射；保留原TB映射管理入口用途 |
| 人群确认 | PUT /api/requirements/{id}/audience | 期望人工标签版本，明确空集≠未确认，actor审计 |
| 主分析重试 | 现有分析retry及编辑入队机制 | 固定当前来源/实质版本，失败/空优先级非推送门槛；不得为Beta滥用主分析retry |
| RICE | GET/PUT /api/requirements/{id}/beta/rice | 独立评分编辑版本/配置版本；草稿不输出正式分数 |
| Kano运行 | POST /api/requirements/{id}/beta/kano/runs | 幂等键，选定资料版本，返回独立Beta runID；运行后可读取报告/历史 |
| Kano报告 | GET /api/requirements/{id}/beta/kano/runs及单次结果 | 只读运行状态/输入快照/假设报告，不关联主analysisState |
| Kano材料 | 内部维护接口或批准seed；已登录只读资料版本列表 | 正式路径随实施契约评审；不新增公共编辑器或自动抓飞书内容 |
| 优先级规则 | 现有rules/priority契约 | 扩展显式公式版本/参数；未经G-UMSC不得选择新算法 |

## 状态

- TB：保留待同步/同步中/已同步/失败；手工：新建请求提交后已收录，失败是提交错误，没有假成功记录。
- 手工DB行不以TB pull=synced通过就绪检查。新增来源收录语义，并对手工将TB拉取维度设为不适用；TB旧调用保留原值。
- AI、负责人、Base状态继续独立；主AI失败并不表示来源收录失败。待分析也不等于已推送。
- Beta有独立草稿/待配置/运行/成功/失败状态，不增加到主需求阶段计数。
- PM处理状态和通知送达结果仍不出现在Web主状态；Base推送已成功与消息已送达须分别留证。

## 持久化和并发

创建提交是单个事务：需求＋来源快照＋幂等回执＋审计＋持久分析job。修改以期望版本更新同一需求并追加快照。负责人、人群和Beta编辑使用各自版本。不同actor/不同操作的幂等键隔离，相同键不同payload冲突。

作业固定来源/实质版本；新内容提交后旧分析/旧推送不得成为当前结果。复用现有租约fencing，入队失败由事务或持久恢复机制处理，不能只在进程内安排异步Promise。

## 访问

沿用NeedLogin与可信req.userContext.userId；客户端头或请求体不能指定actor。沿用全租户登录访问，不为本期RICE或资料维护引入隐藏角色体系。后续接口具体状态码和JSON形状由唯一OpenAPI先批准并实现。
