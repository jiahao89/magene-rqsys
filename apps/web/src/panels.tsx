// 工单 16/17 工作台面板：数据全部来自本地 API，不使用演示数据；
// 权限拒绝、空数据、加载中、局部失败和 API 不可用都显示可恢复状态。
// 需求池/批次/审计面板自治加载，支持服务端筛选与游标分页。
import { useCallback, useEffect, useId, useRef, useState, Component, type KeyboardEvent, type ReactNode } from "react";
import { Button as HeroButton, Input as HeroInput, TextArea as HeroTextArea } from "@heroui/react";
import { RefreshCw, X } from "lucide-react";
import { stateLabel } from "./state-labels";
import {
  ApiError, createSource, getBatch, getRequirement, listAudit, listBatches, listMappings, listRequirements, pushRequirement,
  retryAnalysis, retrySyncItem, searchFeishuUsers, setOwner, updateSource,
  type AnalysisVersionSummary, type AuditEvent, type BatchDetail, type BatchSummary, type PersonMapping,
  type FeishuUserCandidate, type RequirementDetail, type RequirementSummary, type SourceConfig, type SourceConfigUpdate,
} from "./api";

export type LoadState = "loading" | "ready" | "error";

function errorText(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.status === 403) return `没有权限执行此操作（${cause.code}）。角色校验由服务端强制执行。`;
    return `${cause.message}（${cause.code}）`;
  }
  return "操作失败：无法连接本地 API。";
}

function StateBanner({ loadError, notice, onCloseNotice }: { loadError: string | null; notice: string | null; onCloseNotice: () => void }) {
  return <>
    {loadError && <div className="alert-banner" role="alert"><div><strong>请求失败</strong><span>{loadError}</span></div></div>}
    {notice && <div className="notice-banner" role="status"><span>{notice}</span><HeroButton className="icon-button" aria-label="关闭提示" onPress={onCloseNotice}><X size={15} /></HeroButton></div>}
  </>;
}

function timeLabel(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString("zh-CN") : "—";
}

function FeishuUserPicker({ disabled, onMap, saveLabel = "保存映射并入队推送" }: {
  disabled: boolean;
  onMap: (user: FeishuUserCandidate) => Promise<void>;
  saveLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<FeishuUserCandidate[]>([]);
  const [selected, setSelected] = useState<FeishuUserCandidate | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const searchVersion = useRef(0);
  const listboxId = useId();

  const search = async () => {
    if (query.trim().length < 2) { setSearchError("请输入至少 2 个字符搜索飞书用户。"); return; }
    const version = ++searchVersion.current;
    setSearching(true); setSearchError(null); setSelected(null); setCandidates([]); setActiveIndex(0);
    try {
      const results = await searchFeishuUsers(query);
      if (version === searchVersion.current) setCandidates(results);
    } catch (cause) {
      if (version === searchVersion.current) setSearchError(errorText(cause));
    } finally {
      if (version === searchVersion.current) setSearching(false);
    }
  };

  const handleListboxKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (candidates.length === 0) return;
    if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => (index + 1) % candidates.length); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => (index + candidates.length - 1) % candidates.length); }
    else if (event.key === "Home") { event.preventDefault(); setActiveIndex(0); }
    else if (event.key === "End") { event.preventDefault(); setActiveIndex(candidates.length - 1); }
    else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault(); setSelected(candidates[activeIndex]);
    }
  };

  return <div className="feishu-user-picker">
    <div className="feishu-user-search"><HeroInput aria-label="搜索飞书用户" placeholder="输入姓名搜索飞书用户" value={query} onChange={(event) => { searchVersion.current += 1; setSearching(false); setQuery(event.target.value); setCandidates([]); setSelected(null); setSearchError(null); setActiveIndex(0); }} />
      <HeroButton className="button button-secondary button-small" onPress={() => void search()} isDisabled={disabled || searching}>搜索</HeroButton>
    </div>
    {searchError && <span className="feishu-user-error" role="alert">{searchError}</span>}
    {candidates.length > 0 && <div id={listboxId} className="feishu-user-results" role="listbox" aria-label="飞书用户搜索结果" aria-activedescendant={`${listboxId}-option-${activeIndex}`} aria-describedby={`${listboxId}-instructions`} tabIndex={0} onKeyDown={handleListboxKeyDown}>
      {candidates.map((candidate, index) => <div id={`${listboxId}-option-${index}`} key={candidate.openId} role="option" aria-selected={selected?.openId === candidate.openId} data-active={activeIndex === index} className="feishu-user-option" onMouseMove={() => setActiveIndex(index)} onClick={() => { setActiveIndex(index); setSelected(candidate); }}>
        <span><strong>{candidate.name}</strong>{candidate.enName && <small>{candidate.enName}</small>}</span><code>…{candidate.openId.slice(-6)}</code>
      </div>)}
    </div>}
    {candidates.length > 0 && <span id={`${listboxId}-instructions`} className="feishu-user-hint">使用上下方向键选择，按 Enter 确认。</span>}
    {!searching && !searchError && query.trim().length >= 2 && candidates.length === 0 && <span className="feishu-user-hint">没有找到可选用户，请检查姓名或通讯录权限。</span>}
    {selected && <span className="feishu-user-hint" role="status">已选择：{selected.name}</span>}
    <HeroButton className="button button-primary button-small" onPress={() => { if (selected) void onMap(selected); }} isDisabled={disabled || !selected}>{saveLabel}</HeroButton>
  </div>;
}

// ---------- 工单 16：数据源配置（创建唯一来源 / 更新现有配置） ----------

const DEFAULT_TB_PROJECT_NAME = "室外产品-码表软固件需求池";
const emptyUpdate: SourceConfigUpdate = {
  projectName: DEFAULT_TB_PROJECT_NAME, enabled: false,
  schedule: { enabled: false, weekday: null, time: null, timezone: null },
  ownerNames: [], fieldMap: {},
};

export function SourcesPanel({ sources, loadState, onRefresh }: { sources: SourceConfig[]; loadState: LoadState; onRefresh: () => void }) {
  const existing = sources[0];
  const [draft, setDraft] = useState<SourceConfigUpdate>(() => existing ? {
    projectName: existing.projectName,
    enabled: existing.enabled, schedule: { ...existing.schedule }, ownerNames: [...existing.ownerNames], fieldMap: { ...existing.fieldMap },
  } : emptyUpdate);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const set = <K extends keyof SourceConfigUpdate>(key: K, value: SourceConfigUpdate[K]) => setDraft((prev) => ({ ...prev, [key]: value }));

  const save = async () => {
    setBusy(true); setLoadError(null); setNotice(null);
    try {
      const saved = existing ? await updateSource(existing.id, draft) : await createSource(draft);
      setDraft({ projectName: saved.projectName, enabled: saved.enabled, schedule: { ...saved.schedule }, ownerNames: [...saved.ownerNames], fieldMap: { ...saved.fieldMap } });
      setNotice(existing ? "来源配置已保存并从 API 重新读取一致。" : "来源已创建。MVP 只允许一个产品组来源。");
      onRefresh();
    } catch (cause) { setLoadError(errorText(cause)); }
    finally { setBusy(false); }
  };

  return <section className="panel requirements-panel">
    <div className="panel-heading"><div><h2>连接与数据源</h2><p>填写 Teambition 项目名称；系统会自动匹配项目及需求任务类型。凭据保存在服务端。</p></div>{existing && <span className={`status-chip ${existing.enabled ? "status-live" : "status-muted"}`}><span />{existing.enabled ? "已启用" : "已停用"}</span>}</div>
    <StateBanner loadError={loadError} notice={notice} onCloseNotice={() => setNotice(null)} />
    <div className="rules-form" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
      <label className="rules-threshold"><span>Teambition 项目名称</span><HeroInput aria-label="项目名称" value={draft.projectName} onChange={(e) => set("projectName", e.target.value)} /></label>
      <label className="rules-threshold"><span>启用同步</span><input type="checkbox" aria-label="启用同步" checked={draft.enabled} onChange={(e) => set("enabled", e.target.checked)} /></label>
    </div>
    <div className="rules-form" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
      <label className="rules-threshold"><span>周计划（1–7，周一为 1）</span><HeroInput aria-label="周计划星期" type="number" min={1} max={7} value={draft.schedule.weekday ?? ""} onChange={(e) => set("schedule", { ...draft.schedule, weekday: e.target.value === "" ? null : Number(e.target.value) })} /></label>
      <label className="rules-threshold"><span>执行时间（HH:MM）</span><HeroInput aria-label="执行时间" placeholder="09:30" value={draft.schedule.time ?? ""} onChange={(e) => set("schedule", { ...draft.schedule, time: e.target.value === "" ? null : e.target.value })} /></label>
      <label className="rules-threshold"><span>时区</span><HeroInput aria-label="时区" placeholder="Asia/Shanghai" value={draft.schedule.timezone ?? ""} onChange={(e) => set("schedule", { ...draft.schedule, timezone: e.target.value === "" ? null : e.target.value })} /></label>
      <label className="rules-threshold"><span>启用周计划</span><input type="checkbox" aria-label="启用周计划" checked={draft.schedule.enabled} onChange={(e) => set("schedule", { ...draft.schedule, enabled: e.target.checked })} /></label>
    </div>
    <div className="rules-form" style={{ alignItems: "flex-end" }}>
      <label className="rules-threshold" style={{ flex: 1 }}><span>产品组负责人名单（每行一个）</span><HeroTextArea aria-label="负责人名单" className="rules-textarea" rows={2} value={draft.ownerNames.join("\n")} onChange={(e) => set("ownerNames", e.target.value.split("\n").map((line) => line.trim()).filter(Boolean))} /></label>
      <label className="rules-threshold" style={{ flex: 1 }}><span>字段映射（每行「领域字段=Teambition 字段 ID」；个人/联系/凭据字段会被服务端拒绝）</span><HeroTextArea aria-label="字段映射" className="rules-textarea" rows={2} value={Object.entries(draft.fieldMap).map(([k, v]) => `${k}=${v}`).join("\n")} onChange={(e) => { const next: Record<string, string> = {}; for (const line of e.target.value.split("\n")) { const [key, ...rest] = line.split("="); if (key?.trim() && rest.length) next[key.trim()] = rest.join("=").trim(); } set("fieldMap", next); }} /></label>
    </div>
    <div className="rules-form"><HeroButton className="button button-primary button-small" onPress={() => void save()} isDisabled={busy}>{existing ? "保存更新" : "创建来源"}</HeroButton></div>
    {loadState === "error" && <div className="table-empty"><strong>无法读取来源配置</strong><span>请检查 API 连接后重试。</span></div>}
    {!existing && loadState === "ready" && <div className="table-empty"><strong>尚未配置数据源</strong><span>填写上方配置并创建后，同步与 AI 分析才会启动。</span></div>}
    {existing && <div className="table-scroll"><table><thead><tr><th>项目</th><th>负责人</th><th>映射字段数</th></tr></thead><tbody><tr><td>{existing.projectName}</td><td>{existing.ownerNames.join("、") || "—"}</td><td>{Object.keys(existing.fieldMap).length}</td></tr></tbody></table></div>}
  </section>;
}

// ---------- 工单 16/17：同步批次（status 筛选 + 游标分页 + 详情 + 失败项重试） ----------

export function BatchesPanel({ onRefresh }: { onRefresh: () => void }) {
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openBatch, setOpenBatch] = useState<BatchDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const retryKeys = useRef(new Map<string, string>());

  const load = useCallback(async (filter: { status: string; since: string; until: string }, nextCursor: string | null) => {
    setLoadState("loading"); setLoadError(null);
    try {
      const page = await listBatches({ status: filter.status || undefined, since: filter.since ? new Date(filter.since).toISOString() : undefined, until: filter.until ? new Date(filter.until).toISOString() : undefined, limit: 10, ...(nextCursor ? { cursor: nextCursor } : {}) });
      setBatches((prev) => nextCursor ? [...prev, ...page.items] : page.items);
      setCursor(page.nextCursor);
      setLoadState("ready");
    } catch (cause) { setLoadError(errorText(cause)); setLoadState("error"); }
  }, []);
  useEffect(() => { void load({ status: "", since: "", until: "" }, null); }, [load]);

  const open = async (id: string) => {
    setOpenBatch(null); setDetailError(null); setNotice(null);
    try { setOpenBatch(await getBatch(id)); }
    catch (cause) { setDetailError(errorText(cause)); }
  };
  const retryItem = async (item: BatchDetail["items"][number]) => {
    setBusy(true); setNotice(null);
    try {
      const key = retryKeys.current.get(item.id) ?? crypto.randomUUID();
      retryKeys.current.set(item.id, key);
      const result = await retrySyncItem(item.id, fetch, key);
      retryKeys.current.delete(item.id);
      if (openBatch) { const refreshed = await getBatch(openBatch.batchId); setOpenBatch(refreshed); }
      onRefresh(); setNotice(`失败项已重新入队：批次 ${result.batchId}`);
    } catch (cause) { setNotice(errorText(cause)); }
    finally { setBusy(false); }
  };

  return <section className="panel requirements-panel">
    <div className="panel-heading"><div><h2>同步批次历史</h2><p>触发者、批次时间与逐条结果由 API 提供；点击批次查看明细。</p></div><div style={{ display: "flex", gap: 8 }}>
      <select aria-label="批次状态筛选" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
        <option value="">全部状态</option><option value="running">进行中</option><option value="succeeded">已完成</option><option value="partial_failure">部分失败</option><option value="failed">失败</option>
      </select>
      <label className="rules-threshold"><span>开始时间</span><HeroInput type="datetime-local" aria-label="批次开始时间" value={since} onChange={(e) => setSince(e.target.value)} /></label>
      <label className="rules-threshold"><span>结束时间</span><HeroInput type="datetime-local" aria-label="批次结束时间" value={until} onChange={(e) => setUntil(e.target.value)} /></label>
      <HeroButton className="button button-secondary button-small" onPress={() => void load({ status: statusFilter, since, until }, null)}>筛选</HeroButton>
      <HeroButton className="button button-secondary button-small" onPress={() => { onRefresh(); void load({ status: statusFilter, since, until }, null); }}><RefreshCw size={14} />刷新</HeroButton>
    </div></div>
    <StateBanner loadError={loadError ?? detailError} notice={notice} onCloseNotice={() => setNotice(null)} />
    {openBatch && <div className="config-source" style={{ flexDirection: "column", alignItems: "stretch" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><strong>批次 {openBatch.batchId}</strong><HeroButton className="button button-secondary button-small" onPress={() => setOpenBatch(null)}>收起</HeroButton></div>
      <span>{stateChip(openBatch.status)} · 总数 {openBatch.totalCount} · 成功 {openBatch.succeededCount} · 失败 {openBatch.failedCount} · {openBatch.errorSummary ?? ""}</span>
      <div className="table-scroll"><table><thead><tr><th>源需求 ID</th><th>动作</th><th>状态</th><th>错误</th><th>操作</th></tr></thead><tbody>{openBatch.items.map((item) => <tr key={item.id}><td className="mono-cell">{item.teambitionRequirementId}</td><td>{item.action}</td><td><span className={`status-chip ${item.status === "failed" ? "status-danger" : "status-muted"}`}><span />{item.status === "failed" ? "失败" : "成功"}</span></td><td>{item.errorCode ?? "—"}</td><td>{item.status === "failed" && <HeroButton className="button button-secondary button-small" onPress={() => void retryItem(item)} isDisabled={busy}>重试</HeroButton>}</td></tr>)}</tbody></table></div>
    </div>}
    {batches.length ? <>
      <div className="table-scroll"><table><thead><tr><th>批次 ID</th><th>状态</th><th>触发</th><th>需求总数</th><th>成功</th><th>失败</th><th>开始时间</th><th>明细</th></tr></thead><tbody>{batches.map((batch) => <tr key={batch.id}><td className="mono-cell">{batch.id}</td><td>{stateChip(batch.status)}</td><td>{triggerLabel(batch)}</td><td>{batch.totalCount}</td><td>{batch.succeededCount}</td><td className={batch.failedCount ? "text-danger" : ""}>{batch.failedCount}</td><td>{timeLabel(batch.startedAt)}</td><td><HeroButton className="button button-secondary button-small" onPress={() => void open(batch.id)}>查看</HeroButton></td></tr>)}</tbody></table></div>
      {cursor && <div className="rules-form"><HeroButton className="button button-secondary button-small" onPress={() => void load({ status: statusFilter, since, until }, cursor)} isDisabled={loadState === "loading"}>加载更多</HeroButton></div>}
    </> : <div className="table-empty"><strong>{loadState === "loading" ? "正在载入批次" : "还没有同步批次"}</strong><span>{loadState === "loading" ? "正在从本地 API 读取。" : "启动手动同步后，真实批次记录会显示在这里。"}</span></div>}
  </section>;
}

function triggerLabel(batch: { triggerType?: string; actorId?: string | null }): string {
  const mode = batch.triggerType === "scheduled" ? "周计划" : batch.triggerType === "manual" ? "手动" : (batch.triggerType ?? "—");
  return `${mode}${batch.actorId ? ` · ${batch.actorId.slice(0, 8)}` : ""}`;
}

function stateChip(status: string) {
  const tone = status === "failed" ? "status-danger" : status === "running" ? "status-live" : "status-muted";
  return <span className={`status-chip ${tone}`}><span />{stateLabel(status)}</span>;
}

// ---------- 工单 17：需求池（服务端搜索/筛选/游标分页 + 详情证据 + 分阶段重试） ----------

const ownerStateOptions = [["", "全部负责人状态"], ["pending_mapping", "待匹配"], ["auto_mapped", "已匹配"], ["manually_mapped", "手动匹配"], ["not_required", "无需匹配"]] as const;
const analysisStateOptions = [["", "全部分析状态"], ["analyzed", "已分析"], ["failed_retryable", "待重试"], ["pending", "等待中"], ["running", "进行中"]] as const;
const pullStateOptions = [["", "全部同步状态"], ["pending", "等待同步"], ["running", "同步中"], ["synced", "已同步"], ["failed", "同步失败"]] as const;
const pushStateOptions = [["", "全部推送状态"], ["pending", "等待推送"], ["running", "推送中"], ["pushed", "已推送"], ["failed", "推送失败"]] as const;

interface AnalysisStructured {
  module?: unknown; priority?: unknown; confidence?: unknown; confidence_reason?: unknown;
  evidence?: unknown; facts?: unknown; inferences?: unknown; missing_inputs?: unknown; blind_spots?: unknown;
}

export function RequirementsPanel({ onRefresh }: { onRefresh: () => void }) {
  const [rows, setRows] = useState<RequirementSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [ownerState, setOwnerState] = useState("");
  const [analysisState, setAnalysisState] = useState("");
  const [pullState, setPullState] = useState("");
  const [pushState, setPushState] = useState("");
  const [batchId, setBatchId] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<RequirementDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (filter: { q: string; ownerState: string; analysisState: string; pullState: string; pushState: string; batchId: string; since: string; until: string }, nextCursor: string | null) => {
    setLoadState("loading"); setLoadError(null);
    try {
      const page = await listRequirements({ q: filter.q || undefined, ownerState: filter.ownerState || undefined, analysisState: filter.analysisState || undefined, pullState: filter.pullState || undefined, pushState: filter.pushState || undefined, batchId: filter.batchId || undefined, since: filter.since ? new Date(filter.since).toISOString() : undefined, until: filter.until ? new Date(filter.until).toISOString() : undefined, limit: 25, ...(nextCursor ? { cursor: nextCursor } : {}) });
      setRows((prev) => nextCursor ? [...prev, ...page.items] : page.items);
      setCursor(page.nextCursor);
      setLoadState("ready");
    } catch (cause) { setLoadError(errorText(cause)); setLoadState("error"); }
  }, []);
  const filters = { q: query.trim(), ownerState, analysisState, pullState, pushState, batchId: batchId.trim(), since, until };
  useEffect(() => { void load({ q: "", ownerState: "", analysisState: "", pullState: "", pushState: "", batchId: "", since: "", until: "" }, null); }, [load]);

  const open = async (id: string) => {
    setSelected(null); setDetailError(null); setNotice(null);
    try { setSelected(await getRequirement(id)); }
    catch (cause) { setDetailError(errorText(cause)); }
  };
  const runAction = async (action: () => Promise<string>, detailId: string) => {
    setBusy(true); setNotice(null);
    try { setNotice(await action()); onRefresh(); await open(detailId); }
    catch (cause) { setNotice(errorText(cause)); }
    finally { setBusy(false); }
  };
  const structured: AnalysisStructured = (selected?.analysis ?? {}) as AnalysisStructured;

  return <section className="panel requirements-panel">
    <div className="panel-heading"><div><h2>需求处理记录</h2><p>四阶段状态、批次和最近同步时间均由服务端筛选。</p></div><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <HeroInput aria-label="搜索需求标题" placeholder="搜索需求标题…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <select aria-label="同步状态筛选" value={pullState} onChange={(e) => setPullState(e.target.value)}>{pullStateOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <select aria-label="负责人筛选" value={ownerState} onChange={(e) => setOwnerState(e.target.value)}>{ownerStateOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <select aria-label="分析状态筛选" value={analysisState} onChange={(e) => setAnalysisState(e.target.value)}>{analysisStateOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <select aria-label="推送状态筛选" value={pushState} onChange={(e) => setPushState(e.target.value)}>{pushStateOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <HeroInput aria-label="批次 ID 筛选" placeholder="批次 ID" value={batchId} onChange={(e) => setBatchId(e.target.value)} />
      <label className="rules-threshold"><span>最近同步始于</span><HeroInput type="datetime-local" aria-label="最近同步开始时间" value={since} onChange={(e) => setSince(e.target.value)} /></label>
      <label className="rules-threshold"><span>最近同步止于</span><HeroInput type="datetime-local" aria-label="最近同步结束时间" value={until} onChange={(e) => setUntil(e.target.value)} /></label>
      <HeroButton className="button button-secondary button-small" onPress={() => void load(filters, null)}>筛选</HeroButton>
      <HeroButton className="button button-secondary button-small" onPress={() => { onRefresh(); void load(filters, null); }}><RefreshCw size={14} />刷新</HeroButton>
    </div></div>
    <StateBanner loadError={loadError ?? detailError} notice={notice} onCloseNotice={() => setNotice(null)} />
    {selected && <RequirementDetailCard selected={selected} structured={structured} busy={busy} onClose={() => setSelected(null)} onAct={runAction} />}
    <RequirementsTable rows={rows} loading={loadState === "loading"} onOpen={(row) => void open(row.id)} />
    {cursor && <div className="rules-form"><HeroButton className="button button-secondary button-small" onPress={() => void load(filters, cursor)} isDisabled={loadState === "loading"}>加载更多</HeroButton></div>}
  </section>;
}

function RequirementDetailCard({ selected, structured, busy, onClose, onAct }: {
  selected: RequirementDetail; structured: AnalysisStructured; busy: boolean; onClose: () => void;
  onAct: (action: () => Promise<string>, detailId: string) => Promise<void>;
}) {
  const evidence = Array.isArray(structured.evidence) ? structured.evidence.filter((x): x is string => typeof x === "string") : [];
  const facts = Array.isArray(structured.facts) ? structured.facts as { text?: string; evidence?: string }[] : [];
  const inferences = Array.isArray(structured.inferences) ? structured.inferences as { text?: string }[] : [];
  const missingInputs = Array.isArray(structured.missing_inputs) ? structured.missing_inputs.filter((x): x is string => typeof x === "string") : [];
  const blindSpots = Array.isArray(structured.blind_spots) ? structured.blind_spots.filter((x): x is string => typeof x === "string") : [];
  return <div className="config-source" style={{ flexDirection: "column", alignItems: "stretch" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><strong>{selected.title}（REQ-{selected.sourceRequirementId} · v{selected.sourceVersion}）</strong><HeroButton className="button button-secondary button-small" onPress={onClose}>收起</HeroButton></div>
    <span>拉取 {selected.pipeline.pull} · AI 分析 {selected.pipeline.analysis} · 负责人 {selected.pipeline.owner} · 推送 {selected.pipeline.push}{selected.baseRecordId ? ` · Base 记录 ${selected.baseRecordId}` : ""}</span>
    <div className="table-scroll"><table><thead><tr><th>AI 建议</th><th>内容</th></tr></thead><tbody>
      <tr><td>模块建议</td><td>{typeof structured.module === "string" ? structured.module : "—"}</td></tr>
      <tr><td>优先级建议</td><td>{typeof structured.priority === "string" ? structured.priority : "空（未发布有效校准规则时保持为空）"}</td></tr>
      <tr><td>置信度</td><td>{typeof structured.confidence === "string" ? structured.confidence : "—"}{typeof structured.confidence_reason === "string" ? ` · ${structured.confidence_reason}` : ""}</td></tr>
      <tr><td>原文证据</td><td>{evidence.length ? evidence.join("；") : "—"}</td></tr>
      <tr><td>事实（来自源文本）</td><td>{facts.length ? facts.map((f) => typeof f.text === "string" ? f.text : "").filter(Boolean).join("；") || "—" : "—"}</td></tr>
      <tr><td>AI 推断（非事实）</td><td>{inferences.length ? inferences.map((i) => typeof i.text === "string" ? `【AI 推断】${i.text}` : "").filter(Boolean).join("；") || "—" : "—"}</td></tr>
      <tr><td>缺失信息</td><td>{missingInputs.length ? missingInputs.join("；") || "—" : "—"}</td></tr>
      <tr><td>分析盲点</td><td>{blindSpots.length ? blindSpots.join("；") || "—" : "—"}</td></tr>
      <tr><td>源快照版本</td><td>v{selected.sourceVersion}（只读，来自 Teambition 快照）</td></tr>
    </tbody></table></div>
    <details className="source-snapshot"><summary>查看源快照内容（allowlist 字段，只读）</summary><pre className="source-snapshot-pre">{JSON.stringify(selected.source, null, 2)}</pre></details>
    {selected.analyses.length > 0 && <div className="table-scroll"><table><thead><tr><th>分析版本</th><th>状态</th><th>模块</th><th>优先级</th><th>开始时间</th><th>失败摘要</th></tr></thead><tbody>{[...selected.analyses].reverse().map((version: AnalysisVersionSummary) => <tr key={version.analysisVersion}><td className="mono-cell">v{version.analysisVersion}</td><td>{stageLabel(version.status)}</td><td>{version.moduleSuggestion ?? "—"}</td><td>{version.priority ?? "空"}</td><td>{timeLabel(version.startedAt)}</td><td>{version.safeErrorSummary ?? "—"}</td></tr>)}</tbody></table></div>}
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      {selected.pipeline.analysis === "failed_retryable" && <HeroButton className="button button-secondary button-small" onPress={() => void onAct(async () => { await retryAnalysis(selected.id); return "AI 分析重试已入队"; }, selected.id)} isDisabled={busy}>重试 AI 分析</HeroButton>}
      {selected.pipeline.owner === "pending_mapping" && <FeishuUserPicker disabled={busy} onMap={(user) => onAct(async () => { const result = await setOwner(selected.id, { feishuUserId: user.openId, feishuIdType: "open_id" }); return `${user.name} 映射已保存（${result.ownerState}），推送已排队`; }, selected.id)} />}
      {selected.pipeline.push === "failed" && <HeroButton className="button button-secondary button-small" onPress={() => void onAct(async () => { const result = await pushRequirement(selected.id); return result.status === "queued" ? "Base 推送重试已入队" : `推送状态：${result.status}`; }, selected.id)} isDisabled={busy}>重试 Base 推送</HeroButton>}
      <span style={{ fontSize: 9, color: "#818b9a" }}>推送成功不代表飞书 PM 通知已送达。</span>
    </div>
  </div>;
}

function RequirementsTable({ rows, loading, onOpen }: { rows: RequirementSummary[]; loading: boolean; onOpen: (row: RequirementSummary) => void }) {
  if (!rows.length) return <div className="table-empty"><strong>{loading ? "正在载入需求…" : "没有匹配的需求"}</strong><span>{loading ? "正在从本地 API 读取需求状态。" : "数据仅在 API 返回后显示，不使用演示数据。"}</span></div>;
  return <div className="table-scroll"><table><thead><tr><th>需求</th><th>版本</th><th>拉取</th><th>AI 分析</th><th>负责人</th><th>Base 推送</th><th>详情</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><div className="requirement-title"><span className="req-id">REQ-{row.sourceRequirementId}</span><strong>{row.title}</strong></div></td><td><span className="version-label">v{row.sourceVersion}</span></td><td>{stageLabel(row.pipeline.pull)}</td><td>{stageLabel(row.pipeline.analysis)}</td><td>{stageLabel(row.pipeline.owner)}</td><td>{stageLabel(row.pipeline.push)}</td><td><HeroButton className="button button-secondary button-small" onPress={() => onOpen(row)}>查看</HeroButton></td></tr>)}</tbody></table></div>;
}

function stageLabel(state: string) {
  const tone = state === "failed" || state === "failed_retryable" ? "status-danger" : state === "running" ? "status-live" : "status-muted";
  return <span className={`status-chip ${tone}`}><span />{stateLabel(state)}</span>;
}

// 审计结果列独立渲染（result 枚举 succeeded/failed/denied），不复用流水线阶段标签
function auditResultLabel(result: AuditEvent["result"]) {
  const map: Record<AuditEvent["result"], string> = { succeeded: "成功", failed: "失败", denied: "已拒绝" };
  const tone = result === "failed" ? "status-danger" : result === "denied" ? "status-muted" : "status-live";
  return <span className={`status-chip ${tone}`}><span />{map[result]}</span>;
}

// ---------- 工单 17：负责人映射（pending 服务端筛选 + 现有映射列表） ----------

export function MappingsPanel({ onRefresh }: { onRefresh: () => void }) {
  const [pending, setPending] = useState<RequirementSummary[]>([]);
  const [mappings, setMappings] = useState<PersonMapping[]>([]);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadState("loading"); setLoadError(null);
    const [pendingPage, mappingPage] = await Promise.allSettled([
      listRequirements({ ownerState: "pending_mapping", limit: 25 }),
      listMappings(),
    ]);
    // 任一关键请求失败即进入错误态（自述的可恢复行为：不静默吞掉局部失败）
    if (pendingPage.status === "rejected" || mappingPage.status === "rejected") {
      const cause = pendingPage.status === "rejected" ? pendingPage.reason : mappingPage.status === "rejected" ? mappingPage.reason : null;
      setLoadError(cause instanceof ApiError ? errorText(cause) : "无法加载映射数据。");
      setLoadState("error");
      return;
    }
    setPending(pendingPage.value.items);
    setMappings(mappingPage.value);
    setLoadState("ready");
  }, []);
  useEffect(() => { void load(); }, [load]);

  const submit = async (user: FeishuUserCandidate) => {
    if (!targetId) return;
    setBusy(true); setNotice(null);
    try {
      const result = await setOwner(targetId, { feishuUserId: user.openId, feishuIdType: "open_id" });
      setNotice(`${user.name} 映射已持久化（${result.ownerState}），Base 推送已入队。`);
      setTargetId(null);
      onRefresh(); await load();
    } catch (cause) { setNotice(errorText(cause)); }
    finally { setBusy(false); }
  };
  const matchMethodLabel: Record<PersonMapping["matchMethod"], string> = { tb_user_id: "TB 用户 ID", unique_name: "姓名唯一匹配", manual: "人工指定" };

  return <section className="panel requirements-panel">
    <div className="panel-heading"><div><h2>负责人映射</h2><p>为待匹配负责人选择飞书用户；映射持久化成功后才会入队推送。</p></div><HeroButton className="button button-secondary button-small" onPress={() => { onRefresh(); void load(); }}><RefreshCw size={14} />刷新</HeroButton></div>
    <StateBanner loadError={loadError} notice={notice} onCloseNotice={() => setNotice(null)} />
    {pending.length ? <div className="table-scroll"><table><thead><tr><th>需求</th><th>TB 负责人</th><th>操作</th></tr></thead><tbody>{pending.map((row) => <tr key={row.id}><td><div className="requirement-title"><span className="req-id">REQ-{row.sourceRequirementId}</span><strong>{row.title}</strong></div></td><td>待匹配</td><td>{targetId === row.id ? <div className="mapping-editor"><FeishuUserPicker disabled={busy} onMap={submit} saveLabel="保存" /><HeroButton className="button button-secondary button-small" onPress={() => setTargetId(null)} isDisabled={busy}>取消</HeroButton></div> : <HeroButton className="button button-secondary button-small" onPress={() => setTargetId(row.id)}>选择飞书用户</HeroButton>}</td></tr>)}</tbody></table></div> : <div className="table-empty"><strong>{loadState === "loading" ? "正在载入待匹配需求…" : "没有待匹配的负责人"}</strong><span>{loadState === "loading" ? "正在从本地 API 读取。" : "TB 无负责人需求可直接推送；未匹配需求会出现在这里等待人工映射。"}</span></div>}
    {mappings.length > 0 && <div className="table-scroll"><table><thead><tr><th>TB 用户 / 姓名</th><th>飞书用户</th><th>匹配方式</th><th>更新时间</th></tr></thead><tbody>{mappings.map((m) => <tr key={m.id}><td>{m.teambitionDisplayName ?? m.teambitionUserId ?? "（仅姓名匹配占位）"}</td><td className="mono-cell">{m.feishuUserId}</td><td>{matchMethodLabel[m.matchMethod] ?? m.matchMethod}</td><td>{timeLabel(m.updatedAt)}</td></tr>)}</tbody></table></div>}
  </section>;
}

// ---------- 工单 17：审计日志（按对象/时间筛选，服务端数据） ----------

export function AuditPanel() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [entityId, setEntityId] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");

  const load = useCallback(async (filter: { entityId: string; since: string; until: string }) => {
    setLoadState("loading"); setLoadError(null);
    try {
      setEvents(await listAudit({ entityId: filter.entityId || undefined, since: filter.since || undefined, until: filter.until || undefined, limit: 50 }));
      setLoadState("ready");
    } catch (cause) { setLoadError(errorText(cause)); setLoadState("error"); }
  }, []);
  useEffect(() => { void load({ entityId: "", since: "", until: "" }); }, [load]);

  return <section className="panel requirements-panel">
    <div className="panel-heading"><div><h2>审计日志</h2><p>同步、分析、映射、推送与配置操作的留痕；对象与时间筛选由服务端执行。</p></div><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <HeroInput aria-label="对象 ID 筛选" placeholder="按对象 ID 筛选" value={entityId} onChange={(e) => setEntityId(e.target.value)} />
      <label className="rules-threshold"><span>开始时间</span><HeroInput type="datetime-local" aria-label="开始时间" value={since} onChange={(e) => setSince(e.target.value)} /></label>
      <label className="rules-threshold"><span>结束时间</span><HeroInput type="datetime-local" aria-label="结束时间" value={until} onChange={(e) => setUntil(e.target.value)} /></label>
      <HeroButton className="button button-secondary button-small" onPress={() => void load({ entityId: entityId.trim(), since: since ? new Date(since).toISOString() : "", until: until ? new Date(until).toISOString() : "" })}>筛选</HeroButton>
    </div></div>
    <StateBanner loadError={loadError} notice={null} onCloseNotice={() => undefined} />
    {events.length ? <div className="table-scroll"><table><thead><tr><th>时间</th><th>操作者</th><th>动作</th><th>对象</th><th>结果</th><th>安全摘要</th></tr></thead><tbody>{events.map((event) => <tr key={event.id}><td>{timeLabel(event.occurredAt)}</td><td>{event.actorId ?? "系统"}</td><td className="mono-cell">{event.eventType}</td><td className="mono-cell">{event.entityType}:{event.entityId.slice(0, 8)}</td><td>{auditResultLabel(event.result)}</td><td>{Object.keys(event.safeDetails).length ? JSON.stringify(event.safeDetails) : "—"}</td></tr>)}</tbody></table></div> : <div className="table-empty"><strong>{loadState === "loading" ? "正在载入审计日志…" : "没有匹配的审计记录"}</strong><span>{loadState === "loading" ? "正在从本地 API 读取。" : "调整筛选条件或执行操作后再试。"}</span></div>}
  </section>;
}

// ---------- 全局错误边界：面板崩溃时显示可恢复状态而非白屏 ----------

interface ErrorBoundaryState { error: Error | null }
export class PanelErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };
  static getDerivedStateFromError(error: Error): ErrorBoundaryState { return { error }; }
  render() {
    if (this.state.error) {
      return <section className="panel requirements-panel"><div className="alert-banner" role="alert"><div><strong>页面渲染出错</strong><span>{this.state.error.message}。请刷新页面重试；问题持续时检查本地 API 日志。</span></div></div><div className="rules-form"><HeroButton className="button button-secondary button-small" onPress={() => this.setState({ error: null })}>重试渲染</HeroButton></div></section>;
    }
    return this.props.children;
  }
}
