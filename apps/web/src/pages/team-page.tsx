// 团队管理页面：组内人员 + 飞书账号绑定 + 负责人映射。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert as ArcoAlert, Badge as ArcoBadge, Button as ArcoButton, Card as ArcoCard, Divider as ArcoDivider, Empty as ArcoEmpty, Form as ArcoForm, Input as ArcoInput, Space as ArcoSpace, Table as ArcoTable, Tabs as ArcoTabs, Tag as ArcoTag, Tooltip as ArcoTooltip, Typography as ArcoTypography } from "@arco-design/web-react";
import { RefreshCw } from "lucide-react";
import { ApiError, addTeamPerson, bindTeamPersonFeishu, deleteTeamPerson, isAbortError, listMappings, listRequirements, listTeamPeople, renameTeamPerson, searchFeishuUsers, setOwner, unbindTeamPersonFeishu, type FeishuUserCandidate, type FeishuUserSelection, type PersonMapping, type RequirementSummary, type TeamPerson } from "../api";
import { CACHE_KEYS, invalidateQueryCache } from "../cache";
import { requirementDisplayId } from "../requirement-view";
import { SkeletonTableRows } from "../skeleton";
import type { WorkbenchTab } from "../workbench-routing";
import { AccessibleTabs, DeleteConfirmation, errorText, FeishuUserPicker, StateBanner, timeLabel, type LoadState } from "../panel-shared";

function shortFeishuId(id: string): string {
  return id.length <= 14 ? id : `${id.slice(0, 4)}…${id.slice(-6)}`;
}

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
  const searchRequestVersion = useRef(0);
  const searchControllerRef = useRef<AbortController | null>(null);

  const search = useCallback(async (text: string) => {
    const clean = text.trim();
    if (clean.length < 2) { setError("请输入至少 2 个字符再搜索。"); return; }
    const version = ++searchRequestVersion.current;
    searchControllerRef.current?.abort();
    const controller = new AbortController();
    searchControllerRef.current = controller;
    setSearching(true); setError(null);
    try {
      const items = await searchFeishuUsers(clean, undefined, controller.signal);
      if (version !== searchRequestVersion.current) return;
      setCandidates(items);
      setSelectedId(items[0]?.openId ?? "");
    } catch (cause) {
      if (version !== searchRequestVersion.current || isAbortError(cause)) return;
      setCandidates([]); setSelectedId("");
      setError(cause instanceof ApiError ? errorText(cause) : "无法搜索飞书通讯录，请稍后重试。");
    } finally {
      if (version === searchRequestVersion.current) setSearching(false);
    }
  }, []);

  useEffect(() => {
    void search(personName);
    return () => {
      searchRequestVersion.current += 1;
      searchControllerRef.current?.abort();
    };
  }, [personName, search]);

  const selected = candidates.find((candidate) => candidate.openId === selectedId) ?? null;
  const save = async () => {
    if (!selected) return;
    setSaving(true); setError(null);
    const feishuUserId = selected.userId ?? selected.openId;
    try { await onSave({ feishuUserId, feishuIdType: selected.userId ? "user_id" : "open_id", name: selected.name }); }
    catch (cause) { setError(cause instanceof ApiError ? errorText(cause) : "保存绑定失败，请重试。"); }
    finally { setSaving(false); }
  };

  return <div className="feishu-account-binder">
    <div className="feishu-user-search">
      <ArcoInput aria-label="搜索飞书账号" value={query} onChange={(value: string) => setQuery(value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(query); } }} />
      <ArcoButton htmlType="button" onClick={() => void search(query)} disabled={disabled || searching} type="secondary" size="small">{searching ? "搜索中…" : "搜索"}</ArcoButton>
    </div>
    {error && <ArcoAlert type="error" showIcon role="alert" content={error} />}
    {!error && !searching && candidates.length === 0 && <ArcoTypography.Text type="secondary" className="rq-caption">没有搜索到匹配的飞书账号。可换一个关键字（例如英文名）再试。</ArcoTypography.Text>}
    {candidates.length > 0 && <div className="feishu-user-results" role="listbox" aria-label="飞书账号候选">
      {candidates.map((candidate) => <ArcoButton type="text" key={candidate.openId} role="option" aria-selected={selectedId === candidate.openId} className="feishu-user-option" onClick={() => setSelectedId(candidate.openId)} htmlType="button">
        <span>{candidate.name}{candidate.enName ? <small>{candidate.enName}</small> : null}</span>
        <code>{shortFeishuId(candidate.openId)}</code>
      </ArcoButton>)}
    </div>}
    <ArcoSpace size={8} className="feishu-account-actions">
      <ArcoButton htmlType="button" onClick={() => void save()} disabled={disabled || saving || !selected} type="primary" size="small">{saving ? "保存中…" : "保存绑定"}</ArcoButton>
      <ArcoButton htmlType="button" onClick={onCancel} disabled={saving} type="secondary" size="small">取消</ArcoButton>
    </ArcoSpace>
    <ArcoTypography.Text type="secondary" className="rq-caption">绑定后该人员会出现在需求详情的负责人下拉中；没有 TB 用户 ID 的需求会按姓名唯一匹配到此人。</ArcoTypography.Text>
  </div>;
}

export function PeoplePanel() {
  const [people, setPeople] = useState<TeamPerson[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [bindingName, setBindingName] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loadRequestVersion = useRef(0);
  const loadControllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async (force = false) => {
    if (force) invalidateQueryCache(CACHE_KEYS.people);
    const version = ++loadRequestVersion.current;
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    setLoadState("loading");
    try {
      const rows = await listTeamPeople(undefined, force ? controller.signal : undefined);
      if (version !== loadRequestVersion.current) return;
      setPeople(rows); setLoadError(null); setLoadState("ready");
    } catch (cause) {
      if (version !== loadRequestVersion.current || isAbortError(cause)) return;
      setLoadError(errorText(cause)); setLoadState("error");
    }
  }, []);
  useEffect(() => {
    void load();
    return () => {
      loadRequestVersion.current += 1;
      loadControllerRef.current?.abort();
    };
  }, [load]);

  const submit = useCallback(async (action: () => Promise<{ items: TeamPerson[] }>, success: string) => {
    setBusy(true); setLoadError(null); setNotice(null);
    try { const result = await action(); setPeople(result.items); setNotice(success); setDraft(""); setEditing(null); setBindingName(null); }
    catch (cause) { setLoadError(errorText(cause)); }
    finally { setBusy(false); }
  }, []);

  const bindFeishu = useCallback(async (name: string, selection: FeishuUserSelection) => {
    const result = await bindTeamPersonFeishu(name, selection);
    setPeople(result.items);
    setBindingName(null);
    setNotice(`已绑定「${name}」的飞书账号。`);
  }, []);
  const unbindFeishu = useCallback(async (name: string) => {
    setBusy(true); setLoadError(null); setNotice(null);
    try {
      const result = await unbindTeamPersonFeishu(name);
      setPeople(result.items);
      setNotice(`已解除「${name}」的飞书账号绑定。`);
    } catch (cause) { setLoadError(errorText(cause)); }
    finally { setBusy(false); }
  }, []);

  const columns = useMemo(() => [
    { title: "人员", dataIndex: "name", width: 200, render: (_value: unknown, person: TeamPerson) => editing === person.name ? <ArcoInput aria-label="编辑人员姓名" value={editDraft} onChange={(value: string) => setEditDraft(value)} /> : person.name },
    { title: "飞书账号", dataIndex: "feishuUserId", render: (_value: unknown, person: TeamPerson) => bindingName === person.name
        ? <FeishuAccountBinder personName={person.name} disabled={busy} onSave={(selection) => bindFeishu(person.name, selection)} onCancel={() => setBindingName(null)} />
        : <div className="person-binding">
            {person.feishuUserId
              ? <><ArcoBadge status="success" text="已绑定" /><ArcoTooltip content={person.feishuUserId}><code className="mono-cell" title={person.feishuUserId}>{shortFeishuId(person.feishuUserId)}</code></ArcoTooltip></>
              : person.bindingConflict
                ? <ArcoTag size="small" color="red">同名多账号</ArcoTag>
                : <span className="subtle-text">未绑定</span>}
            {person.bindingConflict
              ? <ArcoTypography.Text type="secondary" className="rq-caption">同一姓名对应多个飞书账号，请先在「团队管理 → 负责人映射」核对，或解除绑定后重新绑定。</ArcoTypography.Text>
              : <ArcoButton htmlType="button" onClick={() => { setBindingName(person.name); setEditing(null); }} disabled={busy || editing === person.name} type="secondary" size="small">{person.feishuUserId ? "重新绑定" : "绑定飞书账号"}</ArcoButton>}
          </div> },
    { title: "操作", width: 280, render: (_value: unknown, person: TeamPerson) => editing === person.name
        ? <ArcoSpace size={8}><ArcoButton htmlType="button" onClick={() => void submit(() => renameTeamPerson(person.name, editDraft), "人员及模块责任关系已更新。")} disabled={busy || !editDraft.trim()} type="primary" size="small">保存</ArcoButton><ArcoButton htmlType="button" onClick={() => setEditing(null)} disabled={busy} type="secondary" size="small">取消</ArcoButton></ArcoSpace>
        : <ArcoSpace size={8}><ArcoButton htmlType="button" onClick={() => { setEditing(person.name); setEditDraft(person.name); setBindingName(null); }} disabled={busy} type="secondary" size="small">编辑</ArcoButton>{(person.feishuUserId || person.bindingConflict) && <DeleteConfirmation disabled={busy} triggerLabel="解除绑定" heading="解除飞书绑定" confirmLabel="确认解除" description={`解除「${person.name}」的飞书账号绑定？该人员名下需求的负责人映射将被清除，后续推送会停在待匹配负责人；已推送的 Base 记录不会被清除。`} onConfirm={() => void unbindFeishu(person.name)} />}<DeleteConfirmation disabled={busy} description={`删除人员“${person.name}”？相关功能模块将变为未分配，飞书账号绑定同时解除。`} onConfirm={() => void submit(() => deleteTeamPerson(person.name), "人员已删除，相关模块已解除分配。")} /></ArcoSpace> },
  ], [editing, editDraft, bindingName, busy, bindFeishu, unbindFeishu, submit]);

  return (
    <ArcoCard bordered={false} className="rq-card requirements-panel">
      <div className="req-action-row">
        <ArcoForm layout="inline" className="rq-compact-form">
          <ArcoForm.Item label="人员姓名" style={{ marginBottom: 0 }}>
            <ArcoInput aria-label="新增人员姓名" placeholder="输入成员姓名…" value={draft} onChange={(value: string) => setDraft(value)} />
          </ArcoForm.Item>
          <ArcoForm.Item style={{ marginBottom: 0 }}>
            <ArcoButton htmlType="button" onClick={() => void submit(() => addTeamPerson(draft), "人员已添加。")} disabled={busy || !draft.trim()} type="primary" size="small">新增人员</ArcoButton>
          </ArcoForm.Item>
        </ArcoForm>
        <ArcoButton htmlType="button" onClick={() => void load(true)} disabled={busy} type="secondary" size="small"><RefreshCw size={14} />刷新</ArcoButton>
      </div>
      <StateBanner loadError={loadError} notice={notice} onCloseNotice={() => setNotice(null)} onRetry={() => void load(true)} />
      {loadState === "loading" && !people.length ? <SkeletonTableRows rows={4} columns={3} /> : <ArcoTable<TeamPerson>
        rowKey="name"
        data={people}
        pagination={false}
        border={false}
        noDataElement={<ArcoEmpty className="rq-empty" description={<div className="rq-empty-copy"><strong>{loadError ? "人员读取失败" : "暂无人员"}</strong><span>{loadError ? "检查 API 连接后刷新。" : "填写姓名并新增；数据源配置完成后可维护组内名单并绑定飞书账号。"}</span></div>} />}
        columns={columns}
      />}
    </ArcoCard>
  );
}

function pendingExecutorSummary(rows: RequirementSummary[]): string {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const name = row.executorName?.trim();
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  if (!counts.size) return "未返回 TB 负责人姓名（可能已离职或未同步）";
  return [...counts.entries()].sort((left, right) => right[1] - left[1]).map(([name, count]) => `${name}×${count}`).join("、");
}

const MATCH_METHOD_LABELS: Record<PersonMapping["matchMethod"], string> = { tb_user_id: "TB 用户 ID", unique_name: "姓名唯一匹配", manual: "人工指定" };

const MAPPING_HISTORY_COLUMNS = [
  { title: "TB 用户 / 姓名", dataIndex: "teambitionDisplayName", render: (_value: unknown, mapping: PersonMapping) => mapping.teambitionDisplayName ?? mapping.teambitionUserId ?? "（仅姓名匹配占位）" },
  { title: "飞书用户", dataIndex: "feishuUserId", render: (_value: unknown, mapping: PersonMapping) => <span className="mono-cell">{mapping.feishuUserId}</span> },
  { title: "匹配方式", dataIndex: "matchMethod", width: 140, render: (_value: unknown, mapping: PersonMapping) => MATCH_METHOD_LABELS[mapping.matchMethod] ?? mapping.matchMethod },
  { title: "更新时间", dataIndex: "updatedAt", width: 190, render: (_value: unknown, mapping: PersonMapping) => timeLabel(mapping.updatedAt) },
];

export function MappingsPanel({ onRefresh }: { onRefresh: () => void }) {
  const [pending, setPending] = useState<RequirementSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [mappings, setMappings] = useState<PersonMapping[]>([]);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loadRequestVersion = useRef(0);
  const loadControllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async (nextCursor: string | null) => {
    const version = ++loadRequestVersion.current;
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    if (nextCursor) setLoadingMore(true); else setLoadState("loading");
    setLoadError(null);
    const [pendingPage, mappingPage] = await Promise.allSettled([
      listRequirements({ ownerState: "pending_mapping", limit: 25, ...(nextCursor ? { cursor: nextCursor } : {}), signal: controller.signal }),
      listMappings(undefined, controller.signal),
    ]);
    if (version !== loadRequestVersion.current || controller.signal.aborted) return;
    if (pendingPage.status === "rejected" || mappingPage.status === "rejected") {
      const cause = pendingPage.status === "rejected" ? pendingPage.reason : mappingPage.status === "rejected" ? mappingPage.reason : null;
      if (isAbortError(cause)) return;
      setLoadError(cause instanceof ApiError ? errorText(cause) : "无法加载映射数据。");
      setLoadState("error"); setLoadingMore(false);
      return;
    }
    setPending((prev) => nextCursor ? [...prev, ...pendingPage.value.items] : pendingPage.value.items);
    setCursor(pendingPage.value.nextCursor);
    setMappings(mappingPage.value);
    setLoadState("ready");
    setLoadingMore(false);
  }, []);
  useEffect(() => {
    void load(null);
    return () => {
      loadRequestVersion.current += 1;
      loadControllerRef.current?.abort();
    };
  }, [load]);

  const submit = useCallback(async (requirementId: string, user: FeishuUserSelection) => {
    setBusy(true); setNotice(null);
    try {
      const result = await setOwner(requirementId, { feishuUserId: user.feishuUserId, feishuIdType: user.feishuIdType, tbDisplayName: user.name });
      setNotice(`${user.name} 已指定为这条需求的负责人（${result.ownerState}），Base 推送已入队。`);
      setTargetId(null);
      onRefresh(); await load(null);
    } catch (cause) { setNotice(errorText(cause)); }
    finally { setBusy(false); }
  }, [onRefresh, load]);

  const pendingColumns = useMemo(() => [
    { title: "需求", dataIndex: "title", render: (_value: unknown, row: RequirementSummary) => <div className="requirement-title"><span className="req-id">{requirementDisplayId(row)}</span><strong>{row.title}</strong></div> },
    { title: "TB 负责人", dataIndex: "executorName", width: 140, render: (_value: unknown, row: RequirementSummary) => row.executorName ?? "待匹配" },
    { title: "操作", dataIndex: "id", width: 320, render: (_value: unknown, row: RequirementSummary) => targetId === row.id
        ? <ArcoSpace size={8} wrap align="center"><FeishuUserPicker key={row.id} disabled={busy} onMap={(user) => submit(row.id, user)} saveLabel="保存" /><ArcoButton htmlType="button" onClick={() => setTargetId(null)} disabled={busy} type="secondary" size="small">取消</ArcoButton></ArcoSpace>
        : <ArcoButton htmlType="button" onClick={() => setTargetId(row.id)} type="secondary" size="small">选择飞书用户</ArcoButton> },
  ], [targetId, busy, submit]);

  return <ArcoCard
    bordered={false}
    className="rq-card requirements-panel"
    title={
      <div className="rq-card-title">
        <h2>负责人映射</h2>
        <ArcoTypography.Text type="secondary" className="rq-card-subtitle">为待匹配负责人逐条选择飞书用户；只影响选中的这一条需求，不会改写同 TB 执行人的其他需求。</ArcoTypography.Text>
      </div>
    }
    extra={<ArcoButton htmlType="button" onClick={() => { onRefresh(); void load(null); }} type="secondary" size="small"><RefreshCw size={14} />刷新</ArcoButton>}
  >
    <StateBanner loadError={loadError} notice={notice} onCloseNotice={() => setNotice(null)} onRetry={() => void load(null)} />
    {pending.length ? <ArcoAlert className="rq-inline-alert" type="info" showIcon={false} content={<><strong>待匹配 {pending.length}{cursor ? "+" : ""} 条</strong>，按 TB 负责人聚合：{pendingExecutorSummary(pending)}</>} /> : null}
    {loadState === "loading" && !pending.length ? <SkeletonTableRows rows={4} columns={3} /> : <ArcoTable<RequirementSummary>
      rowKey="id"
      data={pending}
      pagination={false}
      border={false}
      noDataElement={<ArcoEmpty className="rq-empty" description={<div className="rq-empty-copy"><strong>没有待匹配的负责人</strong><span>未匹配需求会出现在这里，等待为每一条需求单独指定负责人。</span></div>} />}
      columns={pendingColumns}
    />}
    {cursor && <div className="rq-action-bar" style={{ textAlign: "center" }}><ArcoButton type="secondary" htmlType="button" size="small" disabled={loadingMore || busy} onClick={() => void load(cursor)}>{loadingMore ? "加载中…" : "加载更多待匹配需求"}</ArcoButton></div>}
    {mappings.length > 0 && <><ArcoDivider /><ArcoTable<PersonMapping>
      rowKey="id"
      data={mappings}
      pagination={false}
      border={false}
      columns={MAPPING_HISTORY_COLUMNS}
    /></>}
  </ArcoCard>;
}

export function TeamPanel({ initialTab, onRefresh }: { initialTab?: WorkbenchTab | null; onRefresh: () => void }) {
  const [tab, setTab] = useState<"people" | "mappings">(initialTab === "mappings" ? "mappings" : "people");
  useEffect(() => { if (initialTab === "people" || initialTab === "mappings") setTab(initialTab); }, [initialTab]);
  return <div className="composite-page">
    <AccessibleTabs label="团队管理" activeTab={tab} onChange={(key) => setTab(key as "people" | "mappings")}>
      <ArcoTabs.TabPane key="people" title="人员"><PeoplePanel /></ArcoTabs.TabPane>
      <ArcoTabs.TabPane key="mappings" title="负责人映射"><MappingsPanel onRefresh={onRefresh} /></ArcoTabs.TabPane>
    </AccessibleTabs>
  </div>;
}

export default TeamPanel;
