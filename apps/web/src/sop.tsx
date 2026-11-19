// SOP 与培训：独立页面，供试点 PM Leader / 执行 PM / 运维直接查阅。
// 内容为静态作业规范，不读取业务数据，也不写入任何系统。
export function SopPanel() {
  return <section className="panel requirements-panel guide-panel sop-panel">
    <div className="panel-heading">
      <div>
        <h2>SOP 与培训</h2>
        <p>试点角色标准作业流程 · 版本 v2（2026-11-19）· 建议培训时长 30 分钟 · 新增聊天粘贴、需求收集表、来源方式</p>
      </div>
      <span className="status-chip status-live"><span />试点材料</span>
    </div>

    <div className="guide-section">
      <h3>一、角色与边界</h3>
      <p className="guide-lead">Teambition 是需求原文唯一来源；RQ-Sys 负责同步、分析和推送；飞书 Base 是 PM 处理与 PM 终审的工作台。系统不覆盖 TB，也不把 PM 的 Base 终审写回 Web。</p>
      <div className="guide-table"><table>
        <thead><tr><th>角色</th><th>主要工作</th><th>系统入口</th><th>不负责</th></tr></thead>
        <tbody>
          <tr><td><strong>PM Leader</strong></td><td>分诊与优先级把关、负责人分配、周度质量复盘、需求收集表运营、试点节奏</td><td>总览、需求池、需求收集表、Base「TB需求池」、上线 Gate</td><td>不代替执行 PM 做逐条 PM 确认；不手工改 TB</td></tr>
          <tr><td><strong>执行 PM</strong></td><td>逐条确认模块/优先级、处理负责人通知、新来源需求确认、反馈 AI 结论偏差</td><td>需求池详情、「从聊天粘贴」、来源筛选、Base</td><td>不改评分规则、不改 Base 系统字段、不重复推送</td></tr>
          <tr><td><strong>运维</strong></td><td>同步/分析/推送健康、需求收集表同步状态、失败作业、告警、备份与发布</td><td>作业运维、运维指标（含多维表格同步）、告警群、发布记录</td><td>不修改需求内容与 PM 结论</td></tr>
        </tbody>
      </table></div>
      <p className="guide-note">当前试点维持“登录即全权限”，角色只用于职责分工，系统不强制权限。正式上线前如需权限矩阵，另立需求。</p>
      <p className="guide-note">新来源（聊天粘贴 / 需求收集表）不改变角色分工；来源只影响入口和标识，PM 确认、负责人、推送口径不变。</p>
    </div>

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

    <div className="guide-section">
      <h3>四、新增来源入口（聊天粘贴 / 需求收集表 / 来源方式）</h3>
      <p className="guide-lead">除 Teambition 同步外，系统支持两种新来源：Web「从聊天粘贴」和飞书 Base「需求收集表」；加上手工录入，共四种来源。四种来源进入后走同一条 分析 → 负责人 → 推送 链路；来源只影响入口和来源标识，不改变 PM 确认口径。</p>

      <h4 style={{ fontSize: "13px", fontWeight: 650, margin: "18px 0 8px" }}>4.1 聊天粘贴（Web 需求池）</h4>
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

      <h4 style={{ fontSize: "13px", fontWeight: 650, margin: "18px 0 8px" }}>4.2 需求收集表（多维表格同步）</h4>
      <ol className="guide-steps">
        <li><strong>入口：</strong>飞书 Base 里的「需求收集表」，与「TB需求池」是两张表；把表单/表格入口发给需求提出人（销售、售后、电商、运营等）。</li>
        <li><strong>填写：</strong>标题、描述、来源渠道必填；需求类型、产品型号、约束说明、补充链接、功能模块、提出人按需填写。链接必须是 http(s)，不要带账号密码。</li>
        <li><strong>功能模块：</strong>自由文本，系统按已发布词典识别；识别不了不会拒绝整行，但需求模块会留空，同步说明会写「模块未识别：原文」。</li>
        <li><strong>等待同步：</strong>平台自动化每 30 分钟读取一次（实际可能因抖动略晚）；成功后「同步状态=已收录」、「系统需求 ID」有值；失败则「同步状态=校验失败」，按「同步说明」修正后等下一轮，<strong>不要新建重复行</strong>。</li>
        <li><strong>只收录一次：</strong>已收录的行后续修改不同步；需求内容要改，在 Web 详情或 Base 处理，不要改收集表行；删行不会删已创建的需求。</li>
        <li><strong>系统字段：</strong>不要手工改「系统需求 ID / 同步状态 / 同步说明」；长时间不更新或写回失败，联系运维。</li>
        <li><strong>查原始行：</strong>详情页不提供 Base 记录链接；要核对收集表原文，用「系统需求 ID」在收集表里搜。</li>
      </ol>
      <p className="guide-note">收集表只负责「进入系统」；后续分析、负责人、推送、通知与其它来源完全一致。提出人只作展示，不参与负责人匹配、不通知。</p>

      <h4 style={{ fontSize: "13px", fontWeight: 650, margin: "18px 0 8px" }}>4.3 来源方式（需求池 / Base）</h4>
      <div className="guide-table"><table>
        <thead><tr><th>来源方式</th><th>怎么产生</th><th>在哪里看</th></tr></thead>
        <tbody>
          <tr><td>Teambition</td><td>从 TB 同步</td><td>默认来源，需求池不挂徽标</td></tr>
          <tr><td>Web 手工</td><td>需求池「新建需求」手工填写</td><td>需求池徽标「手工·渠道」+ 行首橙色条</td></tr>
          <tr><td>聊天粘贴</td><td>「从聊天粘贴」整理后创建</td><td>需求池徽标「聊天粘贴·渠道」+ 行首紫色条</td></tr>
          <tr><td>多维表格</td><td>需求收集表同步创建</td><td>需求池徽标「多维表格·渠道」+ 行首蓝色条</td></tr>
        </tbody>
      </table></div>
      <ul className="guide-steps">
        <li><strong>筛选：</strong>需求池顶部「来源」Tab 可选全部来源 / Teambition / 多维表格 / 手工 / 聊天粘贴；详情页底部「这条需求怎么来的」显示来源、渠道、提出人、创建时间。</li>
        <li><strong>Base：</strong>「来源方式」是单选字段，由系统在推送时写入，取值同上；不要手工改。字段未配置时系统不写、不报错；看不到这一列就联系 PM Leader/管理员确认。</li>
        <li><strong>通知：</strong>来源方式写入不触发 PM 通知；通知仍只在负责人变化、需求实质变更等事件发送。</li>
        <li><strong>历史数据：</strong>2026-11-18 之前通过聊天粘贴创建、但当时还没有来源留痕的需求无法与手工区分，按「Web 手工」处理；Base 来源方式只覆盖新推送/回填范围，空白不代表数据丢失。</li>
      </ul>
      <p className="guide-note">Base 来源方式字段与历史回填由管理员按计划执行：先 dry-run 对照，确认后只写「来源方式」，不碰 PM 字段、不触发通知。回填前会先确认通知工作流条件。</p>
    </div>

    <div className="guide-section">
      <h3>五、运维 · 每日 / 每周 SOP</h3>
      <ul className="guide-steps">
        <li><strong>每日 5 分钟：</strong>看飞书告警群与「作业运维」页。失败作业先看错误码：1254606/1254066 多为人员 ID/Base 字段问题；1254607 为过滤接口瞬时失败，可重试；AI 额度耗尽会自动暂停自动分析并告警，恢复后自动补跑。</li>
        <li><strong>需求收集表同步：</strong>看「扫描 / 已收录 / 校验失败 / 写回失败 / 读取失败」；写回或读取失败先查 Base 权限、字段是否存在、收集表是否被删/改名，再升级研发；校验失败是行数据问题，让填表人按同步说明修正。</li>
        <li><strong>推送失败处理：</strong>单条失败可在需求详情页「重试 Base 推送」；批量失败先停手，检查 Base token/字段/权限与最近发布，避免持续重试放大问题。</li>
        <li><strong>每周：</strong>核对运维指标（近 7/30 天）、失败码 Top、队列是否为 0、发布 error_logs；检查 Base 通知自动化与告警 webhook 是否 enabled；按需导出 CSV 留档。</li>
        <li><strong>每月：</strong>执行备份导出与隔离 schema 恢复演练，记录 RPO/RTO；检查 migration 状态（目标平台显示“无法判断”属预期）；轮换/核对告警 webhook 与平台密钥；复盘一次回退演练。</li>
        <li><strong>发布：</strong>变更走 `lark-cli` 发布并记录 release id/commit/error_logs；发布前跑本地门禁（typecheck/test/build/contract/alignment），发布后验证总览、需求池、作业运维、Gate 页。</li>
      </ul>
      <p className="guide-note">目标环境由妙搭托管；应用迁移记录不暴露给应用，health readiness 显示 upToDate=null 属预期，不要误判为数据库落后。备份/恢复脚本与 runbook 在 deployment/ 下。</p>
    </div>

    <div className="guide-section">
      <h3>六、30 分钟培训议程</h3>
      <div className="guide-table"><table>
        <thead><tr><th>时间</th><th>内容</th><th>形式</th></tr></thead>
        <tbody>
          <tr><td>0–5 分钟</td><td>目标、角色边界、Teambition/RQ-Sys/Base 三方关系</td><td>讲解</td></tr>
          <tr><td>5–10 分钟</td><td>总览四项健康度；需求池筛选/详情/证据</td><td>演示</td></tr>
          <tr><td>10–18 分钟</td><td>Base 逐条 PM 确认（模块/优先级/PM 状态）；AI 建议只作输入</td><td>演示 + 跟做</td></tr>
          <tr><td>18–23 分钟</td><td>负责人分配、通知触发规则、空负责人与待匹配处理</td><td>演示 + 跟做</td></tr>
          <tr><td>23–27 分钟</td><td>新增来源入口：聊天粘贴、需求收集表、来源方式</td><td>演示 + 跟做</td></tr>
          <tr><td>27–30 分钟</td><td>失败重试、告警（含 AI 额度暂停）与答疑；反馈入口、试点周会节奏</td><td>场景演练 + 讨论</td></tr>
        </tbody>
      </table></div>
      <p className="guide-note">培训验收：每位角色能独立完成本角色 SOP 的“每日清单”；执行 PM 能在 Base 完成 3 条需求确认，并完成一次聊天粘贴草稿的核对；PM Leader 能读出总览四项指标与 Gate 状态，并把一条需求收集表行跑到「已收录」。</p>
    </div>

    <div className="guide-section">
      <h3>七、异常升级路径</h3>
      <div className="guide-table"><table>
        <thead><tr><th>现象</th><th>先检查</th><th>升级到</th></tr></thead>
        <tbody>
          <tr><td>同步连续失败 / 批次卡住</td><td>数据源与计划、TB 凭据、队列</td><td>运维 → 研发</td></tr>
          <tr><td>需求收集表读取 / 写回失败</td><td>Base 权限、字段是否存在、收集表是否被删/改名</td><td>运维 → 研发</td></tr>
          <tr><td>需求收集表行校验失败</td><td>同步说明（标题/渠道/链接/必填）</td><td>填表人修正 → PM Leader；持续失败 → 运维</td></tr>
          <tr><td>聊天粘贴整理失败 / 超时 / 限流</td><td>页面错误、AI 状态卡、是否 429</td><td>手工填写；持续失败 → 运维</td></tr>
          <tr><td>来源方式缺失 / 与入口不符</td><td>记录来源、Base 字段是否配置、回填范围</td><td>运维</td></tr>
          <tr><td>AI 分析长期失败或额度告警</td><td>作业运维错误码、AI 暂停标记</td><td>运维 → 研发/AI 供应商</td></tr>
          <tr><td>单条 Base 推送失败</td><td>详情页失败原因、Base 字段/人员 ID</td><td>运维</td></tr>
          <tr><td>批量 Base 推送失败</td><td>最近发布、Base 权限、告警群</td><td>运维 → 研发</td></tr>
          <tr><td>优先级/模块结论明显不合理</td><td>原文证据、AI 版本、PM 终审</td><td>执行 PM → PM Leader</td></tr>
          <tr><td>权限/数据治理/合规问题</td><td>变更记录、Base 权限</td><td>PM Leader → 产品/安全</td></tr>
        </tbody>
      </table></div>
      <p className="guide-note">升级时请附：RQ 编号、发生时间、页面/接口、最近一次 release id、错误码或截图；不要附需求中的个人联系方式。</p>
    </div>
  </section>;
}
