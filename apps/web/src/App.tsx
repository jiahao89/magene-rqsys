import { useCallback, useEffect, useState } from "react";
import { Activity, ArrowDownToLine, ArrowRight, Check, ChevronDown, CircleAlert, CircleHelp, Clock3, Command, Database, FileClock, FolderSync, Gauge, GitBranch, Layers3, ListChecks, LoaderCircle, Moon, Play, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Sun, Users, X } from "lucide-react";
import { ApiError, createDictionaryDraft, createPriorityRuleDraft, getHealth, listDictionaryVersions, listPriorityRules, listSources, publishDictionaryVersion, publishPriorityRule, runSync, type DictionaryVersion, type PriorityRuleVersion, type PublishStatus, type SourceConfig } from "./api";
import { AuditPanel, BatchesPanel, MappingsPanel, PanelErrorBoundary, RequirementsPanel, SourcesPanel } from "./panels";
import { stateLabel } from "./state-labels";
import { checkScheduleHealth, describeCountdown, formatInZone, nextRunAt, type WeeklySchedule } from "./schedule";

type Batch = { id: string; status: string; totalCount: number; succeededCount: number; failedCount: number; startedAt?: string; completedAt?: string; errorSummary?: string };
type Requirement = { id: string; sourceRequirementId: string; title: string; sourceVersion: number; pipeline: { pull: string; analysis: string; owner: string; push: string }; analysis?: { module?: string; confidence?: string } | null };
type Page = "Overview" | "Requirements" | "Batches" | "Sources" | "Mappings" | "Rules" | "Audit";
type LoadState = "loading" | "ready" | "error";
type Theme = "light" | "dark";

function readStoredTheme(): Theme {
  try { return window.localStorage?.getItem("rq-sys-theme") === "dark" ? "dark" : "light"; }
  catch { return "light"; }
}

const navigation: { label: Page; icon: typeof Gauge }[] = [
  { label: "Overview", icon: Gauge }, { label: "Requirements", icon: ListChecks }, { label: "Batches", icon: FolderSync },
  { label: "Sources", icon: Database }, { label: "Mappings", icon: Users }, { label: "Rules", icon: Settings2 }, { label: "Audit", icon: FileClock },
];
const pageTitles: Record<Page, string> = { Overview: "总览", Requirements: "需求池", Batches: "同步批次", Sources: "数据源配置", Mappings: "负责人映射", Rules: "分类规则", Audit: "审计日志" };

async function apiJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: "application/json" } });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const envelope = body && typeof body === "object" && "error" in body ? body.error : undefined;
    const detail = envelope && typeof envelope === "object" ? envelope as { code?: string; message?: string } : {};
    throw new ApiError(detail.message ?? `Request failed (${response.status})`, response.status, detail.code ?? "REQUEST_FAILED");
  }
  return body as T;
}

const stageLabels = { pull: "拉取", analysis: "AI 分析", owner: "负责人", push: "推送" } as const;

function StagePill({ stage, value }: { stage: keyof typeof stageLabels; value: string }) {
  const tone = value === "failed" || value === "failed_retryable" ? "failed" : value === "pending" || value === "pending_mapping" ? "pending" : value === "running" ? "running" : "done";
  return <span className={`stage-pill ${tone}`}><span className="stage-dot" />{stageLabels[stage]} · {stateLabel(value)}</span>;
}

/**
 * 调度状态卡片：展示计划配置是否可用与下次计划时刻。
 * 只描述「已配置的计划」，不代表目标环境已执行或能够执行——绝对时刻来自本地纯计算。
 */
export function SchedulerHealthPanel({ schedule, now, loadState, onConfigure }: { schedule?: WeeklySchedule; now: Date; loadState: LoadState; onConfigure: () => void }) {
  const health = checkScheduleHealth(schedule);
  const next = health.active ? nextRunAt(schedule, now) : null;
  const tone = loadState === "loading" ? "status-muted" : health.active ? "status-live" : "status-muted";
  const toneLabel = loadState === "loading" ? "读取中" : health.active ? "计划已配置" : "未生效";
  return <section className="panel scheduler-panel">
    <div className="panel-heading"><div><h2>调度状态</h2><p>周计划配置与下次计划时刻 · 不代表目标环境已执行</p></div><span className={`status-chip ${tone}`}><span />{toneLabel}</span></div>
    <div className="scheduler-body">
      {loadState === "loading" && <p className="scheduler-note">正在读取来源配置与计划设置。</p>}
      {loadState !== "loading" && !health.active && <p className="scheduler-note">{health.reason}。<button className="link-button" onClick={onConfigure}>前往数据源配置 <ArrowRight size={13} /></button></p>}
      {loadState !== "loading" && health.active && <>
        <div className="scheduler-next">
          <span className="micro-label">下次计划同步</span>
          <strong>{next ? formatInZone(next, schedule!.timezone!) : "无法计算"}</strong>
          {next && <span className="scheduler-countdown"><Clock3 size={13} />{describeCountdown(next, now)}</span>}
        </div>
        <p className="scheduler-note">计划由来源配置与服务端调度共同决定；本卡片只反映已保存的配置，执行结果以同步批次记录为准。</p>
      </>}
    </div>
  </section>;
}

function App() {
  const [page, setPage] = useState<Page>("Overview");
  const [theme, setTheme] = useState<Theme>(readStoredTheme);
  const [health, setHealth] = useState<LoadState>("loading");
  const [sources, setSources] = useState<SourceConfig[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  // 计划预测基于「本次数据读取完成的时刻」，避免渲染期间读取挂钟导致结果不稳定。
  const [loadedAt, setLoadedAt] = useState(() => new Date());

  const loadData = useCallback(async () => {
    setHealth("loading"); setError(null);
    try {
      await getHealth();
      setHealth("ready");
      setLoadedAt(new Date());
      const sourceRows = await listSources();
      // 各端点独立容错：个别端点未实现（501）时不拖垮整页
      const [batchPage, requirementPage] = await Promise.allSettled([
        apiJson<{ items: Batch[] }>("/api/batches?limit=10"),
        apiJson<{ items: Requirement[] }>("/api/requirements?limit=25"),
      ]);
      setSources(sourceRows);
      setBatches(batchPage.status === "fulfilled" ? batchPage.value.items : []);
      setRequirements(requirementPage.status === "fulfilled" ? requirementPage.value.items : []);
      if (batchPage.status === "rejected" && requirementPage.status === "rejected") {
        throw batchPage.reason instanceof ApiError ? batchPage.reason : new Error("API request failed");
      }
    } catch (cause) {
      setHealth("error");
      setError(cause instanceof ApiError ? `${cause.message}（${cause.code}）` : "无法连接到本地 API。请启动 API 服务后重试。");
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { window.localStorage?.setItem("rq-sys-theme", theme); } catch { /* Storage can be disabled by the browser. */ }
  }, [theme]);

  const handleRunSync = async () => {
    const source = sources.find((item) => item.enabled);
    if (!source) { setNotice("请先配置并启用一个数据源。"); return; }
    setBusy(true); setNotice(null);
    try {
      const result = await runSync(source);
      setNotice(`批次 ${result.batchId} 已提交`);
      await loadData();
    } catch (cause) {
      setNotice(cause instanceof ApiError ? `${cause.message}（${cause.code}）` : "提交失败：无法连接本地 API。");
    } finally { setBusy(false); }
  };

  const shownRequirements = requirements.filter((item) => item.title.toLowerCase().includes(query.toLowerCase()) || item.sourceRequirementId.includes(query));
  const latestBatch = batches[0];
  const counts = { pull: requirements.filter((r) => r.pipeline.pull === "synced").length, analysis: requirements.filter((r) => r.pipeline.analysis === "analyzed").length, owner: requirements.filter((r) => ["auto_mapped", "manually_mapped", "not_required"].includes(r.pipeline.owner)).length, push: requirements.filter((r) => r.pipeline.push === "pushed").length, failed: requirements.filter((r) => [r.pipeline.pull, r.pipeline.analysis, r.pipeline.owner, r.pipeline.push].some((s) => s === "failed" || s === "failed_retryable")).length };
  const total = requirements.length;
  const completeStages = [counts.pull, counts.analysis, counts.owner, counts.push];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" onClick={() => setPage("Overview")}><span className="brand-mark"><Layers3 size={19} strokeWidth={2.2} /></span><span className="brand-name">rq<span>·</span>sys</span><span className="brand-edition">WORKSPACE</span></a>
        <div className="workspace-switch"><span className="workspace-avatar">R</span><span className="workspace-copy"><strong>需求运营组</strong><small>本地工作区</small></span><ChevronDown size={14} className="muted-icon" /></div>
        <div className="nav-label">WORKSPACE</div>
        <nav className="main-nav" aria-label="主导航">{navigation.map(({ label, icon: Icon }) => <button key={label} className={`nav-item ${page === label ? "active" : ""}`} onClick={() => setPage(label)}><Icon size={17} strokeWidth={1.8} /><span>{({ Overview: "总览", Requirements: "需求池", Batches: "同步批次", Sources: "数据源配置", Mappings: "负责人映射", Rules: "分类规则", Audit: "审计日志" } as Record<Page, string>)[label]}</span>{label === "Batches" && batches.length > 0 && <span className="nav-count">{batches.length}</span>}</button>)}</nav>
        <div className="sidebar-spacer" />
        <div className="side-help"><div className="help-icon"><CircleHelp size={17} /></div><div><strong>需要帮助？</strong><span>查看本地运行指南</span></div><ArrowRight size={15} /></div>
        <div className="user-profile"><div className="user-avatar">R</div><div className="user-copy"><strong>已登录用户</strong><span>租户内可用 · 无应用角色</span></div><button className="icon-button profile-menu" aria-label="账户菜单"><Settings2 size={17} /></button></div>
      </aside>

      <main className="main-area">
        <header className="topbar"><div className="breadcrumbs"><span>工作区</span><span className="crumb-sep">/</span><strong>{pageTitles[page]}</strong></div><div className="topbar-actions"><span className={`connection-state ${health}`}><span className="connection-dot" />{health === "ready" ? "API 已连接" : health === "loading" ? "正在检查 API" : "API 未连接"}</span><span className="topbar-divider" /><button className="icon-button" aria-label={theme === "dark" ? "切换浅色主题" : "切换深色主题"} aria-pressed={theme === "dark"} onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}><>{theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}</></button><button className="icon-button" aria-label="帮助"><CircleHelp size={17} /></button><button className="icon-button" aria-label="活动记录"><Activity size={17} /></button><div className="top-avatar">R</div></div></header>

        <div className="content-area">
          <PanelErrorBoundary>
          {error && <div className="alert-banner" role="alert"><CircleAlert size={18} /><div><strong>服务暂不可用</strong><span>{error}</span></div><button className="button button-secondary button-small" onClick={() => void loadData()}><RefreshCw size={14} />重试连接</button></div>}
          {notice && <div className="notice-banner" role="status"><Check size={16} /><span>{notice}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setNotice(null)}><X size={15} /></button></div>}
          {page === "Overview" && <>
            <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" />SYNC WORKBENCH</div><h1>工作流总览</h1><p>查看需求同步进度、分析状态与推送健康度。</p></div><div className="heading-actions"><button className="button button-secondary" onClick={() => void loadData()} disabled={health === "loading"}><RefreshCw size={15} className={health === "loading" ? "spin" : ""} />刷新</button><button className="button button-primary" onClick={() => void handleRunSync()} disabled={busy || health !== "ready"}><Play size={15} fill="currentColor" />{busy ? "提交中…" : "立即同步"}</button></div></section>
            <section className="source-banner"><div className="source-leading"><span className="source-icon"><GitBranch size={17} /></span><div><span className="micro-label">当前同步来源</span><strong>{sources[0]?.projectName ?? (health === "loading" ? "正在加载配置…" : "尚未配置数据源")}</strong></div></div><div className="source-meta"><span className={`status-chip ${sources[0]?.enabled ? "status-live" : "status-muted"}`}><span />{sources[0]?.enabled ? "同步已启用" : "未启用"}</span><span className="source-meta-divider" /><span className="subtle-text">Teambition 项目</span></div><button className="text-link" onClick={() => setPage("Sources")}>管理来源 <ArrowRight size={14} /></button></section>

            <section className="section-block"><div className="section-heading"><div><h2>同步健康度</h2><p>四个处理阶段独立统计 · 不互相阻塞</p></div><button className="link-button" onClick={() => setPage("Requirements")}>查看需求池 <ArrowRight size={14} /></button></div>
              <div className="metric-grid">{[
                { label: "已拉取需求", value: counts.pull, total, icon: ArrowDownToLine, color: "blue", delta: "Teambition → RQ-Sys" },
                { label: "AI 分析完成", value: counts.analysis, total, icon: Sparkles, color: "violet", delta: "建议结果可独立重试" },
                { label: "负责人已匹配", value: counts.owner, total, icon: Users, color: "amber", delta: "未分配需求仍可推送" },
                { label: "成功推送", value: counts.push, total, icon: Check, color: "green", delta: "Feishu Base" },
              ].map(({ label, value, total: denominator, icon: Icon, color, delta }) => <article className="metric-card" key={label}><div className="metric-top"><span className={`metric-icon ${color}`}><Icon size={17} /></span><span className="metric-context">本地 API 数据</span></div><div className="metric-value-row"><strong>{value}</strong><span className="metric-total">/ {denominator}</span></div><div className="metric-label">{label}</div><div className="metric-foot"><span>{delta}</span><span className="metric-trend"><ArrowRight size={13} /></span></div></article>)}</div>
            </section>

            <div className="overview-grid"><section className="panel pipeline-panel"><div className="panel-heading"><div><h2>处理阶段</h2><p>需求处理状态一览</p></div><button className="icon-button" aria-label="阶段说明"><CircleHelp size={16} /></button></div><div className="pipeline-overview">{[
              { name: "拉取", detail: "从 Teambition 获取需求", value: counts.pull, color: "blue", icon: ArrowDownToLine },
              { name: "AI 分析", detail: "生成模块与维度建议", value: counts.analysis, color: "violet", icon: Sparkles },
              { name: "负责人匹配", detail: "关联 Feishu 用户", value: counts.owner, color: "amber", icon: Users },
              { name: "推送 Base", detail: "创建或更新多维表格记录", value: counts.push, color: "green", icon: Check },
            ].map(({ name, detail, value, color, icon: Icon }, index) => <div className="pipeline-row" key={name}><div className={`pipeline-icon ${color}`}><Icon size={16} /></div><div className="pipeline-copy"><strong>{name}</strong><span>{detail}</span></div><div className="pipeline-progress"><div className="progress-track"><span style={{ width: `${total ? Math.round(value / total * 100) : 0}%` }} /></div><small>{value} / {total}</small></div>{index < 3 && <span className="pipeline-connector" />}</div>)}</div><div className="pipeline-foot"><span className="pipeline-health"><span />{health === "ready" ? "状态来自当前 API" : "等待 API 连接"}</span><span className="pipeline-note">AI 失败不会阻止推送</span></div></section>

              <section className="panel latest-panel"><div className="panel-heading"><div><h2>最近同步</h2><p>最新批次执行情况</p></div><button className="link-button" onClick={() => setPage("Batches")}>全部批次 <ArrowRight size={14} /></button></div>{latestBatch ? <div className="latest-content"><div className="batch-status-line"><span className={`batch-status-icon ${latestBatch.status === "failed" ? "danger" : latestBatch.status === "running" ? "live" : "success"}`}>{latestBatch.status === "running" ? <LoaderCircle size={16} className="spin" /> : latestBatch.status === "failed" ? <CircleAlert size={16} /> : <Check size={16} />}</span><div><strong>{latestBatch.status === "running" ? "同步进行中" : latestBatch.status === "partial_failure" ? "部分完成" : latestBatch.status === "failed" ? "同步失败" : "同步完成"}</strong><span>批次 {latestBatch.id}</span></div><span className="batch-status-tag">{stateLabel(latestBatch.status)}</span></div><div className="latest-counts"><div><strong>{latestBatch.totalCount}</strong><span>总需求</span></div><div><strong>{latestBatch.succeededCount}</strong><span>已完成</span></div><div><strong className={latestBatch.failedCount ? "text-danger" : ""}>{latestBatch.failedCount}</strong><span>失败</span></div></div><div className="latest-timestamp"><Clock3 size={14} />{latestBatch.startedAt ? new Date(latestBatch.startedAt).toLocaleString("zh-CN") : "等待批次时间"}<button className="link-button" onClick={() => setPage("Batches")}>查看详情</button></div></div> : <div className="empty-state compact"><span className="empty-icon"><Clock3 size={20} /></span><strong>{health === "loading" ? "正在加载批次" : "还没有同步批次"}</strong><span>{health === "ready" ? "手动启动同步后，批次进度会显示在这里。" : "连接 API 后可查看实际批次记录。"}</span></div>}</section></div>

            <SchedulerHealthPanel schedule={sources[0]?.schedule} now={loadedAt} loadState={health} onConfigure={() => setPage("Sources")} />

            <section className="panel requirements-panel"><div className="panel-heading requirements-heading"><div><h2>最近处理的需求</h2><p>每个阶段状态分别展示，分析失败不会隐藏已推送结果</p></div><div className="table-actions"><label className="search-box"><Search size={15} /><input aria-label="搜索需求" placeholder="搜索需求名称…" value={query} onChange={(event) => setQuery(event.target.value)} /><kbd>⌘ K</kbd></label><button className="button button-secondary button-small" onClick={() => setPage("Requirements")}>查看全部</button></div></div><RequirementsTable rows={shownRequirements.slice(0, 5)} loading={health === "loading"} /></section>
            <footer className="page-footer"><span>RQ-Sys MVP <span className="footer-dot">·</span> 本地开发工作区</span><span><ShieldCheck size={14} />状态由 API 返回；不展示飞书 PM 处理状态</span></footer>
          </>}

          {page !== "Overview" && <section className="secondary-page"><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" />WORKSPACE</div><h1>{pageTitles[page]}</h1><p>{pageDescription(page)}</p></div>{page === "Batches" && <button className="button button-primary" onClick={() => void handleRunSync()} disabled={busy || health !== "ready"}><Play size={15} fill="currentColor" />{busy ? "提交中…" : "立即同步"}</button>}</div><SecondaryContent page={page} sources={sources} batches={batches} requirements={shownRequirements} loadState={health} onNavigate={setPage} onRefresh={() => void loadData()} /></section>}
          </PanelErrorBoundary>
        </div>
      </main>
    </div>
  );
}

function RequirementsTable({ rows, loading }: { rows: Requirement[]; loading: boolean }) {
  if (!rows.length) return <div className="table-empty"><span className="empty-icon"><ListChecks size={19} /></span><strong>{loading ? "正在载入需求…" : "没有匹配的需求"}</strong><span>{loading ? "正在从本地 API 读取需求状态。" : "数据仅在 API 返回后显示，不使用演示数据。"}</span></div>;
  return <div className="table-scroll"><table><thead><tr><th>需求</th><th>版本</th><th>拉取</th><th>AI 分析</th><th>负责人</th><th>Base 推送</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><div className="requirement-title"><span className="req-id">REQ-{row.sourceRequirementId}</span><strong>{row.title}</strong></div></td><td><span className="version-label">v{row.sourceVersion}</span></td><td><StagePill stage="pull" value={row.pipeline.pull} /></td><td><StagePill stage="analysis" value={row.pipeline.analysis} /></td><td><StagePill stage="owner" value={row.pipeline.owner} /></td><td><StagePill stage="push" value={row.pipeline.push} /></td></tr>)}</tbody></table></div>;
}

function SecondaryContent({ page, sources, batches, requirements, loadState, onNavigate, onRefresh }: { page: Page; sources: SourceConfig[]; batches: Batch[]; requirements: Requirement[]; loadState: LoadState; onNavigate: (page: Page) => void; onRefresh: () => void }) {
  if (page === "Requirements") return <RequirementsPanel onRefresh={onRefresh} />;
  if (page === "Batches") return <BatchesPanel onRefresh={onRefresh} />;
  if (page === "Sources") return <SourcesPanel sources={sources} loadState={loadState} onRefresh={onRefresh} />;
  if (page === "Rules") return <RulesPanel />;
  if (page === "Mappings") return <MappingsPanel onRefresh={onRefresh} />;
  if (page === "Audit") return <AuditPanel />;
  return <section className="panel placeholder-panel"><div className="placeholder-illustration"><span><Users size={23} /></span><i /><i /><i /></div><div className="eyebrow"><span className="eyebrow-line" />API 契约待实现</div><h2>页面未实现</h2><p>该页面尚未提供 API 契约。</p><button className="button button-secondary" onClick={() => onNavigate("Overview" as Page)}>返回总览<ArrowRight size={15} /></button></section>;
}

const publishStatusChip: Record<PublishStatus, { label: string; className: string }> = { draft: { label: "草稿", className: "status-muted" }, published: { label: "已发布", className: "status-live" }, retired: { label: "已退役", className: "status-muted" } };

function PublishStatusChip({ status }: { status: PublishStatus }) {
  const chip = publishStatusChip[status];
  return <span className={`status-chip ${chip.className}`}><span />{chip.label}</span>;
}

// 评分映射输入：每行「维度:取值=分数」；分数来自规则数据本身，UI 不代填公式
function parseScoringInput(text: string): Record<string, Record<string, number>> {
  const map: Record<string, Record<string, number>> = { user: {}, market: {}, business: {}, technology: {} };
  for (const line of text.split("\n")) {
    const match = line.trim().match(/^(user|market|business|technology)[:：]\s*(.+?)\s*=\s*(-?\d+(?:\.\d+)?)$/);
    if (match) map[match[1]!]![match[2]!.trim()] = Number(match[3]);
  }
  return map;
}

function RulesPanel() {
  const [dictionaries, setDictionaries] = useState<DictionaryVersion[]>([]);
  const [rules, setRules] = useState<PriorityRuleVersion[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [entriesInput, setEntriesInput] = useState("");
  const [thresholds, setThresholds] = useState({ p0: 4, p1: 3, p2: 2 });
  const [scoringInput, setScoringInput] = useState("user:强=3\nuser:中=2\nuser:弱=1\nmarket:强=3\nmarket:中=2\nmarket:弱=1\nbusiness:强=3\nbusiness:中=2\nbusiness:弱=1\ntechnology:强=3\ntechnology:中=2\ntechnology:弱=1");
  const [evidenceInput, setEvidenceInput] = useState("");

  const load = useCallback(async () => {
    setLoadError(null);
    const [dictionaryPage, rulePage] = await Promise.allSettled([listDictionaryVersions(), listPriorityRules()]);
    if (dictionaryPage.status === "fulfilled") setDictionaries(dictionaryPage.value);
    if (rulePage.status === "fulfilled") setRules(rulePage.value);
    if (dictionaryPage.status === "rejected" && rulePage.status === "rejected") {
      setLoadError(dictionaryPage.reason instanceof ApiError ? `${dictionaryPage.reason.message}（${dictionaryPage.reason.code}）` : "无法加载规则配置。");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const withFeedback = async (action: () => Promise<string>) => {
    setBusy(true); setNotice(null);
    try { setNotice(await action()); await load(); }
    catch (cause) { setNotice(cause instanceof ApiError ? `${cause.message}（${cause.code}）` : "操作失败：无法连接本地 API。"); }
    finally { setBusy(false); }
  };
  const handleCreateDictionary = () => withFeedback(async () => {
    const entries = entriesInput.split("\n").map((line) => line.trim()).filter(Boolean);
    if (!entries.length) throw new ApiError("请输入至少一个模块名称（每行一个）。", 400, "EMPTY_INPUT");
    const created = await createDictionaryDraft(entries);
    setEntriesInput("");
    return `词典 v${created.version} 草稿已创建`;
  });
  const handleCreateRule = () => withFeedback(async () => {
    if (!(thresholds.p0 >= thresholds.p1 && thresholds.p1 >= thresholds.p2)) throw new ApiError("阈值需满足 P0 ≥ P1 ≥ P2。", 400, "INVALID_THRESHOLDS");
    const scoring = parseScoringInput(scoringInput);
    if (Object.values(scoring).some((map) => Object.keys(map).length === 0)) throw new ApiError("每个维度至少需要一条「取值=分数」的已批准评分。", 400, "INVALID_SCORING");
    let validationEvidence: unknown[] = [];
    try { validationEvidence = evidenceInput.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line) as unknown); }
    catch { throw new ApiError("校准证据每行必须是一个合法 JSON 对象。", 400, "INVALID_EVIDENCE"); }
    const created = await createPriorityRuleDraft({ scoring, thresholds }, fetch, validationEvidence);
    return `规则 v${created.version} 草稿已创建`;
  });

  return <>
    <section className="panel requirements-panel">
      <div className="panel-heading"><div><h2>模块词典</h2><p>AI 分析只使用已发布的词典版本；发布新版本会自动退役旧版本。</p></div><button className="button button-secondary button-small" onClick={() => void load()} disabled={busy}><RefreshCw size={14} />刷新</button></div>
      {loadError && <div className="alert-banner" role="alert"><CircleAlert size={18} /><div><strong>配置加载失败</strong><span>{loadError}</span></div></div>}
      {notice && <div className="notice-banner" role="status"><Check size={16} /><span>{notice}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setNotice(null)}><X size={15} /></button></div>}
      <div className="rules-form">
        <textarea aria-label="模块名称" className="rules-textarea" rows={3} placeholder="每行一个模块名称，例如：&#10;报表分析&#10;数据导入" value={entriesInput} onChange={(event) => setEntriesInput(event.target.value)} />
        <button className="button button-primary button-small" onClick={() => void handleCreateDictionary()} disabled={busy}>创建草稿</button>
      </div>
      {dictionaries.length ? <div className="table-scroll"><table><thead><tr><th>版本</th><th>状态</th><th>模块</th><th>创建时间</th><th>发布时间</th><th>操作</th></tr></thead><tbody>{dictionaries.map((d) => <tr key={d.version}><td className="mono-cell">v{d.version}</td><td><PublishStatusChip status={d.status} /></td><td>{d.entries.join("、")}</td><td>{new Date(d.createdAt).toLocaleString("zh-CN")}</td><td>{d.publishedAt ? new Date(d.publishedAt).toLocaleString("zh-CN") : "—"}</td><td>{d.status === "draft" && <button className="button button-secondary button-small" onClick={() => void withFeedback(async () => { await publishDictionaryVersion(d.version); return `词典 v${d.version} 已发布`; })} disabled={busy}>发布</button>}</td></tr>)}</tbody></table></div> : <div className="table-empty"><strong>{loadError ? "配置不可用" : "还没有词典版本"}</strong><span>{loadError ? "请检查 API 连接后重试。" : "创建草稿并发布后，AI 分析将使用该词典。"}</span></div>}
    </section>
    <section className="panel requirements-panel">
      <div className="panel-heading"><div><h2>优先级规则</h2><p>规则版本经历史案例校准；发布前需求优先级保持为空。</p></div></div>
      <div className="rules-form">
        <div className="rules-thresholds">
          {(["p0", "p1", "p2"] as const).map((key) => <label key={key} className="rules-threshold"><span>{key.toUpperCase()} 阈值</span><input type="number" min={0} max={4} step={1} value={thresholds[key]} aria-label={`${key.toUpperCase()} 阈值`} onChange={(event) => setThresholds((prev) => ({ ...prev, [key]: Number(event.target.value) }))} /></label>)}
        </div>
        <button className="button button-primary button-small" onClick={() => void handleCreateRule()} disabled={busy}>创建草稿</button>
      </div>
      <div className="rules-form">
        <label className="rules-threshold" style={{ flex: 1 }}><span>U/M/S/C 已批准评分映射（每行「维度:取值=分数」；未校准证据的规则不会用于计算）</span><textarea aria-label="评分映射" className="rules-textarea" rows={3} value={scoringInput} onChange={(event) => setScoringInput(event.target.value)} /></label>
      </div>
      <div className="rules-form">
        <label className="rules-threshold" style={{ flex: 1 }}><span>校准证据（每行一个 JSON 对象；为空的规则发布后不会用于优先级计算）</span><textarea aria-label="校准证据" className="rules-textarea" rows={2} placeholder='例如：{"cohort":"2026-Q3","cases":12}' value={evidenceInput} onChange={(event) => setEvidenceInput(event.target.value)} /></label>
      </div>
      {rules.length ? <div className="table-scroll"><table><thead><tr><th>版本</th><th>状态</th><th>阈值 (P0/P1/P2)</th><th>创建时间</th><th>发布时间</th><th>操作</th></tr></thead><tbody>{rules.map((rule) => <tr key={rule.id}><td className="mono-cell">v{rule.version}</td><td><PublishStatusChip status={rule.status} /></td><td className="mono-cell">{[rule.rules.thresholds?.p0, rule.rules.thresholds?.p1, rule.rules.thresholds?.p2].map((value) => value ?? "—").join(" / ")}</td><td>{new Date(rule.createdAt).toLocaleString("zh-CN")}</td><td>{rule.publishedAt ? new Date(rule.publishedAt).toLocaleString("zh-CN") : "—"}</td><td>{rule.status === "draft" && <button className="button button-secondary button-small" onClick={() => void withFeedback(async () => { await publishPriorityRule(rule.id); return `规则 v${rule.version} 已发布`; })} disabled={busy}>发布</button>}</td></tr>)}</tbody></table></div> : <div className="table-empty"><strong>{loadError ? "配置不可用" : "还没有规则版本"}</strong><span>{loadError ? "请检查 API 连接后重试。" : "创建阈值规则草稿并发布后，AI 建议才会生成 P0–P3 优先级。"}</span></div>}
    </section>
  </>;
}

function EmptyPanel({ loading, title, description }: { loading: boolean; title: string; description: string }) {
  return <div className="empty-state"><span className="empty-icon">{loading ? <LoaderCircle size={21} className="spin" /> : <Database size={20} />}</span><strong>{loading ? "正在载入…" : title}</strong><span>{description}</span></div>;
}

function pageDescription(page: Page): string {
  const descriptions: Record<Page, string> = { Overview: "同步流程的当前健康状态与执行概况。", Requirements: "查找需求并分别检查各流水线处理状态。", Batches: "检查同步运行历史、阶段结果与失败项。", Sources: "查看项目来源与同步连接状态。", Mappings: "处理 Teambition 与 Feishu 负责人之间的映射。", Rules: "管理版本化的模块字典与优先级规则。", Audit: "按操作人、时间和对象检查可追踪的工作流操作。" };
  return descriptions[page];
}

export default App;
