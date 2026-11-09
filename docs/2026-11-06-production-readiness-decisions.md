# 生产就绪产品决策记录（2026-11-06）

> 依据：用户 2026-11-06 指示「其他的你先帮我决定」。本文件记录对 PR-01/02/04/07/08 等阻塞票的产品决策；实现细节以 PRD 增补与 ticket 为准。
> 变更方式：修改既有 D-02/D-04/D-05 等决策时，在 ticket/PRD 中标注「2026-11-06 决策更新」，不删除历史记录。

## 决策清单

| ID | 主题 | 决策 | 影响票 |
|---|---|---|---|
| PRD-13 | 生产 Base | **正式「TB需求池」为生产目标**；测试 Base「TB同步测试(可删除)」仅用于 POC/验收，不得承载真实 PM 协作。切换前按 TB ID/平台键对账当前 278 条已推送记录；保留测试 Base 只读与回退路径。 | PR-01 |
| PRD-14 | 优先级语义 | **AI 优先级改为相对分位**：同一活跃需求池内按校正总分排名，P0≈前 5%、P1≈下 15%、P2≈下 30%、其余 P3；安全标记强制 P0；**PM 终审优先级在 Base 维护**，AI 建议仅作输入。发布 v3 规则前继续用 v2 绝对阈值过渡；上线前用 20–30 条 PM 人工排序校准（Top20 重合 ≥70%）。 | PR-02、PR-03 |
| PRD-15 | PM 工作台归属 | **Base 为唯一 PM 处理面**（D-02 维持不变）：PM 状态/通知/最终优先级均在 Base；Web 不读取、不回写 PM 状态，只提供深链与只读分析/运维视图。若要改变，需新 ADR 并修订 PRD。 | PR-07 |
| PRD-16 | 角色权限 | **暂缓（2026-11-09 用户更新：现在不需要做角色和权限）**。维持 D-04：任何登录租户用户可用；仅在 PR-08 保留未来设计，不实施。 | PR-08（cancelled） |
| PRD-17 | 负责人映射功能 | **PR-05 取消**（用户 2026-11-06 明确不需要）：不做批量映射、离职/外部人员转交、覆盖率报表；43 条 pending_mapping 按现行规则不推送；已有映射页保持现状。 | PR-05 |
| PRD-18 | 人工优先级投影 Base | **不自动回写 Base**：PM 最终优先级在 Base 维护；Web 的人工优先级覆盖继续只影响应用内排序/预览，不写 Base、不触发通知。PR-04 取消。 | PR-04 |
| PRD-19 | AI 供应商 | 内部试点期继续使用当前网关（Claude `claude-sonnet-5-5` via yfy-new），但须完成数据留存/出境合规复核并保留 DeepSeek 直连配置作为回退；任何模型/网关切换需在 PR-11 记录并演练回退。 | PR-11 |
| PRD-20 | 试点与上线 Gate | 先 10–15 名 PM、1 个产品组试点 2–4 周；唯一上线判据为 PRD §9 Gate + PR-15 状态页；P0 未完成不宣布正式上线。 | PR-15、PR-14 |

## 对既有决策的更新

- **D-02（Base vs Web）**：维持 Base 为 PM 协作面；Web 仅分析与运维（PRD-15）。
- **D-04（身份与访问）**：**维持「登录即全权限」**（2026-11-09 用户取消角色/权限工作，PR-08 cancelled）。
- **D-05（Base schema）**：正式 Base 仍为「TB需求池」；切换前需字段/选项核对（PR-01）。
- **D-06（AI provider）**：当前 Claude 网关为过渡实现，需合规复核与回退配置（PRD-19 / PR-11）。
- **D-12（通知规则）**：不变（单收件人两步走）。

## Ticket 状态变化（2026-11-06）

| 票 | 原状态 | 新状态 | 说明 |
|---|---|---|---|
| PR-01 | blocked-on-external | ready-for-agent（执行仍须正式 Base 授权） | 目标与对账/回退方案已定 |
| PR-02 | blocked-on-decision | ready-for-agent | 相对分位口径已定，进入 v3 实施 |
| PR-04 | blocked-on-decision | cancelled | 按 PRD-18 不自动回写 |
| PR-05 | ready-for-agent | cancelled | 用户明确不需要（PRD-17）；已落地的只读姓名显示保留 |
| PR-07 | blocked-on-decision | closed-by-decision | 维持 Base 工作台（PRD-15） |
| PR-08 | blocked-on-decision | cancelled | 2026-11-09 用户决定现在不需要角色/权限；D-04 维持不变 |
| PR-03 | implemented-local | implemented-local（范围调整） | 取消「批量确认」子项（随 PR-04 取消） |

## 正式 Base 链接与授权状态（2026-11-09 核对）

- 正式 Base「TB需求池」：https://aimagene.feishu.cn/base/GRnEboCIga7Omas8RwgcDmmgnib?table=tbl6Gfi0KJ2a1llK （30 字段，含 4 个通知字段与「系统需求链接」；通知工作流 `wkfMnsnvaDS4Auj4` 已启用；`AI优先级建议` 选项已含 P0–P3）。
- 当前测试 Base「TB同步测试(可删除)」：https://aimagene.feishu.cn/base/OddqbqBeOamFjFsR5IXcJdjknmd?table=tblxbyvbdLGVnLaO
- 授权核对：正式 Base 协作者（`lark-cli drive +member-list`）包含应用 `cli_aa434b0a8d39dd05`（= 线上 `FEISHU_APP_ID`），权限 `edit`；因此应用侧 Base 编辑授权已具备，剩余动作为**切换窗口内改 env + 发布并验证**。
- 字段兼容核对：正式表字段名/类型与 POC 基本一致；差异为正式表 `AI模块建议` 是文本（POC 是单选），而通知字段/推送状态/优先级选项齐备，需在切换后用一条真实需求做推送+通知验证。

## 发布记录（2026-11-06）

- 优先级分诊与待匹配负责人姓名显示已随妙搭 release `7704997761057361172`（commit `8d07753`）发布；`status=finished`、`error_logs=[]`。
- 线上验证：优先级列/筛选/分诊排序可用（P2=7 条；分诊视图 100 条有序）；发布后 10 分钟 error=0。
- 已确认 43 条 pending_mapping 的 `executor_name` 全为空（仅 `executor_user_id`），故 PR-05 的姓名显示无法补充真实姓名；按 PRD-17 不再投入。

## 仍需用户提供/确认

1. 正式 Base 授权与切换窗口（PR-01）。
3. 20–30 条真实需求的人工排序基准（PR-02 校准）。
4. 试点团队名单与开始日期（PRD-20）。

## 更新记录

- 2026-11-09：用户确认「现在不需要做角色和权限」→ PR-08 cancelled，PRD-16 暂缓，D-04 维持「登录即全权限」。
