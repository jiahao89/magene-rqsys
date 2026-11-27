// SOP 与培训：独立页面，供试点 PM Leader / 执行 PM / 运维直接查阅。
// 内容为静态作业规范，不读取业务数据，也不写入任何系统。
import { Alert as ArcoAlert, Card as ArcoCard, Divider as ArcoDivider, Table as ArcoTable, Tag as ArcoTag, Typography as ArcoTypography } from "@arco-design/web-react";

const ROLE_ROWS = [
  { role: "PM Leader", duties: "分诊与优先级把关、负责人分配、周度质量复盘、需求收集表运营、评估结论抽查、试点节奏", entries: "总览、需求池、需求评估、需求收集表、Base「TB需求池」、上线 Gate", outOfScope: "不代替执行 PM 做逐条 PM 确认；不手工改 TB" },
  { role: "执行 PM", duties: "逐条确认模块/优先级、处理负责人通知、新来源需求确认、按需生成需求评估、反馈 AI 结论偏差", entries: "需求池详情、「从聊天粘贴」、来源筛选、需求评估、Base", outOfScope: "不改评分规则、不改 Base 系统字段、不重复推送" },
  { role: "运维", duties: "同步/分析/推送健康、需求收集表同步状态、失败作业、告警、备份与发布", entries: "作业运维、运维指标（含多维表格同步）、告警群、发布记录", outOfScope: "不修改需求内容与 PM 结论" },
];

const SOURCE_ROWS = [
  { mode: "Teambition", how: "从 TB 同步", where: "默认来源，需求池不挂徽标" },
  { mode: "Web 手工", how: "需求池「新建需求」手工填写", where: "需求池徽标「手工·渠道」+ 行首橙色条" },
  { mode: "聊天粘贴", how: "「从聊天粘贴」整理后创建", where: "需求池徽标「聊天粘贴·渠道」+ 行首紫色条" },
  { mode: "多维表格", how: "需求收集表同步创建", where: "需求池徽标「多维表格·渠道」+ 行首蓝色条" },
];

const AGENDA_ROWS = [
  { time: "0–5 分钟", content: "目标、角色边界、Teambition/RQ-Sys/Base 三方关系", format: "讲解" },
  { time: "5–10 分钟", content: "总览四项健康度；需求池筛选/详情/证据", format: "演示" },
  { time: "10–18 分钟", content: "Base 逐条 PM 确认（模块/优先级/PM 状态）；AI 建议只作输入", format: "演示 + 跟做" },
  { time: "18–23 分钟", content: "负责人分配、通知触发规则、空负责人与待匹配处理", format: "演示 + 跟做" },
  { time: "23–26 分钟", content: "新增来源入口：聊天粘贴、需求收集表、来源方式", format: "演示 + 跟做" },
  { time: "26–29 分钟", content: "需求评估：按需生成、结论解读、Investigation 提示词复制", format: "演示 + 跟做" },
  { time: "29–30 分钟", content: "失败重试、告警（含 AI 额度暂停）与答疑；反馈入口、试点周会节奏", format: "场景演练 + 讨论" },
];

const ESCALATION_ROWS = [
  { symptom: "同步连续失败 / 批次卡住", check: "数据源与计划、TB 凭据、队列", escalate: "运维 → 研发" },
  { symptom: "需求收集表读取 / 写回失败", check: "Base 权限、字段是否存在、收集表是否被删/改名", escalate: "运维 → 研发" },
  { symptom: "需求收集表行校验失败", check: "同步说明（标题/渠道/链接/必填）", escalate: "填表人修正 → PM Leader；持续失败 → 运维" },
  { symptom: "聊天粘贴整理失败 / 超时 / 限流", check: "页面错误、AI 状态卡、是否 429", escalate: "手工填写；持续失败 → 运维" },
  { symptom: "需求评估失败 / 超时 / 429 / 409", check: "AI 状态、错误码、是否已有生成中版本、补充内容是否超长", escalate: "稍后重试/手工判断；持续失败 → 运维" },
  { symptom: "来源方式缺失 / 与入口不符", check: "记录来源、Base 字段是否配置、回填范围", escalate: "运维" },
  { symptom: "AI 分析长期失败或额度告警", check: "作业运维错误码、AI 暂停标记", escalate: "运维 → 研发/AI 供应商" },
  { symptom: "单条 Base 推送失败", check: "详情页失败原因、Base 字段/人员 ID", escalate: "运维" },
  { symptom: "批量 Base 推送失败", check: "最近发布、Base 权限、告警群", escalate: "运维 → 研发" },
  { symptom: "优先级/模块结论明显不合理", check: "原文证据、AI 版本、PM 终审", escalate: "执行 PM → PM Leader" },
  { symptom: "权限/数据治理/合规问题", check: "变更记录、Base 权限", escalate: "PM Leader → 产品/安全" },
];

export function SopPanel() {
  return (
    <ArcoCard
      className="rq-card guide-panel sop-panel"
      title={
        <div className="rq-card-title">
          <h2>SOP 与培训</h2>
          <ArcoTypography.Text type="secondary" className="rq-card-subtitle">
            试点角色标准作业流程 · 版本 v3.1（2026-11-20）· 建议培训时长 30 分钟 · 新增聊天粘贴、需求收集表、来源方式、需求评估、需求编辑
          </ArcoTypography.Text>
        </div>
      }
      extra={<ArcoTag color="green">试点材料</ArcoTag>}
    >
      <div className="guide-section">
        <h3>一、角色与边界</h3>
        <ArcoTypography.Paragraph type="secondary" className="guide-lead">
          Teambition 是需求原文唯一来源；RQ-Sys 负责同步、分析和推送；飞书 Base 是 PM 处理与 PM 终审的工作台。系统不覆盖 TB，也不把 PM 的 Base 终审写回 Web。
        </ArcoTypography.Paragraph>
        <ArcoTable<(typeof ROLE_ROWS)[number]>
          rowKey="role"
          data={ROLE_ROWS}
          pagination={false}
          border={false}
          columns={[
            { title: "角色", dataIndex: "role", width: 120, render: (_value, row) => <strong>{row.role}</strong> },
            { title: "主要工作", dataIndex: "duties" },
            { title: "系统入口", dataIndex: "entries" },
            { title: "不负责", dataIndex: "outOfScope" },
          ]}
        />
        <ArcoAlert
          className="rq-inline-alert"
          type="info"
          showIcon={false}
          content="当前试点维持“登录即全权限”，角色只用于职责分工，系统不强制权限。新来源（聊天粘贴 / 需求收集表）与需求评估不改变 PM 确认、负责人与推送口径。"
        />
      </div>

      <ArcoDivider />

      <div className="guide-section">
        <h3>二、PM Leader · 每日 / 每周 SOP</h3>
        <ul className="guide-steps">
          <li><strong>每日 10 分钟（上午）：</strong>打开「总览」，看同步、分析、推送四项健康度；点「需求池」，先筛「待分配负责人」，再筛「推送失败」。待分配优先在详情页选负责人，系统会自动排队推送并通知新负责人。</li>
          <li><strong>每日异常：</strong>推送失败先看详情页的最近失败原因，点「重试 Base 推送」；同一错误反复出现时，记录 RQ 编号并升级运维。同步/分析失败交给系统自动重试，不在 Web 重复触发。</li>
          <li><strong>每周一同步后：</strong>核对本周新增需求数与 Base 行数；在 Base 中检查「PM确认模块 / PM确认优先级 / PM状态」；把仍待处理的 P0/P1 分给执行 PM。</li>
          <li><strong>每周检查需求收集表：</strong>看「同步状态=校验失败」和「系统需求 ID 为空」的行；把同步说明里的原因反馈给填表人，不要手工改系统字段。</li>
          <li><strong>每周复盘（15 分钟）：</strong>看运营指标 7 天视图（同步/分析/推送成功率、低置信度、失败码）；抽查 5 条 AI 建议与 PM 终审差异；更新试点问题清单。</li>
          <li><strong>月度：</strong>确认备份/恢复演练记录、告警通道可用、人员与负责人映射无离职残留；每月至少一次数据抽检（20 条 Base vs Web）。</li>
        </ul>
        <p className="guide-note">优先级口径：v3 规则按当前池校准阈值输出 AI 建议（P0–P3）；PM 终审以 Base「PM确认优先级」为准，Web 不自动回写 Base。当前明确不改优先级分数阈值。</p>
      </div>

      <ArcoDivider />

      <div className="guide-section">
        <h3>三、执行 PM · 每日 SOP</h3>
        <ul className="guide-steps">
          <li><strong>打开 Base「TB需求池」：</strong>按「PM状态=待处理」筛选自己负责的行；先看 AI模块建议/AI优先级建议，再确定「PM确认模块」与「PM确认优先级」。</li>
          <li><strong>处理负责人通知：</strong>收到「需求通知」卡片后，进入对应需求；确认需求描述与证据，在 Base 完成字段确认并更新 PM 状态。</li>
          <li><strong>在 Web 查看依据：</strong>需求池详情可看原文、AI 证据与历史版本；发现 AI 结论与原文不符时，记录 RQ 编号并反馈 PM Leader，不要直接改系统评分。</li>
          <li><strong>新来源需求：</strong>聊天粘贴/需求收集表进入的需求，来源徽标为「聊天粘贴」/「多维表格」；按同一流程核对字段与原文，来源方式由系统写入，不手工改。</li>
          <li><strong>人工指派：</strong>详情页「分配负责人」只影响当前这条需求并触发一次通知；改派前确认新负责人已知情。TB 无执行人的需求会以空负责人推送到 Base，不阻塞处理。</li>
          <li><strong>不要做：</strong>不手工改系统通知字段；不删除 Base 行；不同一条需求重复点推送（推送是幂等的，但会排一次队）。</li>
        </ul>
        <p className="guide-note">通知只在这些事件发送：分配/变更负责人、需求内容实质变更、AI 失败后重试成功；首次推送和错别字/元数据变化不发。未收到通知先确认 Base「系统通知收件人」是否有值。</p>
      </div>

      <ArcoDivider />

      <div className="guide-section">
        <h3>四、来源入口与需求评估</h3>
        <ArcoTypography.Paragraph type="secondary" className="guide-lead">
          除 Teambition 同步外，系统支持两种新来源：Web「从聊天粘贴」和飞书 Base「需求收集表」；加上手工录入，共四种来源。四种来源进入后走同一条 分析 → 负责人 → 推送 链路；来源只影响入口和来源标识，不改变 PM 确认口径。4.1–4.3 讲来源入口，4.4 讲详情页的按需需求评估。
        </ArcoTypography.Paragraph>

        <h4 className="guide-subheading">4.1 聊天粘贴（Web 需求池）</h4>
        <ol className="guide-steps">
          <li><strong>入口：</strong>需求池「新建需求」旁的「从聊天粘贴」。</li>
          <li><strong>粘贴：</strong>把聊天原文粘到文本框（最多 20,000 字）；不要粘账号、密码、密钥或附件内容。</li>
          <li><strong>整理：</strong>点「整理成需求草稿」，最多等 30 秒；AI 填充的字段带「AI 填充」标记，手动改过的字段标记会撤销。</li>
          <li><strong>核对：</strong>逐项核对标题、渠道、类型、模块、约束和描述。表单已有内容时会弹「草稿与已填内容冲突」：选「只补空白字段」保留你已填的内容，选「覆盖已填字段」按草稿替换。</li>
          <li><strong>提出人：</strong>只作展示，不会自动设为负责人、不发通知；负责人仍在创建后分配。</li>
          <li><strong>相似需求：</strong>提示按标题关键字匹配，不是语义相似；提交前先在需求池搜一下 RQ 编号，避免重复。</li>
          <li><strong>失败处理：</strong>AI 暂停、未配置、超时或限流时，按页面提示手工填写；原文不会保存，只有你确认后的描述入库。</li>
          <li><strong>频率：</strong>每人每分钟 3 次、每天 100 次；遇到 429 按提示等待，不要连续重试。</li>
        </ol>
        <p className="guide-note">聊天原文不保存；手机号、邮箱、证件号、@提及会先掩码。AI 没能整理时，标题和描述会按脱敏原文填入并明确提示「未经过 AI 整理」，必须人工改写后再提交。</p>

        <h4 className="guide-subheading">4.2 需求收集表（多维表格同步）</h4>
        <ol className="guide-steps">
          <li><strong>入口：</strong>飞书 Base 里的「需求收集表」，与「TB需求池」是两张表；把表单/表格入口发给需求提出人（销售、售后、电商、运营等）。</li>
          <li><strong>填写：</strong>标题、描述、来源渠道必填；需求类型、产品型号、约束说明、补充链接、功能模块、提出人按需填写。链接必须是 http(s)，不要带账号密码。</li>
          <li><strong>功能模块：</strong>自由文本，系统按已发布词典识别；识别不了不会拒绝整行，但需求模块会留空，同步说明会写「模块未识别：原文」。</li>
          <li><strong>等待同步：</strong>平台自动化每 30 分钟读取一次（实际可能因抖动略晚）；成功后「同步状态=已收录」、「系统需求 ID」有值；失败则「同步状态=校验失败」，按「同步说明」修正后等下一轮，<strong>不要新建重复行</strong>。</li>
          <li><strong>只收录一次：</strong>已收录的行后续修改不同步；需求内容要改，在 Web 详情或 Base 处理，不要改收集表行；删行不会删已创建的需求。</li>
          <li><strong>日常维护：</strong>收集表本身不设删除同步；如需暂停收录，在「数据源与计划 → 多维表格需求收集表」核对同步状态。</li>
        </ol>

        <h4 className="guide-subheading">4.3 四种来源对照</h4>
        <ArcoTable<(typeof SOURCE_ROWS)[number]>
          rowKey="mode"
          data={SOURCE_ROWS}
          pagination={false}
          border={false}
          columns={[
            { title: "来源方式", dataIndex: "mode", width: 130, render: (_value, row) => <strong>{row.mode}</strong> },
            { title: "入口", dataIndex: "how", width: 220 },
            { title: "需求池标识", dataIndex: "where" },
          ]}
        />

        <h4 className="guide-subheading">4.4 需求评估（详情页按需辅助）</h4>
        <ol className="guide-steps">
          <li><strong>触发：</strong>需求详情页「需求评估」区块，点「生成评估」手动触发；不会在同步/分析时自动调用模型。</li>
          <li><strong>补充输入：</strong>背景（≤2000 字）、目标（≤1000 字）、使用场景（≤2000 字）都可留空；补充内容只保存在评估版本里，不改需求原文、不写 Base。</li>
          <li><strong>结论解读：</strong>输出「建议推进 / 建议暂缓 / 待调查」与可行性、风险、反方观点及下一步建议；AI 建议非结论，不自动改写优先级或 PM 结论。</li>
          <li><strong>失败与单飞：</strong>同一需求正在生成时拒绝并发（409）；客户端等待最长 125 秒，超时后会继续核对落库结果，不重复提交。</li>
        </ol>
      </div>

      <ArcoDivider />

      <div className="guide-section">
        <h3>五、30 分钟培训议程</h3>
        <ArcoTable<(typeof AGENDA_ROWS)[number]>
          rowKey="time"
          data={AGENDA_ROWS}
          pagination={false}
          border={false}
          columns={[
            { title: "时段", dataIndex: "time", width: 120, render: (_value, row) => <span className="mono-cell">{row.time}</span> },
            { title: "内容", dataIndex: "content" },
            { title: "形式", dataIndex: "format", width: 130 },
          ]}
        />
      </div>

      <ArcoDivider />

      <div className="guide-section">
        <h3>六、异常排查与升级路径</h3>
        <ArcoTable<(typeof ESCALATION_ROWS)[number]>
          rowKey="symptom"
          data={ESCALATION_ROWS}
          pagination={false}
          border={false}
          columns={[
            { title: "现象", dataIndex: "symptom", width: 220, render: (_value, row) => <strong>{row.symptom}</strong> },
            { title: "首查项", dataIndex: "check", width: 260 },
            { title: "升级路径", dataIndex: "escalate" },
          ]}
        />
      </div>
    </ArcoCard>
  );
}
