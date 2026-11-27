// 使用指南页面：系统工作流、状态含义、通知规则与常见问题（纯静态说明）。
import { Card as ArcoCard, Descriptions as ArcoDescriptions, Divider as ArcoDivider, Grid as ArcoGrid, Space as ArcoSpace, Table as ArcoTable, Tag as ArcoTag, Typography as ArcoTypography } from "@arco-design/web-react";

const GUIDE_STAGES = [
  { name: "拉取", from: "Teambition", desc: "从 TB 项目拉取需求原文。只读，系统从不回写 TB。", who: "系统自动" },
  { name: "AI 分析", from: "应用", desc: "模型给出模块、优先级、置信度和 U/M/S/C 建议。结果独立版本化，可重试。", who: "系统自动" },
  { name: "负责人", from: "应用", desc: "把 TB 执行人映射到飞书用户。没映射的需求仍可推送，只是 Base 里负责人为空。", who: "系统自动 + 人工补" },
  { name: "推送", from: "飞书 Base", desc: "把 PM 字段和系统字段写进多维表格。同一诉求重复推送不会重复写。", who: "系统自动" },
  { name: "通知", from: "Base 自动化", desc: "Base 发现通知事件变化后，按规则发给负责人。", who: "Base 自动化" },
];

const GUIDE_STATES = [
  {
    name: "同步状态（拉取）",
    values: "已同步 · 待同步 · 同步中 · 同步失败",
    when: "定时同步或手动触发时，从 Teambition 拉取需求原文。原文没变就不会产生新版本。",
    stuck: "失败多半是 TB 凭据或网络问题，检查「数据源与计划」后重试同步。",
  },
  {
    name: "AI 分析状态",
    values: "已分析 · 待分析 · 分析中 · 可重试 · 失败",
    when: "同步完成且有新版本时自动触发，也可在详情页手动重试。它只产出建议，不改变需求原文。",
    stuck: "「可重试」表示这次失败但还能再试；系统会自行重试最多 3 次。分析失败不影响推送。",
  },
  {
    name: "负责人状态",
    values: "已手动匹配 · 已自动匹配 · 待匹配负责人 · 无需负责人",
    when: "把 TB 执行人对应到飞书账号。你能在详情页手动指定，系统也会按已保存的映射自动匹配。",
    stuck: "「待匹配负责人」说明这个 TB 执行人还没有飞书映射。此时需求仍能推送，Base 里负责人留空。",
  },
  {
    name: "推送状态",
    values: "已推送 · 待推送 · 推送中 · 推送失败",
    when: "把 PM 字段和系统字段写进飞书多维表格。同一版本的同一诉求重复推送不会重复写。",
    stuck: "失败多数是 Base 字段缺失或类型不符，详情页可点「重试 Base 推送」，并显示最近的失败原因。",
  },
];

const GUIDE_NOTICES: string[][] = [
  ["首次推送", "不发", "避免批量回填时刷屏"],
  ["分配或变更负责人", "发给新负责人", "负责人变更后由新负责人接手"],
  ["需求内容有实质变更", "发给当前负责人", "负责人为空时发给 PM Leader"],
  ["AI 分析失败后重试成功", "发给当前负责人", "同上"],
  ["改备注、改错别字", "不发", "不构成实质变更"],
];

const STAGE_COLUMNS = [
  { title: "阶段", dataIndex: "name", width: 120, render: (_value: unknown, stage: (typeof GUIDE_STAGES)[number]) => <strong>{stage.name}</strong> },
  { title: "数据归属", dataIndex: "from", width: 160 },
  { title: "做什么", dataIndex: "desc" },
  { title: "谁触发", dataIndex: "who", width: 160 },
];

const NOTICE_COLUMNS = [
  { title: "事件", render: (_value: unknown, row: string[]) => row[0] },
  { title: "是否通知", width: 120, render: (_value: unknown, row: string[]) => <ArcoTag size="small" color={row[1] === "不发" ? "gray" : "green"}>{row[1]}</ArcoTag> },
  { title: "为什么", render: (_value: unknown, row: string[]) => row[2] },
];

const FAQ_DATA = [
  { label: "需求改了但 Base 没变？", value: "推送是排队执行的，通常几十秒内完成。若长期不动，去需求池看它的推送状态和最近失败原因。" },
  { label: "负责人是空的怎么办？", value: "说明这个 TB 执行人还没对应飞书账号。在「团队管理 → 负责人映射」里补一条，或在需求详情页直接分配。空负责人的需求本身仍会推送到 Base，不阻塞。" },
  { label: "通知没收到？", value: "先确认这条需求是否发生过「分配负责人 / 内容实质变更 / AI 重试成功」之一——首次推送和改错别字都不会发。再确认 Base 里的「系统通知收件人」是否有值。" },
  { label: "AI 分析失败了怎么办？", value: "系统会自动重试最多 3 次；也可以在详情页手动点「重试 AI 分析」。分析失败不影响已推送的需求内容。" },
  { label: "页面上的「推送成功」等于消息已送达吗？", value: "不等于。推送成功只表示 Base 已写入；消息是否送达取决于 Base 自动化规则是否开启。可在多维表格里查看自动化运行记录。" },
];

export function GuidePanel() {
  return <ArcoCard bordered={false} className="rq-card requirements-panel guide-panel">
    <div className="guide-section">
      <h2>一、数据从哪里来，到哪里去</h2>
      <ArcoTypography.Paragraph type="secondary" className="guide-lead">Teambition 拥有需求原文，应用拥有处理状态，飞书多维表格拥有 PM 处理结果和通知。三者各管一段，互不覆盖。</ArcoTypography.Paragraph>
      <ArcoSpace size={8} wrap align="center">
        <ArcoTag color="arcoblue">Teambition（需求原文 · 只读）</ArcoTag>
        <span>→</span>
        <ArcoTag>应用数据库（处理状态 · 快照 · 映射）</ArcoTag>
        <span>→</span>
        <ArcoTag>飞书多维表格（PM 字段 · 通知）</ArcoTag>
        <span>→</span>
        <ArcoTag color="green">飞书消息（发给负责人）</ArcoTag>
      </ArcoSpace>
      <p className="guide-note">系统只读 Teambition，从不回写。你在页面里改的是应用侧的负责人映射，不是 TB 数据。</p>
    </div>

    <ArcoDivider />

    <div className="guide-section">
      <h2>二、五个阶段各自在做什么</h2>
      <ArcoTable<(typeof GUIDE_STAGES)[number]>
        rowKey="name"
        data={GUIDE_STAGES}
        pagination={false}
        border={false}
        columns={STAGE_COLUMNS}
      />
      <p className="guide-note">四个状态互相独立，各自推进：分析失败不影响推送，负责人空缺也不阻断推送。判断一条需求卡在哪，看它停在哪一列变红或变琥珀。</p>
    </div>

    <ArcoDivider />

    <div className="guide-section">
      <h2>三、状态怎么读</h2>
      <ArcoGrid.Row gutter={[12, 12]}>
        {GUIDE_STATES.map((stage) => (
          <ArcoGrid.Col key={stage.name} xs={24} md={12}>
            <ArcoCard size="small" className="rq-subcard" title={stage.name}>
              <div style={{ marginBottom: 6 }}><ArcoTag size="small" color="arcoblue">{stage.values}</ArcoTag></div>
              <p className="detail-note" style={{ marginTop: 0 }}><strong>什么时候变：</strong>{stage.when}</p>
              <p className="detail-note"><strong>卡住了怎么办：</strong>{stage.stuck}</p>
            </ArcoCard>
          </ArcoGrid.Col>
        ))}
      </ArcoGrid.Row>
      <p className="guide-note">页面上的状态一律显示中文；把鼠标停上去能看到原始值，便于排查。</p>
    </div>

    <ArcoDivider />

    <div className="guide-section">
      <h2>四、每天该做什么</h2>
      <ol className="guide-steps">
        <li><strong>先看总览。</strong>四个指标告诉你今天有多少需求卡在哪个阶段。</li>
        <li><strong>再看需求池的「待分配」。</strong>这些是 TB 里有执行人但还没对应飞书账号的需求。在详情页点「分配负责人」即可，分配后会自动排队推送并通知对方。</li>
        <li><strong>然后看「推送失败」。</strong>多数是 Base 字段问题。详情页点「重试 Base 推送」；版本不一致时系统会先重新同步。</li>
        <li><strong>怀疑 AI 结论时</strong>，在详情页展开「查看依据与历史」，核对原文证据和推断过程。AI 推断会明确标注。</li>
      </ol>
      <p className="guide-note">每周一上午系统会自动同步一次（可在「数据源与计划」调整）。平时不需要手动触发。</p>
    </div>

    <ArcoDivider />

    <div className="guide-section">
      <h2>五、什么时候会收到通知</h2>
      <ArcoTable<string[]>
        rowKey={(row: string[]) => row[0] ?? ""}
        data={GUIDE_NOTICES}
        pagination={false}
        border={false}
        columns={NOTICE_COLUMNS}
      />
      <p className="guide-note">同一事件重复推送不会重复通知：事件 ID 是确定性的，Base 只有看到变化才会发消息。</p>
    </div>

    <ArcoDivider />

    <div className="guide-section">
      <h2>六、常见问题</h2>
      <ArcoDescriptions
        size="small"
        layout="vertical"
        column={1}
        data={FAQ_DATA}
      />
    </div>
  </ArcoCard>;
}

export default GuidePanel;
