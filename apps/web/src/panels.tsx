// 工单 16/17 工作台面板：数据全部来自本地 API，不使用演示数据；
// 权限拒绝、空数据、加载中、局部失败和 API 不可用都显示可恢复状态。
// 需求池/批次/审计面板自治加载，支持服务端筛选与游标分页。
import { useCallback, useEffect, useId, useRef, useState, Component, type KeyboardEvent, type ReactNode } from "react";
import { Accordion as HeroAccordion, AlertDialog as HeroAlertDialog, Button as HeroButton, Card as HeroCard, Chip as HeroChip, Input as HeroInput, TextArea as HeroTextArea } from "@heroui/react";
import { ArrowLeft, RefreshCw, X } from "lucide-react";
import { stateLabel } from "./state-labels";
import { checkScheduleHealth } from "./schedule";
import { readRequirementDeepLink } from "./deep-link";
import { emptyRequirementListFilters, readRequirementListFilters, requirementPoolUrl, type RequirementListFilters } from "./requirements-url";
import { formatDateTime, requirementOwnerView, requirementSourceFacts, requirementTime, sortRequirementsForAttention } from "./requirement-view";
import {
  ApiError, addTeamPerson, bindTeamPersonFeishu, createSource, deleteTeamPerson, getBatch, getFunctionModules, getRequirement, listAudit, listBatches, listDictionaryVersions, listMappings, listRequirements, listTeamPeople, pushRequirement,
  renameTeamPerson, saveFunctionModules,
  retryAnalysis, retrySyncItem, searchFeishuUsers, setOwner, unbindTeamPersonFeishu, updateSource,
  type AnalysisVersionSummary, type AuditEvent, type BatchDetail, type BatchSummary, type DictionaryVersion, type PersonMapping, type PublishStatus, type FeishuUserSelection,
  type FeishuUserCandidate, type FunctionModuleEntry, type RequirementDetail, type RequirementSummary, type SourceConfig, type SourceConfigUpdate, type TeamPerson,
} from "./api";
import type { WorkbenchTab } from "./workbench-routing";

export type LoadState = "loading" | "ready" | "error";

function errorText(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.status === 403) return `服务端拒绝了此操作（${cause.code}）。MVP 要求飞书登录；拒绝原因以服务端为准，工作台不会绕过。`;
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

function DeleteConfirmation({ description, disabled, onConfirm, triggerLabel = "删除", heading = "确认删除", confirmLabel = "确认删除" }: { description: string; disabled: boolean; onConfirm: () => void; triggerLabel?: string; heading?: string; confirmLabel?: string }) {
  return <HeroAlertDialog.Root>
    <HeroAlertDialog.Trigger className="button button-secondary button-small" aria-disabled={disabled} tabIndex={disabled ? -1 : 0} style={disabled ? { pointerEvents: "none", opacity: 0.6 } : undefined}>{triggerLabel}</HeroAlertDialog.Trigger>
    <HeroAlertDialog.Backdrop>
      <HeroAlertDialog.Container>
        <HeroAlertDialog.Dialog>
          <HeroAlertDialog.Header><HeroAlertDialog.Heading>{heading}</HeroAlertDialog.Heading></HeroAlertDialog.Header>
          <HeroAlertDialog.Body><p>{description}</p></HeroAlertDialog.Body>
          <HeroAlertDialog.Footer>
            <HeroButton slot="close" variant="secondary">取消</HeroButton>
            <HeroButton slot="close" variant="danger" onPress={onConfirm}>{confirmLabel}</HeroButton>
          </HeroAlertDialog.Footer>
        </HeroAlertDialog.Dialog>
      </HeroAlertDialog.Container>
    </HeroAlertDialog.Backdrop>
  </HeroAlertDialog.Root>;
}

function timeLabel(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString("zh-CN") : "—";
}

const publishStatusChip: Record<PublishStatus, { label: string; className: string }> = { draft: { label: "草稿", className: "status-muted" }, published: { label: "已发布", className: "status-live" }, retired: { label: "已退役", className: "status-muted" } };

export function PublishStatusChip({ status }: { status: PublishStatus }) {
  const chip = publishStatusChip[status];
  return <span className={`status-chip ${chip.className}`}><span />{chip.label}</span>;
}

function scheduleLabel(schedule: SourceConfig["schedule"]): string {
  if (!schedule.enabled) return "未启用";
  const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const weekday = weekdays[(schedule.weekday ?? 1) - 1] ?? "每周";
  return `${weekday} ${schedule.time ?? "时间未设置"} ${schedule.timezone ?? ""}`.trim();
}

function FeishuUserPicker({ disabled, onMap, saveLabel = "保存负责人并入队推送" }: {
  disabled: boolean;
  onMap: (user: FeishuUserSelection) => Promise<void>;
  saveLabel?: string;
}) {
  // 名单来自 person_mappings（组内人员绑定的飞书账号 + 需求详情里建立的人工映射），
  // 不再每次输入姓名搜索飞书通讯录：分配负责人是高频动作，从固定名单里选比等搜索结果快。
  const [people, setPeople] = useState<FeishuUserSelection[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void listMappings()
      .then((rows) => {
        if (cancelled) return;
        const seen = new Map<string, FeishuUserSelection>();
        for (const row of rows) {
          // 只有带姓名的映射才能在下拉里显示；否则会变成一串飞书 ID，无法辨认。
          if (!row.feishuUserId || !row.teambitionDisplayName || seen.has(row.feishuUserId)) continue;
          seen.set(row.feishuUserId, {
            feishuUserId: row.feishuUserId,
            feishuIdType: row.feishuIdType,
            name: row.teambitionDisplayName,
          });
        }
        setPeople([...seen.values()].sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN")));
      })
      .catch((cause) => { if (!cancelled) setLoadError(cause instanceof ApiError ? errorText(cause) : "无法读取人员名单，请刷新后重试。"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const selected = people.find((person) => person.feishuUserId === selectedId) ?? null;
  const save = async () => {
    if (!selected) return;
    setSaving(true);
    try { await onMap(selected); } finally { setSaving(false); }
  };

  return <div className="feishu-user-picker">
    {loadError
      ? <span className="feishu-user-error" role="alert">{loadError}</span>
      : <div className="feishu-user-search">
          <select aria-label="选择负责人" value={selectedId} disabled={disabled || loading || saving}
            onChange={(event) => setSelectedId(event.target.value)}>
            <option value="">{loading ? "正在读取人员…" : people.length ? "请选择负责人" : "名单为空，请先在「组内人员」绑定飞书账号"}</option>
            {people.map((person) => <option key={person.feishuUserId} value={person.feishuUserId}>{person.name}</option>)}
          </select>
          <button className="button button-primary button-small" onClick={() => void save()} disabled={disabled || !selected || saving}>
            {saving ? "保存中…" : saveLabel}
          </button>
        </div>}
  </div>;
}

// ---------- 工单 16：数据源配置（创建唯一来源 / 更新现有配置） ----------

const DEFAULT_TB_PROJECT_NAME = "室外产品-码表软固件需求池";
const emptyUpdate: SourceConfigUpdate = {
  projectName: DEFAULT_TB_PROJECT_NAME, enabled: false,
  schedule: { enabled: false, weekday: 1, time: "09:00", timezone: "Asia/Shanghai" },
};

// ---------- Spec 04 连接自检：只反映已保存配置，不声称已校验服务端凭据 ----------

/**
 * 连接自检清单。凭据校验发生在服务端；凭据值不下发浏览器，
 * 因此这里只展示「配置是否完整/合法」，绝不显示任何凭据内容或有效/无效结论。
 */
function ConnectionSelfCheck({ existing, draft }: { existing?: SourceConfig; draft: SourceConfigUpdate }) {
  const schedule = existing ? existing.schedule : draft.schedule;
  const scheduleHealth = checkScheduleHealth(schedule);
  const checks = [
    { label: "Teambition 项目名称", ok: Boolean((existing?.projectName ?? draft.projectName).trim()), detail: existing ? "已保存到服务端" : "保存后由服务端解析项目与需求任务类型" },
    { label: "周计划配置", ok: scheduleHealth.active, detail: scheduleHealth.active ? scheduleLabel(schedule) : scheduleHealth.reason ?? "未配置" },
    { label: "同步开关", ok: Boolean(existing?.enabled), detail: existing?.enabled ? "允许手动同步" : "未启用，手动同步会被拒绝" },
  ];
  return <div className="self-check" role="group" aria-label="连接自检">
    <div className="self-check-head"><strong>连接自检</strong><span>只反映已保存配置；服务端凭据与外部连通性不在此处断言</span></div>
    <ul className="self-check-list">{checks.map((check) => <li key={check.label}>
      <span className={`self-check-dot ${check.ok ? "ok" : "pending"}`} />
      <span className="self-check-label">{check.label}</span>
      <span className="self-check-detail">{check.detail}</span>
    </li>)}</ul>
    <p className="self-check-note">服务端凭据（Teambition 网关、AI 服务、飞书 Base）保存在服务端环境，不写入浏览器也不回显；其有效性以实际同步批次与推送结果为准。</p>
  </div>;
}

export function SourcesPanel({ sources, loadState, onRefresh }: { sources: SourceConfig[]; loadState: LoadState; onRefresh: () => void }) {
  const existing = sources[0];
  const [draft, setDraft] = useState<SourceConfigUpdate>(() => existing ? {
    projectName: existing.projectName,
    enabled: existing.enabled, schedule: { ...existing.schedule },
  } : emptyUpdate);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 冷加载时 sources 还是空数组，useState 初始化只会拿到默认值；等数据到达后必须再同步一次，
  // 否则页面写着「已启用」，开关却是关的，直接保存会把同步和周计划一起关掉。
  const loadedKey = existing ? `${existing.id}|${existing.enabled}|${existing.projectName}|${existing.schedule.enabled}|${existing.schedule.weekday}|${existing.schedule.time}` : "";
  useEffect(() => {
    if (!existing) return;
    setDraft({ projectName: existing.projectName, enabled: existing.enabled, schedule: { ...existing.schedule } });
    // 仅在服务端配置实际变化时重同步，避免覆盖用户正在编辑的草稿。
  }, [loadedKey]);

  const set = <K extends keyof SourceConfigUpdate>(key: K, value: SourceConfigUpdate[K]) => setDraft((prev) => ({ ...prev, [key]: value }));

  const save = async () => {
    setBusy(true); setLoadError(null); setNotice(null);
    try {
      const saved = existing ? await updateSource(existing.id, draft) : await createSource(draft);
      setDraft({ projectName: saved.projectName, enabled: saved.enabled, schedule: { ...saved.schedule } });
      setNotice(existing ? "来源配置已保存并从 API 重新读取一致。" : "来源已创建。MVP 只允许一个产品组来源。");
      onRefresh();
    } catch (cause) { setLoadError(errorText(cause)); }
    finally { setBusy(false); }
  };

  return <section className="panel requirements-panel">
    <div className="panel-heading"><div><h2>连接与数据源</h2><p>填写 Teambition 项目名称；系统会自动匹配项目及需求任务类型。凭据保存在服务端。</p></div>{existing && <span className={`status-chip ${existing.enabled ? "status-live" : "status-muted"}`}><span />{existing.enabled ? "已启用" : "已停用"}</span>}</div>
    <StateBanner loadError={loadError} notice={notice} onCloseNotice={() => setNotice(null)} />
    <div className="rules-form" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
      <label className="field"><span>Teambition 项目名称</span><HeroInput aria-label="项目名称" value={draft.projectName} onChange={(e) => set("projectName", e.target.value)} /></label>
      <label className="rules-threshold"><span>启用同步</span><input type="checkbox" aria-label="启用同步" checked={draft.enabled} onChange={(e) => set("enabled", e.target.checked)} /></label>
    </div>
    <div className="rules-form" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
      <label className="rules-threshold"><span>周计划（1–7，周一为 1）</span><HeroInput aria-label="周计划星期" type="number" min={1} max={7} value={draft.schedule.weekday ?? ""} onChange={(e) => set("schedule", { ...draft.schedule, weekday: e.target.value === "" ? null : Number(e.target.value) })} /></label>
      <label className="field field--short"><span>执行时间（HH:MM）</span><HeroInput aria-label="执行时间" placeholder="09:00" value={draft.schedule.time ?? ""} onChange={(e) => set("schedule", { ...draft.schedule, time: e.target.value === "" ? null : e.target.value })} /></label>
      <label className="field"><span>时区</span><HeroInput aria-label="时区" placeholder="Asia/Shanghai" value={draft.schedule.timezone ?? ""} onChange={(e) => set("schedule", { ...draft.schedule, timezone: e.target.value === "" ? null : e.target.value })} /></label>
      <label className="rules-threshold"><span>启用周计划</span><input type="checkbox" aria-label="启用周计划" checked={draft.schedule.enabled} onChange={(e) => set("schedule", { ...draft.schedule, enabled: e.target.checked })} /></label>
    </div>
    <div className="rules-form"><HeroButton className="button button-primary button-small" onPress={() => void save()} isDisabled={busy || loadState === "loading"}>{existing ? "保存更新" : "创建来源"}</HeroButton></div>
    {loadState === "ready" && <ConnectionSelfCheck existing={existing} draft={draft} />}
    {loadState === "error" && <div className="table-empty"><strong>无法读取来源配置</strong><span>请检查 API 连接后重试。</span></div>}
    {!existing && loadState === "ready" && <div className="table-empty"><strong>尚未配置数据源</strong><span>填写项目名称并创建后，可手动同步；周计划启用后按设定执行。</span></div>}
    {existing && <div className="table-scroll"><table><thead><tr><th>项目</th><th>定时同步</th></tr></thead><tbody><tr><td>{existing.projectName}</td><td>{scheduleLabel(existing.schedule)}</td></tr></tbody></table></div>}
  </section>;
}

// ---------- 人员与功能模块字典 ----------

/** 飞书 user ID 很长，人员表格里只显示首尾；完整值放在 title 上，便于核对。 */
function shortFeishuId(id: string): string {
  return id.length <= 14 ? id : `${id.slice(0, 4)}…${id.slice(-6)}`;
}

/**
 * 人员页的「绑定飞书账号」编辑器：按姓名搜索飞书通讯录，选中后保存映射。
 * 搜索走 /api/feishu/users（独立部署时可用）；目标妙搭环境用平台通讯录搜索 + resolve。
 */
function FeishuAccountBinder({ personName, disabled, onSave, onCancel }: {
  personName: string;
  disabled: boolean;
  onSave: (selection: FeishuUserSelection) => Promise<void>;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState(personName);
  const [candidates, setCandidates] = useState<FeishuUserCandidate[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (text: string) => {
    const clean = text.trim();
    if (clean.length < 2) { setError("请输入至少 2 个字符再搜索。"); return; }
    setSearching(true); setError(null);
    try {
      const items = await searchFeishuUsers(clean);
      setCandidates(items);
      setSelectedId(items[0]?.openId ?? "");
    } catch (cause) {
      setCandidates([]); setSelectedId("");
      setError(cause instanceof ApiError ? errorText(cause) : "无法搜索飞书通讯录，请稍后重试。");
    } finally { setSearching(false); }
  }, []);
  // 打开编辑器就用人员姓名搜一次：多数情况姓名即飞书姓名，少打一次字。
  useEffect(() => { void search(personName); }, [personName, search]);

  const selected = candidates.find((candidate) => candidate.openId === selectedId) ?? null;
  const save = async () => {
    if (!selected) return;
    setSaving(true); setError(null);
    try { await onSave({ feishuUserId: selected.openId, feishuIdType: "open_id", name: selected.name }); }
    catch (cause) { setError(cause instanceof ApiError ? errorText(cause) : "保存绑定失败，请重试。"); }
    finally { setSaving(false); }
  };

  return <div className="feishu-account-binder">
    <div className="feishu-user-search">
      <HeroInput aria-label="搜索飞书账号" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void search(query); }} />
      <HeroButton className="button button-secondary button-small" onPress={() => void search(query)} isDisabled={disabled || searching}>{searching ? "搜索中…" : "搜索"}</HeroButton>
    </div>
    {error && <span className="feishu-user-error" role="alert">{error}</span>}
    {!error && !searching && candidates.length === 0 && <span className="feishu-user-hint">没有搜索到匹配的飞书账号。可换一个关键字（例如英文名）再试。</span>}
    {candidates.length > 0 && <div className="feishu-user-results" role="listbox" aria-label="飞书账号候选">
      {candidates.map((candidate) => <button key={candidate.openId} type="button" role="option" aria-selected={selectedId === candidate.openId} className="feishu-user-option" onClick={() => setSelectedId(candidate.openId)}>
        <span>{candidate.name}{candidate.enName ? <small>{candidate.enName}</small> : null}</span>
        <code>{shortFeishuId(candidate.openId)}</code>
      </button>)}
    </div>}
    <div className="feishu-account-actions">
      <HeroButton className="button button-primary button-small" onPress={() => void save()} isDisabled={disabled || saving || !selected}>{saving ? "保存中…" : "保存绑定"}</HeroButton>
      <HeroButton className="button button-secondary button-small" onPress={onCancel} isDisabled={saving}>取消</HeroButton>
    </div>
    <span className="feishu-user-hint">绑定后该人员会出现在需求详情的负责人下拉中；没有 TB 用户 ID 的需求会按姓名唯一匹配到此人。</span>
  </div>;
}

export function PeoplePanel() {
  const [people, setPeople] = useState<TeamPerson[]>([]);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [bindingName, setBindingName] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setPeople(await listTeamPeople()); setLoadError(null); }
    catch (cause) { setLoadError(errorText(cause)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const submit = async (action: () => Promise<{ items: TeamPerson[] }>, success: string) => {
    setBusy(true); setLoadError(null); setNotice(null);
    try { const result = await action(); setPeople(result.items); setNotice(success); setDraft(""); setEditing(null); setBindingName(null); }
    catch (cause) { setLoadError(errorText(cause)); }
    finally { setBusy(false); }
  };

  const bindFeishu = async (name: string, selection: FeishuUserSelection) => {
    const result = await bindTeamPersonFeishu(name, selection);
    setPeople(result.items);
    setBindingName(null);
    setNotice(`已绑定「${name}」的飞书账号。`);
  };
  const unbindFeishu = async (name: string) => {
    setBusy(true); setLoadError(null); setNotice(null);
    try {
      const result = await unbindTeamPersonFeishu(name);
      setPeople(result.items);
      setNotice(`已解除「${name}」的飞书账号绑定。`);
    } catch (cause) { setLoadError(errorText(cause)); }
    finally { setBusy(false); }
  };

  return <section className="panel requirements-panel">
    <div className="panel-heading"><div><h2>组内人员</h2><p>用于按 TB 负责人筛选需求、维护功能模块责任人；绑定飞书账号后，该人员才会出现在需求的负责人下拉中。</p></div><HeroButton className="button button-secondary button-small" onPress={() => void load()} isDisabled={busy}><RefreshCw size={14} />刷新</HeroButton></div>
    <StateBanner loadError={loadError} notice={notice} onCloseNotice={() => setNotice(null)} />
    <div className="rules-form" style={{ alignItems: "flex-end" }}><label className="field" style={{ flex: 1 }}><span>人员姓名</span><HeroInput aria-label="新增人员姓名" value={draft} onChange={(event) => setDraft(event.target.value)} /></label><HeroButton className="button button-primary button-small" onPress={() => void submit(() => addTeamPerson(draft), "人员已添加。")} isDisabled={busy || !draft.trim()}>新增人员</HeroButton></div>
    {people.length ? <div className="table-scroll"><table><thead><tr><th>人员</th><th>飞书账号</th><th>操作</th></tr></thead><tbody>{people.map((person) => <tr key={person.name}>
      <td>{editing === person.name ? <HeroInput aria-label="编辑人员姓名" value={editDraft} onChange={(event) => setEditDraft(event.target.value)} /> : person.name}</td>
      <td>{bindingName === person.name
        ? <FeishuAccountBinder personName={person.name} disabled={busy} onSave={(selection) => bindFeishu(person.name, selection)} onCancel={() => setBindingName(null)} />
        : <div className="person-binding">
            {person.feishuUserId
              ? <><span className="status-chip status-live"><span />已绑定</span><code className="mono-cell" title={person.feishuUserId}>{shortFeishuId(person.feishuUserId)}</code></>
              : person.bindingConflict
                ? <span className="status-chip status-danger"><span />同名多账号</span>
                : <span className="subtle-text">未绑定</span>}
            {person.bindingConflict
              ? <span className="feishu-user-hint">同一姓名对应多个飞书账号，请先在「团队管理 → 负责人映射」核对，或解除绑定后重新绑定。</span>
              : <HeroButton className="button button-secondary button-small" onPress={() => { setBindingName(person.name); setEditing(null); }} isDisabled={busy || editing === person.name}>{person.feishuUserId ? "重新绑定" : "绑定飞书账号"}</HeroButton>}
          </div>}</td>
      <td>{editing === person.name
        ? <><HeroButton className="button button-primary button-small" onPress={() => void submit(() => renameTeamPerson(person.name, editDraft), "人员及模块责任关系已更新。")} isDisabled={busy || !editDraft.trim()}>保存</HeroButton> <HeroButton className="button button-secondary button-small" onPress={() => setEditing(null)} isDisabled={busy}>取消</HeroButton></>
        : <><HeroButton className="button button-secondary button-small" onPress={() => { setEditing(person.name); setEditDraft(person.name); setBindingName(null); }} isDisabled={busy}>编辑</HeroButton>{" "}
            {(person.feishuUserId || person.bindingConflict) && <DeleteConfirmation disabled={busy} triggerLabel="解除绑定" heading="解除飞书绑定" confirmLabel="确认解除" description={`解除「${person.name}」的飞书账号绑定？该人员名下需求的负责人映射将被清除，后续推送会停在待匹配负责人；已推送的 Base 记录不会被清除。`} onConfirm={() => void unbindFeishu(person.name)} />}{" "}
            <DeleteConfirmation disabled={busy} description={`删除人员“${person.name}”？相关功能模块将变为未分配，飞书账号绑定同时解除。`} onConfirm={() => void submit(() => deleteTeamPerson(person.name), "人员已删除，相关模块已解除分配。")} /></>}
      </td>
    </tr>)}</tbody></table></div> : <div className="table-empty"><strong>{loadError ? "人员读取失败" : "暂无人员"}</strong><span>{loadError ? "检查 API 连接后刷新。" : "填写姓名并新增；数据源配置完成后可维护组内名单并绑定飞书账号。"}</span></div>}
  </section>;
}

export function ModulesPanel() {
  const [version, setVersion] = useState(0);
  const [items, setItems] = useState<FunctionModuleEntry[]>([]);
  const [name, setName] = useState("");
  const [personName, setPersonName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [people, setPeople] = useState<TeamPerson[]>([]);
  const [versions, setVersions] = useState<DictionaryVersion[]>([]);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 模块列表很长，编辑表单在页面顶部；点「编辑」后必须把表单带到视野里，否则看起来像没反应。
  const formRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  // 编辑用独立状态，避免改一条模块时顶部的「新增」表单跟着一起变。
  const [editName, setEditName] = useState("");
  const [editPerson, setEditPerson] = useState("");
  const beginEdit = (item: FunctionModuleEntry) => {
    setEditing(item.name); setEditName(item.name); setEditPerson(item.personName ?? "");
  };

  // 词典版本历史属于模块维护本身：不再要求用户去“规则”页找同一份数据。
  const loadVersions = useCallback(async () => {
    try { setVersions(await listDictionaryVersions()); setVersionsError(null); }
    catch (cause) { setVersions([]); setVersionsError(errorText(cause)); }
  }, []);

  const load = useCallback(async () => {
    try {
      const [directory, roster] = await Promise.all([getFunctionModules(), listTeamPeople()]);
      setVersion(directory.version); setItems(directory.items); setPeople(roster); setLoadError(null);
    } catch (cause) { setLoadError(errorText(cause)); }
    await loadVersions();
  }, [loadVersions]);
  useEffect(() => { void load(); }, [load]);

  const save = async (next: FunctionModuleEntry[]) => {
    setBusy(true); setLoadError(null); setNotice(null);
    try {
      const result = await saveFunctionModules(version, next);
      setVersion(result.version); setItems(result.items); setEditing(null); setEditName(""); setEditPerson("");
      setNotice(`已发布模块字典 v${result.version}，后续 AI 分析将使用新版本。`);
      await loadVersions();
    } catch (cause) {
      setLoadError(errorText(cause));
      if (cause instanceof ApiError && cause.status === 409) void load();
    } finally { setBusy(false); }
  };
  const submitEdit = () => {
    const clean = editName.trim();
    if (!clean) { setLoadError("请填写功能模块名称。"); return; }
    if (items.some((candidate) => candidate.name.toLocaleLowerCase() === clean.toLocaleLowerCase() && candidate.name !== editing)) { setLoadError("功能模块名称不能重复。"); return; }
    void save(items.map((candidate) => candidate.name === editing ? { name: clean, personName: editPerson || null } : candidate));
  };
  const submit = () => {
    const clean = name.trim();
    if (!clean) { setLoadError("请填写功能模块名称。"); return; }
    const duplicate = items.some((item) => item.name.toLocaleLowerCase() === clean.toLocaleLowerCase() && item.name !== editing);
    if (duplicate) { setLoadError("功能模块名称不能重复。"); return; }
    const next = editing ? items.map((item) => item.name === editing ? { name: clean, personName: personName || null } : item) : [...items, { name: clean, personName: personName || null }];
    void save(next);
  };

  return <section className="panel requirements-panel">
    <div className="panel-heading"><div><h2>功能模块</h2><p>AI 仅从已发布的模块名称中选择；无法匹配时输出“无法识别”。每次保存生成一个新字典版本，且至少保留一个模块。</p></div><HeroButton className="button button-secondary button-small" onPress={() => void load()} isDisabled={busy}><RefreshCw size={14} />刷新</HeroButton></div>
    <StateBanner loadError={loadError} notice={notice} onCloseNotice={() => setNotice(null)} />
    <div className="rules-form" style={{ alignItems: "flex-end", flexWrap: "wrap" }}><label className="field" style={{ flex: 1 }}><span>功能模块</span><HeroInput aria-label="功能模块名称" value={name} onChange={(event) => setName(event.target.value)} /></label><label className="field"><span>人员</span><select aria-label="模块责任人员" value={personName} onChange={(event) => setPersonName(event.target.value)}><option value="">未分配</option>{people.map((person) => <option key={person.name} value={person.name}>{person.name}</option>)}</select></label><HeroButton className="button button-primary button-small" onPress={submit} isDisabled={busy}>新增模块</HeroButton></div>
    {items.length ? <div className="table-scroll"><table><thead><tr><th>功能模块</th><th>人员</th><th>操作</th></tr></thead><tbody>{items.map((item) => editing === item.name
      ? <tr key={item.name} className="module-row is-editing">
          <td><input className="inline-input" aria-label="编辑功能模块名称" value={editName} onChange={(event) => setEditName(event.target.value)} autoFocus /></td>
          <td><select className="inline-input" aria-label="编辑模块责任人员" value={editPerson} onChange={(event) => setEditPerson(event.target.value)}><option value="">未分配</option>{people.map((person) => <option key={person.name} value={person.name}>{person.name}</option>)}</select></td>
          <td><HeroButton className="button button-primary button-small" onPress={submitEdit} isDisabled={busy}>保存</HeroButton> <HeroButton className="button button-secondary button-small" onPress={() => { setEditing(null); setEditName(""); setEditPerson(""); }} isDisabled={busy}>取消</HeroButton></td>
        </tr>
      : <tr key={item.name} className="module-row">
          <td>{item.name}</td>
          <td>{item.personName ?? "未分配"}</td>
          <td><HeroButton className="button button-secondary button-small" onPress={() => beginEdit(item)} isDisabled={busy}>编辑</HeroButton> <DeleteConfirmation disabled={busy || items.length === 1} description={`删除功能模块“${item.name}”？`} onConfirm={() => void save(items.filter((candidate) => candidate.name !== item.name))} /></td>
        </tr>)}</tbody></table></div> : <div className="table-empty"><strong>{loadError ? "模块字典读取失败" : "暂无功能模块"}</strong><span>{loadError ? "检查 API 连接后刷新。" : "新增模块后，AI 分析会使用最新的已发布字典。"}</span></div>}
    <div className="subsection">
      <div className="panel-heading"><div><h3>词典版本历史</h3><p>每次保存生成一个新版本；仅最新发布版供 AI 分析使用。</p></div></div>
      {versionsError ? <div className="table-empty"><strong>版本历史读取失败</strong><span>{versionsError}</span></div> : versions.length ? <div className="table-scroll"><table><thead><tr><th>版本</th><th>状态</th><th>模块</th><th>创建时间</th><th>发布时间</th></tr></thead><tbody>{versions.map((d) => <tr key={d.version}><td className="mono-cell">v{d.version}</td><td><PublishStatusChip status={d.status} /></td><td>{d.entries.map((entry) => typeof entry === "string" ? entry : `${entry.name}（${entry.personName ?? "未分配"}）`).join("、")}</td><td>{timeLabel(d.createdAt)}</td><td>{d.publishedAt ? timeLabel(d.publishedAt) : "—"}</td></tr>)}</tbody></table></div> : <div className="table-empty"><strong>还没有词典版本</strong><span>保存一次模块字典后会生成首个已发布版本。</span></div>}
    </div>
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
      <label className="field"><span>开始时间</span><HeroInput type="datetime-local" aria-label="批次开始时间" value={since} onChange={(e) => setSince(e.target.value)} /></label>
      <label className="field"><span>结束时间</span><HeroInput type="datetime-local" aria-label="批次结束时间" value={until} onChange={(e) => setUntil(e.target.value)} /></label>
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

// ---------- 工单 17 / design.md 第 8–10 章：需求池列表 + 独立详情页 ----------

const ownerStateOptions = [["", "全部负责人状态"], ["pending_mapping", "待匹配"], ["auto_mapped", "已匹配"], ["manually_mapped", "手动匹配"], ["not_required", "无需匹配"]] as const;
const analysisStateOptions = [["", "全部分析状态"], ["analyzed", "已分析"], ["failed_retryable", "待重试"], ["pending", "等待中"], ["running", "进行中"]] as const;
const pullStateOptions = [["", "全部同步状态"], ["pending", "等待同步"], ["running", "同步中"], ["synced", "已同步"], ["failed", "同步失败"]] as const;
const pushStateOptions = [["", "全部推送状态"], ["pending", "等待推送"], ["running", "推送中"], ["pushed", "已推送"], ["failed", "推送失败"]] as const;

// 详情/列表徽标按阶段取值：同一个原始枚举（pending/running/failed）在不同阶段含义不同，
// 因此不能用一张全局表；原始值保留在 title 上，便于排查。
type PipelineStage = "pull" | "analysis" | "owner" | "push";

const pipelineLabels: Record<PipelineStage, Record<string, string>> = {
  pull: { synced: "已同步", pending: "待同步", running: "同步中", failed: "同步失败" },
  analysis: { analyzed: "已分析", running: "分析中", failed_retryable: "可重试", failed: "分析失败", pending: "待分析" },
  owner: { manually_mapped: "已手动匹配", auto_mapped: "已自动匹配", pending_mapping: "待匹配负责人", not_required: "无需负责人" },
  push: { pushed: "已推送", pending: "待推送", running: "推送中", failed: "推送失败" },
};

const pipelineStageNames: Record<PipelineStage, string> = { pull: "同步", analysis: "AI 分析", owner: "负责人", push: "推送" };

interface AnalysisRecommendation {
  recommendation?: unknown;
  rationale?: unknown;
  evidence?: unknown;
  missing_evidence?: unknown;
}

interface AnalysisStructured {
  module?: unknown; priority?: unknown; confidence?: unknown; confidence_reason?: unknown;
  evidence?: unknown; facts?: unknown; inferences?: unknown; missing_inputs?: unknown; blind_spots?: unknown;
  recommendations?: Partial<Record<"user" | "market" | "business" | "technology", AnalysisRecommendation>>;
}

function analysisText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function analysisStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "") : [];
}

function pipelineLabel(stage: PipelineStage, state: string): string {
  return pipelineLabels[stage][state] ?? stateLabel(state);
}

function pipelineChipColor(state: string): "success" | "warning" | "danger" | "default" | "accent" {
  if (state === "failed") return "danger";
  if (state === "failed_retryable" || state === "pending_mapping") return "warning";
  if (state === "running") return "accent";
  if (["synced", "analyzed", "pushed", "manually_mapped", "auto_mapped", "not_required"].includes(state)) return "success";
  return "default";
}

// 中文文案 + 语义色；原始枚举留在 title 上，符合 design.md 10.3。
function StageBadge({ stage, state }: { stage: PipelineStage; state: string }) {
  return <HeroChip
    className="req-badge"
    color={pipelineChipColor(state)}
    variant="soft"
    size="sm"
    title={`${pipelineStageNames[stage]}：${pipelineLabel(stage, state)}（${state}）`}
  >{pipelineLabel(stage, state)}</HeroChip>;
}

function TbFieldLabel({ children }: { children: ReactNode }) {
  return <span className="req-field-label"><span className="tb-badge" title="来自 Teambition 的原始字段">TB</span>{children}</span>;
}

function OwnerBadge({ owner }: { owner: ReturnType<typeof requirementOwnerView> }) {
  return <span className={`req-owner${owner.unassigned ? " is-unassigned" : ""}${owner.notRequired ? " is-not-required" : ""}`} title={owner.title}>
    <span className="req-avatar" aria-hidden="true">{owner.initial}</span>
    <span>{owner.label}</span>
  </span>;
}

function SourceValue({ value, href, emptyHint = "Teambition 未提供该字段" }: { value: string | null; href?: boolean; emptyHint?: string }) {
  if (!value) return <span className="req-empty-value" title={emptyHint}>—</span>;
  if (href) return <a className="req-source-link" href={value} target="_blank" rel="noreferrer">{value}</a>;
  return <span>{value}</span>;
}

function TextList({ items, prefix }: { items: string[]; prefix?: string }) {
  if (!items.length) return <span className="req-empty-value">—</span>;
  return <ul className="req-evidence-list">{items.map((item, index) => <li key={`${index}-${item}`}>{prefix ?? ""}{item}</li>)}</ul>;
}

function requirementListQuery(filter: RequirementListFilters) {
  const toIso = (value: string): string | undefined => {
    if (!value) return undefined;
    const time = new Date(value);
    return Number.isNaN(time.getTime()) ? undefined : time.toISOString();
  };
  return {
    q: filter.title || undefined,
    executorName: filter.owner || undefined,
    pullState: filter.pull || undefined,
    analysisState: filter.analysis || undefined,
    ownerState: filter.ownerState || undefined,
    pushState: filter.push || undefined,
    batchId: filter.batchId || undefined,
    since: toIso(filter.from),
    until: toIso(filter.to),
  };
}

export function RequirementsPanel({ onRefresh, initialRequirementId }: { onRefresh: () => void; initialRequirementId?: string | null }) {
  const [initialFilters] = useState(() => readRequirementListFilters(window.location.search));
  const [initialDetailId] = useState(() => readRequirementDeepLink(window.location.search) ?? initialRequirementId?.trim() ?? null);
  const [rows, setRows] = useState<RequirementSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [query, setQuery] = useState(initialFilters.title);
  const [executorName, setExecutorName] = useState(initialFilters.owner);
  const [people, setPeople] = useState<TeamPerson[]>([]);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const [ownerState, setOwnerState] = useState(initialFilters.ownerState);
  const [analysisState, setAnalysisState] = useState(initialFilters.analysis);
  const [pullState, setPullState] = useState(initialFilters.pull);
  const [pushState, setPushState] = useState(initialFilters.push);
  const [batchId, setBatchId] = useState(initialFilters.batchId);
  const [since, setSince] = useState(initialFilters.from);
  const [until, setUntil] = useState(initialFilters.to);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(initialDetailId);
  const [selected, setSelected] = useState<RequirementDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(Boolean(initialDetailId));
  const detailRequestVersion = useRef(0);
  // 列表滚动位置：进入详情时记下，返回列表后恢复（design.md 8.1）。
  const listScrollTop = useRef(0);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [autoOpenOwnerPicker, setAutoOpenOwnerPicker] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const filters: RequirementListFilters = { title: query.trim(), owner: executorName, pull: pullState, analysis: analysisState, ownerState, push: pushState, batchId: batchId.trim(), from: since, to: until };
  // 已生效筛选：列表行/详情 URL 与刷新必须以「点过筛选」的条件为准，
  // 不能把用户尚未应用的草稿输入写进 URL。
  const appliedFiltersRef = useRef(initialFilters);
  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  // 已生效 = 上一次真正发给服务端的条件；草稿输入不算，否则还没点筛选就显示"已生效"。
  // 已生效 = 上一次真正发给服务端的条件；草稿输入不算，否则还没点筛选就显示"已生效"。
  const [appliedFilterCount, setAppliedFilterCount] = useState(0);
  const dateFilterCount = [since, until].filter(Boolean).length;

  const load = useCallback(async (filter: RequirementListFilters, nextCursor: string | null) => {
    appliedFiltersRef.current = filter;
    setLoadState("loading"); setLoadError(null);
    try {
      const page = await listRequirements({ ...requirementListQuery(filter), limit: 25, ...(nextCursor ? { cursor: nextCursor } : {}) });
      setRows((prev) => nextCursor ? [...prev, ...page.items] : page.items);
      setCursor(page.nextCursor);
      setLoadState("ready");
    } catch (cause) { setLoadError(errorText(cause)); setLoadState("error"); }
  }, []);

  useEffect(() => {
    void load(initialFilters, null);
    void listTeamPeople().then(setPeople).catch((cause: unknown) => setPeopleError(errorText(cause)));
  }, [load, initialFilters]);

  const open = useCallback(async (id: string, options?: { push?: boolean; openOwnerPicker?: boolean }) => {
    if (options?.push) {
      listScrollTop.current = window.scrollY || document.documentElement.scrollTop || 0;
      window.history.pushState(null, "", requirementPoolUrl(window.location.pathname || "/", appliedFiltersRef.current, id, window.location.hash));
    }
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    setDetailId(id); setSelected(null); setDetailLoading(true); setDetailError(null); setNotice(null);
    setAutoOpenOwnerPicker(Boolean(options?.openOwnerPicker));
    const version = ++detailRequestVersion.current;
    try {
      const detail = await getRequirement(id);
      if (version === detailRequestVersion.current) {
        setSelected(detail);
        // 用最新详情同步当前列表行，操作后返回列表无需重新加载、也不会丢分页。
        setRows((prev) => prev.map((row) => row.id === detail.id ? {
          ...row,
          title: detail.title,
          pipeline: detail.pipeline,
          ...(detail.source === undefined ? {} : { source: detail.source }),
          ...(detail.ownerName === undefined ? {} : { ownerName: detail.ownerName }),
          ...(detail.updatedAt === undefined ? {} : { updatedAt: detail.updatedAt }),
        } : row));
        setDetailLoading(false);
      }
    } catch (cause) {
      if (version === detailRequestVersion.current) { setDetailError(errorText(cause)); setDetailLoading(false); }
    }
  }, []);

  // 通知深链/分享链接：URL 的 requirement 是唯一入口；只在首次挂载时自动打开。
  const deepLinkOpened = useRef(false);
  useEffect(() => {
    if (!initialDetailId || deepLinkOpened.current) return;
    deepLinkOpened.current = true;
    void open(initialDetailId);
  }, [initialDetailId, open]);

  // 返回列表时恢复进入详情前的滚动位置；详情页本身从顶部开始阅读。
  useEffect(() => {
    if (detailId !== null || listScrollTop.current === 0) return;
    const top = listScrollTop.current;
    listScrollTop.current = 0;
    document.documentElement.scrollTop = top;
    document.body.scrollTop = top;
  }, [detailId]);

  // 浏览器前进/后退：详情页跟着 URL 走，列表状态留在组件 state 里。
  useEffect(() => {
    const onPopState = () => {
      const next = readRequirementDeepLink(window.location.search);
      if (next) { void open(next); return; }
      detailRequestVersion.current += 1;
      setDetailId(null); setSelected(null); setDetailError(null); setDetailLoading(false); setAutoOpenOwnerPicker(false);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [open]);

  const runAction = async (action: () => Promise<string>, detailKey: string): Promise<boolean> => {
    setBusy(true); setNotice(null);
    try {
      const message = await action();
      onRefresh();
      await open(detailKey);
      setNotice(message);
      return true;
    } catch (cause) { setNotice(errorText(cause)); return false; }
    finally { setBusy(false); }
  };

  // 返回列表：用 replaceState 立刻把 URL 恢复为「筛选 + 无 requirement」，
  // 刷新/分享列表地址都不会再落回详情；已加载的 rows/cursor 仍在 state 中。
  const closeDetail = () => {
    detailRequestVersion.current += 1;
    setDetailId(null); setSelected(null); setDetailError(null); setDetailLoading(false); setAutoOpenOwnerPicker(false);
    window.history.replaceState(null, "", requirementPoolUrl(window.location.pathname || "/", appliedFiltersRef.current, null, window.location.hash));
  };

  const applyFilters = () => {
    setAppliedFilterCount(activeFilterCount);
    window.history.replaceState(null, "", requirementPoolUrl(window.location.pathname || "/", filters, null, window.location.hash));
    void load(filters, null);
  };

  // 清除筛选后立即回到无筛选的第一页，避免残留旧条件与旧游标。
  const clearFilters = () => {
    setAppliedFilterCount(0);
    const cleared = { ...emptyRequirementListFilters };
    setQuery(""); setExecutorName(""); setPullState(""); setOwnerState(""); setAnalysisState(""); setPushState(""); setBatchId(""); setSince(""); setUntil("");
    window.history.replaceState(null, "", requirementPoolUrl(window.location.pathname || "/", cleared, null, window.location.hash));
    void load(cleared, null);
  };

  const refresh = () => {
    onRefresh();
    void load(appliedFiltersRef.current, null);
    if (detailId) void open(detailId);
  };

  const sortedRows = sortRequirementsForAttention(rows);

  if (detailId) {
    return <section className="panel requirements-panel">
      <RequirementDetailPage
        detail={selected}
        detailId={detailId}
        loading={detailLoading}
        error={detailError}
        notice={notice}
        busy={busy}
        autoOpenOwnerPicker={autoOpenOwnerPicker}
        onCloseNotice={() => setNotice(null)}
        onBack={closeDetail}
        onRefresh={refresh}
        onAct={runAction}
      />
    </section>;
  }

  return <section className="panel requirements-panel">
    
    
    <div className="qtoolbar">
      <div className="qtoolbar-main">
        <label className="qfield qfield-search">
          <span className="sr-only">需求标题</span>
          <input aria-label="搜索需求标题" placeholder="搜索需求标题或批次 ID…" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(event) => { if (event.key === "Enter") applyFilters(); }} />
        </label>
        <label className="qfield">
          <span className="sr-only">负责人</span>
          <select aria-label="TB负责人筛选" value={executorName} onChange={(e) => setExecutorName(e.target.value)}><option value="">全部 TB 负责人</option>{people.map((person) => <option key={person.name} value={person.name}>{person.name}</option>)}</select>
        </label>
        <label className="qfield">
          <span className="sr-only">同步状态</span>
          <select aria-label="同步状态筛选" value={pullState} onChange={(e) => setPullState(e.target.value)}>{pullStateOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        </label>
        <details className="qmore">
          <summary>更多筛选{activeFilterCount - (query.trim() ? 1 : 0) - (executorName ? 1 : 0) - (pullState ? 1 : 0) > 0 ? `（${activeFilterCount - (query.trim() ? 1 : 0) - (executorName ? 1 : 0) - (pullState ? 1 : 0)}）` : ""}</summary>
          <div className="qmore-body">
            <label className="qfield">
              <span className="sr-only">负责人状态</span>
              <select aria-label="负责人筛选" value={ownerState} onChange={(e) => setOwnerState(e.target.value)}>{ownerStateOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            </label>
            <label className="qfield">
              <span className="sr-only">分析状态</span>
              <select aria-label="分析状态筛选" value={analysisState} onChange={(e) => setAnalysisState(e.target.value)}>{analysisStateOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            </label>
            <label className="qfield">
              <span className="sr-only">推送状态</span>
              <select aria-label="推送状态筛选" value={pushState} onChange={(e) => setPushState(e.target.value)}>{pushStateOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            </label>
            <label className="qfield">
              <span className="sr-only">批次 ID</span>
              <input aria-label="批次 ID 筛选" placeholder="批次 ID" value={batchId} onChange={(e) => setBatchId(e.target.value)} />
            </label>
            <label className="qfield">
              <span className="sr-only">最近同步始于</span>
              <input type="datetime-local" aria-label="最近同步开始时间" value={since} onChange={(e) => setSince(e.target.value)} />
            </label>
            <label className="qfield">
              <span className="sr-only">最近同步止于</span>
              <input type="datetime-local" aria-label="最近同步结束时间" value={until} onChange={(e) => setUntil(e.target.value)} />
            </label>
          </div>
        </details>
      </div>
      <div className="toolbar-actions">
        {appliedFilterCount > 0 && <span className="toolbar-active-count" role="status">{appliedFilterCount} 个筛选已生效</span>}
        {activeFilterCount > 0 && <button className="link-button" onClick={clearFilters}>清除筛选</button>}
        <button className="button button-secondary button-small" onClick={refresh}><RefreshCw size={14} />刷新</button>
        <button className="button button-primary button-small" onClick={applyFilters}>筛选</button>
      </div>
    </div>
    <p className="status-hint">
      <strong>三个状态分别是什么意思：</strong>
      <span><em>同步状态</em> — 是否已从 Teambition 拉到最新原文（已同步/待同步/同步失败）</span>
      <span><em>AI 分析状态</em> — 是否已生成模块与优先级建议（已分析/待分析/可重试/失败）</span>
      <span><em>推送状态</em> — 是否已写入飞书多维表格（已推送/待推送/推送失败）。三者互不影响，分析失败不会阻止推送。</span>
    </p>
    <StateBanner loadError={loadError ?? peopleError} notice={notice} onCloseNotice={() => setNotice(null)} />
    <div className="list-summary" role="status">
      <span className="list-summary-count">已加载 {sortedRows.length} 条{cursor ? "，还有更多" : ""}{activeFilterCount > 0 ? `（已应用 ${activeFilterCount} 个筛选）` : ""}</span>
      <span className="list-summary-sort">排序仅作用于已加载的记录：待分配 → 推送失败 → 待推送 → 已推送</span>
    </div>
    <RequirementsTable rows={sortedRows} loading={loadState === "loading"} onOpen={(row) => void open(row.id, { push: true })} onAssign={(row) => void open(row.id, { push: true, openOwnerPicker: true })} />
    {cursor && <div className="rules-form"><HeroButton className="button button-secondary button-small" onPress={() => void load(appliedFiltersRef.current, cursor)} isDisabled={loadState === "loading"}>加载更多</HeroButton></div>}
  </section>;
}

/**
 * Base 记录引用。工作台只拿得到 record ID，拿不到 Base app token（凭据不下发浏览器），
 * 因此提供可复制的引用，而不是伪造一个打不开的链接。
 */
function BaseRecordReference({ recordId }: { recordId: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!recordId) return <span className="base-ref-empty">尚未写入飞书 Base</span>;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(recordId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { setCopied(false); }
  };
  return <span className="base-ref">
    <code className="base-ref-id">{recordId}</code>
    <button className="link-button" onClick={() => void copy()}>{copied ? "已复制" : "复制记录 ID"}</button>
    <span className="base-ref-hint">PM 处理状态与通知送达请在飞书 Base 中查看；本工作台不读取这些字段。</span>
  </span>;
}

function RequirementDetailPage({ detail, detailId, loading, error, notice, busy, autoOpenOwnerPicker, onCloseNotice, onBack, onRefresh, onAct }: {
  detail: RequirementDetail | null;
  detailId: string;
  loading: boolean;
  error: string | null;
  notice: string | null;
  busy: boolean;
  autoOpenOwnerPicker: boolean;
  onCloseNotice: () => void;
  onBack: () => void;
  onRefresh: () => void;
  onAct: (action: () => Promise<string>, detailId: string) => Promise<boolean>;
}) {
  const [ownerPickerOpen, setOwnerPickerOpen] = useState(autoOpenOwnerPicker);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const ownerEditorId = useId();
  useEffect(() => { setOwnerPickerOpen(autoOpenOwnerPicker); }, [detail?.id, autoOpenOwnerPicker]);
  useEffect(() => { setDescriptionExpanded(false); }, [detail?.id]);

  if (!detail) {
    return <div className="req-detail-page">
      <header className="req-detail-summary">
        <div className="req-summary-top">
          <HeroButton className="button button-secondary button-small" onPress={onBack}><ArrowLeft size={14} />返回需求池</HeroButton>
          <div className="req-summary-copy">
            <h2 className="req-summary-title">{loading ? "正在载入需求详情…" : "无法载入需求详情"}</h2>
            <span className="req-summary-id">REQ {detailId.slice(0, 8)}</span>
          </div>
        </div>
      </header>
      <StateBanner loadError={error} notice={notice} onCloseNotice={onCloseNotice} />
      {!loading && <div className="rules-form"><HeroButton className="button button-secondary button-small" onPress={onRefresh}><RefreshCw size={14} />重试载入</HeroButton></div>}
    </div>;
  }

  const structured: AnalysisStructured = (detail.analysis ?? {}) as AnalysisStructured;
  const facts = requirementSourceFacts(detail);
  const owner = requirementOwnerView(detail);
  const evidence = analysisStrings(structured.evidence);
  const factItems = Array.isArray(structured.facts)
    ? (structured.facts as { text?: unknown }[]).map((fact) => analysisText(fact.text)).filter((text): text is string => text !== null)
    : [];
  const inferenceItems = Array.isArray(structured.inferences)
    ? (structured.inferences as { text?: unknown }[]).map((inference) => analysisText(inference.text)).filter((text): text is string => text !== null)
    : [];
  const missingInputs = analysisStrings(structured.missing_inputs);
  const blindSpots = analysisStrings(structured.blind_spots);
  const dimensionRecommendations = [
    ["U · 用户", structured.recommendations?.user],
    ["M · 市场", structured.recommendations?.market],
    ["S · 商业", structured.recommendations?.business],
    ["C · 技术", structured.recommendations?.technology],
  ] as const;
  interface AdviceCard { label: string; conclusion: string; rationale?: string | null; evidence?: string[]; missing?: boolean }
  const adviceCards: AdviceCard[] = [
    { label: "模块建议", conclusion: analysisText(structured.module) ?? "—" },
    { label: "优先级建议", conclusion: analysisText(structured.priority) ?? "空（未发布有效校准规则时保持为空）" },
    { label: "置信度", conclusion: analysisText(structured.confidence) ?? "—", rationale: analysisText(structured.confidence_reason) },
    ...dimensionRecommendations.map(([label, result]) => ({
      label,
      conclusion: analysisText(result?.recommendation) ?? "—",
      rationale: analysisText(result?.rationale),
      evidence: analysisStrings(result?.evidence),
      missing: result?.missing_evidence === true,
    })),
  ];

  // 操作可用性只取决于流水线状态；不可用时保留按钮并说明原因，避免「入口消失 = 不知道能做什么」。
  const analysisRetryable = ["failed_retryable", "pending"].includes(detail.pipeline.analysis);
  const pushRetryable = detail.pipeline.push === "failed";
  const ownerMapped = ["auto_mapped", "manually_mapped"].includes(detail.pipeline.owner);
  const ownerSaveLabel = detail.pipeline.owner === "pending_mapping" ? "保存负责人并入队推送" : ownerMapped ? "变更负责人并入队推送" : "分配负责人并入队推送";
  const analysisDisabledReason = detail.pipeline.analysis === "running"
    ? "AI 分析正在进行中，完成后可查看结果。"
    : detail.pipeline.analysis === "analyzed"
      ? "AI 分析已完成，无需重试。"
      : detail.pipeline.analysis === "failed"
        ? "该需求的分析失败不可自动重试，请检查源数据或联系管理员。"
        : "当前状态不可重试 AI 分析。";
  const pushDisabledReason = detail.pipeline.push === "pushed"
    ? "Base 推送已完成，无需重试；PM 在飞书多维表格继续处理。"
    : detail.pipeline.push === "running"
      ? "Base 推送进行中，完成后状态会自动刷新。"
      : detail.pipeline.push === "pending"
        ? "Base 推送排队中，完成后状态会自动刷新。"
        : "当前状态不可重试 Base 推送。";
  // 没有可重试项时也要给出一句明确的下一步说明，而不是留白。
  const guidance = [
    detail.pipeline.push === "pushed" ? "该需求已推送完成，PM 在飞书多维表格继续处理；如需换人可在此变更负责人。" : "",
    pushRetryable ? (ownerMapped ? "Base 推送失败：可重试推送，也可变更负责人后重新排队。" : "Base 推送失败：请先分配负责人，再重试推送。") : "",
    analysisRetryable ? "AI 分析未完成，可在此重试分析。" : "",
    detail.pipeline.analysis === "failed" ? "AI 分析失败且不可自动重试；失败摘要见「查看依据与历史」中的分析版本记录。" : "",
  ].filter(Boolean).join(" ") || "当前没有待重试的失败项；如需换人可在此变更负责人。";

  const createdAt = formatDateTime(facts.createdAt);
  const updatedAt = formatDateTime(facts.updatedAt);
  const analysisVersions = [...detail.analyses].reverse();
  const failedAnalysis = analysisVersions.find((version) => version.safeErrorSummary !== null);
  const failureText = detail.pipeline.push === "failed"
    ? "Base 推送失败。可在详情页点「重试 Base 推送」；AI 分析失败是另一条独立链路，不影响推送。"
    : detail.pipeline.analysis === "failed" || detail.pipeline.analysis === "failed_retryable"
      ? failedAnalysis?.safeErrorSummary ?? "AI 分析失败（接口未返回失败摘要）。"
      : null;
  const pushTime = formatDateTime(detail.lastPushedAt ?? null);
  const stages: Array<[PipelineStage, string]> = [["pull", detail.pipeline.pull], ["analysis", detail.pipeline.analysis], ["owner", detail.pipeline.owner], ["push", detail.pipeline.push]];

  return <div className="req-detail-page">
    <header className="req-detail-summary">
      <div className="req-summary-top">
        <HeroButton className="button button-secondary button-small" onPress={onBack}><ArrowLeft size={14} />返回需求池</HeroButton>
        <div className="req-summary-copy">
          <h2 className="req-summary-title">{detail.title}</h2>
          <span className="req-summary-id">{detail.platformRequirementId ?? `REQ-${detail.sourceRequirementId.slice(0, 8)}`} · v{detail.sourceVersion}</span>
        </div>
      </div>
      <div className="req-summary-meta">
        <span className="req-owner-line"><span className="req-meta-label">负责人</span><OwnerBadge owner={owner} /></span>
        <div className="req-stage-row" role="group" aria-label="处理状态">{stages.map(([stage, state]) => <StageBadge key={stage} stage={stage} state={state} />)}</div>
        <div className="req-summary-actions" role="group" aria-label="需求操作">
          <HeroButton className="button button-primary button-small" aria-expanded={ownerPickerOpen} aria-controls={ownerEditorId} onPress={() => setOwnerPickerOpen((open) => !open)} isDisabled={busy}>分配 / 变更负责人</HeroButton>
          <button className="button button-secondary button-small" onClick={() => void onAct(async () => { await retryAnalysis(detail.id); return "AI 分析重试已入队"; }, detail.id)} disabled={busy || !analysisRetryable} title={analysisRetryable ? "重新提交 AI 分析" : analysisDisabledReason}>重试 AI 分析</button>
          <button className="button button-secondary button-small" onClick={() => void onAct(async () => { const result = await pushRequirement(detail.id); return result.status === "queued" ? "Base 推送重试已入队" : `推送状态：${result.status}`; }, detail.id)} disabled={busy || !pushRetryable} title={pushRetryable ? "重新提交 Base 推送" : pushDisabledReason}>重试 Base 推送</button>
          <HeroButton className="button button-secondary button-small" onPress={onRefresh} isDisabled={busy}><RefreshCw size={14} />刷新</HeroButton>
        </div>
      </div>
      <p className="detail-actionbar-hint">{guidance}</p>
      {ownerPickerOpen && <div className="detail-owner-editor" id={ownerEditorId}>
        <p className="detail-actionbar-hint">从人员名单中选择负责人；保存后会覆盖当前负责人并重新排队 Base 推送。</p>
        <FeishuUserPicker key={detail.id} disabled={busy} saveLabel={ownerSaveLabel} onMap={async (user) => {
          const ok = await onAct(async () => {
            const result = await setOwner(detail.id, { feishuUserId: user.feishuUserId, feishuIdType: user.feishuIdType, tbDisplayName: user.name });
            return `${user.name} 负责人已${ownerMapped ? "变更" : "分配"}（${pipelineLabel("owner", result.ownerState)}），推送已排队`;
          }, detail.id);
          if (ok) setOwnerPickerOpen(false);
        }} />
      </div>}
    </header>

    <StateBanner loadError={error} notice={notice} onCloseNotice={onCloseNotice} />

    <section className="req-section" aria-labelledby="req-l1-heading">
      <div className="req-section-head"><h3 id="req-l1-heading">需求信息</h3><span className="req-source-note">来自 Teambition</span></div>
      <div className="req-field">
        <TbFieldLabel>标题</TbFieldLabel>
        <p className="req-l1-title">{detail.title}</p>
      </div>
      <div className="req-field req-description-field">
        <TbFieldLabel>描述</TbFieldLabel>
        {facts.description ? <>
          <p className={`req-description${descriptionExpanded ? " is-expanded" : ""}`}>{facts.description}</p>
          {facts.description.length > 140 && <HeroButton className="link-button" onPress={() => setDescriptionExpanded((expanded) => !expanded)}>{descriptionExpanded ? "收起描述" : "展开全部"}</HeroButton>}
        </> : <span className="req-empty-value" title="Teambition 未提供该字段">—</span>}
      </div>
      <div className="req-l1-meta">
        {/* 负责人与四阶段状态已在顶部摘要栏常驻，这里不再重复，避免稀释重点。 */}
        <dl className="req-source-grid">
          <div><dt><TbFieldLabel>提出人</TbFieldLabel></dt><dd><SourceValue value={facts.proposerName} /></dd></div>
          <div><dt><TbFieldLabel>执行人</TbFieldLabel></dt><dd><SourceValue value={facts.executorName} /></dd></div>
          <div><dt><TbFieldLabel>状态</TbFieldLabel></dt><dd><SourceValue value={facts.tbStatus} emptyHint="Teambition 未提供该字段；工作台不推断状态名称" /></dd></div>
          <div><dt><TbFieldLabel>链接</TbFieldLabel></dt><dd><SourceValue value={facts.tbUrl} href emptyHint="Teambition 未提供该字段" /></dd></div>
          <div><dt><TbFieldLabel>创建时间</TbFieldLabel></dt><dd><SourceValue value={createdAt ?? facts.createdAt} emptyHint="Teambition 未提供该字段" /></dd></div>
          <div><dt><TbFieldLabel>更新时间</TbFieldLabel></dt><dd><SourceValue value={updatedAt ?? facts.updatedAt} emptyHint="Teambition 未提供该字段" /></dd></div>
        </dl>
      </div>
    </section>

    <section className="req-section" aria-labelledby="req-l2-heading">
      <div className="req-section-head"><h3 id="req-l2-heading">AI 分析与建议</h3><span className="req-source-note">AI 生成 · 可被推翻</span></div>
      {!detail.analysis
        ? <div className="req-empty-state">
          <strong>尚未分析</strong>
          <span>{detail.pipeline.analysis === "running" ? "AI 分析正在进行中；完成后刷新查看结果。" : "该需求还没有可用的 AI 分析结果。"}</span>
          <button className="button button-secondary button-small" onClick={() => void onAct(async () => { await retryAnalysis(detail.id); return "AI 分析重试已入队"; }, detail.id)} disabled={busy || !analysisRetryable} title={analysisRetryable ? "提交 AI 分析" : analysisDisabledReason}>触发 AI 分析</button>
        </div>
        : <div className="advice-grid">{adviceCards.map((card) => <HeroCard key={card.label} className="advice-card">
          <HeroCard.Content>
            <span className="advice-label">{card.label}</span>
            <strong className="advice-conclusion">{card.conclusion}</strong>
            {card.rationale && <p className="advice-rationale">理由：{card.rationale}</p>}
            {card.evidence && card.evidence.length > 0 && <p className="advice-evidence">证据：{card.evidence.join("；")}</p>}
            {card.missing && <span className="advice-missing">需要补充信息</span>}
          </HeroCard.Content>
        </HeroCard>)}</div>}
    </section>

    <section className="req-section" aria-labelledby="req-status-heading">
      <div className="req-section-head"><h3 id="req-status-heading">处理与推送</h3><span className="req-source-note">系统状态</span></div>
      <dl className="req-system-grid">
        <div><dt>四阶段状态</dt><dd><div className="req-stage-row">{stages.map(([stage, state]) => <StageBadge key={stage} stage={stage} state={state} />)}</div></dd></div>
        <div><dt>负责人映射方式</dt><dd>{pipelineLabel("owner", detail.pipeline.owner)}</dd></div>
        <div><dt>Base 记录</dt><dd><BaseRecordReference recordId={detail.baseRecordId} /></dd></div>
        <div><dt>推送时间</dt><dd>{pushTime ?? <span className="req-empty-value" title="接口未返回推送时间">—</span>}</dd></div>
        <div><dt>最近一次失败</dt><dd>{failureText ?? <span className="req-empty-value" title="没有最近失败记录">—</span>}</dd></div>
      </dl>
      <p className="detail-note">推送成功不代表飞书 PM 通知已送达；PM 处理状态与通知送达以飞书多维表格为准。</p>
    </section>

    <section className="req-section req-audit-section">
      <HeroAccordion className="req-audit">
        <HeroAccordion.Item id="requirement-audit">
          <HeroAccordion.Heading><HeroAccordion.Trigger className="req-audit-trigger">查看依据与历史<HeroAccordion.Indicator /></HeroAccordion.Trigger></HeroAccordion.Heading>
          <HeroAccordion.Panel><HeroAccordion.Body>
            <dl className="evidence-grid">
              <div className="evidence-card"><dt>原文证据</dt><dd><TextList items={evidence} /></dd></div>
              <div className="evidence-card"><dt>事实（来自源文本）</dt><dd><TextList items={factItems} /></dd></div>
              <div className="evidence-card"><dt>AI 推断（非事实）</dt><dd><TextList items={inferenceItems} prefix="【AI 推断】" /></dd></div>
              <div className="evidence-card"><dt>缺失信息</dt><dd><TextList items={missingInputs} /></dd></div>
              <div className="evidence-card"><dt>分析盲点</dt><dd><TextList items={blindSpots} /></dd></div>
              <div className="evidence-card"><dt>Base 记录号</dt><dd>{detail.baseRecordId ? <code className="base-ref-id">{detail.baseRecordId}</code> : <span className="req-empty-value">尚未写入飞书 Base</span>}</dd></div>
            </dl>
            <div className="req-source-snapshot">
              <span className="req-audit-label">源快照（只读 JSON）</span>
              <pre className="source-snapshot-pre">{JSON.stringify(detail.source ?? {}, null, 2)}</pre>
            </div>
            <h4 className="req-audit-title">分析版本历史</h4>
            {analysisVersions.length
              ? <div className="table-scroll"><table><thead><tr><th>分析版本</th><th>状态</th><th>模块</th><th>优先级</th><th>开始时间</th><th>失败摘要</th></tr></thead><tbody>{analysisVersions.map((version: AnalysisVersionSummary) => <tr key={version.analysisVersion}><td className="mono-cell">v{version.analysisVersion}</td><td><StageBadge stage="analysis" state={version.status} /></td><td>{version.moduleSuggestion ?? "—"}</td><td>{version.priority ?? "空"}</td><td>{timeLabel(version.startedAt)}</td><td>{version.safeErrorSummary ?? "—"}</td></tr>)}</tbody></table></div>
              : <p className="req-empty-value">尚无分析版本历史</p>}
          </HeroAccordion.Body></HeroAccordion.Panel>
        </HeroAccordion.Item>
      </HeroAccordion>
    </section>
  </div>;
}

function isRowActionTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("button, a, input, select, textarea"));
}

function RequirementsTable({ rows, loading, onOpen, onAssign }: { rows: RequirementSummary[]; loading: boolean; onOpen: (row: RequirementSummary) => void; onAssign: (row: RequirementSummary) => void }) {
  if (!rows.length) return <div className="table-empty"><strong>{loading ? "正在载入需求…" : "没有匹配的需求"}</strong><span>{loading ? "正在从本地 API 读取需求状态。" : "数据仅在 API 返回后显示，不使用演示数据。"}</span></div>;
  return <div className="table-scroll"><table className="req-list">
    <thead><tr><th>需求标题</th><th>负责人</th><th>处理状态</th><th>更新时间</th><th><span className="sr-only">操作</span></th></tr></thead>
    <tbody>{rows.map((row) => {
      const owner = requirementOwnerView(row);
      const time = requirementTime(row);
      const timeText = formatDateTime(time.value);
      return <tr
        key={row.id}
        className={`req-row${owner.unassigned ? " is-pending-owner" : ""}`}
        tabIndex={0}
        aria-label={`打开需求：${row.title}`}
        onClick={(event) => { if (!isRowActionTarget(event.target)) onOpen(row); }}
        onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && !isRowActionTarget(event.target)) { event.preventDefault(); onOpen(row); } }}
      >
        <td><span className="req-row-title" title={row.title}>{row.title}</span></td>
        <td>
          <button type="button" className="owner-cell-button" title={owner.unassigned ? "分配负责人" : "变更负责人"}
            onClick={(event) => { event.stopPropagation(); onAssign(row); }}>
            <OwnerBadge owner={owner} />
            <span className="owner-cell-edit">{owner.unassigned ? "分配" : "变更"}</span>
          </button>
        </td>
        <td><div className="req-row-stages">{[["pull", row.pipeline.pull], ["analysis", row.pipeline.analysis], ["owner", row.pipeline.owner], ["push", row.pipeline.push]].map(([stage, state]) => <StageBadge key={stage} stage={stage as PipelineStage} state={state} />)}</div></td>
        <td className="req-row-time" title={timeText ? (time.fallbackToCreated ? "接口未返回更新时间，显示 Teambition 创建时间" : time.value ?? undefined) : "接口未返回更新时间"}>{timeText ?? <span className="req-empty-value">—</span>}</td>
        <td className="req-row-action">{owner.unassigned && <HeroButton className="button button-secondary button-small" onPress={() => onAssign(row)}>分配</HeroButton>}</td>
      </tr>;
    })}</tbody>
  </table></div>;
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

  const submit = async (user: FeishuUserSelection) => {
    if (!targetId) return;
    setBusy(true); setNotice(null);
    try {
      const result = await setOwner(targetId, { feishuUserId: user.feishuUserId, feishuIdType: user.feishuIdType, tbDisplayName: user.name });
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
      <label className="field"><span>开始时间</span><HeroInput type="datetime-local" aria-label="开始时间" value={since} onChange={(e) => setSince(e.target.value)} /></label>
      <label className="field"><span>结束时间</span><HeroInput type="datetime-local" aria-label="结束时间" value={until} onChange={(e) => setUntil(e.target.value)} /></label>
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

// ---------- 菜单收敛：团队管理 / 同步记录（同一入口下的页签，不做重复菜单） ----------

function CompositeTabs({ label, tabs, active, onSelect }: { label: string; tabs: { id: string; label: string }[]; active: string; onSelect: (id: string) => void }) {
  return <div className="composite-tabs" role="tablist" aria-label={label}>
    {tabs.map((tab) => <button key={tab.id} type="button" role="tab" id={`${label}-${tab.id}`} aria-selected={active === tab.id} aria-controls={`${label}-${tab.id}-panel`} className={`composite-tab ${active === tab.id ? "is-active" : ""}`} onClick={() => onSelect(tab.id)}>{tab.label}</button>)}
  </div>;
}

export function TeamPanel({ initialTab, onRefresh }: { initialTab?: WorkbenchTab | null; onRefresh: () => void }) {
  const [tab, setTab] = useState<"people" | "mappings">(initialTab === "mappings" ? "mappings" : "people");
  useEffect(() => { if (initialTab === "people" || initialTab === "mappings") setTab(initialTab); }, [initialTab]);
  return <div className="composite-page">
    <CompositeTabs label="团队管理" tabs={[{ id: "people", label: "人员" }, { id: "mappings", label: "负责人映射" }]} active={tab} onSelect={(id) => setTab(id as "people" | "mappings")} />
    <div role="tabpanel" id={`团队管理-${tab}-panel`} aria-labelledby={`团队管理-${tab}`}>
      {tab === "people" ? <PeoplePanel /> : <MappingsPanel onRefresh={onRefresh} />}
    </div>
  </div>;
}

export function SyncRecordsPanel({ initialTab, onRefresh }: { initialTab?: WorkbenchTab | null; onRefresh: () => void }) {
  const [tab, setTab] = useState<"batches" | "audit">(initialTab === "audit" ? "audit" : "batches");
  useEffect(() => { if (initialTab === "batches" || initialTab === "audit") setTab(initialTab); }, [initialTab]);
  return <div className="composite-page">
    <CompositeTabs label="同步记录" tabs={[{ id: "batches", label: "同步批次" }, { id: "audit", label: "审计日志" }]} active={tab} onSelect={(id) => setTab(id as "batches" | "audit")} />
    <div role="tabpanel" id={`同步记录-${tab}-panel`} aria-labelledby={`同步记录-${tab}`}>
      {tab === "batches" ? <BatchesPanel onRefresh={onRefresh} /> : <AuditPanel />}
    </div>
  </div>;
}

export function GuidePanel() {
  const stages = [
    { name: "拉取", from: "Teambition", desc: "从 TB 项目拉取需求原文。只读，系统从不回写 TB。", who: "系统自动" },
    { name: "AI 分析", from: "应用", desc: "模型给出模块、优先级、置信度和 U/M/S/C 建议。结果独立版本化，可重试。", who: "系统自动" },
    { name: "负责人", from: "应用", desc: "把 TB 执行人映射到飞书用户。没映射的需求仍可推送，只是 Base 里负责人为空。", who: "系统自动 + 人工补" },
    { name: "推送", from: "飞书 Base", desc: "把 PM 字段和系统字段写进多维表格。同一诉求重复推送不会重复写。", who: "系统自动" },
    { name: "通知", from: "Base 自动化", desc: "Base 发现通知事件变化后，按规则发给负责人。", who: "Base 自动化" },
  ];
  const states = [
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
  const notices = [
    ["首次推送", "不发", "避免批量回填时刷屏"],
    ["分配或变更负责人", "发给新负责人", "负责人变更后由新负责人接手"],
    ["需求内容有实质变更", "发给当前负责人", "负责人为空时发给 PM Leader"],
    ["AI 分析失败后重试成功", "发给当前负责人", "同上"],
    ["改备注、改错别字", "不发", "不构成实质变更"],
  ];
  return <section className="panel requirements-panel guide-panel">
    <div className="panel-heading">
      <div><h2>使用指南</h2><p>这套系统的数据怎么流、状态怎么读、每天该做什么。</p></div>
    </div>

    <div className="guide-section">
      <h3>一、数据从哪里来，到哪里去</h3>
      <p className="guide-lead">Teambition 拥有需求原文，应用拥有处理状态，飞书多维表格拥有 PM 处理结果和通知。三者各管一段，互不覆盖。</p>
      <div className="guide-flow">
        <span className="guide-node guide-node-source">Teambition<small>需求原文 · 只读</small></span>
        <span className="guide-arrow">→</span>
        <span className="guide-node">应用数据库<small>处理状态 · 快照 · 映射</small></span>
        <span className="guide-arrow">→</span>
        <span className="guide-node">飞书多维表格<small>PM 字段 · 通知</small></span>
        <span className="guide-arrow">→</span>
        <span className="guide-node guide-node-target">飞书消息<small>发给负责人</small></span>
      </div>
      <p className="guide-note">系统只读 Teambition，从不回写。你在页面里改的是应用侧的负责人映射，不是 TB 数据。</p>
    </div>

    <div className="guide-section">
      <h3>二、五个阶段各自在做什么</h3>
      <div className="guide-table"><table>
        <thead><tr><th>阶段</th><th>数据归属</th><th>做什么</th><th>谁触发</th></tr></thead>
        <tbody>{stages.map((s) => <tr key={s.name}><td><strong>{s.name}</strong></td><td>{s.from}</td><td>{s.desc}</td><td>{s.who}</td></tr>)}</tbody>
      </table></div>
      <p className="guide-note">四个状态互相独立，各自推进：分析失败不影响推送，负责人空缺也不阻断推送。判断一条需求卡在哪，看它停在哪一列变红或变琥珀。</p>
    </div>

    <div className="guide-section">
      <h3>三、状态怎么读</h3>
      <div className="guide-state-list">{states.map((stage) => <div className="guide-state-card" key={stage.name}>
        <strong>{stage.name}</strong>
        <span className="guide-state-values">{stage.values}</span>
        <span><em>什么时候变：</em>{stage.when}</span>
        <span><em>卡住了怎么办：</em>{stage.stuck}</span>
      </div>)}</div>
      <p className="guide-note">页面上的状态一律显示中文；把鼠标停上去能看到原始值，便于排查。</p>
    </div>

    <div className="guide-section">
      <h3>四、每天该做什么</h3>
      <ol className="guide-steps">
        <li><strong>先看总览。</strong>四个指标告诉你今天有多少需求卡在哪个阶段。</li>
        <li><strong>再看需求池的「待分配」。</strong>这些是 TB 里有执行人但还没对应飞书账号的需求。在详情页点「分配负责人」即可，分配后会自动排队推送并通知对方。</li>
        <li><strong>然后看「推送失败」。</strong>多数是 Base 字段问题。详情页点「重试 Base 推送」；版本不一致时系统会先重新同步。</li>
        <li><strong>怀疑 AI 结论时</strong>，在详情页展开「查看依据与历史」，核对原文证据和推断过程。AI 推断会明确标注。</li>
      </ol>
      <p className="guide-note">每周一上午系统会自动同步一次（可在「数据源与计划」调整）。平时不需要手动触发。</p>
    </div>

    <div className="guide-section">
      <h3>五、什么时候会收到通知</h3>
      <div className="guide-table"><table>
        <thead><tr><th>事件</th><th>是否通知</th><th>为什么</th></tr></thead>
        <tbody>{notices.map(([event, yes, why]) => <tr key={event}>
          <td>{event}</td>
          <td><span className={`badge ${yes === "不发" ? "status-neutral" : "status-success"}`}>{yes}</span></td>
          <td>{why}</td>
        </tr>)}</tbody>
      </table></div>
      <p className="guide-note">同一事件重复推送不会重复通知：事件 ID 是确定性的，Base 只有看到变化才会发消息。</p>
    </div>

    <div className="guide-section">
      <h3>六、常见问题</h3>
      <dl className="guide-faq">
        <dt>需求改了但 Base 没变？</dt>
        <dd>推送是排队执行的，通常几十秒内完成。若长期不动，去需求池看它的推送状态和最近失败原因。</dd>
        <dt>负责人是空的怎么办？</dt>
        <dd>说明这个 TB 执行人还没对应飞书账号。在「团队管理 → 负责人映射」里补一条，或在需求详情页直接分配。空负责人的需求本身仍会推送到 Base，不阻塞。</dd>
        <dt>通知没收到？</dt>
        <dd>先确认这条需求是否发生过「分配负责人 / 内容实质变更 / AI 重试成功」之一——首次推送和改错别字都不会发。再确认 Base 里的「系统通知收件人」是否有值。</dd>
        <dt>AI 分析失败了怎么办？</dt>
        <dd>系统会自动重试最多 3 次；也可以在详情页手动点「重试 AI 分析」。分析失败不影响已推送的需求内容。</dd>
        <dt>页面上的「推送成功」等于消息已送达吗？</dt>
        <dd>不等于。推送成功只表示 Base 已写入；消息是否送达取决于 Base 自动化规则是否开启。可在多维表格里查看自动化运行记录。</dd>
      </dl>
    </div>
  </section>;
}
