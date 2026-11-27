// 功能模块词典页面：受控模块与责任人员维护 + 词典版本历史。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert as ArcoAlert, Button as ArcoButton, Card as ArcoCard, Empty as ArcoEmpty, Form as ArcoForm, Input as ArcoInput, Select as ArcoSelect, Space as ArcoSpace, Table as ArcoTable, Typography as ArcoTypography } from "@arco-design/web-react";
import { RefreshCw } from "lucide-react";
import { ApiError, getFunctionModules, isAbortError, listDictionaryVersions, listTeamPeople, saveFunctionModules, type DictionaryVersion, type FunctionModuleEntry, type TeamPerson } from "../api";
import { CACHE_KEYS, invalidateQueryCache } from "../cache";
import { SkeletonTableRows } from "../skeleton";
import { DeleteConfirmation, errorText, PublishStatusChip, StateBanner, timeLabel, type LoadState } from "../panel-shared";

const DICTIONARY_VERSION_COLUMNS = [
  { title: "版本", dataIndex: "version", width: 90, render: (_value: unknown, d: DictionaryVersion) => <span className="mono-cell">v{d.version}</span> },
  { title: "状态", dataIndex: "status", width: 110, render: (_value: unknown, d: DictionaryVersion) => <PublishStatusChip status={d.status} /> },
  { title: "模块", dataIndex: "entries", width: 300, render: (_value: unknown, d: DictionaryVersion) => d.entries.map((entry) => typeof entry === "string" ? entry : `${entry.name}（${entry.personName ?? "未分配"}）`).join("、") },
  { title: "创建时间", dataIndex: "createdAt", width: 180, render: (_value: unknown, d: DictionaryVersion) => timeLabel(d.createdAt) },
  { title: "发布时间", dataIndex: "publishedAt", width: 180, render: (_value: unknown, d: DictionaryVersion) => d.publishedAt ? timeLabel(d.publishedAt) : "—" },
];

export function ModulesPanel() {
  const [version, setVersion] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [formError, setFormError] = useState<string | null>(null);
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
  const loadRequestVersion = useRef(0);
  const loadControllerRef = useRef<AbortController | null>(null);
  const [editName, setEditName] = useState("");
  const [editPerson, setEditPerson] = useState("");

  const beginEdit = useCallback((item: FunctionModuleEntry) => {
    setEditing(item.name); setEditName(item.name); setEditPerson(item.personName ?? "");
  }, []);

  const loadVersions = useCallback(async (signal?: AbortSignal) => {
    try {
      const list = await listDictionaryVersions(undefined, signal);
      if (signal?.aborted) return;
      setVersions(list); setVersionsError(null);
    } catch (cause) {
      if (signal?.aborted || isAbortError(cause)) return;
      setVersions([]); setVersionsError(errorText(cause));
    }
  }, []);

  const load = useCallback(async (force = false) => {
    if (force) invalidateQueryCache(CACHE_KEYS.modules, CACHE_KEYS.people);
    const requestVersion = ++loadRequestVersion.current;
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    setLoadState("loading");
    try {
      const [directory, roster] = await Promise.all([
        getFunctionModules(undefined, force ? controller.signal : undefined),
        listTeamPeople(undefined, force ? controller.signal : undefined),
      ]);
      if (requestVersion !== loadRequestVersion.current) return;
      setVersion(directory.version); setItems(directory.items); setPeople(roster); setLoadError(null); setLoadState("ready");
    } catch (cause) {
      if (requestVersion !== loadRequestVersion.current || isAbortError(cause)) return;
      setLoadError(errorText(cause)); setLoadState("error");
    }
    if (requestVersion === loadRequestVersion.current) await loadVersions(controller.signal);
  }, [loadVersions]);

  useEffect(() => {
    void load();
    return () => {
      loadRequestVersion.current += 1;
      loadControllerRef.current?.abort();
    };
  }, [load]);

  const save = useCallback(async (next: FunctionModuleEntry[], resetAddForm = false) => {
    setBusy(true); setLoadError(null); setNotice(null);
    try {
      const result = await saveFunctionModules(version, next);
      setVersion(result.version); setItems(result.items); setEditing(null); setEditName(""); setEditPerson(""); setFormError(null);
      if (resetAddForm) { setName(""); setPersonName(""); }
      setNotice(`已发布模块字典 v${result.version}，后续 AI 分析将使用新版本。`);
      await loadVersions();
    } catch (cause) {
      setLoadError(errorText(cause));
      if (cause instanceof ApiError && cause.status === 409) void load(true);
    } finally { setBusy(false); }
  }, [version, loadVersions, load]);

  const submitEdit = useCallback(() => {
    setFormError(null);
    const clean = editName.trim();
    if (!clean) { setFormError("请填写功能模块名称。"); return; }
    if (items.some((candidate) => candidate.name.toLocaleLowerCase() === clean.toLocaleLowerCase() && candidate.name !== editing)) { setFormError("功能模块名称不能重复。"); return; }
    void save(items.map((candidate) => candidate.name === editing ? { name: clean, personName: editPerson || null } : candidate));
  }, [editName, editPerson, editing, items, save]);

  const submit = () => {
    setFormError(null);
    const clean = name.trim();
    if (!clean) { setFormError("请填写功能模块名称。"); return; }
    if (items.some((item) => item.name.toLocaleLowerCase() === clean.toLocaleLowerCase())) { setFormError("功能模块名称不能重复。"); return; }
    void save([...items, { name: clean, personName: personName || null }], true);
  };

  const peopleOptions = useMemo(() => [{ label: "未分配", value: "" }, ...people.filter((person) => person.name).map((person) => ({ label: person.name!, value: person.name! }))], [people]);

  const moduleColumns = useMemo(() => [
    { title: "功能模块", dataIndex: "name", render: (_value: unknown, item: FunctionModuleEntry) => editing === item.name ? <ArcoInput className="inline-input" aria-label="编辑功能模块名称" value={editName} onChange={(value: string) => setEditName(value)} autoFocus /> : item.name },
    { title: "人员", dataIndex: "personName", width: 220, render: (_value: unknown, item: FunctionModuleEntry) => editing === item.name ? <ArcoSelect className="inline-input" aria-label="编辑模块责任人员" value={editPerson} onChange={(value: string) => setEditPerson(value)} style={{ minWidth: 150 }} options={peopleOptions} /> : (item.personName ?? "未分配") },
    { title: "操作", width: 200, render: (_value: unknown, item: FunctionModuleEntry) => editing === item.name
        ? <ArcoSpace size={8}><ArcoButton htmlType="button" onClick={submitEdit} disabled={busy} type="primary" size="small">保存</ArcoButton><ArcoButton htmlType="button" onClick={() => { setEditing(null); setEditName(""); setEditPerson(""); }} disabled={busy} type="secondary" size="small">取消</ArcoButton></ArcoSpace>
        : <ArcoSpace size={8}><ArcoButton htmlType="button" onClick={() => beginEdit(item)} disabled={busy} type="secondary" size="small">编辑</ArcoButton><DeleteConfirmation disabled={busy || items.length === 1} description={`删除功能模块“${item.name}”？`} onConfirm={() => void save(items.filter((candidate) => candidate.name !== item.name))} /></ArcoSpace> },
  ], [editing, editName, editPerson, peopleOptions, submitEdit, busy, beginEdit, items, save]);

  return (
    <div className="modules-stack">
      <ArcoCard bordered={false} className="rq-card requirements-panel">
        <div className="req-action-row">
          <ArcoForm layout="inline" className="rq-compact-form">
            <ArcoForm.Item label="功能模块" style={{ marginBottom: 0 }}>
              <ArcoInput aria-label="功能模块名称" placeholder="输入功能模块名称…" value={name} onChange={(value: string) => setName(value)} />
            </ArcoForm.Item>
            <ArcoForm.Item label="人员" style={{ marginBottom: 0 }}>
              <ArcoSelect aria-label="模块责任人员" value={personName} onChange={(value: string) => setPersonName(value)} style={{ minWidth: 150 }} options={peopleOptions} />
            </ArcoForm.Item>
            <ArcoForm.Item style={{ marginBottom: 0 }}>
              <ArcoButton htmlType="button" onClick={submit} disabled={busy} type="primary" size="small">新增模块</ArcoButton>
            </ArcoForm.Item>
          </ArcoForm>
          <ArcoButton htmlType="button" onClick={() => void load(true)} disabled={busy} type="secondary" size="small"><RefreshCw size={14} />刷新</ArcoButton>
        </div>
        <StateBanner loadError={loadError} notice={notice} onCloseNotice={() => setNotice(null)} onRetry={() => void load(true)} />
        {formError && <ArcoAlert className="rq-inline-alert" type="error" showIcon role="alert" content={formError} />}
        {loadState === "loading" && !items.length ? <SkeletonTableRows rows={4} columns={3} /> : <div tabIndex={0} role="region" aria-label="功能模块列表"><ArcoTable<FunctionModuleEntry>
          rowKey="name"
          data={items}
          pagination={false}
          border={false}
          noDataElement={<ArcoEmpty className="rq-empty" description={<div className="rq-empty-copy"><strong>{loadError ? "模块字典读取失败" : "暂无功能模块"}</strong><span>{loadError ? "检查 API 连接后刷新。" : "新增模块后，AI 分析会使用最新的已发布字典。"}</span></div>} />}
          rowClassName={(item: FunctionModuleEntry) => editing === item.name ? "module-row is-editing" : "module-row"}
          columns={moduleColumns}
        /></div>}
      </ArcoCard>

      <ArcoCard
        bordered={false}
        className="rq-card"
        title={
          <div className="rq-card-title">
            <h3>词典版本历史</h3>
            <ArcoTypography.Text type="secondary" className="rq-card-subtitle">每次保存生成一个新版本；仅最新发布版供 AI 分析使用。</ArcoTypography.Text>
          </div>
        }
      >
        <ArcoTable<DictionaryVersion>
          rowKey="version"
          data={versionsError ? [] : versions}
          pagination={false}
          border={false}
          scroll={{ x: 900 }}
          noDataElement={
            versionsError
              ? <ArcoEmpty className="rq-empty" description={<div className="rq-empty-copy"><strong>版本历史读取失败</strong><span>{versionsError}</span></div>} />
              : <ArcoEmpty className="rq-empty" description={<div className="rq-empty-copy"><strong>还没有词典版本</strong><span>保存一次模块字典后会生成首个已发布版本。</span></div>} />
          }
          columns={DICTIONARY_VERSION_COLUMNS}
        />
      </ArcoCard>
    </div>
  );
}

export default ModulesPanel;
