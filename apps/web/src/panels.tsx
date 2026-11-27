// 工单 16/17 工作台面板：数据全部来自本地 API，不使用演示数据；
// 权限拒绝、空数据、加载中、局部失败和 API 不可用都显示可恢复状态。
// 需求池/批次/审计面板自治加载，支持服务端筛选与游标分页。
import { useCallback, useEffect, useId, useRef, useState, Component, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { AudienceEditor, BetaPanel, IntakeForm, ManualEditSection } from "./intake-form";
import { Alert as ArcoAlert, Badge as ArcoBadge, Button as ArcoButton, Card as ArcoCard, Checkbox as ArcoCheckbox, Collapse, Descriptions as ArcoDescriptions, Divider as ArcoDivider, Empty as ArcoEmpty, Form as ArcoForm, Grid as ArcoGrid, Input as ArcoInput, InputNumber as ArcoInputNumber, Message as ArcoMessage, Popover as ArcoPopover, Radio as ArcoRadio, Result as ArcoResult, Select as ArcoSelect, Space as ArcoSpace, Statistic as ArcoStatistic, Switch as ArcoSwitch, Table as ArcoTable, Tabs as ArcoTabs, Tag as ArcoTag, Tooltip as ArcoTooltip, Typography as ArcoTypography } from "@arco-design/web-react";
import { ConfirmModal } from "./confirm-modal";
import { ArrowLeft, CircleHelp, Download, RefreshCw } from "lucide-react";
import { stateLabel } from "./state-labels";
import { RequirementDetailSkeleton, SkeletonBlock, SkeletonTableRows } from "./skeleton";
import { checkScheduleHealth } from "./schedule";
import { readRequirementDeepLink } from "./deep-link";
import { emptyRequirementListFilters, myRequirementsUrl, readMyRequirementsPool, readRequirementListFilters, recycleBinUrl, requirementFilterCount, requirementPoolUrl, type RequirementListFilters, type RequirementProcessingView } from "./requirements-url";
import { formatDateTime, requirementDisplayId, requirementOwnerView, requirementSourceFacts, requirementSourceName, requirementTime, sortRequirementsForAttention } from "./requirement-view";
import { AUDIT_PAGE_LIMIT, ApiError, addTeamPerson, applyRequirementAiScore, bindTeamPersonFeishu, createSource, createRequirementAssessment, deleteRequirement, deleteTeamPerson, getBatch, getFunctionModules, getMyRequirementCounts, getRequirement, exportRequirementsCsv, getBaseLinks, getGates, getOpsJobs, getOpsMetrics, getReadiness, getRequirementSourceCounts, listMyRequirements, listRecycleBinRequirements, listRequirementAssessments, restoreRequirement, setGate, listAudit, listBatches, listDictionaryVersions, listMappings, listRequirements, listTeamPeople, pushRequirement, renameTeamPerson, revokeDuplicateDecision, saveAnalysisContext, saveFunctionModules, retryAnalysis, setPriorityOverride, retrySyncItem, saveRequirementScore, searchFeishuUsers, setDuplicateDecision, setOwner, unbindTeamPersonFeishu, updateSource, type AnalysisVersionSummary, type AuditEvent, type OpsJob, type OpsMetrics, type GatesResponse, type AssessmentConfidence, type AssessmentVerdict, type BatchDetail, type BaseLinks, type BatchSummary, type DictionaryVersion, type DuplicateDecision, type MyRequirementCounts, type PersonMapping, type PublishStatus, type FeishuUserSelection, type FeishuUserCandidate, type FunctionModuleEntry, type RequirementDetail, type RequirementProcessingState, type RequirementResolution, type RequirementAssessment, type RequirementScoreVersion, type RequirementSourceCounts, type RequirementSummary, type ScoringInputs, type SourceConfig, type SourceConfigUpdate, type TeamPerson, type RequirementPool, clearOwner } from "./api";
import type { WorkbenchTab } from "./workbench-routing";
import { PrdPromptSection } from "./prd-prompt";
import { safeHttpUrl } from "./safe-url";

/** 页内锚点跳转：直接滚动并聚焦目标标题，不修改 location.hash（避免触发 hash 路由 popstate 切页）。 */
function scrollToSection(id: string): void {
  const target = document.getElementById(id);
  if (!target) return;
  target.scrollIntoView?.({ behavior: "smooth", block: "start" });
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus?.({ preventScroll: true });
}

export type LoadState = "loading" | "ready" | "error";

const API_ERROR_TEXT: Record<string, string> = {
  INTERNAL: "服务暂时不可用，请稍后重试。",
  DEPENDENCY_UNAVAILABLE: "依赖服务暂不可用，请稍后重试。",
  VALIDATION_FAILED: "请求参数不合法，请检查输入。",
  NOT_FOUND: "请求的资源不存在或已被删除。",
  CONFLICT: "当前状态不允许此操作，请刷新后重试。",
  REQUEST_FAILED: "无法连接到 API 服务，请确认服务已启动后重试。",
  SOURCE_NOT_ENABLED: "请先配置并启用一个数据源。",
  UNAUTHORIZED: "登录已失效，请重新登录。",
  FORBIDDEN: "没有权限执行此操作。",
  INVALID_METRICS_RESPONSE: "统计响应格式不正确，请稍后重试。",
};

function errorText(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.status === 403) return `服务端拒绝了此操作（${cause.code}）。MVP 要求飞书登录；拒绝原因以服务端为准，工作台不会绕过。`;
    // 服务端已经给出中文可操作说明时直接使用；否则把稳定的错误码映射成中文，避免英文堆栈文案进入界面。
    if (/[\u4e00-\u9fff]/.test(cause.message)) return cause.message;
    return API_ERROR_TEXT[cause.code] ?? `操作失败（${cause.code}）。`;
  }
  return "操作失败：无法连接后端服务。";
}

const PRIORITY_TAG_COLORS: Record<string, string> = { P0: "red", P1: "orange", P2: "arcoblue", P3: "gray" };

function StateBanner({ loadError, notice, onCloseNotice }: { loadError: string | null; notice: string | null; onCloseNotice: () => void }) {
  return <>
    {loadError && <ArcoAlert className="rq-inline-alert" type="error" showIcon role="alert" title="请求失败" content={loadError} />}
    {notice && <ArcoAlert className="rq-inline-alert" type="success" showIcon closable role="status" content={notice} onClose={onCloseNotice} />}
  </>;
}

function DeleteConfirmation({ description, disabled, onConfirm, triggerLabel = "删除", heading = "确认删除", confirmLabel = "确认删除" }: { description: string; disabled: boolean; onConfirm: () => void; triggerLabel?: string; heading?: string; confirmLabel?: string }) {
  const [arcoOpen, setArcoOpen] = useState(false);
  // 弹窗关闭后把焦点还给触发按钮：Arco 的 focus-lock 只在弹窗内循环，关闭后默认回到 body。
  const triggerRef = useRef<HTMLButtonElement>(null);
  return <>
    <ArcoButton type="outline" status="danger" htmlType="button" size="small" ref={triggerRef} disabled={disabled} onClick={() => { if (!disabled) setArcoOpen(true); }}>{triggerLabel}</ArcoButton>
    <ConfirmModal visible={arcoOpen} title={heading} description={description} okText={confirmLabel} onOk={() => { setArcoOpen(false); onConfirm(); }} onCancel={() => setArcoOpen(false)} afterClose={() => triggerRef.current?.focus()} />
  </>;
}

function timeLabel(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString("zh-CN") : "—";
}

const publishStatusBadge: Record<PublishStatus, { label: string; status: "warning" | "success" | "default" }> = {
  draft: { label: "草稿", status: "warning" },
  published: { label: "已发布", status: "success" },
  retired: { label: "已退役", status: "default" },
};

export function PublishStatusChip({ status }: { status: PublishStatus }) {
  const badge = publishStatusBadge[status];
  return <ArcoBadge status={badge.status} text={badge.label} />;
}

const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
function scheduleDays(schedule: SourceConfig["schedule"]): number[] {
  return schedule.weekdays ?? (schedule.weekday === null ? [] : [schedule.weekday]);
}
function scheduleLabel(schedule: SourceConfig["schedule"]): string {
  if (!schedule.enabled) return "未启用";
  const days = scheduleDays(schedule);
  const label = days.length ? days.map((day) => WEEKDAY_LABELS[day - 1] ?? String(day)).join("/") : "每周";
  return `${label} ${schedule.time ?? "时间未设置"} ${schedule.timezone ?? ""}`.trim();
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
      ? <ArcoAlert type="error" showIcon role="alert" content={loadError} />
      : <ArcoSpace size={8} wrap className="feishu-user-search">
          <ArcoSelect aria-label="选择负责人" value={selectedId} disabled={disabled || loading || saving}
            onChange={(value: string) => setSelectedId(value)} style={{ minWidth: 200 }}
            placeholder={loading ? "正在读取人员…" : people.length ? "请选择负责人" : "名单为空，请先在「组内人员」绑定飞书账号"}
            options={people.map((person) => ({ label: person.name, value: person.feishuUserId }))}
          />
          <ArcoButton type="primary" htmlType="button" size="small" onClick={() => void save()} disabled={disabled || !selected || saving}>
            {saving ? "保存中…" : saveLabel}
          </ArcoButton>
        </ArcoSpace>}
  </div>;
}

// ---------- 工单 16：数据源配置（创建唯一来源 / 更新现有配置） ----------

const DEFAULT_TB_PROJECT_NAME = "室外产品-码表软固件需求池";
const DEFAULT_GROUP_PROJECT_NAME = "需求收集与管理";
// ---------- Spec 04 连接自检：只反映已保存配置，不声称已校验服务端凭据 ----------

/**
 * 连接自检清单。凭据校验发生在服务端；凭据值不下发浏览器，
 * 因此这里只展示「配置是否完整/合法」，绝不显示任何凭据内容或有效/无效结论。
 */
function ConnectionSelfCheck({ existing, draft, pool = "product" }: { existing?: SourceConfig; draft: SourceConfigUpdate; pool?: RequirementPool }) {
  const isGroup = pool === "group";
  const schedule = existing ? existing.schedule : draft.schedule;
  const scheduleHealth = checkScheduleHealth(schedule);
  const executorNames = normalizeExecutorNames(draft.executorAllowlist ?? []);
  const checks = [
    { label: "Teambition 项目名称", ok: Boolean((existing?.projectName ?? draft.projectName).trim()), detail: existing ? "已保存到服务端" : "保存后由服务端解析项目与需求任务类型" },
    ...(isGroup ? [{ label: "执行人名单", ok: executorNames.length > 0, detail: executorNames.length > 0 ? `已填写 ${executorNames.length} 个执行人（任一命中即同步）` : "名单为空，保存与启用同步都会被拒绝" }] : []),
    { label: "周计划配置", ok: scheduleHealth.active, detail: scheduleHealth.active ? scheduleLabel(schedule) : scheduleHealth.reason ?? "未配置" },
    { label: "同步开关", ok: Boolean(existing?.enabled), detail: existing?.enabled ? "允许手动同步" : "未启用，手动同步会被拒绝" },
  ];
  const okCount = checks.filter((check) => check.ok).length;
  // 折叠成一行摘要：摘要区已有项目名/周计划/开关，明细按需展开，避免整页像调试面板。
  return (
    <Collapse className="self-check" defaultActiveKey={[]}>
      <Collapse.Item
        name="self-check"
        header={
          <ArcoSpace size={8} wrap>
            <strong>连接自检</strong>
            <ArcoTag size="small" color={okCount === checks.length ? "green" : "orange"}>{okCount}/{checks.length} 项已就绪</ArcoTag>
            <ArcoTypography.Text type="secondary" className="rq-caption">只反映已保存配置</ArcoTypography.Text>
          </ArcoSpace>
        }
      >
        <div className="self-check-body" role="group" aria-label={isGroup ? "集团池连接自检" : "连接自检"}>
          <ul className="self-check-list">
            {checks.map((check) => (
              <li key={check.label}>
                <ArcoBadge status={check.ok ? "success" : "default"} />
                <span className="self-check-label">{check.label}</span>
                <span className="self-check-detail">{check.detail}</span>
              </li>
            ))}
          </ul>
          <ArcoTypography.Paragraph type="secondary" className="detail-note">
            服务端凭据（Teambition 网关、AI 服务、飞书 Base）保存在服务端环境，不写入浏览器也不回显；其有效性以实际同步批次与推送结果为准。
          </ArcoTypography.Paragraph>
        </div>
      </Collapse.Item>
    </Collapse>
  );
}

function defaultSourceUpdate(pool: RequirementPool): SourceConfigUpdate {
  return {
    projectName: pool === "group" ? DEFAULT_GROUP_PROJECT_NAME : DEFAULT_TB_PROJECT_NAME,
    enabled: false,
    schedule: { enabled: false, weekday: 1, weekdays: [1], time: "09:00", timezone: "Asia/Shanghai" },
    pool,
    ...(pool === "group" ? { executorAllowlist: [] } : {}),
  };
}

/** 集团池执行人名单：自由文本标签（无 TB 人员选择接口），trim/去重后 1–20 个。 */
function normalizeExecutorNames(names: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    result.push(name);
  }
  return result;
}

/** 服务端 400 时返回未解析的姓名；其它错误返回空数组。 */
function unresolvedExecutorNames(cause: unknown): string[] {
  if (!(cause instanceof ApiError)) return [];
  const details = cause.details as { unresolvedExecutorNames?: unknown } | null;
  const names = details?.unresolvedExecutorNames;
  return Array.isArray(names) ? names.filter((name): name is string => typeof name === "string" && name.trim() !== "") : [];
}

function ExecutorAllowlistEditor({ value, onChange, disabled }: { value: string[]; onChange: (next: string[]) => void; disabled?: boolean }) {
  const [input, setInput] = useState("");
  const add = () => {
    const name = input.trim();
    if (!name) return;
    if (value.includes(name) || value.length >= 20) { setInput(""); return; }
    onChange([...value, name]);
    setInput("");
  };
  const remove = (name: string) => onChange(value.filter((item) => item !== name));
  return <div className="executor-editor">
    <div className="executor-tags" role="list" aria-label="执行人名单">
      {value.map((name) => (
        <span role="listitem" key={name}>
          <ArcoTag
            closable={!disabled}
            onClose={() => remove(name)}
            closeIcon={<span aria-label={`移除执行人 ${name}`}>×</span>}
          >
            {name}
          </ArcoTag>
        </span>
      ))}
      {!value.length && <span className="req-empty-value">尚未添加执行人</span>}
    </div>
    <div className="executor-add">
      <ArcoInput aria-label="添加执行人" placeholder="输入姓名后回车添加（1–20 个）" value={input} onChange={(val: string) => setInput(val)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }} />
      <ArcoButton htmlType="button" onClick={add} disabled={disabled || !input.trim() || value.length >= 20} type="secondary" size="small">添加</ArcoButton>
    </div>
    <ArcoTypography.Text type="secondary" className="rq-caption">当前 {value.length}/20。任一执行人在名单内即同步；不处理执行人变更；名单为空不能保存或启用同步。</ArcoTypography.Text>
  </div>;
}

export function SourcesPanel({ sources, loadState, onRefresh }: { sources: SourceConfig[]; loadState: LoadState; onRefresh: () => void }) {
  // 方案 A：同一 provider 两条来源配置，按 pool 分组渲染；≥1200px 两列，窄屏单列。
  const product = sources.find((item) => (item.pool ?? "product") === "product");
  const group = sources.find((item) => item.pool === "group");
  return <div className="sources-page">
    <ArcoGrid.Row gutter={[16, 16]} align="stretch">
      <ArcoGrid.Col xs={24} xl={12}><SourceConfigCard pool="product" existing={product} loadState={loadState} onRefresh={onRefresh} /></ArcoGrid.Col>
      <ArcoGrid.Col xs={24} xl={12}><SourceConfigCard pool="group" existing={group} loadState={loadState} onRefresh={onRefresh} /></ArcoGrid.Col>
    </ArcoGrid.Row>
    <BaseFormReadonlyPanel />
    <BaseLinksPanel />
  </div>;
}

function SourceConfigCard({ pool, existing, loadState, onRefresh }: { pool: RequirementPool; existing?: SourceConfig; loadState: LoadState; onRefresh: () => void }) {
  const isGroup = pool === "group";
  const [draft, setDraft] = useState<SourceConfigUpdate>(() => existing ? {
    projectName: existing.projectName,
    enabled: existing.enabled,
    schedule: { ...existing.schedule },
    pool,
    ...(isGroup ? { executorAllowlist: existing.executorAllowlist ?? [] } : {}),
  } : defaultSourceUpdate(pool));
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [unresolvedNames, setUnresolvedNames] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  // 最近同步：只读该池最近一批，失败只降级本项，不影响来源配置的读写。
  const [lastBatch, setLastBatch] = useState<BatchSummary | null>(null);
  const [lastBatchState, setLastBatchState] = useState<LoadState>("loading");
  const executorNames = draft.executorAllowlist ?? [];
  const emptyAllowlist = isGroup && executorNames.length === 0;

  // 冷加载/刷新：服务端配置实际变化时同步草稿；只在 key 变化时做，避免覆盖用户正在编辑的内容。
  const loadedKey = existing ? `${existing.id}|${existing.enabled}|${existing.projectName}|${existing.schedule.enabled}|${scheduleDays(existing.schedule).join(",")}|${existing.schedule.time}|${(existing.executorAllowlist ?? []).join(",")}` : "";
  useEffect(() => {
    if (!existing) return;
    setDraft({
      projectName: existing.projectName,
      enabled: existing.enabled,
      schedule: { ...existing.schedule },
      pool,
      ...(isGroup ? { executorAllowlist: existing.executorAllowlist ?? [] } : {}),
    });
    // 仅在服务端配置实际变化时重同步，避免覆盖用户正在编辑的草稿。
  }, [loadedKey]);

  useEffect(() => {
    let cancelled = false;
    setLastBatchState("loading");
    void listBatches({ pool: isGroup ? "group" : undefined, limit: 1 })
      .then((result) => { if (!cancelled) { setLastBatch(result.items[0] ?? null); setLastBatchState("ready"); } })
      .catch(() => { if (!cancelled) { setLastBatch(null); setLastBatchState("error"); } });
    return () => { cancelled = true; };
  }, [isGroup]);

  const set = <K extends keyof SourceConfigUpdate>(key: K, value: SourceConfigUpdate[K]) => setDraft((prev) => ({ ...prev, [key]: value }));
  const selectedDays = draft.schedule.weekdays ?? (draft.schedule.weekday === null ? [] : [draft.schedule.weekday]);
  const toggleWeekday = (day: number) => {
    const next = selectedDays.includes(day) ? selectedDays.filter((item) => item !== day) : [...selectedDays, day].sort((a, b) => a - b);
    set("schedule", { ...draft.schedule, weekdays: next, weekday: next[0] ?? null });
  };

  const save = async () => {
    if (emptyAllowlist) { setLoadError("请至少填写 1 个执行人后再保存或启用同步。"); return; }
    setBusy(true); setLoadError(null); setUnresolvedNames([]); setNotice(null);
    try {
      const body: SourceConfigUpdate = { projectName: draft.projectName, enabled: draft.enabled, schedule: { ...draft.schedule } };
      if (isGroup) body.executorAllowlist = normalizeExecutorNames(executorNames);
      const saved = existing ? await updateSource(existing.id, body) : await createSource({ ...body, pool });
      setDraft({
        projectName: saved.projectName,
        enabled: saved.enabled,
        schedule: { ...saved.schedule },
        pool,
        ...(isGroup ? { executorAllowlist: saved.executorAllowlist ?? normalizeExecutorNames(executorNames) } : {}),
      });
      setNotice(existing
        ? (isGroup ? "集团池来源配置已保存并从 API 重新读取一致。" : "来源配置已保存并从 API 重新读取一致。")
        : (isGroup ? "集团池来源已创建。" : "来源已创建。"));
      onRefresh();
    } catch (cause) {
      const names = unresolvedExecutorNames(cause);
      if (names.length) {
        setUnresolvedNames(names);
        setLoadError("以下执行人未解析到 Teambition 账号，请核对姓名后重试（名单已保留）。");
      } else { setLoadError(errorText(cause)); }
    } finally { setBusy(false); }
  };

  const title = isGroup ? "集团需求池（Teambition）" : "产品需求池（Teambition）";
  const description = isGroup
    ? "集团池独立同步 Teambition「需求收集与管理」项目；仅收录执行人名单内的需求。凭据保存在服务端。"
    : "填写 Teambition 项目名称；系统会自动匹配项目及需求任务类型。凭据保存在服务端。";
  const prefix = isGroup ? "集团池" : "";
  const BATCH_STATUS_LABELS: Record<string, string> = { queued: "排队中", running: "进行中", succeeded: "成功", partial_failure: "部分失败", failed: "失败" };
  const lastSyncText = lastBatchState === "loading"
    ? "读取中…"
    : lastBatch
      ? `${formatDateTime(lastBatch.startedAt ?? null) ?? lastBatch.startedAt ?? "时间未知"} · ${BATCH_STATUS_LABELS[lastBatch.status] ?? lastBatch.status}`
      : lastBatchState === "error" ? "暂不可用" : "暂无同步记录";

  return <section className="source-card-wrap" aria-label={isGroup ? "集团需求池来源配置" : "产品需求池来源配置"}>
    <ArcoCard bordered={false} className={`rq-card source-card ${isGroup ? "is-group" : "is-product"}`} title={<ArcoSpace size={8} align="center" wrap>
      <ArcoTypography.Title heading={5} style={{ margin: 0 }}>{title}</ArcoTypography.Title>
      {existing && <ArcoTag color={existing.enabled ? "green" : "gray"} bordered={false}>{existing.enabled ? "当前已启用" : "当前已停用"}</ArcoTag>}
    </ArcoSpace>}>
      {loadState === "error" && <ArcoAlert className="rq-inline-alert" type="error" showIcon role="alert" title="无法读取来源配置" content="请检查 API 连接后重试。" />}
      <StateBanner loadError={loadError} notice={notice} onCloseNotice={() => setNotice(null)} />
      {unresolvedNames.length > 0 && <ArcoAlert className="rq-inline-alert" type="error" showIcon role="alert" title="执行人未解析" content={`${unresolvedNames.join("、")}：请填写 Teambition 组织目录中的准确姓名。`} />}
      <ArcoTypography.Paragraph type="secondary">{description}</ArcoTypography.Paragraph>
      {/* 摘要即表单：每个字段只出现一次，卡片标题上的 Tag 表示已保存状态，开关表示保存后的状态。 */}
      <ArcoDescriptions column={1} size="small" className="source-summary" labelStyle={{ width: 112 }} data={[
        { label: "项目名称", value: <ArcoInput aria-label={`${prefix}项目名称`} value={draft.projectName} onChange={(value: string) => set("projectName", value)} /> },
        { label: "同步开关", value: <div className="schedule-toggle-row">
          <ArcoSwitch checked={draft.enabled} disabled={emptyAllowlist} aria-label={isGroup ? "启用集团池同步" : "启用同步"} onChange={(checked: boolean) => set("enabled", checked)} />
          <span>{isGroup ? "启用集团池同步" : "启用同步"}</span>
          <span className="subtle-text">保存后启用</span>
        </div> },
        ...(isGroup ? [{ label: "执行人名单", value: <ExecutorAllowlistEditor value={executorNames} onChange={(next) => set("executorAllowlist", next)} disabled={busy} /> }] : []),
        { label: "周计划", value: <ArcoSpace direction="vertical" size={8} style={{ width: "100%" }}>
          <div className="weekday-grid">
            {WEEKDAY_LABELS.map((label, index) => { const day = index + 1; return <ArcoButton key={label} htmlType="button" size="small" type={selectedDays.includes(day) ? "primary" : "secondary"} aria-label={isGroup ? `集团池${label}` : label} aria-pressed={selectedDays.includes(day)} onClick={() => toggleWeekday(day)}>{label}</ArcoButton>; })}
          </div>
          <ArcoSpace size={8} align="center" wrap>
            <ArcoInput aria-label={`${prefix}执行时间`} placeholder="09:00" style={{ width: 110 }} value={draft.schedule.time ?? ""} onChange={(value: string) => set("schedule", { ...draft.schedule, time: value === "" ? null : value })} />
            <ArcoInput aria-label={`${prefix}时区`} placeholder="Asia/Shanghai" style={{ width: 168 }} value={draft.schedule.timezone ?? ""} onChange={(value: string) => set("schedule", { ...draft.schedule, timezone: value === "" ? null : value })} />
          </ArcoSpace>
          <div className="schedule-toggle-row">
            <ArcoSwitch checked={draft.schedule.enabled} aria-label={isGroup ? "启用集团池周计划" : "启用周计划"} onChange={(checked: boolean) => set("schedule", { ...draft.schedule, enabled: checked })} />
            <span>{isGroup ? "启用集团池周计划" : "启用周计划"}</span>
            <span className="subtle-text">保存后启用</span>
          </div>
        </ArcoSpace> },
        { label: "最近同步", value: lastSyncText },
      ]} />

      <ArcoSpace size={8} className="rq-action-bar">
        <ArcoButton type="primary" htmlType="button" size="small" onClick={() => void save()} disabled={busy || loadState === "loading" || emptyAllowlist}>{isGroup ? (existing ? "保存集团池设置" : "创建集团池来源") : (existing ? "保存更新" : "创建来源")}</ArcoButton>
      </ArcoSpace>

      {emptyAllowlist && <ArcoAlert className="rq-inline-alert" type="warning" showIcon role="status" content="请至少填写 1 个执行人后再启用同步；名单为空时不能保存或启用。" />}
      {loadState === "ready" && <ConnectionSelfCheck existing={existing} draft={draft} pool={pool} />}
      {!existing && loadState === "ready" && <ArcoEmpty className="rq-empty" description={<div className="rq-empty-copy"><strong>{isGroup ? "尚未配置集团池数据源" : "尚未配置数据源"}</strong><span>{isGroup ? "填写项目名称与执行人名单后创建；名单为空时不能启用同步。" : "填写项目名称并创建后，可手动同步；周计划启用后按设定执行。"}</span></div>} />}
    </ArcoCard>
  </section>;
}


/** 数据源页的多维表格收集表只读卡片：来源地址、同步规则、最近一次同步（PRD §4.11）。 */
function BaseFormReadonlyPanel() {
  const [baseForm, setBaseForm] = useState<OpsMetrics["baseForm"]>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const shareUrlRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    let cancelled = false;
    // 进入页面只读一次，不轮询；失败只降级本卡片。
    void getOpsMetrics().then((metrics) => { if (!cancelled) setBaseForm(metrics.baseForm ?? null); }).catch(() => { if (!cancelled) setBaseForm(null); });
    return () => { cancelled = true; };
  }, []);
  const shareUrl = baseForm?.shareUrl ?? null;
  const copyShareUrl = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true); setCopyError(null);
      ArcoMessage.success("已复制收集表链接");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板不可用：选中只读文本，供手动复制（PRD §4.11.2）。
      const node = shareUrlRef.current;
      if (node) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      setCopyError("复制失败，已选中链接，请手动复制。");
    }
  };
  const stats = baseForm;
  // 0 是有效值不隐藏；关键字段缺失时才整体降级（PRD DS3）。
  const statsAvailable = Boolean(stats)
    && typeof stats?.scanned === "number"
    && typeof stats?.created === "number"
    && typeof stats?.rejected === "number"
    && typeof stats?.writeBackFailed === "number"
    && typeof stats?.readFailed === "boolean";
  const lastError = sanitizeBaseFormError(stats?.lastError ?? null);
  return <ArcoCard bordered={false} className="rq-card baseform-card" title={<h3 id="baseform-source-heading">多维表格需求收集表</h3>} extra={<ArcoSpace size={8}>
    <ArcoTag color="orange" bordered={false}>同步已暂停</ArcoTag>
    <ArcoTag color="gray" bordered={false}>只读</ArcoTag>
  </ArcoSpace>}>
    <ArcoTypography.Paragraph type="secondary">销售、售后等通过飞书收集表提交需求。收集表同步已暂停，本页保留来源地址与暂停前的同步记录，只读。</ArcoTypography.Paragraph>
    <div className="baseform-readonly-grid">
      {shareUrl ? <div className="baseform-block">
        <h3>来源地址</h3>
        <code className="baseform-share-url" ref={shareUrlRef}>{shareUrl}</code>
        <div className="baseform-share-actions">
          <ArcoButton type="secondary" size="small" htmlType="button" onClick={() => void copyShareUrl()}>{copied ? "已复制" : "复制链接"}</ArcoButton>
          <span className="subtle-text">需使用公司飞书登录（仅本租户可访问）。</span>
        </div>
        {copyError ? <ArcoAlert className="rq-inline-alert" type="error" showIcon role="alert" content={copyError} /> : null}
      </div> : null}
      <div className="baseform-block">
        <h3>同步规则</h3>
        <ArcoTypography.Paragraph type="secondary" className="baseform-rule-text">同步已暂停：平台自动化已停止读取收集表，暂停期间新提交不会进入需求池。暂停前的规则为每 30 分钟读取一次（Asia/Shanghai），实际投递时间可能有偏移；恢复后扫描到新行会依次校验、收录、回写「已收录 + 系统需求 ID」、AI 分析、推送 PM 数据表。已收录的行不再重复处理；提交不等于立即进池。</ArcoTypography.Paragraph>
      </div>
      <div className="baseform-block">
        <h3>最近一次同步（暂停前的历史值）</h3>
        {stats && statsAvailable ? (
          <ArcoDescriptions
            size="small"
            column={{ xs: 1, sm: 2, md: 3 }}
            data={[
              { label: "最后运行", value: stats.lastRunAt ? formatDateTime(stats.lastRunAt) ?? stats.lastRunAt : "尚未运行" },
              { label: "扫描", value: `${stats.scanned} 行` },
              { label: "新建", value: String(stats.created) },
              { label: "校验失败", value: String(stats.rejected) },
              { label: "写回失败", value: String(stats.writeBackFailed) },
              { label: "读取失败", value: stats.readFailed ? <ArcoTag size="small" color="red">是</ArcoTag> : "否" },
              ...(lastError ? [{ label: "最后错误", value: lastError }] : []),
            ]}
          />
        ) : <p className="detail-note">同步统计暂不可用</p>}
      </div>
    </div>
  </ArcoCard>;
}

/** 数据源页最下方的飞书 Base 地址卡片：两个池的 Base 承载需求推送与消息通知，只读展示。 */
function BaseLinksPanel() {
  const [links, setLinks] = useState<BaseLinks | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    // 接口未就位或读取失败时只降级本卡片，不影响上面的来源配置。
    void getBaseLinks()
      .then((value) => { if (!cancelled) setLinks(value); })
      .catch(() => { if (!cancelled) { setLinks({ product: null, group: null }); setUnavailable(true); } });
    return () => { cancelled = true; };
  }, []);
  const copy = async (key: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(key); setCopyError(null);
      ArcoMessage.success("已复制 Base 地址");
      window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 2000);
    } catch { setCopyError("复制失败，请手动选中链接复制。"); }
  };
  const rows: Array<{ key: string; label: string; copyLabel: string; url: string | null }> = [
    { key: "product", label: "需求池 Base", copyLabel: "复制需求池 Base 地址", url: links?.product?.url?.trim() || null },
    { key: "group", label: "集团需求池 Base", copyLabel: "复制集团需求池 Base 地址", url: links?.group?.url?.trim() || null },
  ];
  return <ArcoCard bordered={false} className="rq-card base-links-card" title={<ArcoTypography.Title heading={5} style={{ margin: 0 }}>飞书 Base 地址</ArcoTypography.Title>}>
    <ArcoTypography.Paragraph type="secondary">这两个 Base 承载需求推送与飞书消息通知，仅在应用内展示，不可编辑。</ArcoTypography.Paragraph>
    <div className="base-link-list">
      {rows.map((row) => {
        const safeUrl = safeHttpUrl(row.url);
        return <div className="base-link-row" key={row.key}>
          <ArcoTypography.Text className="base-link-label">{row.label}</ArcoTypography.Text>
          {safeUrl
            ? <>
                <a className="base-link-url" href={safeUrl} target="_blank" rel="noreferrer">{safeUrl}</a>
                <ArcoButton type="secondary" size="small" htmlType="button" aria-label={row.copyLabel} onClick={() => void copy(row.key, safeUrl)}>{copied === row.key ? "已复制" : "复制"}</ArcoButton>
              </>
            : <span className="subtle-text">{links === null ? "读取中…" : unavailable ? "暂不可用" : "未配置"}</span>}
        </div>;
      })}
    </div>
    {copyError ? <ArcoAlert className="rq-inline-alert" type="error" showIcon role="alert" content={copyError} /> : null}
  </ArcoCard>;
}

/** PRD §4.11.4：lastError 只展示归一化摘要；前端兜底掩码，仍不安全时给统一文案。 */
function sanitizeBaseFormError(value: string | null): string | null {
  if (!value) return null;
  const masked = value
    .replace(/\brec[A-Za-z0-9]{6,}\b/g, "rec…")
    .replace(/\btbl[A-Za-z0-9]{6,}\b/g, "tbl…")
    .replace(/\bfld[A-Za-z0-9]{6,}\b/g, "fld…")
    .replace(/https?:\/\/\S+/gi, "链接已隐藏")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "…")
    .slice(0, 200);
  if (/\brec[A-Za-z0-9]{6,}|\btbl[A-Za-z0-9]{6,}|\bfld[A-Za-z0-9]{6,}|https?:\/\//i.test(masked)) return "同步失败，请到作业运维查看";
  return masked;
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
  const searchRequestVersion = useRef(0);

  const search = useCallback(async (text: string) => {
    const clean = text.trim();
    if (clean.length < 2) { setError("请输入至少 2 个字符再搜索。"); return; }
    const version = ++searchRequestVersion.current;
    setSearching(true); setError(null);
    try {
      const items = await searchFeishuUsers(clean);
      if (version !== searchRequestVersion.current) return;
      setCandidates(items);
      setSelectedId(items[0]?.openId ?? "");
    } catch (cause) {
      if (version !== searchRequestVersion.current) return;
      setCandidates([]); setSelectedId("");
      setError(cause instanceof ApiError ? errorText(cause) : "无法搜索飞书通讯录，请稍后重试。");
    } finally {
      if (version === searchRequestVersion.current) setSearching(false);
    }
  }, []);
  // 打开编辑器就用人员姓名搜一次：多数情况姓名即飞书姓名，少打一次字。
  useEffect(() => {
    void search(personName);
    return () => { searchRequestVersion.current += 1; };
  }, [personName, search]);

  const selected = candidates.find((candidate) => candidate.openId === selectedId) ?? null;
  const save = async () => {
    if (!selected) return;
    setSaving(true); setError(null);
    // 正式 Base 人员字段需要 user_id；search 返回 user_id 时优先使用，缺失才回落 open_id（本地 POC）。
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

  const load = useCallback(async () => {
    const version = ++loadRequestVersion.current;
    setLoadState("loading");
    try {
      const rows = await listTeamPeople();
      if (version !== loadRequestVersion.current) return;
      setPeople(rows); setLoadError(null); setLoadState("ready");
    } catch (cause) {
      if (version !== loadRequestVersion.current) return;
      setLoadError(errorText(cause)); setLoadState("error");
    }
  }, []);
  useEffect(() => {
    void load();
    return () => { loadRequestVersion.current += 1; };
  }, [load]);

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
        <ArcoButton htmlType="button" onClick={() => void load()} disabled={busy} type="secondary" size="small"><RefreshCw size={14} />刷新</ArcoButton>
      </div>
      <StateBanner loadError={loadError} notice={notice} onCloseNotice={() => setNotice(null)} />
      {loadState === "loading" && !people.length ? <SkeletonTableRows rows={4} columns={3} /> : <ArcoTable<TeamPerson>
        rowKey="name"
        data={people}
        pagination={false}
        border={false}
        noDataElement={<ArcoEmpty className="rq-empty" description={<div className="rq-empty-copy"><strong>{loadError ? "人员读取失败" : "暂无人员"}</strong><span>{loadError ? "检查 API 连接后刷新。" : "填写姓名并新增；数据源配置完成后可维护组内名单并绑定飞书账号。"}</span></div>} />}
        columns={[
          { title: "人员", dataIndex: "name", width: 200, render: (_value, person) => editing === person.name ? <ArcoInput aria-label="编辑人员姓名" value={editDraft} onChange={(value: string) => setEditDraft(value)} /> : person.name },
          { title: "飞书账号", dataIndex: "feishuUserId", render: (_value, person) => bindingName === person.name
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
          { title: "操作", width: 280, render: (_value, person) => editing === person.name
              ? <ArcoSpace size={8}><ArcoButton htmlType="button" onClick={() => void submit(() => renameTeamPerson(person.name, editDraft), "人员及模块责任关系已更新。")} disabled={busy || !editDraft.trim()} type="primary" size="small">保存</ArcoButton><ArcoButton htmlType="button" onClick={() => setEditing(null)} disabled={busy} type="secondary" size="small">取消</ArcoButton></ArcoSpace>
              : <ArcoSpace size={8}><ArcoButton htmlType="button" onClick={() => { setEditing(person.name); setEditDraft(person.name); setBindingName(null); }} disabled={busy} type="secondary" size="small">编辑</ArcoButton>{(person.feishuUserId || person.bindingConflict) && <DeleteConfirmation disabled={busy} triggerLabel="解除绑定" heading="解除飞书绑定" confirmLabel="确认解除" description={`解除「${person.name}」的飞书账号绑定？该人员名下需求的负责人映射将被清除，后续推送会停在待匹配负责人；已推送的 Base 记录不会被清除。`} onConfirm={() => void unbindFeishu(person.name)} />}<DeleteConfirmation disabled={busy} description={`删除人员“${person.name}”？相关功能模块将变为未分配，飞书账号绑定同时解除。`} onConfirm={() => void submit(() => deleteTeamPerson(person.name), "人员已删除，相关模块已解除分配。")} /></ArcoSpace> },
        ]}
      />}
    </ArcoCard>
  );
}

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
    const version = ++loadRequestVersion.current;
    setLoadState("loading");
    try {
      const [directory, roster] = await Promise.all([getFunctionModules(), listTeamPeople()]);
      if (version !== loadRequestVersion.current) return;
      setVersion(directory.version); setItems(directory.items); setPeople(roster); setLoadError(null); setLoadState("ready");
    } catch (cause) {
      if (version !== loadRequestVersion.current) return;
      setLoadError(errorText(cause)); setLoadState("error");
    }
    if (version === loadRequestVersion.current) await loadVersions();
  }, [loadVersions]);
  useEffect(() => {
    void load();
    return () => { loadRequestVersion.current += 1; };
  }, [load]);

  const save = async (next: FunctionModuleEntry[], resetAddForm = false) => {
    setBusy(true); setLoadError(null); setNotice(null);
    try {
      const result = await saveFunctionModules(version, next);
      setVersion(result.version); setItems(result.items); setEditing(null); setEditName(""); setEditPerson(""); setFormError(null);
      if (resetAddForm) { setName(""); setPersonName(""); }
      setNotice(`已发布模块字典 v${result.version}，后续 AI 分析将使用新版本。`);
      await loadVersions();
    } catch (cause) {
      setLoadError(errorText(cause));
      if (cause instanceof ApiError && cause.status === 409) void load();
    } finally { setBusy(false); }
  };
  const submitEdit = () => {
    setFormError(null);
    const clean = editName.trim();
    if (!clean) { setFormError("请填写功能模块名称。"); return; }
    if (items.some((candidate) => candidate.name.toLocaleLowerCase() === clean.toLocaleLowerCase() && candidate.name !== editing)) { setFormError("功能模块名称不能重复。"); return; }
    void save(items.map((candidate) => candidate.name === editing ? { name: clean, personName: editPerson || null } : candidate));
  };
  const submit = () => {
    setFormError(null);
    const clean = name.trim();
    if (!clean) { setFormError("请填写功能模块名称。"); return; }
    if (items.some((item) => item.name.toLocaleLowerCase() === clean.toLocaleLowerCase())) { setFormError("功能模块名称不能重复。"); return; }
    void save([...items, { name: clean, personName: personName || null }], true);
  };

  return (
    <div className="modules-stack">
      <ArcoCard bordered={false} className="rq-card requirements-panel">
        <div className="req-action-row">
          <ArcoForm layout="inline" className="rq-compact-form">
            <ArcoForm.Item label="功能模块" style={{ marginBottom: 0 }}>
              <ArcoInput aria-label="功能模块名称" placeholder="输入功能模块名称…" value={name} onChange={(value: string) => setName(value)} />
            </ArcoForm.Item>
            <ArcoForm.Item label="人员" style={{ marginBottom: 0 }}>
              <ArcoSelect aria-label="模块责任人员" value={personName} onChange={(value: string) => setPersonName(value)} style={{ minWidth: 150 }} options={[{ label: "未分配", value: "" }, ...people.filter((person) => person.name).map((person) => ({ label: person.name!, value: person.name! }))]} />
            </ArcoForm.Item>
            <ArcoForm.Item style={{ marginBottom: 0 }}>
              <ArcoButton htmlType="button" onClick={submit} disabled={busy} type="primary" size="small">新增模块</ArcoButton>
            </ArcoForm.Item>
          </ArcoForm>
          <ArcoButton htmlType="button" onClick={() => void load()} disabled={busy} type="secondary" size="small"><RefreshCw size={14} />刷新</ArcoButton>
        </div>
        <StateBanner loadError={loadError} notice={notice} onCloseNotice={() => setNotice(null)} />
        {formError && <ArcoAlert className="rq-inline-alert" type="error" showIcon role="alert" content={formError} />}
        {loadState === "loading" && !items.length ? <SkeletonTableRows rows={4} columns={3} /> : <div tabIndex={0} role="region" aria-label="功能模块列表"><ArcoTable<FunctionModuleEntry>
          rowKey="name"
          data={items}
          pagination={false}
          border={false}
          noDataElement={<ArcoEmpty className="rq-empty" description={<div className="rq-empty-copy"><strong>{loadError ? "模块字典读取失败" : "暂无功能模块"}</strong><span>{loadError ? "检查 API 连接后刷新。" : "新增模块后，AI 分析会使用最新的已发布字典。"}</span></div>} />}
          rowClassName={(item: FunctionModuleEntry) => editing === item.name ? "module-row is-editing" : "module-row"}
          columns={[
            { title: "功能模块", dataIndex: "name", render: (_value, item) => editing === item.name ? <ArcoInput className="inline-input" aria-label="编辑功能模块名称" value={editName} onChange={(value: string) => setEditName(value)} autoFocus /> : item.name },
            { title: "人员", dataIndex: "personName", width: 220, render: (_value, item) => editing === item.name ? <ArcoSelect className="inline-input" aria-label="编辑模块责任人员" value={editPerson} onChange={(value: string) => setEditPerson(value)} style={{ minWidth: 150 }} options={[{ label: "未分配", value: "" }, ...people.filter((person) => person.name).map((person) => ({ label: person.name!, value: person.name! }))]} /> : (item.personName ?? "未分配") },
            { title: "操作", width: 200, render: (_value, item) => editing === item.name
                ? <ArcoSpace size={8}><ArcoButton htmlType="button" onClick={submitEdit} disabled={busy} type="primary" size="small">保存</ArcoButton><ArcoButton htmlType="button" onClick={() => { setEditing(null); setEditName(""); setEditPerson(""); }} disabled={busy} type="secondary" size="small">取消</ArcoButton></ArcoSpace>
                : <ArcoSpace size={8}><ArcoButton htmlType="button" onClick={() => beginEdit(item)} disabled={busy} type="secondary" size="small">编辑</ArcoButton><DeleteConfirmation disabled={busy || items.length === 1} description={`删除功能模块“${item.name}”？`} onConfirm={() => void save(items.filter((candidate) => candidate.name !== item.name))} /></ArcoSpace> },
          ]}
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
          columns={[
            { title: "版本", dataIndex: "version", width: 90, render: (_value, d) => <span className="mono-cell">v{d.version}</span> },
            { title: "状态", dataIndex: "status", width: 110, render: (_value, d) => <PublishStatusChip status={d.status} /> },
            { title: "模块", dataIndex: "entries", width: 300, render: (_value, d) => d.entries.map((entry) => typeof entry === "string" ? entry : `${entry.name}（${entry.personName ?? "未分配"}）`).join("、") },
            { title: "创建时间", dataIndex: "createdAt", width: 180, render: (_value, d) => timeLabel(d.createdAt) },
            { title: "发布时间", dataIndex: "publishedAt", width: 180, render: (_value, d) => d.publishedAt ? timeLabel(d.publishedAt) : "—" },
          ]}
        />
      </ArcoCard>
    </div>
  );
}

// ---------- 工单 16/17：同步批次（status 筛选 + 游标分页 + 详情 + 失败项重试） ----------

export function BatchesPanel({ onRefresh, pool = "product" }: { onRefresh: () => void; pool?: RequirementPool }) {
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
  // 已生效筛选：加载更多必须沿用「点过筛选」的条件，而不是用户正在编辑的下拉值，
  // 否则会拿旧游标配新条件，翻页结果错位（与需求池的 appliedFiltersRef 同一规则）。
  const appliedFiltersRef = useRef({ status: "", since: "", until: "" });
  const listRequestVersion = useRef(0);
  const detailRequestVersion = useRef(0);

  const load = useCallback(async (filter: { status: string; since: string; until: string }, nextCursor: string | null) => {
    appliedFiltersRef.current = filter;
    const version = ++listRequestVersion.current;
    setLoadState("loading"); setLoadError(null);
    try {
      const page = await listBatches({ status: filter.status || undefined, since: filter.since ? new Date(filter.since).toISOString() : undefined, until: filter.until ? new Date(filter.until).toISOString() : undefined, pool: pool === "group" ? ("group" as const) : undefined, limit: 10, ...(nextCursor ? { cursor: nextCursor } : {}) });
      if (version !== listRequestVersion.current) return;
      setBatches((prev) => nextCursor ? [...prev, ...page.items] : page.items);
      setCursor(page.nextCursor);
      setLoadState("ready");
    } catch (cause) {
      if (version !== listRequestVersion.current) return;
      if (!nextCursor) { setBatches([]); setCursor(null); }
      setLoadError(errorText(cause)); setLoadState("error");
    }
  }, [pool]);
  useEffect(() => {
    void load({ status: "", since: "", until: "" }, null);
    return () => { listRequestVersion.current += 1; detailRequestVersion.current += 1; };
  }, [load]);

  const open = async (id: string) => {
    const version = ++detailRequestVersion.current;
    setOpenBatch(null); setDetailError(null); setNotice(null);
    try {
      const detail = await getBatch(id);
      if (version !== detailRequestVersion.current) return;
      setOpenBatch(detail);
    } catch (cause) {
      if (version !== detailRequestVersion.current) return;
      setDetailError(errorText(cause));
    }
  };
  const retryItem = async (item: BatchDetail["items"][number]) => {
    setBusy(true); setNotice(null);
    try {
      const key = retryKeys.current.get(item.id) ?? crypto.randomUUID();
      retryKeys.current.set(item.id, key);
      const result = await retrySyncItem(item.id, undefined, key);
      retryKeys.current.delete(item.id);
      onRefresh(); setNotice(`失败项已重新入队：批次 ${result.batchId}`);
      if (openBatch) {
        // 入队与刷新分开反馈：刷新失败不能覆盖“已入队”的成功结果。
        try { setOpenBatch(await getBatch(openBatch.id)); } catch { /* keep the previous detail */ }
      }
    } catch (cause) { setNotice(errorText(cause)); }
    finally { setBusy(false); }
  };

  return (
    <ArcoCard
      bordered={false}
      className="rq-card requirements-panel"
      title={
        <div className="rq-card-title">
          <h2>同步批次历史</h2>
          <ArcoTypography.Text type="secondary" className="rq-card-subtitle">触发者、批次时间与逐条结果由 API 提供；点击批次查看明细。</ArcoTypography.Text>
        </div>
      }
    >
      <ArcoForm layout="inline" className="rq-compact-form">
        <ArcoForm.Item>
          <ArcoSelect aria-label="批次状态筛选" value={statusFilter} onChange={(value: string) => setStatusFilter(value)} style={{ minWidth: 120 }} options={[{ label: "全部状态", value: "" }, { label: "进行中", value: "running" }, { label: "已完成", value: "succeeded" }, { label: "部分失败", value: "partial_failure" }, { label: "失败", value: "failed" }]} />
        </ArcoForm.Item>
        <ArcoForm.Item label="开始时间">
          <input className="rq-datetime-input" type="datetime-local" aria-label="批次开始时间" value={since} onChange={(e) => setSince(e.target.value)} />
        </ArcoForm.Item>
        <ArcoForm.Item label="结束时间">
          <input className="rq-datetime-input" type="datetime-local" aria-label="批次结束时间" value={until} onChange={(e) => setUntil(e.target.value)} />
        </ArcoForm.Item>
        <ArcoForm.Item>
          <ArcoSpace size={8}>
            <ArcoButton htmlType="button" onClick={() => void load({ status: statusFilter, since, until }, null)} type="primary" size="small">筛选</ArcoButton>
            <ArcoButton htmlType="button" onClick={() => { onRefresh(); void load({ status: statusFilter, since, until }, null); }} type="secondary" size="small"><RefreshCw size={14} />刷新</ArcoButton>
          </ArcoSpace>
        </ArcoForm.Item>
      </ArcoForm>
      <StateBanner loadError={loadError ?? detailError} notice={notice} onCloseNotice={() => setNotice(null)} />
      {openBatch && (
        <ArcoCard
          size="small"
          className="rq-subcard"
          style={{ marginBottom: 16 }}
          title={<strong>批次 {openBatch.id}</strong>}
          extra={<ArcoButton htmlType="button" onClick={() => setOpenBatch(null)} type="secondary" size="small">收起</ArcoButton>}
        >
          <ArcoSpace size={8} wrap style={{ marginBottom: 12 }}>
            {stateChip(openBatch.status)}
            {poolChip(openBatch.pool)}
            <ArcoTypography.Text type="secondary">
              总数 {openBatch.totalCount} · 成功 {openBatch.succeededCount} · 失败 {openBatch.failedCount}{(openBatch.pool === "group" || (pool === "group" && openBatch.pool === undefined)) && openBatch.filteredCount !== undefined ? ` · 名单外跳过 ${openBatch.filteredCount}` : ""}{openBatch.errorSummary ? ` · ${openBatch.errorSummary}` : ""}
            </ArcoTypography.Text>
          </ArcoSpace>
          <ArcoTable<BatchDetail["items"][number]> scroll={{ x: 960 }}
            rowKey="id"
            data={openBatch.items}
            pagination={false}
            border={false}
            columns={[
              { title: "源需求 ID", dataIndex: "teambitionRequirementId", render: (_value, item) => <span className="mono-cell">{item.teambitionRequirementId}</span> },
              { title: "动作", dataIndex: "action" },
              { title: "状态", dataIndex: "status", render: (_value, item) => <ArcoBadge status={item.status === "failed" ? "error" : "success"} text={item.status === "failed" ? "失败" : "成功"} /> },
              { title: "错误", dataIndex: "errorCode", render: (_value, item) => item.errorCode ?? "—" },
              { title: "操作", render: (_value, item) => item.status === "failed" && <ArcoButton htmlType="button" onClick={() => void retryItem(item)} disabled={busy} type="secondary" size="small">重试</ArcoButton> },
            ]}
          />
        </ArcoCard>
      )}
      {loadState === "loading" && !batches.length ? <SkeletonTableRows rows={5} columns={4} /> : <>
        <ArcoTable<BatchSummary> scroll={{ x: 960 }}
          rowKey="id"
          data={batches}
          pagination={false}
          border={false}
          noDataElement={<ArcoEmpty className="rq-empty" description={<div className="rq-empty-copy"><strong>还没有同步批次</strong><span>启动手动同步后，真实批次记录会显示在这里。</span></div>} />}
          columns={[
            { title: "批次 ID", dataIndex: "id", render: (_value, batch) => <span className="mono-cell">{batch.id}</span> },
            { title: "池", dataIndex: "pool", width: 90, render: (_value, batch) => poolChip(batch.pool) },
            { title: "状态", dataIndex: "status", render: (_value, batch) => stateChip(batch.status) },
            { title: "触发", dataIndex: "triggerType", render: (_value, batch) => triggerLabel(batch) },
            { title: "需求总数", dataIndex: "totalCount" },
            { title: "成功", dataIndex: "succeededCount" },
            { title: "失败", dataIndex: "failedCount", render: (_value, batch) => <span className={batch.failedCount ? "text-danger" : ""}>{batch.failedCount}</span> },
            { title: "开始时间", dataIndex: "startedAt", render: (_value, batch) => timeLabel(batch.startedAt) },
            { title: "明细", render: (_value, batch) => <ArcoButton htmlType="button" onClick={() => void open(batch.id)} type="text" size="small">查看</ArcoButton> },
          ]}
        />
        {cursor && <div className="rq-action-bar"><ArcoButton htmlType="button" onClick={() => void load(appliedFiltersRef.current, cursor)} disabled={loadState === "loading"} type="secondary" size="small">加载更多</ArcoButton></div>}
      </>}
    </ArcoCard>
  );
}

function triggerLabel(batch: { triggerType?: string; actorId?: string | null }): string {
  const mode = batch.triggerType === "scheduled" ? "周计划" : batch.triggerType === "manual" ? "手动" : (batch.triggerType ?? "—");
  return `${mode}${batch.actorId ? ` · ${batch.actorId.slice(0, 8)}` : ""}`;
}

function stateChip(status: string) {
  const color = status === "failed" ? "red" : status === "running" ? "arcoblue" : status === "partial_failure" ? "orange" : status === "succeeded" ? "green" : "gray";
  return <ArcoTag size="small" color={color}>{stateLabel(status)}</ArcoTag>;
}

/** 池标识：产品池/集团池共用同一视觉，只在需要区分池的地方出现。 */
function poolChip(pool?: RequirementPool) {
  const value = pool ?? "product";
  return <ArcoTag size="small" color={value === "group" ? "purple" : "arcoblue"}><span className="pool-chip">{value === "group" ? "集团池" : "产品池"}</span></ArcoTag>;
}

// ---------- 工单 17 / design.md 第 8–10 章：需求池列表 + 独立详情页 ----------

const ownerStateOptions = [["", "全部负责人状态"], ["pending_mapping", "待匹配"], ["auto_mapped", "已匹配"], ["manually_mapped", "手动匹配"], ["not_required", "无需匹配"]] as const;
// 优先级分诊（2026-11-06）：默认不筛选；sort=priority_asc 由服务端按生效优先级排序（P0→P3，单页最多 100 条）。
const priorityFilterOptions = [["", "全部优先级"], ["P0", "P0"], ["P1", "P1"], ["P2", "P2"], ["P3", "P3"]] as const;
const prioritySortOptions = [["", "默认排序"], ["priority_asc", "按优先级（P0 → P3）"]] as const;
const analysisStateOptions = [["", "全部分析状态"], ["analyzed", "已分析"], ["failed_retryable", "待重试"], ["pending", "等待中"], ["running", "进行中"]] as const;
const pullStateOptions = [["", "全部同步状态"], ["pending", "等待同步"], ["running", "同步中"], ["synced", "已同步"], ["failed", "同步失败"], ["collected", "已收录"]] as const;
// 5c-1 来源区分：来源是需求池的一等维度，用顶部 Tab 而不是下拉——筛选藏进下拉约等于没有。
// Teambition 是默认来源（332/333 都是它），所以默认来源不挂徽标、不加色条。
const SOURCE_TABS = [
  { value: "", label: "全部来源" },
  { value: "teambition", label: "Teambition" },
  { value: "base_form", label: "多维表格" },
  { value: "web_manual", label: "手工" },
  { value: "chat_paste", label: "聊天粘贴" },
] as const;

/** 来源筛选值 → source-counts 响应里的键；未知值不显示计数。 */
function sourceCountKey(value: string): keyof RequirementSourceCounts | null {
  return value === "" ? "all" : value === "teambition" || value === "web_manual" || value === "base_form" || value === "chat_paste" ? value : null;
}
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
  // V02-T08：可选新字段，旧分析缺失时为 undefined（展示“未提供”）。
  typeSuggestion?: unknown;
  audience?: unknown;
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

// ---------- P1 重复处理：处理闸口状态与判定展示 ----------

/** 旧响应没有 processingState 时按 active 处理，避免把普通需求误显示成压制态。 */
export function requirementProcessingState(requirement: Pick<RequirementSummary, "processingState">): RequirementProcessingState {
  return requirement.processingState ?? "active";
}

export const processingStateLabels: Record<RequirementProcessingState, string> = {
  active: "活跃",
  suppressed_duplicate: "已压制（重复）",
  suppressed_ignored: "已压制（忽略）",
};

/** 列表行角标：疑似重复提示 / 压制结果；普通活跃需求不加角标。 */
export function processingBadge(requirement: Pick<RequirementSummary, "processingState" | "resolution">): { label: string; className: string; title: string } | null {
  const state = requirementProcessingState(requirement);
  const resolution: RequirementResolution | null = requirement.resolution ?? null;
  const canonical = resolution?.canonicalPlatformRequirementId ?? resolution?.canonicalRequirementId ?? null;
  if (state === "suppressed_duplicate") {
    return { label: "已压制（重复）", className: "status-danger", title: `已压制：不再进入 AI 分析/Base 推送/通知${canonical ? `；主记录 ${canonical}` : ""}${resolution?.reason ? `；理由：${resolution.reason}` : ""}` };
  }
  if (state === "suppressed_ignored") {
    return { label: "已压制（忽略）", className: "status-muted", title: `已压制：不再进入 AI 分析/Base 推送/通知${resolution?.reason ? `；理由：${resolution.reason}` : ""}` };
  }
  if (resolution?.reviewState === "suspected") {
    return { label: "疑似重复", className: "status-warning", title: `系统提示标题相同，仅作疑似重复提示；${canonical ? `疑似主记录 ${canonical}；` : ""}尚未人工确认` };
  }
  if (resolution?.reviewState === "confirmed") {
    return { label: "已确认非重复", className: "status-muted", title: `已人工确认为非重复${resolution.reason ? `；理由：${resolution.reason}` : ""}` };
  }
  return null;
}

/** 需求池顶部视图切换值；`all` 只在 UI/URL 层使用，请求时省略参数。 */
const PROCESSING_VIEWS: Array<{ value: RequirementProcessingView; label: string }> = [
  { value: "all", label: "全部" },
  { value: "active", label: "仅活跃" },
  { value: "suppressed", label: "已压制重复" },
];

function pipelineTagColor(state: string): string {
  if (state === "failed") return "red";
  if (state === "failed_retryable" || state === "pending_mapping") return "orange";
  if (state === "running") return "arcoblue";
  if (["synced", "analyzed", "pushed", "manually_mapped", "auto_mapped", "not_required"].includes(state)) return "green";
  return "gray";
}

// 中文文案 + 语义色；原始枚举留在 title / Tooltip 上，符合 design.md。
function StageBadge({ stage, state }: { stage: PipelineStage; state: string }) {
  const tip = `${pipelineStageNames[stage]}：${pipelineLabel(stage, state)}（${state}）`;
  return (
    <ArcoTooltip content={tip}>
      <ArcoTag className="req-badge" color={pipelineTagColor(state)} size="small" title={tip}>
        {pipelineLabel(stage, state)}
      </ArcoTag>
    </ArcoTooltip>
  );
}

type RequirementFieldSource = "teambition" | "web_manual" | "base_form" | "chat_paste";

/**
 * 字段来源标签：只有 Teambition 挂「TB」徽标。
 * 非 TB 来源不再挂来源徽标——区块右上角与底部「这条需求怎么来的」已经说明来源，
 * 再显示「多维表格 标题」既重复又占宽。
 */
function TbFieldLabel({ children, kind = "teambition" }: { children: ReactNode; kind?: RequirementFieldSource }) {
  return <span className="req-field-label">{kind === "teambition" ? <ArcoTag size="small" color="arcoblue" className="tb-badge" title="来自 Teambition 的原始字段">TB</ArcoTag> : null}{children}</span>;
}

function OwnerBadge({ owner }: { owner: ReturnType<typeof requirementOwnerView> }) {
  return <span className={`req-owner${owner.unassigned ? " is-unassigned" : ""}${owner.notRequired ? " is-not-required" : ""}`} title={owner.title}>
    <span className="req-avatar" aria-hidden="true">{owner.initial}</span>
    <span>{owner.label}</span>
  </span>;
}

function SourceValue({ value, href, emptyHint = "Teambition 未提供该字段" }: { value: string | null; href?: boolean; emptyHint?: string }) {
  if (!value) return <span className="req-empty-value" title={emptyHint}>—</span>;
  if (href) {
    const safeUrl = safeHttpUrl(value);
    if (safeUrl) return <a className="req-source-link" href={safeUrl} target="_blank" rel="noreferrer">{safeUrl}</a>;
  }
  return <span>{value}</span>;
}

function TextList({ items, prefix }: { items: string[]; prefix?: string }) {
  if (!items.length) return <span className="req-empty-value">—</span>;
  return <ul className="req-evidence-list">{items.map((item, index) => <li key={`${index}-${item}`}>{prefix ?? ""}{item}</li>)}</ul>;
}

function requirementListQuery(filter: RequirementListFilters, pool: RequirementPool = "product") {
  const toIso = (value: string): string | undefined => {
    if (!value) return undefined;
    const time = new Date(value);
    return Number.isNaN(time.getTime()) ? undefined : time.toISOString();
  };
  return {
    // 产品池是服务端默认：不序列化 pool，保持既有请求 URL 不变。
    pool: pool === "group" ? ("group" as const) : undefined,
    q: filter.title || undefined,
    executorName: filter.owner || undefined,
    pullState: filter.pull || undefined,
    analysisState: filter.analysis || undefined,
    ownerState: filter.ownerState || undefined,
    pushState: filter.push || undefined,
    processingState: filter.processingState === "all" ? undefined : filter.processingState,
    priority: (filter.priority || undefined) as "P0" | "P1" | "P2" | "P3" | undefined,
    // 集团池没有来源 Tab，也不接受来源筛选（数据只有 TB 一个来源）。
    source: pool === "group" ? undefined : (filter.source || undefined) as "teambition" | "web_manual" | "base_form" | "chat_paste" | undefined,
    sort: filter.sort === "priority_asc" ? ("priority_asc" as const) : undefined,
    batchId: filter.batchId || undefined,
    since: toIso(filter.from),
    until: toIso(filter.to),
  };
}

export function RequirementsPanel({ onRefresh, initialRequirementId, scope = "product", onGroupCountChange, mine = false, onRequirementChanged }: { onRefresh: () => void; initialRequirementId?: string | null; scope?: RequirementPool; onGroupCountChange?: (count: number | null) => void; /** PRD §4.13：我的需求模式：服务端按当前身份过滤，隐藏来源 Tab/高级筛选/新建入口。 */ mine?: boolean; /** 删除/还原后通知外层刷新计数。 */ onRequirementChanged?: () => void }) {
  const isGroup = scope === "group";
  // 集团池没有来源维度：即使 URL 带了 source（从产品池复制/手改地址），也不把它带进请求。
  // 我的需求页按 PRD 省略 processingState（返回 active + suppressed），不沿用需求池默认的「仅活跃」。
  const [initialFilters] = useState(() => {
    const parsed = readRequirementListFilters(window.location.search);
    if (mine) return { ...emptyRequirementListFilters, processingState: "all" as RequirementProcessingView };
    return scope === "group" ? { ...parsed, source: "" } : parsed;
  });
  // 页头条数回填用 ref：父组件传内联回调时不应触发计数请求重跑。
  const onGroupCountChangeRef = useRef(onGroupCountChange);
  useEffect(() => { onGroupCountChangeRef.current = onGroupCountChange; }, [onGroupCountChange]);
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
  // 重复处理视图：all=全部 / active=仅活跃（默认）/ suppressed=已压制（重复或忽略）。
  const [processingState, setProcessingState] = useState(initialFilters.processingState);
  const [priorityFilter, setPriorityFilter] = useState(initialFilters.priority);
  const [sourceFilter, setSourceFilter] = useState(initialFilters.source);
  // 5c-1：来源 Tab 计数。接口不可用时保持 null → 只显示 Tab 文字，不显示假数字。
  const [sourceCounts, setSourceCounts] = useState<RequirementSourceCounts | null>(null);
  const [prioritySort, setPrioritySort] = useState(initialFilters.sort);
  const [batchId, setBatchId] = useState(initialFilters.batchId);
  const [since, setSince] = useState(initialFilters.from);
  const [until, setUntil] = useState(initialFilters.to);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(initialDetailId);
  const [selected, setSelected] = useState<RequirementDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(Boolean(initialDetailId));
  const detailRequestVersion = useRef(0);
  // 列表请求序号：筛选快速切换时丢弃过期响应，避免旧结果覆盖新筛选。
  const listRequestVersion = useRef(0);
  // 列表滚动位置：进入详情时记下，返回列表后恢复（design.md 8.1）。
  const listScrollTop = useRef(0);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [autoOpenOwnerPicker, setAutoOpenOwnerPicker] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // PRD §4.13：单条删除的确认弹窗（回收站与列表共用同一实现）。
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);

  // ARCO-05：更多筛选的展开状态（交由 Arco Popover 管理，补充 document click / Escape 关闭以兼容键盘与单测）。
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  useEffect(() => {
    if (!moreFiltersOpen) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setMoreFiltersOpen(false);
    };
    const onClick = (event: globalThis.MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("#requirement-more-filters") || target.closest(".qmore-popover-trigger") || target.closest(".arco-select-popup")) return;
      setMoreFiltersOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("click", onClick);
    };
  }, [moreFiltersOpen]);
  const filters: RequirementListFilters = { title: query.trim(), owner: executorName, pull: pullState, analysis: analysisState, ownerState, push: pushState, processingState, priority: priorityFilter, source: sourceFilter, sort: prioritySort, batchId: batchId.trim(), from: since, to: until };
  // 已生效筛选：列表行/详情 URL 与刷新必须以「点过筛选」的条件为准，
  // 不能把用户尚未应用的草稿输入写进 URL。
  const appliedFiltersRef = useRef(initialFilters);
  const activeFilterCount = requirementFilterCount(filters);
  // 已生效 = 上一次真正发给服务端的条件；草稿输入不算，否则还没点筛选就显示"已生效"。
  const [appliedFilterCount, setAppliedFilterCount] = useState(0);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const dateFilterCount = [since, until].filter(Boolean).length;
  // 「更多筛选」角标只统计浮层里的条件：来源已经移到顶部 Tab，不再计入。
  const moreFilterCount = [priorityFilter, prioritySort, ownerState, analysisState, pushState, batchId.trim(), since, until].filter(Boolean).length;

  const load = useCallback(async (filter: RequirementListFilters, nextCursor: string | null) => {
    appliedFiltersRef.current = filter;
    const version = ++listRequestVersion.current;
    setLoadState("loading"); setLoadError(null);
    try {
      // 分诊视图（priority_asc）按优先级排序且不分页：单页最多 100 条，避免游标与排序不一致。
      const priorityMode = !mine && filter.sort === "priority_asc";
      const page = mine
        ? await listMyRequirements({ pool: scope, limit: 25, ...(nextCursor ? { cursor: nextCursor } : {}) })
        : await listRequirements({ ...requirementListQuery(filter, scope), limit: priorityMode ? 100 : 25, ...(!priorityMode && nextCursor ? { cursor: nextCursor } : {}) });
      if (version !== listRequestVersion.current) return;
      setRows((prev) => nextCursor ? [...prev, ...page.items] : page.items);
      setCursor(page.nextCursor);
      setLoadState("ready");
    } catch (cause) {
      if (version !== listRequestVersion.current) return;
      // 首屏/筛选请求失败时不能继续展示上一批结果：否则用户会把旧行当成新筛选的结果。
      if (!nextCursor) { setRows([]); setCursor(null); }
      setLoadError(errorText(cause)); setLoadState("error");
    }
  }, [scope, mine]);

  // 来源计数只影响 Tab 上的数字：接口失败/未部署时静默降级，不打断列表。
  // 集团池只取 all 作为页头条数，不渲染五个来源 Tab。
  const loadSourceCounts = useCallback(() => {
    void getRequirementSourceCounts({ pool: scope === "group" ? "group" : undefined }).then((counts) => {
      setSourceCounts(counts);
      if (isGroup) onGroupCountChangeRef.current?.(counts?.all ?? null);
    });
  }, [scope, isGroup]);

  useEffect(() => {
    void load(initialFilters, null);
    if (mine) return;
    loadSourceCounts();
    void listTeamPeople().then(setPeople).catch((cause: unknown) => setPeopleError(errorText(cause)));
  }, [load, initialFilters, loadSourceCounts, mine]);

  const open = useCallback(async (id: string, options?: { push?: boolean; openOwnerPicker?: boolean; silent?: boolean }) => {
    if (options?.push) {
      listScrollTop.current = window.scrollY || document.documentElement.scrollTop || 0;
      window.history.pushState(null, "", mine ? myRequirementsUrl(window.location.pathname || "/", scope, id, "#my-requirements") : requirementPoolUrl(window.location.pathname || "/", appliedFiltersRef.current, id, window.location.hash));
    }
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    // 静默刷新（操作成功后）：保留当前详情内容，避免整块详情闪成骨架屏；只有首次打开才展示骨架。
    const silent = Boolean(options?.silent);
    setDetailId(id); if (!silent) { setSelected(null); setDetailLoading(true); } setDetailError(null); setNotice(null);
    setAutoOpenOwnerPicker(Boolean(options?.openOwnerPicker));
    const version = ++detailRequestVersion.current;
    try {
      const detail = await getRequirement(id);
      // 跨池守卫：详情接口按 UUID 返回所属池；与当前页面 scope 不符时按 404 展示，
      // 不渲染详情、不跳转、不探测其他池（服务端对显式带 pool 的跨池请求同样返回 404）。
      if (detail.pool && detail.pool !== scope) throw new ApiError(API_ERROR_TEXT.NOT_FOUND ?? "请求的资源不存在或已被删除。", 404, "NOT_FOUND");
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
          ...(detail.processingState === undefined ? {} : { processingState: detail.processingState }),
          ...(detail.resolution === undefined ? {} : { resolution: detail.resolution }),
        } : row));
        setDetailLoading(false);
      }
    } catch (cause) {
      if (version === detailRequestVersion.current) { setDetailError(errorText(cause)); setDetailLoading(false); }
    }
  }, [scope, mine]);

  // 同一页面实例切池（产品池 ↔ 集团池）时 React 会复用本组件：作废在途请求与上一池的列表行，
  // 详情对象保留、由渲染层按 detail.pool 判池（不符只显示 404），切回原池即可恢复，无需重新请求。
  const previousScope = useRef(scope);
  useEffect(() => {
    if (previousScope.current === scope) return;
    previousScope.current = scope;
    detailRequestVersion.current += 1;
    setRows([]); setCursor(null); setLoadState("loading");
    setAutoOpenOwnerPicker(false);
    // 深链分享链接跨池时会复用同一个面板实例：按新池重新打开该需求，而不是停在 404。
    if (initialDetailId) {
      setDetailError(null);
      void open(initialDetailId);
    } else if (!selected && detailId) {
      // 详情还在加载、没有池信息可判：保守显示 404，避免把在途请求的结果渲染到错误的池。
      setDetailLoading(false);
      setDetailError(API_ERROR_TEXT.NOT_FOUND ?? "请求的资源不存在或已被删除。");
    }
    setSourceCounts(null);
  }, [scope, detailId, selected, initialDetailId, open]);

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
      // 先局部刷新详情（保留内容），再让总览数据在后台静默更新；不整页重载。
      await open(detailKey, { silent: true });
      onRefresh();
      setNotice(message);
      return true;
    } catch (cause) { setNotice(errorText(cause)); return false; }
    finally { setBusy(false); }
  };

  // PRD §4.13：删除/还原。删除成功后从当前列表移除并通知外层刷新计数；详情打开时回到列表。
  const confirmDelete = async () => {
    if (!deleteTargetId) return;
    const targetId = deleteTargetId;
    setDeleteBusy(true); setActionError(null);
    try {
      await deleteRequirement(targetId);
      setRows((prev) => prev.filter((row) => row.id !== targetId));
      setDeleteTargetId(null);
      setNotice("已移入回收站");
      if (detailId === targetId) closeDetail();
      onRequirementChanged?.();
      onRefresh();
    } catch (cause) {
      setDeleteTargetId(null);
      setActionError(errorText(cause));
    } finally { setDeleteBusy(false); }
  };

  const restoreDeleted = async (id: string) => {
    setRestoreBusy(true); setActionError(null);
    try {
      await restoreRequirement(id);
      setNotice("已还原");
      onRequirementChanged?.();
      onRefresh();
      await open(id, { silent: true });
    } catch (cause) {
      // 并发：别人已先还原/需求已不在回收站。刷新到最新状态，而不是弹成失败。
      if (cause instanceof ApiError && cause.status === 409) {
        setNotice("这条需求已不在回收站，已刷新最新状态。");
        onRequirementChanged?.();
        onRefresh();
        await open(id, { silent: true }).catch(() => undefined);
      } else {
        setActionError(errorText(cause));
      }
    } finally { setRestoreBusy(false); }
  };

  // 返回列表：用 replaceState 立刻把 URL 恢复为「筛选 + 无 requirement」，
  // 刷新/分享列表地址都不会再落回详情；已加载的 rows/cursor 仍在 state 中。
  const closeDetail = () => {
    detailRequestVersion.current += 1;
    setDetailId(null); setSelected(null); setDetailError(null); setDetailLoading(false); setAutoOpenOwnerPicker(false);
    window.history.replaceState(null, "", mine ? myRequirementsUrl(window.location.pathname || "/", scope, null, "#my-requirements") : requirementPoolUrl(window.location.pathname || "/", appliedFiltersRef.current, null, window.location.hash));
  };

  const applyFilters = () => {
    setAppliedFilterCount(activeFilterCount);
    window.history.replaceState(null, "", requirementPoolUrl(window.location.pathname || "/", filters, null, window.location.hash));
    void load(filters, null);
  };

  // 重复处理视图切换：立即生效、重置游标并重新拉取，不要求用户再点「筛选」。
  const applyProcessingView = (view: RequirementProcessingView) => {
    setProcessingState(view);
    const next: RequirementListFilters = { ...filters, processingState: view };
    setAppliedFilterCount(requirementFilterCount(next));
    window.history.replaceState(null, "", requirementPoolUrl(window.location.pathname || "/", next, null, window.location.hash));
    void load(next, null);
  };

  // 来源 Tab 切换：立即生效、重置游标；URL / 导出 / 分页继续共用同一个 source 参数。
  // 只改来源，不顺手把用户还没点「筛选」的草稿输入发出去。
  const applySourceFilter = (value: string) => {
    const next: RequirementListFilters = { ...appliedFiltersRef.current, source: value };
    setSourceFilter(value);
    setAppliedFilterCount(requirementFilterCount(next));
    window.history.replaceState(null, "", requirementPoolUrl(window.location.pathname || "/", next, null, window.location.hash));
    void load(next, null);
  };

  // 清除筛选后立即回到无筛选的第一页，避免残留旧条件与旧游标。
  const clearFilters = () => {
    setAppliedFilterCount(0);
    const cleared = { ...emptyRequirementListFilters };
    setQuery(""); setExecutorName(""); setPullState(""); setOwnerState(""); setAnalysisState(""); setPushState(""); setProcessingState(cleared.processingState); setPriorityFilter(""); setSourceFilter(""); setPrioritySort(""); setBatchId(""); setSince(""); setUntil("");
    window.history.replaceState(null, "", requirementPoolUrl(window.location.pathname || "/", cleared, null, window.location.hash));
    void load(cleared, null);
  };

  const refresh = () => {
    // 手动刷新：列表与详情各自静默更新（不整页重载）；总览数据由 onRefresh 在后台静默刷新。
    void load(appliedFiltersRef.current, null);
    if (!mine) loadSourceCounts();
    if (detailId) void open(detailId, { silent: true });
    onRefresh();
  };

  // I3-2：导出使用「已生效」筛选，而不是尚未点筛选的草稿输入。
  const exportCsv = async () => {
    setExportBusy(true); setExportNotice(null);
    try {
      const { csv, truncated } = await exportRequirementsCsv(requirementListQuery(appliedFiltersRef.current, scope));
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `rq-sys-requirements-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      setExportNotice(truncated ? "导出已截断为前 5000 条，请缩小筛选范围。" : "已导出当前筛选结果。");
    } catch (cause) { setExportNotice(errorText(cause)); }
    finally { setExportBusy(false); }
  };

  // 服务端已按优先级排序时不重排；我的需求按服务端默认创建时间倒序，不做注意力重排。
  const sortedRows = mine || prioritySort === "priority_asc" ? rows : sortRequirementsForAttention(rows);

  if (detailId) {
    // 跨池守卫的渲染层兜底：同一实例切池时 selected 仍指向上一个池的详情，但绝不渲染它。
    const detailPoolMismatch = Boolean(selected?.pool && selected.pool !== scope);
    return <section className="panel requirements-panel">
      <RequirementDetailPage
        detail={detailPoolMismatch ? null : selected}
        detailId={detailId}
        loading={detailPoolMismatch ? false : detailLoading}
        error={detailPoolMismatch ? (API_ERROR_TEXT.NOT_FOUND ?? "请求的资源不存在或已被删除。") : detailError}
        notice={notice}
        busy={busy}
        autoOpenOwnerPicker={autoOpenOwnerPicker}
        onCloseNotice={() => setNotice(null)}
        onBack={closeDetail}
        onRefresh={refresh}
        onAct={runAction}
        onSaved={(id) => void open(id, { silent: true })}
        onDelete={selected ? () => setDeleteTargetId(selected.id) : undefined}
        canDelete={Boolean(selected?.canDelete ?? (mine && selected?.lifecycleState !== "deleted"))}
        onRestore={restoreDeleted}
        canRestore={selected?.canRestore === true}
        restoreBusy={restoreBusy}
      />
      <ConfirmModal
        visible={deleteTargetId !== null}
        title="移入回收站？"
        description="这条需求会从需求池隐藏，但不会被物理删除；可在回收站还原。飞书 Base 中的历史行会保留，不会删除或改动。"
        okText="移入回收站"
        onOk={() => void confirmDelete()}
        onCancel={() => { if (!deleteBusy) setDeleteTargetId(null); }}
      />
    </section>;
  }

  return <ArcoCard bordered={false} className="rq-card requirements-panel">
    {/* 5c-1：来源是一等维度。采用 Arco Tabs 置于列表上方，带计数、可深链；计数拿不到时只显示文字。
        集团池只有一个 TB 来源，不渲染来源 Tab，也不请求五来源计数。 */}
    {!mine && !isGroup && (
      <div className="req-source-tabs">
        <AccessibleTabs
          label="需求来源"
          activeTab={sourceFilter || "__all__"}
          onChange={(key) => applySourceFilter(key === "__all__" ? "" : key)}
        >
          {SOURCE_TABS.map((tab) => {
            const countKey = sourceCountKey(tab.value);
            // 处理视图切到「全部/已压制重复」时隐藏计数：计数是活跃数，列表行数会更多，避免误读。
            const count = sourceCounts && processingState === "active" && countKey ? sourceCounts[countKey] : null;
            return (
              <ArcoTabs.TabPane
                key={tab.value || "__all__"}
                title={
                  <ArcoSpace size={4} align="center">
                    <span>{tab.label}</span>
                    {count !== null ? <ArcoTag size="small" className="source-tab-count">{count}</ArcoTag> : null}
                  </ArcoSpace>
                }
              />
            );
          })}
        </AccessibleTabs>
      </div>
    )}
    {!mine && (
      <>
        <div className="req-filter-bar">
          <div className="qtoolbar-main">
            <div className="qfield qfield-search">
              <ArcoInput aria-label="搜索需求标题" placeholder="搜索需求标题或批次 ID…" value={query} onChange={(value: string) => setQuery(value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); applyFilters(); } }} />
            </div>
            <div className="qfield">
              <ArcoSelect aria-label="TB负责人筛选" value={executorName} onChange={(value: string) => setExecutorName(value)} style={{ minWidth: 150 }} options={[{ label: "全部 TB 负责人", value: "" }, ...people.filter((person) => person.name).map((person) => ({ label: person.name!, value: person.name! }))]} />
            </div>
            <div className="qfield">
              <ArcoSelect aria-label="同步状态筛选" value={pullState} onChange={(value: string) => setPullState(value)} style={{ minWidth: 130 }} options={pullStateOptions.map(([value, label]) => ({ label, value }))} />
            </div>
            {/* ARCO-05：更多筛选改为 Arco Popover，交由组件统一处理外部点击与 Escape 关闭。 */}
            <ArcoPopover
              className="qmore-popover"
              style={{ maxWidth: 520 }}
              trigger="click"
              position="bl"
              unmountOnExit
              popupVisible={moreFiltersOpen}
              onVisibleChange={setMoreFiltersOpen}
              content={moreFiltersOpen ? (
                <div className="qmore-popover-body" id="requirement-more-filters">
                  <div className="qmore-field">
                    <span className="qmore-field-label">优先级</span>
                    <ArcoSelect aria-label="优先级筛选" value={priorityFilter} onChange={(value: string) => setPriorityFilter(value)} options={priorityFilterOptions.map(([value, label]) => ({ label, value }))} />
                  </div>
                  <div className="qmore-field">
                    <span className="qmore-field-label">排序方式</span>
                    <ArcoSelect aria-label="排序方式" value={prioritySort} onChange={(value: string) => setPrioritySort(value)} options={prioritySortOptions.map(([value, label]) => ({ label, value }))} />
                  </div>
                  <div className="qmore-field">
                    <span className="qmore-field-label">负责人状态</span>
                    <ArcoSelect aria-label="负责人筛选" value={ownerState} onChange={(value: string) => setOwnerState(value)} options={ownerStateOptions.map(([value, label]) => ({ label, value }))} />
                  </div>
                  <div className="qmore-field">
                    <span className="qmore-field-label">分析状态</span>
                    <ArcoSelect aria-label="分析状态筛选" value={analysisState} onChange={(value: string) => setAnalysisState(value)} options={analysisStateOptions.map(([value, label]) => ({ label, value }))} />
                  </div>
                  <div className="qmore-field">
                    <span className="qmore-field-label">推送状态</span>
                    <ArcoSelect aria-label="推送状态筛选" value={pushState} onChange={(value: string) => setPushState(value)} options={pushStateOptions.map(([value, label]) => ({ label, value }))} />
                  </div>
                  <div className="qmore-field">
                    <span className="qmore-field-label">批次 ID</span>
                    <ArcoInput aria-label="批次 ID 筛选" placeholder="输入批次 ID" value={batchId} onChange={(value: string) => setBatchId(value)} />
                  </div>
                  <div className="qmore-field">
                    <span className="qmore-field-label">开始时间</span>
                    {/* ARCO-04 豁免：datetime-local 依赖浏览器本地时区语义，保留原生控件。 */}
                    <input className="rq-datetime-input" type="datetime-local" aria-label="最近同步开始时间" value={since} onChange={(e) => setSince(e.target.value)} />
                  </div>
                  <div className="qmore-field">
                    <span className="qmore-field-label">结束时间</span>
                    <input className="rq-datetime-input" type="datetime-local" aria-label="最近同步结束时间" value={until} onChange={(e) => setUntil(e.target.value)} />
                  </div>
                </div>
              ) : null}
            >
              <ArcoButton type="secondary" htmlType="button" size="small" className="qmore-popover-trigger" aria-expanded={moreFiltersOpen} aria-controls="requirement-more-filters">更多筛选{moreFilterCount > 0 ? `（${moreFilterCount}）` : ""}</ArcoButton>
            </ArcoPopover>
          </div>
          <div className="req-filter-actions">
            {appliedFilterCount > 0 && <ArcoTag color="arcoblue" role="status">{appliedFilterCount} 个筛选已生效</ArcoTag>}
            <ArcoButton type="primary" htmlType="button" size="small" onClick={applyFilters}>筛选</ArcoButton>
            {activeFilterCount > 0 && <ArcoButton type="secondary" size="small" onClick={clearFilters} htmlType="button">清除筛选</ArcoButton>}
          </div>
        </div>
        <ArcoDivider className="req-search-divider" />
        <div className="req-action-row">
          <div className="req-action-row-left">
            {!isGroup && <IntakeForm onCreated={(id) => { refresh(); void open(id, { push: true }); }} />}
            {isGroup && (
              <div className="processing-view-switch">
                <span className="processing-view-switch-label">重复处理</span>
                <ArcoTooltip content="已压制需求保留记录，但不会进入 AI 分析、Base 推送与通知。">
                  <span className="inline-help-icon" role="img" aria-label="重复处理说明"><CircleHelp size={14} /></span>
                </ArcoTooltip>
                <ArcoRadio.Group
                  type="button"
                  size="small"
                  aria-label="重复处理视图"
                  value={processingState}
                  onChange={(value: RequirementProcessingView) => applyProcessingView(value)}
                  options={PROCESSING_VIEWS.map((view) => ({ label: view.label, value: view.value }))}
                />
              </div>
            )}
          </div>
          <div className="req-action-row-right">
            {!isGroup && (
              <div className="processing-view-switch">
                <span className="processing-view-switch-label">重复处理</span>
                <ArcoTooltip content="已压制需求保留记录，但不会进入 AI 分析、Base 推送与通知。">
                  <span className="inline-help-icon" role="img" aria-label="重复处理说明"><CircleHelp size={14} /></span>
                </ArcoTooltip>
                <ArcoRadio.Group
                  type="button"
                  size="small"
                  aria-label="重复处理视图"
                  value={processingState}
                  onChange={(value: RequirementProcessingView) => applyProcessingView(value)}
                  options={PROCESSING_VIEWS.map((view) => ({ label: view.label, value: view.value }))}
                />
              </div>
            )}
            <ArcoButton type="secondary" htmlType="button" size="small" onClick={() => void exportCsv()} disabled={exportBusy}><Download size={14} />{exportBusy ? "导出中…" : "导出 CSV"}</ArcoButton>
            <ArcoButton type="secondary" htmlType="button" size="small" onClick={refresh}><RefreshCw size={14} />刷新</ArcoButton>
          </div>
        </div>
        <div className="list-summary" role="status" style={{ marginBottom: 12 }}>
          {exportNotice && <ArcoTypography.Text type="secondary" role="status">{exportNotice}</ArcoTypography.Text>}
          <span className="list-summary-count">已加载 {sortedRows.length} 条{cursor ? "，还有更多" : ""}{activeFilterCount > 0 ? `（已应用 ${activeFilterCount} 个筛选）` : ""}</span>
          <span className="list-summary-sort">{prioritySort === "priority_asc" ? "分诊视图：P0 → P3（最多 100 条）" : "待分配 → 推送失败 → 待推送 → 已推送"}</span>
          <ArcoTooltip content="三个状态互不影响：同步状态（是否已拉取最新原文）、AI 分析状态（是否已生成模块与优先级建议）、推送状态（是否已写入飞书多维表格）；分析失败不会阻止推送。">
            <span className="inline-help-icon" role="img" aria-label="处理状态说明"><CircleHelp size={14} /></span>
          </ArcoTooltip>
        </div>
      </>
    )}
    <StateBanner loadError={loadError ?? peopleError ?? actionError} notice={notice} onCloseNotice={() => setNotice(null)} />
    {mine && (
      <div className="list-summary" role="status" style={{ marginBottom: 12 }}>
        <span className="list-summary-count">已加载 {sortedRows.length} 条{cursor ? "，还有更多" : ""}</span>
        <ArcoButton type="secondary" htmlType="button" size="small" onClick={refresh}><RefreshCw size={14} />刷新</ArcoButton>
      </div>
    )}
    <div id="requirement-tab-panel" role="tabpanel" aria-label="需求列表">
      <RequirementsTable
        rows={sortedRows}
        loading={loadState === "loading"}
        showSource={!isGroup}
        showPool={mine}
        emptyState={mine ? { title: "暂无分配给你的需求", description: "负责人匹配或人工指派后会出现在这里。" } : undefined}
        onOpen={(row) => void open(row.id, { push: true })}
        onAssign={(row) => void open(row.id, { push: true, openOwnerPicker: true })}
        onDelete={mine ? (row) => setDeleteTargetId(row.id) : undefined}
      />
      {cursor && (mine || prioritySort !== "priority_asc") && <div className="rq-action-bar"><ArcoButton htmlType="button" onClick={() => void load(appliedFiltersRef.current, cursor)} disabled={loadState === "loading"} type="secondary" size="small">加载更多</ArcoButton></div>}
    </div>
    <ConfirmModal
      visible={deleteTargetId !== null}
      title="移入回收站？"
      description="这条需求会从需求池隐藏，但不会被物理删除；可在回收站还原。飞书 Base 中的历史行会保留，不会删除或改动。"
      okText="移入回收站"
      onOk={() => void confirmDelete()}
      onCancel={() => { if (!deleteBusy) setDeleteTargetId(null); }}
    />
  </ArcoCard>;
}

/** PRD §4.13.4：「我的需求」页：产品池/集团池两个 Tab，Tab 切换写 ?pool= 并重置分页。 */
export function MyRequirementsPanel({ onRefresh }: { onRefresh: () => void }) {
  const [pool, setPool] = useState<RequirementPool>(() => readMyRequirementsPool(window.location.search));
  const [counts, setCounts] = useState<MyRequirementCounts | null>(null);
  const [countsState, setCountsState] = useState<LoadState>("loading");

  const loadCounts = useCallback(() => {
    setCountsState("loading");
    void getMyRequirementCounts()
      .then((value) => { setCounts(value); setCountsState("ready"); })
      .catch(() => { setCounts(null); setCountsState("error"); });
  }, []);
  useEffect(() => { loadCounts(); }, [loadCounts]);
  // 浏览器前进/后退恢复同一 Tab；Tab 切换只 replaceState，避免历史里堆一屏池切换。
  useEffect(() => {
    const onPopState = () => setPool(readMyRequirementsPool(window.location.search));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const switchPool = (next: RequirementPool) => {
    if (next === pool) return;
    setPool(next);
    window.history.replaceState(null, "", myRequirementsUrl(window.location.pathname || "/", next, null, "#my-requirements"));
  };

  const tabs: Array<{ value: RequirementPool; label: string; count: number | null }> = [
    { value: "product", label: "产品需求池", count: countsState === "ready" && counts ? counts.product : null },
    { value: "group", label: "集团需求池", count: countsState === "ready" && counts ? counts.group : null },
  ];

  const tabExtra = countsState === "error"
    ? <span className="subtle-text">数量暂不可用</span>
    : countsState === "ready" && counts
      ? <span className="subtle-text">含已压制 · 共 {counts.total} 条</span>
      : undefined;

  return <div className="composite-page my-requirements-page">
    <AccessibleTabs label="我的需求池" activeTab={pool} onChange={(key) => switchPool(key as RequirementPool)} extra={tabExtra}>
      {tabs.map((tab) => (
        <ArcoTabs.TabPane
          key={tab.value}
          title={
            <ArcoSpace size={4} align="center">
              <span>{tab.label}</span>
              {tab.count !== null ? <ArcoTag size="small">{tab.count}</ArcoTag> : null}
            </ArcoSpace>
          }
        />
      ))}
    </AccessibleTabs>
    {countsState === "ready" && counts && !counts.identityResolved ? (
      <ArcoAlert className="rq-inline-alert" type="warning" showIcon role="status" content="当前账号还没有可识别的飞书身份；请在团队管理中绑定飞书账号后再查看。" />
    ) : null}
    <RequirementsPanel key={pool} scope={pool} mine onRefresh={onRefresh} onRequirementChanged={loadCounts} />
  </div>;
}

/** PRD §4.13.6：个人回收站；只显示本人删除项，还原不二次确认、不写 Base。 */
export function RecycleBinPanel({ onRefresh }: { onRefresh: () => void }) {
  const [initialDetailId] = useState<string | null>(() => readRequirementDeepLink(window.location.search));
  const [rows, setRows] = useState<RequirementSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(initialDetailId);
  const [selected, setSelected] = useState<RequirementDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(Boolean(initialDetailId));
  const [detailError, setDetailError] = useState<string | null>(null);
  const listRequestVersion = useRef(0);
  const detailRequestVersion = useRef(0);

  const load = useCallback(async (nextCursor: string | null) => {
    const version = ++listRequestVersion.current;
    if (!nextCursor) setLoadState("loading");
    setLoadError(null);
    try {
      const page = await listRecycleBinRequirements({ limit: 25, ...(nextCursor ? { cursor: nextCursor } : {}) });
      if (version !== listRequestVersion.current) return;
      setRows((prev) => nextCursor ? [...prev, ...page.items] : page.items);
      setCursor(page.nextCursor);
      setLoadState("ready");
    } catch (cause) {
      if (version !== listRequestVersion.current) return;
      if (!nextCursor) setRows([]);
      setLoadError(errorText(cause));
      setLoadState("error");
    }
  }, []);

  const openDetail = useCallback(async (id: string, options?: { push?: boolean }) => {
    const version = ++detailRequestVersion.current;
    setDetailId(id); setSelected(null); setDetailLoading(true); setDetailError(null); setNotice(null);
    if (options?.push) window.history.pushState(null, "", recycleBinUrl(window.location.pathname || "/", id));
    try {
      const detail = await getRequirement(id);
      if (version !== detailRequestVersion.current) return;
      setSelected(detail);
    } catch (cause) {
      if (version !== detailRequestVersion.current) return;
      setDetailError(errorText(cause));
    } finally {
      if (version === detailRequestVersion.current) setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(null);
    return () => { listRequestVersion.current += 1; detailRequestVersion.current += 1; };
  }, [load]);
  // 直接访问/刷新回收站深链（?stage=recycle&requirement=<id>）时在挂载期拉取详情，不重复 pushState。
  const deepLinkOpened = useRef(false);
  useEffect(() => {
    if (!initialDetailId || deepLinkOpened.current) return;
    deepLinkOpened.current = true;
    void openDetail(initialDetailId);
  }, [initialDetailId, openDetail]);
  useEffect(() => {
    const onPopState = () => {
      const next = readRequirementDeepLink(window.location.search);
      if (next) { void openDetail(next); return; }
      detailRequestVersion.current += 1;
      setDetailId(null); setSelected(null); setDetailError(null); setDetailLoading(false);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [openDetail]);

  const closeDetail = () => {
    detailRequestVersion.current += 1;
    setDetailId(null); setSelected(null); setDetailError(null); setDetailLoading(false);
    window.history.replaceState(null, "", recycleBinUrl(window.location.pathname || "/", null));
  };

  const restore = async (id: string) => {
    setRestoringId(id); setActionError(null);
    try {
      await restoreRequirement(id);
      setRows((prev) => prev.filter((row) => row.id !== id));
      setNotice("已还原");
      if (detailId === id) closeDetail();
      onRefresh();
    } catch (cause) {
      // 并发：这条需求已不在回收站（别人已还原）。刷新列表并提示，不弹成错误。
      if (cause instanceof ApiError && cause.status === 409) {
        setNotice("这条需求已不在回收站，已刷新列表。");
        if (detailId === id) closeDetail();
        void load(null);
        onRefresh();
      } else {
        setActionError(errorText(cause));
      }
    } finally { setRestoringId(null); }
  };

  if (detailId) {
    return <section className="panel requirements-panel">
      <RequirementDetailPage
        detail={selected}
        detailId={detailId}
        loading={detailLoading}
        error={detailError}
        notice={notice ?? actionError}
        busy={restoringId !== null}
        autoOpenOwnerPicker={false}
        onCloseNotice={() => { setNotice(null); setActionError(null); }}
        onBack={closeDetail}
        onRefresh={() => void openDetail(detailId)}
        onAct={async () => false}
        onSaved={() => undefined}
        canDelete={false}
        onRestore={restore}
        canRestore={selected?.canRestore === true}
        restoreBusy={restoringId !== null}
      />
    </section>;
  }

  const columns = [
    {
      title: "需求",
      dataIndex: "title",
      render: (_value: unknown, row: RequirementSummary) => <div className="requirement-title">
        <span className="req-id">{requirementDisplayId(row)}</span>
        <strong>{row.title}</strong>
      </div>,
    },
    { title: "池", dataIndex: "pool", width: 90, render: (_value: unknown, row: RequirementSummary) => poolChip(row.pool) },
    {
      title: "来源",
      dataIndex: "sourceType",
      width: 130,
      render: (_value: unknown, row: RequirementSummary) => requirementSourceInfo(row)?.name ?? requirementSourceName(row),
    },
    {
      title: "删除时间",
      dataIndex: "deletedAt",
      width: 180,
      render: (_value: unknown, row: RequirementSummary) => formatDateTime(row.deletedAt ?? null) ?? <span className="req-empty-value">—</span>,
    },
    {
      title: "删除前处理状态",
      dataIndex: "processingState",
      width: 150,
      render: (_value: unknown, row: RequirementSummary) => processingStateLabels[requirementProcessingState(row)],
    },
    {
      title: "操作",
      dataIndex: "id",
      width: 110,
      render: (_value: unknown, row: RequirementSummary) => <ArcoButton type="text" size="small" className="link-button"
        onClick={(event) => { event.stopPropagation(); void restore(row.id); }} disabled={restoringId !== null} htmlType="button">{restoringId === row.id ? "还原中…" : "还原"}</ArcoButton>,
    },
  ];

  return <ArcoCard bordered={false} className="rq-card requirements-panel recycle-bin-panel">
    <StateBanner loadError={loadError ?? actionError} notice={notice} onCloseNotice={() => setNotice(null)} />
    <div className="list-summary" role="status" style={{ marginBottom: 12 }}>
      <span className="list-summary-count">已加载 {rows.length} 条{cursor ? "，还有更多" : ""}</span>
      <span className="list-summary-sort">只显示你删除的需求；不做物理删除，可随时还原。</span>
    </div>
    {loadState === "loading" && !rows.length
      ? <SkeletonTableRows rows={4} columns={5} />
      : <div className="table-scroll req-list-scroll">
        <ArcoTable<RequirementSummary>
          className="req-list"
          rowKey="id"
          scroll={{ x: 900 }}
          columns={columns}
          data={rows}
          pagination={false}
          border={false}
          noDataElement={<ArcoEmpty className="rq-empty" description={<div className="rq-empty-copy"><strong>回收站是空的</strong><span>你移入回收站的需求会出现在这里，可随时还原。</span></div>} />}
          onRow={(row) => ({
            style: { cursor: "pointer" },
            tabIndex: 0,
            "aria-label": `打开已删除需求：${row.title}`,
            onClick: () => void openDetail(row.id, { push: true }),
            onKeyDown: (event: KeyboardEvent<HTMLElement>) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void openDetail(row.id, { push: true }); } },
          })}
        />
      </div>}
    {cursor && <div className="rq-action-bar"><ArcoButton htmlType="button" onClick={() => void load(cursor)} disabled={loadState === "loading"} type="secondary" size="small">加载更多</ArcoButton></div>}
  </ArcoCard>;
}

/**
 * Base 记录引用。工作台只拿得到 record ID，拿不到 Base app token（凭据不下发浏览器），
 * 因此提供可复制的引用，而不是伪造一个打不开的链接。
 */
function BaseRecordReference({ recordId, url }: { recordId: string | null; url?: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!recordId) return <span className="base-ref-empty">尚未写入飞书 Base</span>;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(recordId);
      setCopied(true);
      ArcoMessage.success("已复制记录 ID");
      window.setTimeout(() => setCopied(false), 2000);
    } catch { setCopied(false); }
  };
  const safeUrl = safeHttpUrl(url);
  return <span className="base-ref">
    <code className="base-ref-id">{recordId}</code>
    {safeUrl ? <a className="link-button" href={safeUrl} target="_blank" rel="noreferrer">在飞书 Base 中打开</a> : null}
    <ArcoButton type="text" className="link-button" onClick={() => void copy()} htmlType="button">{copied ? "已复制" : "复制记录 ID"}</ArcoButton>
    <span className="base-ref-hint">PM 处理状态与通知送达请在飞书 Base 中查看；本工作台不读取这些字段。</span>
  </span>;
}

const SCORE_ROWS: Array<{ path: [keyof ScoringInputs, string]; label: string; max: number; group: string }> = [
  { path: ["user", "pain"], label: "U 痛点强度", max: 5, group: "U 用户价值" },
  { path: ["user", "frequency"], label: "U 发生频次", max: 5, group: "U 用户价值" },
  { path: ["market", "sellingPoint"], label: "M 卖点强度", max: 3, group: "M 市场价值" },
  { path: ["market", "competitor"], label: "M 竞品差异", max: 3, group: "M 市场价值" },
  { path: ["strategy", "roadmap"], label: "S Roadmap 匹配", max: 3, group: "S 战略价值" },
  { path: ["strategy", "dependency"], label: "S 战略依赖/杠杆", max: 3, group: "S 战略价值" },
  { path: ["cost", "workload"], label: "C 工作量", max: 5, group: "C 成本" },
  { path: ["cost", "technicalRisk"], label: "C 技术风险", max: 5, group: "C 成本" },
  { path: ["cost", "resource"], label: "C 资源占用", max: 5, group: "C 成本" },
];

export interface DimensionInsight {
  key: "U" | "M" | "S" | "C";
  recommendation?: string | null;
  rationale?: string | null;
  evidence?: string[];
  missing?: boolean;
}

type EditableScoringInputs = {
  user: { pain: number | undefined; frequency: number | undefined };
  market: { sellingPoint: number | undefined; competitor: number | undefined };
  strategy: { roadmap: number | undefined; dependency: number | undefined };
  cost: { workload: number | undefined; technicalRisk: number | undefined; resource: number | undefined };
};

function scoringValue(inputs: ScoringInputs, path: [keyof ScoringInputs, string]): number {
  return Number((inputs[path[0]] as Record<string, number>)[path[1]] ?? 0);
}

function editableScoringValue(inputs: EditableScoringInputs, path: [keyof ScoringInputs, string]): number | undefined {
  return (inputs[path[0]] as Record<string, number | undefined>)[path[1]];
}

function withScoringValue(inputs: EditableScoringInputs, path: [keyof ScoringInputs, string], value: number | undefined): EditableScoringInputs {
  return { ...inputs, [path[0]]: { ...(inputs[path[0]] as Record<string, number | undefined>), [path[1]]: value } } as EditableScoringInputs;
}

function toValidScoringInputs(inputs: EditableScoringInputs): ScoringInputs | null {
  for (const { path, max } of SCORE_ROWS) {
    const val = editableScoringValue(inputs, path);
    if (typeof val !== "number" || !Number.isInteger(val) || val < 1 || val > max) return null;
  }
  return inputs as ScoringInputs;
}

function scoreDimensions(inputs: ScoringInputs) {
  return {
    U: inputs.user.pain * inputs.user.frequency,
    M: inputs.market.sellingPoint * inputs.market.competitor,
    S: inputs.strategy.roadmap * inputs.strategy.dependency,
    C: Math.max(inputs.cost.workload, inputs.cost.technicalRisk, inputs.cost.resource),
  };
}

function scoreOriginLabel(origin: RequirementScoreVersion["origin"]): string {
  return origin === "ai" ? "AI 建议" : origin === "manual" ? "PM 人工" : "已采用 AI";
}

/** V02-S06 / 2026-10-28：AI 评分与 AI 建议整合为同一区域。
 *  评分决定优先级；U/M/S/C 维度卡、九项输入和 AI 定性建议放在一起，
 *  避免原来的“评分与优先级 + AI分析与建议”两个重复区块。 */
export function ScoringPanel({ requirementId, scoring, dimensionInsights = [], children, onSaved }: {
  requirementId: string;
  scoring: import("./api").ScoringData | null | undefined;
  dimensionInsights?: DimensionInsight[];
  children?: ReactNode;
  onSaved: () => void;
}) {
  const current = scoring?.current ?? null;
  const ai = scoring?.aiSuggestion ?? null;
  const baseInputs: ScoringInputs = current?.inputs ?? ai?.inputs ?? {
    user: { pain: 3, frequency: 3 }, market: { sellingPoint: 1, competitor: 1 },
    strategy: { roadmap: 1, dependency: 1 }, cost: { workload: 3, technicalRisk: 3, resource: 3 },
  };
  const [editing, setEditing] = useState(false);
  const [inputs, setInputs] = useState<EditableScoringInputs>(baseInputs);
  const [alpha, setAlpha] = useState<number | undefined>(current?.alpha ?? ai?.alpha ?? 0.8);
  const [safetyFlag, setSafetyFlag] = useState(current?.safetyFlag ?? ai?.safetyFlag ?? false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  useEffect(() => {
    const source = current ?? ai;
    if (source) { setInputs(source.inputs); setAlpha(source.alpha); setSafetyFlag(source.safetyFlag); }
    setEditing(false); setError(null);
  }, [current?.id, ai?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const display = current ?? ai;
  const dimensions = display ? scoreDimensions(display.inputs) : null;
  const insightByKey = new Map(dimensionInsights.map((insight) => [insight.key, insight]));
  const dimensionCards = display && dimensions ? ([
    { key: "U" as const, label: "U · 用户价值", value: dimensions.U, formula: `痛点 ${display.inputs.user.pain} × 频次 ${display.inputs.user.frequency}` },
    { key: "M" as const, label: "M · 市场价值", value: dimensions.M, formula: `卖点 ${display.inputs.market.sellingPoint} × 竞品 ${display.inputs.market.competitor}` },
    { key: "S" as const, label: "S · 战略价值", value: dimensions.S, formula: `Roadmap ${display.inputs.strategy.roadmap} × 依赖 ${display.inputs.strategy.dependency}` },
    { key: "C" as const, label: "C · 成本", value: dimensions.C, formula: `max(工作量 ${display.inputs.cost.workload}，风险 ${display.inputs.cost.technicalRisk}，资源 ${display.inputs.cost.resource})` },
  ]) : [];
  const aiAlreadyApplied = Boolean(current && ai && current.origin === "ai_applied" && current.analysisVersion === ai.analysisVersion);
  const validInputs = toValidScoringInputs(inputs);
  const validAlpha = typeof alpha === "number" && Number.isFinite(alpha) && alpha >= 0.5 && alpha <= 2 ? alpha : null;
  const save = async () => {
    if (!validInputs || validAlpha === null) { setError("请填写合法的评分项（1 至对应上限）与 α 系数（0.5–2.0）。"); return; }
    setBusy(true); setError(null); setNotice(null);
    try {
      await saveRequirementScore(requirementId, { expectedVersion: current?.version ?? 0, inputs: validInputs, alpha: validAlpha, safetyFlag, reason });
      setNotice("评分已保存并重算。");
      setEditing(false); setReason(""); onSaved();
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  const applyAi = async () => {
    if (!ai) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      await applyRequirementAiScore(requirementId, { expectedVersion: current?.version ?? 0, aiVersion: ai.version, reason: "采用AI建议" });
      setNotice("已采用 AI 建议。"); onSaved();
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  const rowLabel = (path: [keyof ScoringInputs, string]) => {
    const key = `${path[0]}.${path[1]}`;
    const basis = (display?.basis ?? {})[key];
    if (!basis) return "—";
    return `${basis.reason}${basis.assumption ? "（假设）" : ""}`;
  };
  const scoreTableRows: Array<{
    key: string;
    group: string;
    label: string;
    aiValue: string | number;
    currentValue: ReactNode;
    basis: string;
  }> = [
    ...SCORE_ROWS.map(({ path, label, max, group }) => ({
      key: label,
      group,
      label,
      aiValue: ai ? scoringValue(ai.inputs, path) : "—",
      currentValue: editing
        ? <ArcoInputNumber aria-label={`评分 ${label}`} min={1} max={max} step={1} precision={0} value={editableScoringValue(inputs, path)} onChange={(value: number | undefined) => setInputs(withScoringValue(inputs, path, typeof value === "number" && Number.isFinite(value) ? value : undefined))} style={{ width: 72 }} />
        : (display ? scoringValue(display.inputs, path) : "—"),
      basis: rowLabel(path),
    })),
    {
      key: "alpha",
      group: "修正系数",
      label: "α 修正系数",
      aiValue: ai?.alpha ?? "—",
      currentValue: editing
        ? <ArcoInputNumber aria-label="评分 alpha" min={0.5} max={2} step={0.1} precision={1} value={alpha} onChange={(value: number | undefined) => setAlpha(typeof value === "number" && Number.isFinite(value) ? value : undefined)} style={{ width: 72 }} />
        : (display?.alpha ?? "—"),
      basis: display?.rationale ?? "—",
    },
  ];
  return <ArcoCard
    className="rq-card req-section req-score-section"
    aria-labelledby="req-scoring-heading"
    title={
      <div className="rq-card-title">
        <h3 id="req-scoring-heading" className="rq-section-heading">AI 评分与优先级</h3>
        <ArcoTypography.Text type="secondary" className="rq-card-subtitle">U/M/S/C 四维评分决定 P0–P3；AI 给出依据，PM 可修订单项与 α。</ArcoTypography.Text>
      </div>
    }
    extra={<ArcoTag>AI 评分 · 服务端算 P</ArcoTag>}
  >
    <StateBanner loadError={error} notice={notice} onCloseNotice={() => setNotice(null)} />
    {!display && !editing ? (
      <ArcoEmpty
        className="rq-empty"
        description={
          <div className="rq-empty-copy">
            <strong>暂无评分</strong>
            <span>AI 分析完成后会生成九项评分；旧分析没有合法评分时也可以手动填写。</span>
            <ArcoButton type="secondary" htmlType="button" size="small" onClick={() => setEditing(true)} disabled={busy}>手动填写评分</ArcoButton>
          </div>
        }
      />
    ) : <>
      {display && (
        <div className="score-overview">
          <div className="score-overview-main">
            <ArcoTypography.Text type="secondary" className="rq-caption">{current ? "当前综合评分" : "AI 建议综合评分"}</ArcoTypography.Text>
            <div className="score-number-line">
              <ArcoStatistic value={display.score} renderFormat={() => display.score.toFixed(2)} />
              <ArcoTag color={PRIORITY_TAG_COLORS[display.priority] ?? "gray"}>{display.priority}</ArcoTag>
            </div>
            <ArcoTypography.Text type="secondary" className="rq-caption">v{display.version} · {scoreOriginLabel(display.origin)} · {display.scoreConfidence ? `${display.scoreConfidence}置信度` : "置信度 —"}</ArcoTypography.Text>
            {!current && ai && <ArcoTag size="small" color="orange">尚未成为当前评分，请查看后采用</ArcoTag>}
          </div>
          <div className="score-overview-formula">
            <ArcoTypography.Text type="secondary" className="rq-caption">计算依据（只读）</ArcoTypography.Text>
            <code>{scoring?.formula?.text ?? "U/M/S/C 固定公式"}</code>
            <ArcoTypography.Text type="secondary" className="rq-caption">综合分由服务端按此公式计算，P 按 45 / 25 / 10 阈值判定。</ArcoTypography.Text>
          </div>
          <ArcoSpace size={8} wrap>
            {ai && ai.id !== current?.id && !aiAlreadyApplied && <ArcoButton type="primary" htmlType="button" size="small" onClick={() => void applyAi()} disabled={busy}>采用 AI 建议 v{ai.version}</ArcoButton>}
            <ArcoButton type="secondary" htmlType="button" size="small" onClick={() => setEditing((value) => !value)} disabled={busy}>{editing ? "取消编辑" : "编辑评分"}</ArcoButton>
            <ArcoButton type="secondary" htmlType="button" size="small" onClick={() => setHistoryOpen((value) => !value)}>{historyOpen ? "收起历史" : `历史（${scoring?.history.length ?? 0}）`}</ArcoButton>
          </ArcoSpace>
        </div>
      )}
      {display?.scoreConfidenceReason && <ArcoTypography.Paragraph type="secondary" className="detail-note">评分置信度理由：{display.scoreConfidenceReason}</ArcoTypography.Paragraph>}
      {display?.safetyFlag && <ArcoAlert className="rq-inline-alert" type="warning" showIcon role="status" content="涉及安全：需人工复核；安全标记不自动改变 P。" />}
      {display && (
        <ArcoGrid.Row gutter={[12, 12]} aria-label="U/M/S/C 维度评分">
          {dimensionCards.map((card) => {
            const insight = insightByKey.get(card.key);
            return (
              <ArcoGrid.Col key={card.key} xs={24} sm={12}>
                <ArcoCard size="small" className={`rq-subcard dimension-score-card dimension-${card.key.toLowerCase()}`}>
                  <div className="dimension-card-head"><span>{card.label}</span><strong>{card.value}</strong></div>
                  <ArcoTypography.Text type="secondary" className="rq-caption">{card.formula}</ArcoTypography.Text>
                  {insight?.recommendation ? <p className="dimension-insight">AI：{insight.recommendation}</p> : <p className="dimension-insight subtle-text">AI 维度解读未提供</p>}
                  {insight?.rationale && <p className="dimension-rationale">理由：{insight.rationale}</p>}
                  {insight?.evidence && insight.evidence.length > 0 && <p className="dimension-evidence">证据：{insight.evidence.join("；")}</p>}
                  {insight?.missing && <ArcoTag size="small" color="orange">需要补充信息</ArcoTag>}
                </ArcoCard>
              </ArcoGrid.Col>
            );
          })}
        </ArcoGrid.Row>
      )}
      <div className="score-input-head"><h4>九项评分输入</h4><ArcoTypography.Text type="secondary" className="rq-caption">AI 建议值 vs 当前值；依据/假设可逐项核对</ArcoTypography.Text></div>
      <ArcoTable<(typeof scoreTableRows)[number]>
        className="score-input-table"
        rowKey="key"
        data={scoreTableRows}
        pagination={false}
        border={false}
        scroll={{ x: 640 }}
        columns={[
          { title: "维度", dataIndex: "group", width: 120, render: (_value, row) => <ArcoTag size="small">{row.group}</ArcoTag> },
          { title: "评分项", dataIndex: "label", width: 150, render: (_value, row) => <strong>{row.label}</strong> },
          { title: "AI建议", dataIndex: "aiValue", width: 80 },
          { title: "当前值", dataIndex: "currentValue", width: 100 },
          { title: "依据/假设", dataIndex: "basis" },
        ]}
      />
      {editing && (
        <ArcoForm layout="inline" className="rq-compact-form rq-action-bar">
          <ArcoForm.Item>
            <ArcoCheckbox checked={safetyFlag} onChange={(checked: boolean) => setSafetyFlag(checked)}>涉及安全</ArcoCheckbox>
          </ArcoForm.Item>
          <ArcoForm.Item label="修改理由（必填）">
            <ArcoInput aria-label="评分修改理由" value={reason} onChange={(value: string) => setReason(value)} />
          </ArcoForm.Item>
          <ArcoForm.Item>
            <ArcoSpace size={8}>
              <ArcoButton type="primary" htmlType="button" size="small" onClick={() => void save()} disabled={busy || reason.trim().length === 0 || !validInputs || validAlpha === null}>{busy ? "保存中…" : "保存评分"}</ArcoButton>
              {!display && <ArcoButton type="secondary" htmlType="button" size="small" onClick={() => setEditing(false)} disabled={busy}>取消</ArcoButton>}
            </ArcoSpace>
          </ArcoForm.Item>
        </ArcoForm>
      )}
      {historyOpen && <ArcoTable<RequirementScoreVersion>
        rowKey="id"
        data={scoring?.history ?? []}
        pagination={false}
        border={false}
        columns={[
          { title: "版本", dataIndex: "version", width: 130, render: (_value, version) => <>v{version.version} · {version.status}</> },
          { title: "来源", dataIndex: "origin", width: 120, render: (_value, version) => scoreOriginLabel(version.origin) },
          { title: "分数/P", dataIndex: "score", width: 130, render: (_value, version) => <>{version.score.toFixed(2)} / {version.priority}</> },
          { title: "时间", dataIndex: "createdAt", width: 180, render: (_value, version) => formatDateTime(version.createdAt) },
          { title: "理由", dataIndex: "changeReason", render: (_value, version) => version.changeReason ?? "—" },
        ]}
      />}
      {children && <div className="score-analysis-detail">
        <div className="score-analysis-head"><h4>AI 分析建议</h4><ArcoTypography.Text type="secondary" className="rq-caption">模块、类型、人群与整体置信度；详细证据在下方历史/依据中可查。</ArcoTypography.Text></div>
        {children}
      </div>}
    </>}
    {!display && !editing && children && <div className="score-analysis-detail">
      <div className="score-analysis-head"><h4>AI 分析建议</h4><ArcoTypography.Text type="secondary" className="rq-caption">评分未生成时仍可查看现有 AI 分析。</ArcoTypography.Text></div>
      {children}
    </div>}
  </ArcoCard>;
}

// ---------- P1 重复处理：详情页人工判定区块 ----------
type DuplicateDecisionMode = "duplicate" | "confirmed_unique" | "ignored" | "revoke";

/**
 * 重复判定区块：确认重复（选择主记录）/ 确认非重复 / 忽略，已压制时提供撤销。
 * 撤销与确认走不同端点：撤销用 DELETE 清除判定（审计 duplicate.revoked），
 * 不能复用 confirmed_unique，否则会留下一条"已确认非重复"记录。
 */
function DuplicateDecisionSection({ detail, onSaved }: { detail: RequirementDetail; onSaved: () => void }) {
  const state = requirementProcessingState(detail);
  const resolution = detail.resolution ?? null;
  const suppressed = state !== "active";
  const version = resolution?.version ?? 0;
  const [mode, setMode] = useState<DuplicateDecisionMode | null>(null);
  const [canonicalId, setCanonicalId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // 候选优先取后端 duplicateCandidates（同标题的其他 active 需求），旧响应回退 duplicates。
  type DuplicateCandidateLike = { id: string; title: string; platformRequirementId?: string | null; teambitionRequirementId?: string | null };
  const candidateSource: DuplicateCandidateLike[] = detail.duplicateCandidates ?? detail.duplicates ?? [];
  const candidates = candidateSource.map((item) => ({
    id: item.id,
    title: item.title,
    // 手工需求没有 TB 任务号：优先显示 RQ 编号，避免候选行出现 "null"。
    hint: item.platformRequirementId ?? item.teambitionRequirementId ?? "手工需求",
  }));
  const currentCanonicalId = resolution?.canonicalRequirementId ?? detail.duplicateOf ?? null;
  const canonicalOptions = currentCanonicalId && !candidates.some((candidate) => candidate.id === currentCanonicalId)
    ? [{ id: currentCanonicalId, title: "当前疑似主记录", hint: resolution?.canonicalPlatformRequirementId ?? currentCanonicalId }, ...candidates]
    : candidates;

  // 用户口径（2026-11-23）：没有同标题候选时进入精简态——只保留「忽略」这个独立动作，
  // 主记录与「确认非重复」都没有可判断的对象；已有判定时只保留撤销。
  const reviewState = resolution?.reviewState ?? null;
  const undecided = reviewState !== "suspected" && reviewState !== "confirmed";
  const noCandidates = canonicalOptions.length === 0;
  const compact = !suppressed && undecided && noCandidates;

  const openMode = (next: DuplicateDecisionMode) => {
    setMode(next); setError(null); setConflict(false); setNotice(null);
    setReason(next === "revoke" ? "撤销判定，恢复为活跃需求" : "");
    setCanonicalId((previous) => previous || currentCanonicalId || candidates[0]?.id || "");
  };

  const submit = async () => {
    if (!mode) return;
    // null 表示撤销：走 DELETE 清除判定，而不是用 confirmed_unique 落一条新判定。
    const decision: DuplicateDecision | null = mode === "revoke" ? null : mode === "duplicate" ? "duplicate" : mode === "ignored" ? "ignored" : "confirmed_unique";
    const trimmed = reason.trim();
    if (!trimmed) { setError("请填写判定理由。"); return; }
    if (decision === "duplicate" && !canonicalId) { setError("请选择主记录后再确认重复。"); return; }
    setBusy(true); setError(null); setConflict(false); setNotice(null);
    try {
      const result = decision === null
        ? await revokeDuplicateDecision(detail.id, version)
        : await setDuplicateDecision(detail.id, {
            decision,
            ...(decision === "duplicate" ? { canonicalRequirementId: canonicalId } : {}),
            reason: trimmed,
            expectedVersion: version,
          });
      setMode(null);
      setNotice(`${decision === null ? "已撤销判定，需求恢复为活跃" : `重复判定已保存（${processingStateLabels[result.processingState]}）`}，正在刷新详情。`);
      onSaved();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        setConflict(true);
        setError("判定版本冲突：该需求已被其他操作更新。请刷新详情后重试。");
      } else {
        setError(cause instanceof ApiError ? errorText(cause) : "判定提交失败，请重试。");
      }
    } finally { setBusy(false); }
  };

  const heading = mode === "duplicate" ? "确认重复：选择主记录" : mode === "ignored" ? "忽略该需求" : mode === "revoke" ? "撤销判定" : "确认非重复";
  const submitLabel = mode === "duplicate" ? "确认重复" : mode === "ignored" ? "确认忽略" : mode === "revoke" ? "撤销判定" : "确认非重复";
  const stateBadgeStatus = state === "suppressed_duplicate" ? "error" : state === "suppressed_ignored" ? "default" : resolution?.reviewState === "suspected" ? "warning" : "success";
  const stateChipLabel = state !== "active"
    ? processingStateLabels[state]
    : resolution?.reviewState === "suspected" ? "疑似重复（待确认）" : resolution?.reviewState === "confirmed" ? "已确认非重复" : compact ? "未作判定 · 暂无重复候选" : "未作判定";

  return <ArcoCard
    className="rq-card req-section req-duplicate-section"
    aria-labelledby="req-duplicate-heading"
    title={<h3 id="req-duplicate-heading" className="rq-section-heading">重复处理</h3>}
    extra={<ArcoTag>人工判定 · 影响处理链路</ArcoTag>}
  >
    <div className="duplicate-current-state">
      <ArcoBadge status={stateBadgeStatus} text={stateChipLabel} />
      {resolution?.reason && <span className="subtle-text">理由：{resolution.reason}</span>}
      {(resolution?.canonicalPlatformRequirementId ?? resolution?.canonicalRequirementId) && <span className="subtle-text">主记录：<code>{resolution.canonicalPlatformRequirementId ?? resolution.canonicalRequirementId}</code></span>}
      {typeof resolution?.version === "number" && <span className="subtle-text">判定版本 v{resolution.version}</span>}
    </div>
    <p className="detail-note">{compact ? "暂未发现同标题的重复候选，主记录与「确认非重复」暂不可用；如需压制这条需求，可直接忽略：不再进入 AI 分析、Base 推送与通知，记录保留、可随时撤销。" : "确认重复或忽略后该需求会被压制：不再进入 AI 分析、Base 推送与通知，记录保留、可随时撤销；撤销判定会把处理状态恢复为活跃。"}</p>
    {error && <ArcoAlert className="rq-inline-alert" type="error" showIcon role="alert" title={conflict ? "判定未保存" : "操作未完成"} content={error} action={conflict ? <ArcoButton type="secondary" htmlType="button" size="small" onClick={onSaved}>刷新详情</ArcoButton> : undefined} />}
    {notice && <ArcoAlert className="rq-inline-alert" type="success" showIcon role="status" content={notice} />}
    {mode === null ? <ArcoSpace size={8} wrap className="duplicate-actions">
      {!suppressed && !noCandidates && <ArcoButton type="secondary" htmlType="button" size="small" onClick={() => openMode("duplicate")} disabled={busy} title="从同标题候选中选择主记录">确认重复（选择主记录）</ArcoButton>}
      {!suppressed && !noCandidates && <ArcoButton type="secondary" htmlType="button" size="small" onClick={() => openMode("confirmed_unique")} disabled={busy}>确认非重复</ArcoButton>}
      {!suppressed && <ArcoButton type="outline" status="danger" htmlType="button" size="small" onClick={() => openMode("ignored")} disabled={busy}>忽略</ArcoButton>}
      {suppressed && <ArcoButton type="primary" htmlType="button" size="small" onClick={() => openMode("revoke")} disabled={busy}>撤销判定（恢复活跃）</ArcoButton>}
    </ArcoSpace> : <div className="duplicate-form">
      <ArcoTypography.Title heading={6}>{heading}</ArcoTypography.Title>
      <ArcoForm layout="vertical" className="rq-compact-form">
        {mode === "duplicate" && <ArcoForm.Item label="主记录（同标题候选）"><ArcoSelect aria-label="主记录候选" value={canonicalId} onChange={(value: string) => setCanonicalId(value)} disabled={busy} style={{ minWidth: 260 }} placeholder="选择主记录" options={canonicalOptions.map((candidate) => ({ label: `${candidate.title}（${candidate.hint}）`, value: candidate.id }))} /></ArcoForm.Item>}
        <ArcoForm.Item label="判定理由 *"><ArcoInput aria-label="判定理由" value={reason} onChange={(value: string) => setReason(value)} disabled={busy} placeholder={mode === "ignored" ? "例如：已知重复诉求，无需再处理" : "例如：与主记录描述同一诉求"} /></ArcoForm.Item>
        <ArcoSpace size={8}>
          <ArcoButton type="primary" htmlType="button" size="small" onClick={() => void submit()} disabled={busy}>{busy ? "提交中…" : submitLabel}</ArcoButton>
          <ArcoButton type="secondary" htmlType="button" size="small" onClick={() => { setMode(null); setError(null); setConflict(false); }} disabled={busy}>取消</ArcoButton>
        </ArcoSpace>
      </ArcoForm>
    </div>}
  </ArcoCard>;
}

// ---------- V02-T26：人工优先级覆盖（只影响应用内列表/详情/总览，不回写 Base） ----------
export function PriorityOverrideSection({ detail, onSaved }: { detail: RequirementDetail; onSaved: () => void }) {
  const override = detail.priorityOverride ?? null;
  const effective = detail.effectivePriority ?? null;
  const suppressed = requirementProcessingState(detail) !== "active";
  const [mode, setMode] = useState<"edit" | "clear" | null>(null);
  const [priority, setPriority] = useState<"P0" | "P1" | "P2" | "P3">(override?.priority ?? "P1");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => { setMode(null); setReason(""); setError(null); setNotice(null); setPriority(override?.priority ?? "P1"); }, [detail.id, override?.priority]);
  const submit = async () => {
    const trimmed = reason.trim();
    if (!trimmed) { setError("请填写覆盖原因（或清除原因）。"); return; }
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await setPriorityOverride(detail.id, { priority: mode === "clear" ? null : priority, reason: trimmed });
      setMode(null); setReason("");
      setNotice(mode === "clear" ? "已清除人工优先级，恢复使用当前评分版本优先级。" : `人工优先级已保存为 ${result.effectivePriority ?? priority}。`);
      onSaved();
    } catch (cause) { setError(cause instanceof ApiError ? errorText(cause) : "人工优先级保存失败，请重试。"); }
    finally { setBusy(false); }
  };
  return <ArcoCard
    className="rq-card req-section req-priority-override-section"
    aria-labelledby="req-priority-override-heading"
    title={<h3 id="req-priority-override-heading" className="rq-section-heading">人工优先级</h3>}
    extra={<ArcoTag>人工覆盖 · 仅应用内，不回写 Base</ArcoTag>}
  >
    <ArcoSpace size={8} wrap className="priority-override-current">
      <ArcoTypography.Text type="secondary">当前生效</ArcoTypography.Text>
      {effective ? <ArcoTag color={PRIORITY_TAG_COLORS[effective] ?? "gray"}>{effective}</ArcoTag> : <span className="req-empty-value">暂无优先级</span>}
      {override ? <ArcoBadge status="warning" text="已人工覆盖" /> : <span className="subtle-text">取自当前评分版本{detail.scoring?.current ? `（v${detail.scoring.current.version}）` : ""}</span>}
    </ArcoSpace>
    {override && (
      <ArcoDescriptions
        className="priority-override-meta"
        style={{ marginTop: 12 }}
        size="small"
        column={{ xs: 1, sm: 2 }}
        data={[
          { label: "覆盖为", value: override.priority },
          { label: "原因", value: override.reason },
          { label: "操作人", value: override.actorId },
          { label: "时间", value: timeLabel(override.at) },
        ]}
      />
    )}
    <p className="detail-note">人工优先级只影响应用内列表/详情/总览统计，不回写 Base；清除后恢复当前评分版本优先级。</p>
    {override && detail.scoring?.current && detail.scoring.current.priority !== override.priority && <ArcoAlert className="rq-inline-alert" type="info" showIcon role="note" content={`Base 的「AI优先级建议」仍是评分结果 ${detail.scoring.current.priority}，不会随人工覆盖（${override.priority}）变化；PM 终审优先级请在 Base 中维护。`} />}
    <StateBanner loadError={error} notice={notice} onCloseNotice={() => setNotice(null)} />
    {mode === null ? <ArcoSpace size={8} wrap className="rq-action-bar">
      <ArcoButton type="secondary" htmlType="button" size="small" onClick={() => { setMode("edit"); setReason(""); setError(null); setNotice(null); }} disabled={busy || suppressed} title={suppressed ? "已压制需求不能设置人工优先级；请先撤销判定" : "设置人工优先级覆盖"}>{override ? "修改人工优先级" : "设置人工优先级"}</ArcoButton>
      {override && <ArcoButton type="outline" status="danger" htmlType="button" size="small" onClick={() => { setMode("clear"); setReason(""); setError(null); setNotice(null); }} disabled={busy || suppressed} title={suppressed ? "已压制需求不能清除人工优先级" : "清除人工优先级，恢复评分结果"}>清除人工优先级</ArcoButton>}
    </ArcoSpace> : <ArcoForm layout="inline" className="rq-compact-form rq-action-bar">
      {mode === "edit" && <ArcoForm.Item label="覆盖为 *"><ArcoSelect aria-label="人工优先级" value={priority} onChange={(value: "P0" | "P1" | "P2" | "P3") => setPriority(value)} style={{ minWidth: 120 }} options={["P0", "P1", "P2", "P3"].map((level) => ({ label: level, value: level }))} /></ArcoForm.Item>}
      <ArcoForm.Item label={mode === "clear" ? "清除原因 *" : "覆盖原因 *"}><ArcoInput aria-label="人工优先级原因" value={reason} onChange={(value: string) => setReason(value)} disabled={busy} placeholder="例如：产品会议决定提前处理（1–500 字）" /></ArcoForm.Item>
      <ArcoForm.Item>
        <ArcoSpace size={8}>
          <ArcoButton type="primary" htmlType="button" size="small" onClick={() => void submit()} disabled={busy || reason.trim().length === 0}>{busy ? "保存中…" : mode === "clear" ? "确认清除" : "保存"}</ArcoButton>
          <ArcoButton type="secondary" htmlType="button" size="small" onClick={() => { setMode(null); setError(null); }} disabled={busy}>取消</ArcoButton>
        </ArcoSpace>
      </ArcoForm.Item>
    </ArcoForm>}
  </ArcoCard>;
}

// ---------- V02-T26：分析补充上下文（进入下一次分析请求，不写 Base） ----------
export function AnalysisContextSection({ detail, onSaved }: { detail: RequirementDetail; onSaved: () => void }) {
  const suppressed = requirementProcessingState(detail) !== "active";
  const saved = detail.analysisContext ?? null;
  const [context, setContext] = useState(saved?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => { setContext(saved?.note ?? ""); setError(null); setNotice(null); }, [detail.id, saved?.note]);
  const save = async (rerun: boolean) => {
    setBusy(true); setError(null); setNotice(null);
    const trimmed = context.trim();
    try {
      await saveAnalysisContext(detail.id, trimmed.length > 0 ? trimmed : null);
      if (rerun) {
        try { await retryAnalysis(detail.id, { force: true }); }
        catch (cause) {
          if (cause instanceof ApiError && cause.status === 409) {
            setError("补充上下文已保存，但重新分析未开始：当前状态不允许重试（可能有分析排队/运行中），请刷新后重试。");
            onSaved();
            return;
          }
          throw cause;
        }
      }
      setNotice(rerun ? "补充上下文已保存，已提交重新分析。" : trimmed.length > 0 ? "补充上下文已保存。" : "补充上下文已清除。");
      onSaved();
    } catch (cause) { setError(cause instanceof ApiError ? errorText(cause) : "补充上下文保存失败，请重试。"); }
    finally { setBusy(false); }
  };
  return <ArcoCard
    className="rq-card req-section req-analysis-context-section"
    role="region"
    aria-labelledby="req-analysis-context-heading"
    title={<h3 id="req-analysis-context-heading" className="rq-section-heading">补充上下文</h3>}
    extra={<ArcoTag>仅进入 AI 分析 · 不写 Base</ArcoTag>}
  >
    <p className="detail-note">补充 PM 已知但来源未记录的事实（场景、约束、历史决策等）；下一次分析会以“补充上下文：”独立段提供给模型。不写入 Base，也不改变 PM 已确认字段。</p>
    {saved && <ArcoTypography.Paragraph type="secondary" className="rq-caption" style={{ marginTop: 6 }}>上次更新：{timeLabel(saved.updatedAt)} · {saved.updatedBy}</ArcoTypography.Paragraph>}
    <ArcoForm layout="vertical" className="rq-compact-form">
      <ArcoForm.Item label="补充上下文（不超过 4000 字）">
        <ArcoInput.TextArea aria-label="补充上下文" rows={4} value={context} onChange={(value: string) => setContext(value)} disabled={busy || suppressed} placeholder="例如：该能力需在 Q4 前上线；硬件仅支持 C706；与 GEOID 项目存在复用关系。" />
      </ArcoForm.Item>
    </ArcoForm>
    <StateBanner loadError={error} notice={notice} onCloseNotice={() => setNotice(null)} />
    <ArcoSpace size={8} wrap align="center">
      <ArcoButton type="secondary" htmlType="button" size="small" onClick={() => void save(false)} disabled={busy || suppressed} title={suppressed ? "已压制需求不能保存补充上下文；请先撤销判定" : "仅保存补充上下文"}>{busy ? "保存中…" : "保存"}</ArcoButton>
      <ArcoButton type="primary" htmlType="button" size="small" onClick={() => void save(true)} disabled={busy || suppressed} title={suppressed ? "已压制需求不能重新分析" : "保存补充上下文后强制重跑一次 AI 分析（会消耗一次模型调用）"}>{busy ? "提交中…" : "保存并重新分析"}</ArcoButton>
      <span className="subtle-text">会消耗一次模型调用</span>
    </ArcoSpace>
  </ArcoCard>;
}

// ---------- PRD-28：需求评估（按需生成 · 落 requirement_assessments · 不写需求本体/Base） ----------

const ASSESSMENT_VERDICTS: Record<AssessmentVerdict, { label: string; className: string; hint: string }> = {
  advance: { label: "建议推进", className: "is-advance", hint: "信息足够，可以进入 PRD 编写" },
  hold: { label: "建议暂缓", className: "is-hold", hint: "当前价值或时机不足" },
  investigate: { label: "需要调查", className: "is-investigate", hint: "关键信息不足，先做调查" },
};
const ASSESSMENT_CONFIDENCES: Record<AssessmentConfidence, string> = { high: "高", medium: "中", low: "低" };

function assessmentWaitLabel(seconds: number): string {
  if (seconds >= 3600) return `${Math.ceil(seconds / 3600)} 小时`;
  if (seconds >= 60) return `${Math.ceil(seconds / 60)} 分钟`;
  return `${seconds} 秒`;
}

/** 评估失败提示：沿用 intake 口径；429 读 Retry-After 说明还要等多久。 */
function assessmentErrorMessage(cause: unknown): string {
  if (!(cause instanceof ApiError)) return "评估生成失败，请重试。";
  if (cause.status === 429) {
    if (!cause.retryAfterSeconds) return cause.message;
    return `${cause.message}（还需等待约 ${assessmentWaitLabel(cause.retryAfterSeconds)}）`;
  }
  if (cause.status === 500) return "服务端暂时无法完成这次评估，请稍后重试。";
  if (cause.status === 503) return "服务暂时不可用，请稍后重试；已保存的评估不受影响。";
  return cause.message;
}

/** 单条评估结论：按契约 v0 渲染，未知/缺失字段显示「未提供」，不补造内容。 */
function AssessmentResult({ assessment }: { assessment: RequirementAssessment }) {
  const promptBodyId = useId();
  const [promptOpen, setPromptOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  useEffect(() => { setPromptOpen(false); setCopied(false); setCopyError(null); }, [assessment.id]);

  const output = assessment.output;
  if (assessment.status === "running") {
    return <ArcoAlert className="rq-inline-alert" type="info" showIcon role="status" title="这一版正在生成" content="生成完成后会自动刷新；期间请勿重复生成。" />;
  }
  if (assessment.status !== "succeeded" || !output) {
    return <ArcoAlert className="rq-inline-alert" type="error" showIcon role="alert" title="本次评估没有生成可用结论" content={`${assessment.errorCode ? `错误码：${assessment.errorCode}。` : "服务端未返回评估内容。"}调整补充内容后可重新生成。`} />;
  }

  const prompt = analysisText(output.investigationPrompt) ?? "";
  const verdict = output.verdict && ASSESSMENT_VERDICTS[output.verdict] ? output.verdict : null;
  const verdictColor = verdict === "advance" ? "green" : verdict === "hold" ? "orange" : verdict === "investigate" ? "arcoblue" : "gray";
  const confidence = typeof output.confidence === "string" ? (ASSESSMENT_CONFIDENCES as Record<string, string>)[output.confidence] ?? null : null;
  const scopeIn = analysisStrings(output.scope?.in);
  const scopeOut = analysisStrings(output.scope?.out);
  const assumptions = analysisStrings(output.assumptions);
  const openQuestions = analysisStrings(output.openQuestions);
  const feasibility = output.feasibility ?? { technical: "", cost: "", dependency: "", risk: "" };
  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true); setCopyError(null);
      ArcoMessage.success("已复制提示词");
      window.setTimeout(() => setCopied(false), 2000);
    } catch { setCopyError("复制失败，请展开后手动选中复制。"); }
  };

  return <div className="assessment-result">
    <div className="assessment-verdict-row">
      {verdict ? <ArcoTag color={verdictColor} title={ASSESSMENT_VERDICTS[verdict].hint}>{ASSESSMENT_VERDICTS[verdict].label}</ArcoTag> : <ArcoTag>未给出结论</ArcoTag>}
      {confidence ? <ArcoTag>置信度：{confidence}</ArcoTag> : null}
      <span className="subtle-text">v{assessment.version} · {timeLabel(assessment.createdAt)}{assessment.promptVersion ? ` · ${assessment.promptVersion}` : ""}{assessment.model ? ` · ${assessment.model}` : ""}</span>
    </div>
    <p className="subtle-text" style={{ margin: 0 }}>AI 建议，非结论；请结合下方依据与待确认问题人工判断。</p>
    <ArcoGrid.Row gutter={[12, 12]}>
      <ArcoGrid.Col xs={24} md={8}><ArcoCard size="small" className="rq-subcard" title="背景"><p style={{ margin: 0 }}>{analysisText(output.background) ?? "未提供"}</p></ArcoCard></ArcoGrid.Col>
      <ArcoGrid.Col xs={24} md={8}><ArcoCard size="small" className="rq-subcard" title="目标"><p style={{ margin: 0 }}>{analysisText(output.goal) ?? "未提供"}</p></ArcoCard></ArcoGrid.Col>
      <ArcoGrid.Col xs={24} md={8}><ArcoCard size="small" className="rq-subcard" title="业务价值"><p style={{ margin: 0 }}>{analysisText(output.value) ?? "未提供"}</p></ArcoCard></ArcoGrid.Col>
    </ArcoGrid.Row>
    <ArcoGrid.Row gutter={[12, 12]}>
      <ArcoGrid.Col xs={24} md={12}><ArcoCard size="small" className="rq-subcard" title="范围：要做">{scopeIn.length ? <ul className="rq-compact-list">{scopeIn.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="subtle-text">未提供</p>}</ArcoCard></ArcoGrid.Col>
      <ArcoGrid.Col xs={24} md={12}><ArcoCard size="small" className="rq-subcard" title="范围：不做">{scopeOut.length ? <ul className="rq-compact-list">{scopeOut.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="subtle-text">未提供</p>}</ArcoCard></ArcoGrid.Col>
    </ArcoGrid.Row>
    <ArcoCard size="small" className="rq-subcard" title="可行性">
      <ArcoDescriptions
        size="small"
        column={{ xs: 1, sm: 2 }}
        data={[
          { label: "技术", value: analysisText(feasibility.technical) ?? "未提供" },
          { label: "成本", value: analysisText(feasibility.cost) ?? "未提供" },
          { label: "依赖", value: analysisText(feasibility.dependency) ?? "未提供" },
          { label: "风险", value: analysisText(feasibility.risk) ?? "未提供" },
        ]}
      />
    </ArcoCard>
    {verdict ? <ArcoCard size="small" className="rq-subcard" title="结论依据"><p style={{ margin: 0 }}>{analysisText(output.verdictReason) ?? "未提供"}</p></ArcoCard> : null}
    <ArcoGrid.Row gutter={[12, 12]}>
      <ArcoGrid.Col xs={24} md={12}><ArcoCard size="small" className="rq-subcard" title="假设（AI 推断）">{assumptions.length ? <ul className="rq-compact-list">{assumptions.map((item, index) => <li key={index}><ArcoTag size="small" color="orange" style={{ marginRight: 6 }}>假设</ArcoTag>{item.replace(/^(假设|推断)[：:]\s*/, "")}</li>)}</ul> : <p className="subtle-text">未列出假设</p>}</ArcoCard></ArcoGrid.Col>
      <ArcoGrid.Col xs={24} md={12}><ArcoCard size="small" className="rq-subcard" title="待确认问题">{openQuestions.length ? <ol className="rq-compact-list">{openQuestions.map((item, index) => <li key={index}>{item}</li>)}</ol> : <p className="subtle-text">暂无待确认问题</p>}</ArcoCard></ArcoGrid.Col>
    </ArcoGrid.Row>
    {prompt ? <ArcoCard
      size="small"
      className="rq-subcard"
      title={<strong>Investigation 提示词</strong>}
      extra={
        <ArcoSpace size={8}>
          <ArcoButton type="secondary" size="small" htmlType="button" aria-expanded={promptOpen} aria-controls={promptBodyId} onClick={() => setPromptOpen((open) => !open)}>{promptOpen ? "收起提示词" : "展开提示词"}</ArcoButton>
          <ArcoButton size="small" type="primary" htmlType="button" onClick={() => void copyPrompt()}>{copied ? "已复制" : "复制提示词"}</ArcoButton>
        </ArcoSpace>
      }
    >
      <ArcoTypography.Text type="secondary" className="rq-caption">复制后带到你的 Agent 继续调查、写 PRD</ArcoTypography.Text>
      {promptOpen && <pre className="prd-prompt-text is-expanded" id={promptBodyId}>{prompt}</pre>}
      {copyError ? <ArcoAlert className="rq-inline-alert" type="error" showIcon role="alert" content={copyError} /> : null}
    </ArcoCard> : null}
  </div>;
}

/**
 * 需求评估区：补充背景/目标/场景后按需生成；
 * 历史版本来自独立表，不修改需求本体，也不回写 Base。
 */
/**
 * 评估是同步模型调用，服务端单次上限取 AI_TIMEOUT_MS（线上 120s）；客户端留 5s 余量。
 * 即便超时也不直接判失败：服务端可能仍在重试并最终落库成功，超时后按版本号核对。
 */
const ASSESSMENT_CLIENT_TIMEOUT_MS = 125_000;
/** 超时后核对最新评估版本的窗口：覆盖服务端失败重试的剩余时间。 */
const ASSESSMENT_RECONCILE_WINDOW_MS = 90_000;

function RequirementAssessmentSection({ requirementId, onSaved }: { requirementId: string; onSaved?: () => void }) {
  const [history, setHistory] = useState<RequirementAssessment[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [background, setBackground] = useState("");
  const [goal, setGoal] = useState("");
  const [scenario, setScenario] = useState("");
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // 切版本后回填的版本号：提示「已载入 vN 的输入，可改后重新生成」。
  const [loadedVersion, setLoadedVersion] = useState<number | null>(null);
  // 首次打开详情时默认载入最新版本的输入；静默轮询/用户已开始输入时不覆盖。
  const pendingInitialInputs = useRef(true);
  const inputsEdited = useRef(false);
  // 超时后待核对的一轮生成：记录发起前的最大版本号，只有更新的成功版本才算本轮成功。
  const pendingRecovery = useRef<{ baselineVersion: number } | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const loadRequestVersion = useRef(0);
  const generateControllerRef = useRef<AbortController | null>(null);
  // 父组件每次渲染都会传新的内联回调，用 ref 保存以免重建 load 触发挂载 effect 循环。
  const onSavedRef = useRef(onSaved);
  useEffect(() => { onSavedRef.current = onSaved; }, [onSaved]);
  const applyInputs = useCallback((assessment: RequirementAssessment) => {
    const inputs = assessment.inputs ?? { background: "", goal: "", scenario: "" };
    setBackground(inputs.background ?? "");
    setGoal(inputs.goal ?? "");
    setScenario(inputs.scenario ?? "");
  }, []);

  // preferLatest：生成失败后刷新时直接选中最新（失败）版本，避免结论区还停在旧版本。
  const load = useCallback(async (silent = false, preferLatest = false) => {
    const version = ++loadRequestVersion.current;
    if (!silent) { setLoadState("loading"); setLoadError(null); }
    try {
      // 防御：历史接口若返回错形状（如被通用列表路由兜底），不把无 version 的条目当成评估版本。
      const items = (await listRequirementAssessments(requirementId)).filter((item) => item && typeof item.version === "number");
      if (version !== loadRequestVersion.current) return;
      const latest = items.reduce((max, item) => Math.max(max, item.version), 0) || null;
      // 超时核对：只有比发起时更新的成功版本才算本轮成功，避免把旧版本误当成新结果。
      const pending = pendingRecovery.current;
      if (pending) {
        const newer = items.filter((item) => item.version > pending.baselineVersion);
        const succeeded = newer.filter((item) => item.status === "succeeded").sort((left, right) => right.version - left.version)[0];
        if (succeeded) {
          pendingRecovery.current = null;
          setReconciling(false);
          setError(null);
          setNotice(`评估 v${succeeded.version} 已生成。`);
          onSavedRef.current?.();
        } else if (newer.length > 0 && !newer.some((item) => item.status === "running")) {
          // 本轮已结束但没有成功版本：按失败展示最新版，错误码来自历史记录。
          const newest = newer.reduce((left, right) => (right.version > left.version ? right : left));
          pendingRecovery.current = null;
          setReconciling(false);
          setNotice(null);
          setError(`评估 v${newest.version} 生成失败（${newest.errorCode ?? "未知原因"}）。`);
        }
      }
      setHistory(items);
      setSelectedVersion((current) => preferLatest || current === null || !items.some((item) => item.version === current)
        ? latest
        : current);
      // PRD 4.10.7：打开详情时默认带上最新版本的补充输入；只在首次成功载入时做，静默刷新不覆盖草稿。
      if (pendingInitialInputs.current && items.length > 0) {
        pendingInitialInputs.current = false;
        if (!inputsEdited.current) applyInputs(items.reduce((left, right) => (right.version > left.version ? right : left)));
      }
      setLoadState("ready");
    } catch (cause) {
      if (version !== loadRequestVersion.current) return;
      if (!silent) { setLoadError(errorText(cause)); setLoadState("error"); }
    }
  }, [applyInputs, requirementId]);

  useEffect(() => {
    void load();
    return () => { loadRequestVersion.current += 1; };
  }, [load]);

  // 有 running 版本或超时核对中时每 5 秒静默刷新一次：生成完成后自动换成结论，期间保持按钮禁用。
  const hasRunning = history.some((item) => item.status === "running");
  useEffect(() => {
    if (!hasRunning && !reconciling) return;
    const timer = window.setInterval(() => { void load(true); }, 5000);
    return () => window.clearInterval(timer);
  }, [hasRunning, reconciling, load]);

  // 超时核对的兜底窗口：过了这段时间仍没有更新的版本，也不判失败（平台最坏 3×120s），
  // 只提示服务端仍在生成；保留待核对标记，已有 running 行时后续轮询仍能补解锁。
  useEffect(() => {
    if (!reconciling) return;
    const timer = window.setTimeout(() => {
      if (!pendingRecovery.current) return;
      setReconciling(false);
      setError(null);
      setNotice("服务端仍在生成，请稍后刷新查看。");
    }, ASSESSMENT_RECONCILE_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [reconciling]);

  // 409 单飞提示保留一小段时间：避免服务端 running 行还没被历史接口返回时按钮立刻可点。
  useEffect(() => {
    if (!conflict) return;
    const timer = window.setTimeout(() => setConflict(false), 15000);
    return () => window.clearTimeout(timer);
  }, [conflict]);

  // 后台轮询看到 running 结束（成功或失败）后，解除 409 的等待提示，避免残留「正在生成」。
  const sawRunning = useRef(false);
  useEffect(() => {
    if (hasRunning) { sawRunning.current = true; return; }
    if (!sawRunning.current) return;
    sawRunning.current = false;
    setConflict(false);
    setNotice((current) => current === "正在生成，请稍候。" ? null : current);
  }, [hasRunning]);

  // 切换需求时清空草稿输入与待核对状态，避免把上一条需求的背景或恢复状态带过去；下一条继续默认载入自己的最新输入。
  useEffect(() => {
    generateControllerRef.current?.abort();
    generateControllerRef.current = null;
    pendingRecovery.current = null;
    setReconciling(false);
    setConflict(false);
    setBusy(false);
    setBackground(""); setGoal(""); setScenario(""); setError(null); setNotice(null); setLoadedVersion(null);
    pendingInitialInputs.current = true;
    inputsEdited.current = false;
    return () => {
      generateControllerRef.current?.abort();
      generateControllerRef.current = null;
    };
  }, [requirementId]);

  const versions = [...history].sort((left, right) => right.version - left.version);
  const selected = versions.find((item) => item.version === selectedVersion) ?? versions[0] ?? null;

  // 切版本：把该版本的 inputs 载入输入框（可改后重新生成），不做只读锁。
  const switchVersion = (version: number) => {
    setSelectedVersion(version);
    const target = history.find((item) => item.version === version);
    if (!target) return;
    applyInputs(target);
    setLoadedVersion(version);
  };

  const generate = async () => {
    // 三项补充都可为空（PRD 4.10.3：全空也允许生成，结果更多落到 investigate）。
    const inputs = { background: background.trim(), goal: goal.trim(), scenario: scenario.trim() };
    setBusy(true); setError(null); setNotice(null); setLoadedVersion(null);
    // 用户已经主动填写/生成，之后不再用历史版本覆盖输入框。
    pendingInitialInputs.current = false;
    // 记录发起前的最大版本号：超时后只有更新的成功版本才算本轮结果。
    const baselineVersion = versions.reduce((max, item) => Math.max(max, item.version), 0);
    pendingRecovery.current = { baselineVersion };
    setReconciling(false);
    const controller = new AbortController();
    generateControllerRef.current = controller;
    let timedOut = false;
    // 服务端模型超时取 AI_TIMEOUT_MS（线上 120s），客户端留 5s 余量；超时后仍会核对落库结果。
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, ASSESSMENT_CLIENT_TIMEOUT_MS);
    try {
      const created = await createRequirementAssessment(requirementId, inputs, undefined, controller.signal);
      if (generateControllerRef.current !== controller) return;
      // 请求正常返回：本轮已有明确结果，不再走超时核对。
      pendingRecovery.current = null;
      setReconciling(false);
      setHistory((previous) => [created, ...previous.filter((item) => item.version !== created.version)]);
      setSelectedVersion(created.version);
      setNotice(created.status === "succeeded"
        ? `评估 v${created.version} 已生成。`
        : `评估 v${created.version} 生成失败（${created.errorCode ?? "未知原因"}）。`);
      // 同页的 PRD 提示词块按「是否有成功评估」解锁；生成完立刻通知它重新拉取，不必刷新页面。
      onSavedRef.current?.();
    } catch (cause) {
      if (generateControllerRef.current !== controller) return;
      // 同一需求已有未超时的 running 版本（409 单飞）：提示等待并禁用按钮，不重复烧 token。
      if (cause instanceof ApiError && cause.status === 409) {
        pendingRecovery.current = null;
        setReconciling(false);
        setConflict(true);
        setNotice("正在生成，请稍候。");
        setError(null);
        void load(true);
      } else if (timedOut) {
        // 客户端先超时不等于服务端失败：服务端可能仍在重试并已落库成功。
        // 先不报失败，按版本号核对；确认成功就补 onSaved 解锁提示词块，窗口内没有结果才提示超时。
        setError(null);
        setNotice("评估生成较慢，正在核对最新结果…");
        setReconciling(true);
        void load(true, true);
      } else {
        // 429/503/500 由服务端保留 failed 版本：静默刷新历史并选中最新版本，
        // 避免用户只看到报错、却在版本列表里找不到这次失败记录。
        pendingRecovery.current = null;
        setReconciling(false);
        setError(assessmentErrorMessage(cause));
        void load(true, true);
      }
    } finally {
      window.clearTimeout(timer);
      if (generateControllerRef.current === controller) {
        generateControllerRef.current = null;
        setBusy(false);
      }
    }
  };

  return <ArcoCard
    className="rq-card req-section req-assessment-section"
    aria-labelledby="req-assessment-heading"
    title={<h3 id="req-assessment-heading" className="rq-section-heading">需求评估</h3>}
    extra={<ArcoTag>AI 建议 · 非结论 · 按需生成</ArcoTag>}
  >
    <p className="detail-note">补充背景、目标、使用场景后生成评估；补充内容只保存在评估记录里，不修改需求本体，也不写 Base。评估按需生成，不会自动消耗模型调用。</p>
    <ArcoForm layout="vertical" className="rq-compact-form">
      <ArcoGrid.Row gutter={[12, 0]}>
        <ArcoGrid.Col xs={24} md={8}><ArcoForm.Item label="需求背景（不超过 2000 字）"><ArcoInput.TextArea aria-label="需求背景" rows={3} maxLength={2000} showWordLimit value={background} onChange={(value: string) => { inputsEdited.current = true; setBackground(value); }} disabled={busy} placeholder="为什么要做：用户场景、当前问题、触发来源。" /></ArcoForm.Item></ArcoGrid.Col>
        <ArcoGrid.Col xs={24} md={8}><ArcoForm.Item label="目标（不超过 1000 字）"><ArcoInput.TextArea aria-label="需求目标" rows={3} maxLength={1000} showWordLimit value={goal} onChange={(value: string) => { inputsEdited.current = true; setGoal(value); }} disabled={busy} placeholder="希望达成什么结果；尽量可度量。" /></ArcoForm.Item></ArcoGrid.Col>
        <ArcoGrid.Col xs={24} md={8}><ArcoForm.Item label="使用场景（不超过 2000 字）"><ArcoInput.TextArea aria-label="使用场景" rows={3} maxLength={2000} showWordLimit value={scenario} onChange={(value: string) => { inputsEdited.current = true; setScenario(value); }} disabled={busy} placeholder="谁在什么情况下使用；包含环境、硬件型号、频率等约束。" /></ArcoForm.Item></ArcoGrid.Col>
      </ArcoGrid.Row>
    </ArcoForm>
    {loadedVersion !== null ? <ArcoAlert className="rq-inline-alert" type="info" showIcon role="status" content={`已载入 v${loadedVersion} 的输入，可改后重新生成。`} /> : null}
    <ArcoSpace size={10} wrap align="center" className="rq-action-bar">
      <ArcoButton type="primary" htmlType="button" size="small" onClick={() => void generate()} disabled={busy || conflict || hasRunning}>{busy ? "生成中…（约 30 秒）" : conflict || hasRunning ? "正在生成，请稍候" : "生成评估"}</ArcoButton>
      {loadState === "loading" ? <span className="subtle-text">正在读取评估历史…</span> : null}
      {loadState === "error" ? <div role="alert" style={{ display: "inline-flex" }}><ArcoSpace size={6}><ArcoTypography.Text type="error">评估历史读取失败：{loadError}</ArcoTypography.Text><ArcoButton type="text" size="small" htmlType="button" onClick={() => void load()}>重试</ArcoButton></ArcoSpace></div> : null}
      {versions.length > 0 ? (
        <ArcoRadio.Group
          type="button"
          size="small"
          aria-label="评估版本"
          value={selected?.version}
          onChange={(val: number) => switchVersion(val)}
          options={versions.map((item) => ({
            label: `v${item.version}${item.status === "running" ? " 生成中" : item.status !== "succeeded" ? "（失败）" : ""}`,
            value: item.version,
          }))}
        />
      ) : null}
    </ArcoSpace>
    <StateBanner loadError={error} notice={notice} onCloseNotice={() => setNotice(null)} />
    {selected ? <AssessmentResult assessment={selected} /> : loadState === "ready" ? <ArcoEmpty className="rq-empty" description={<div className="rq-empty-copy"><strong>还没有评估结果</strong><span>补充背景、目标或使用场景后生成第一版。</span></div>} /> : null}
  </ArcoCard>;
}

/**
 * PRD-31：多维表格来源的详情只读展示相似需求。
 * R8 两段查询：先用整条标题；0 条且标题超过 8 字时，去掉【…】前缀取前 8 字再查一次。
 * 每次渲染最多 2 次请求，2s 超时或失败静默隐藏，不写 duplicate_of、不自动压制。
 */
function SimilarRequirementSection({ requirementId, title }: { requirementId: string; title: string }) {
  const [items, setItems] = useState<RequirementSummary[]>([]);
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => {
    let cancelled = false;
    setItems([]);

    // 单次查询：2s 超时中断；异常交给 run() 统一静默隐藏。
    const search = async (query: string) => {
      const controller = new AbortController();
      controllerRef.current = controller;
      const timer = window.setTimeout(() => controller.abort(), 2000);
      try {
        const result = await listRequirements({ q: query, limit: 5, processingState: "active", signal: controller.signal });
        return result.items;
      } finally {
        window.clearTimeout(timer);
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    };

    const run = async () => {
      const fullTitle = title.trim();
      if (!fullTitle) return;
      const matches = (await search(fullTitle)).filter((item) => item.id !== requirementId);
      if (cancelled) return;
      if (matches.length > 0) { setItems(matches.slice(0, 5)); return; }
      // 第二段只对长标题生效；避免与第一段完全相同的查询。
      if (Array.from(fullTitle).length <= 8) return;
      const fallbackQuery = Array.from(fullTitle.replace(/^【[^】]*】\s*/, "")).slice(0, 8).join("").trim();
      if (!fallbackQuery || fallbackQuery === fullTitle) return;
      const fallbackMatches = (await search(fallbackQuery)).filter((item) => item.id !== requirementId);
      if (!cancelled) setItems(fallbackMatches.slice(0, 5));
    };

    void run().catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; controllerRef.current?.abort(); };
  }, [requirementId, title]);

  // 0 条、查询中、超时或失败都整块不渲染（PRD-31 C）。
  if (items.length === 0) return null;
  return <ArcoCard
    className="rq-card req-section req-similar-section"
    aria-labelledby="req-similar-heading"
    title={<h3 id="req-similar-heading" className="rq-section-heading">相似需求（只读，仅供参考）</h3>}
    extra={<ArcoTag>按标题关键字匹配</ArcoTag>}
  >
    <p className="detail-note">相似需求只作参考：不会写回重复判定、不自动压制，也不影响本条需求的编辑与推送。</p>
    <ul className="rq-compact-list">
      {items.map((item) => <li key={item.id}>
        <a href={`?requirement=${item.id}`} target="_blank" rel="noreferrer">{item.platformRequirementId ? `${item.platformRequirementId} · ` : ""}{item.title}</a>
        <span className="subtle-text"> · {requirementSourceName(item)}</span>
      </li>)}
    </ul>
  </ArcoCard>;
}

function RequirementDetailPage({ detail, detailId, loading, error, notice, busy, autoOpenOwnerPicker, onCloseNotice, onBack, onRefresh, onAct, onSaved, onDelete, canDelete = false, onRestore, canRestore = false, restoreBusy = false }: {
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
  onSaved: (id: string) => void;
  /** PRD §4.13：只有当前有效负责人可见「移入回收站」。 */
  onDelete?: () => void;
  canDelete?: boolean;
  onRestore?: (id: string) => Promise<void>;
  canRestore?: boolean;
  restoreBusy?: boolean;
}) {
  const [ownerPickerOpen, setOwnerPickerOpen] = useState(autoOpenOwnerPicker);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  // 递增后让 PRD 提示词块重新拉取评估列表（评估生成成功后解锁前置门禁）。
  const [assessmentRevision, setAssessmentRevision] = useState(0);
  const ownerEditorId = useId();
  useEffect(() => { setOwnerPickerOpen(autoOpenOwnerPicker); }, [detail?.id, autoOpenOwnerPicker]);
  useEffect(() => { setDescriptionExpanded(false); }, [detail?.id]);

  if (!detail) {
    return <div className="req-detail-page">
      <ArcoCard className="rq-card req-detail-summary">
        <div style={{ marginBottom: 12 }}><ArcoButton htmlType="button" onClick={onBack} type="secondary" size="small"><ArrowLeft size={14} />返回需求池</ArcoButton></div>
        <h2 className="req-summary-title">{loading ? <SkeletonBlock className="skeleton-title" /> : "无法载入需求详情"}</h2>
        <span className="mono-cell">REQ {detailId.slice(0, 8)}</span>
      </ArcoCard>
      {loading && <RequirementDetailSkeleton />}
      <StateBanner loadError={error} notice={notice} onCloseNotice={onCloseNotice} />
      {!loading && <div className="rq-action-bar"><ArcoButton htmlType="button" onClick={onRefresh} type="secondary" size="small"><RefreshCw size={14} />重试载入</ArcoButton></div>}
    </div>;
  }

  const structured: AnalysisStructured = (detail.analysis ?? {}) as AnalysisStructured;
  const facts = requirementSourceFacts(detail);
  // 5c-1：详情来源说明与列表徽标一致；TB 是默认来源，没有徽标但有同样的来源行。
  const sourceInfo = requirementSourceInfo({ sourceType: detail.sourceType, sourceChannel: detail.sourceChannel, source: detail.source });
  const sourceLabel = sourceInfo?.name ?? "Teambition";
  // 非 Teambition 来源没有 TB 执行人/状态/链接/更新时间：详情只保留有值的提出人，避免一整排「—」。
  const sourceKind = sourceInfo?.kind ?? "teambition";
  const isTbSource = sourceKind === "teambition";
  const owner = requirementOwnerView(detail);
  // P1 重复处理：压制态需求不进入 AI 分析 / Base 推送 / 通知，相关操作入口必须一并收敛。
  const processingState = requirementProcessingState(detail);
  const suppressed = processingState !== "active";
  const suppressedLabel = processingStateLabels[processingState];
  // PRD §4.13.7：已删除详情只读；只有删除人能看到还原入口，其余动作一律不渲染。
  const deleted = Boolean(detail.deletedAt) || detail.lifecycleState === "deleted";
  if (deleted) {
    return <div className="req-detail-page req-deleted-detail">
      <ArcoCard className="rq-card req-detail-summary">
        <div className="req-summary-backbar" style={{ marginBottom: 12 }}><ArcoButton htmlType="button" onClick={onBack} type="secondary" size="small"><ArrowLeft size={14} />返回</ArcoButton></div>
        <h2 className="req-summary-title" style={{ marginBottom: 0 }}>
          <span>{detail.title}</span>
          {" "}
          <ArcoTag size="small">已删除</ArcoTag>
          {detail.pool === "group" ? <>{" "}{poolChip("group")}</> : null}
        </h2>
        <div className="mono-cell" style={{ marginTop: 4 }}>{detail.platformRequirementId ?? (detail.sourceRequirementId ? `REQ-${detail.sourceRequirementId.slice(0, 8)}` : "WEB")} · v{detail.sourceVersion}</div>
        <div className="req-summary-meta">
          <ArcoSpace size={16} wrap>
            <span className="subtle-text">删除时间：{detail.deletedAt ? timeLabel(detail.deletedAt) : "—"}</span>
            <span className="subtle-text">删除前处理状态：{suppressedLabel}</span>
          </ArcoSpace>
          <div role="group" aria-label="已删除需求操作">
            <ArcoSpace size={8}>
              {canRestore ? <ArcoButton type="primary" size="small" htmlType="button" loading={restoreBusy} onClick={() => void onRestore?.(detail.id)}>还原需求</ArcoButton> : null}
              <ArcoButton htmlType="button" onClick={onRefresh} disabled={busy || restoreBusy} type="secondary" size="small"><RefreshCw size={14} />刷新</ArcoButton>
            </ArcoSpace>
          </div>
        </div>
        <p className="detail-note">已删除需求只读：编辑、负责人、重复判定、AI 分析、评估、提示词、评分与 Base 推送均已停止；飞书 Base 中的历史行保留原样。</p>
      </ArcoCard>
      <StateBanner loadError={error} notice={notice} onCloseNotice={onCloseNotice} />
      <ArcoCard
        className="rq-card req-section"
        aria-labelledby="req-l1-heading"
        title={<h3 id="req-l1-heading" className="rq-section-heading">需求信息</h3>}
        extra={<ArcoTag>{sourceLabel}</ArcoTag>}
      >
        <div className="req-field">
          <ArcoTypography.Text type="secondary" className="rq-caption">标题</ArcoTypography.Text>
          <p className="req-l1-title">{detail.title}</p>
        </div>
        <div className="req-field req-description-field">
          <ArcoTypography.Text type="secondary" className="rq-caption">描述</ArcoTypography.Text>
          {facts.description ? <p className="req-description is-expanded">{facts.description}</p> : <span className="req-empty-value">—</span>}
        </div>
        <ArcoDescriptions
          size="small"
          column={{ xs: 1, sm: 2 }}
          data={[
            { label: "池", value: poolChip(detail.pool) },
            { label: "来源", value: sourceLabel },
            { label: "删除时间", value: detail.deletedAt ? timeLabel(detail.deletedAt) : "—" },
            { label: "删除前处理状态", value: suppressedLabel },
          ]}
        />
      </ArcoCard>
    </div>;
  }
  const evidence = analysisStrings(structured.evidence);
  const factItems = Array.isArray(structured.facts)
    ? (structured.facts as { text?: unknown }[]).map((fact) => analysisText(fact.text)).filter((text): text is string => text !== null)
    : [];
  const inferenceItems = Array.isArray(structured.inferences)
    ? (structured.inferences as { text?: unknown }[]).map((inference) => analysisText(inference.text)).filter((text): text is string => text !== null)
    : [];
  const missingInputs = analysisStrings(structured.missing_inputs);
  const blindSpots = analysisStrings(structured.blind_spots);
  interface AdviceCard { label: string; conclusion: string; rationale?: string | null; evidence?: string[]; missing?: boolean }
  // V02-T08：六层人群与类型建议；旧分析缺字段 → 未提供/待判断，不推断“不适用”。
  const AUDIENCE_NAMES: Record<string, string> = { L1: "L1 职业级 Pro", L2: "L2 竞技级 Racing", L3: "L3 爱好者/专业入门", L4: "L4 健身锻炼", L5: "L5 休闲娱乐", L6: "L6 通勤代步" };
  const audienceItems = Array.isArray(structured.audience)
    ? (structured.audience as { level?: unknown; reason?: unknown }[]).filter((item) => typeof item.level === "string")
    : null;
  const typeSuggestion = analysisText(structured.typeSuggestion);
  const adviceCards: AdviceCard[] = [
    { label: "模块建议", conclusion: analysisText(structured.module) ?? "—" },
    { label: "类型建议", conclusion: typeSuggestion ?? (structured.typeSuggestion === undefined ? "未提供（旧版本分析）" : "待判断") },
    {
      label: "适用人群建议",
      conclusion: audienceItems === null ? "未提供（旧版本分析）" : audienceItems.length ? audienceItems.map((item) => AUDIENCE_NAMES[String(item.level)] ?? String(item.level)).join("、") : "待判断",
      rationale: audienceItems === null ? null : audienceItems.map((item) => `${AUDIENCE_NAMES[String(item.level)] ?? item.level}：${typeof item.reason === "string" ? item.reason : ""}`).join("；") || null,
    },
    { label: "整体置信度", conclusion: analysisText(structured.confidence) ?? "—", rationale: analysisText(structured.confidence_reason) },
  ];

  // 操作可用性只取决于流水线状态；不可用时保留按钮并说明原因，避免「入口消失 = 不知道能做什么」。
  // 压制态（重复/忽略）不进入 AI 分析、Base 推送与通知：所有会入队的入口保持禁用，撤销判定后恢复。
  const analysisRetryable = !suppressed && ["failed_retryable", "pending", "analyzed"].includes(detail.pipeline.analysis);
  const analysisActionLabel = detail.pipeline.analysis === "analyzed" ? "重新分析" : "重试 AI 分析";
  const pushRetryable = !suppressed && detail.pipeline.push === "failed";
  const ownerMapped = ["auto_mapped", "manually_mapped"].includes(detail.pipeline.owner);
  const ownerSaveLabel = detail.pipeline.owner === "pending_mapping" ? "保存负责人并入队推送" : ownerMapped ? "变更负责人并入队推送" : "分配负责人并入队推送";
  const analysisDisabledReason = suppressed
    ? "该需求已被压制，不会进入 AI 分析；如需分析请先在「重复处理」撤销判定。"
    : detail.pipeline.analysis === "running"
      ? "AI 分析正在进行中，完成后可查看结果。"
      : detail.pipeline.analysis === "analyzed"
        ? "重新分析会基于当前已发布的词典/规则创建新版本。"
        : detail.pipeline.analysis === "failed"
          ? "该需求的分析失败不可自动重试，请检查源数据或联系管理员。"
          : "当前状态不可重试 AI 分析。";
  const pushDisabledReason = suppressed
    ? "该需求已被压制，不会进入 Base 推送；如需推送请先在「重复处理」撤销判定。"
    : detail.pipeline.push === "pushed"
      ? "Base 推送已完成，无需重试；PM 在飞书多维表格继续处理。"
      : detail.pipeline.push === "running"
        ? "Base 推送进行中，完成后刷新详情可看到最新状态。"
        : detail.pipeline.push === "pending"
          ? "Base 推送排队中，完成后刷新详情可看到最新状态。"
          : "当前状态不可重试 Base 推送。";
  // 没有可重试项时也要给出一句明确的下一步说明，而不是留白。
  // 「可重跑」包含 already analyzed；指引不能把已完成的分析说成未完成。
  const analysisIncomplete = ["pending", "failed_retryable", "running"].includes(detail.pipeline.analysis);
  const guidance = (suppressed
    ? [`该需求已被压制（${suppressedLabel}）：不会进入 AI 分析、Base 推送与通知；如需恢复请在下方「重复处理」撤销判定。`]
    : [
      detail.pipeline.push === "pushed" ? "该需求已推送完成，PM 在飞书多维表格继续处理；如需换人可在此变更负责人。" : "",
      pushRetryable ? (ownerMapped ? "Base 推送失败：可重试推送，也可变更负责人后重新排队。" : "Base 推送失败：请先分配负责人，再重试推送。") : "",
      analysisIncomplete ? (detail.pipeline.analysis === "running" ? "AI 分析正在进行中；完成后刷新查看结果。" : "AI 分析未完成，可在此重试分析。") : "",
      detail.pipeline.analysis === "failed" ? "AI 分析失败且不可自动重试；失败摘要见「查看依据与历史」中的分析版本记录。" : "",
    ]).filter(Boolean).join(" ") || "当前没有待重试的失败项；如需换人可在此变更负责人。";

  // TB「创建时间」仍取源快照；底部「这条需求怎么来的」取服务端创建时间（平台收录时间，四种来源一致，F1）。
  const sourceCreatedAt = formatDateTime(facts.createdAt);
  const platformCreatedAt = formatDateTime(detail.createdAt ?? null) ?? sourceCreatedAt;
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
  const summaryCurrent = detail.scoring?.current ?? null;
  const summaryAi = detail.scoring?.aiSuggestion ?? null;
  const summaryScore = summaryCurrent ?? summaryAi;
  const dimensionInsights: DimensionInsight[] = [
    { key: "U", recommendation: analysisText(structured.recommendations?.user?.recommendation), rationale: analysisText(structured.recommendations?.user?.rationale), evidence: analysisStrings(structured.recommendations?.user?.evidence), missing: structured.recommendations?.user?.missing_evidence === true },
    { key: "M", recommendation: analysisText(structured.recommendations?.market?.recommendation), rationale: analysisText(structured.recommendations?.market?.rationale), evidence: analysisStrings(structured.recommendations?.market?.evidence), missing: structured.recommendations?.market?.missing_evidence === true },
    { key: "S", recommendation: analysisText(structured.recommendations?.business?.recommendation), rationale: analysisText(structured.recommendations?.business?.rationale), evidence: analysisStrings(structured.recommendations?.business?.evidence), missing: structured.recommendations?.business?.missing_evidence === true },
    { key: "C", recommendation: analysisText(structured.recommendations?.technology?.recommendation), rationale: analysisText(structured.recommendations?.technology?.rationale), evidence: analysisStrings(structured.recommendations?.technology?.evidence), missing: structured.recommendations?.technology?.missing_evidence === true },
  ];
  const audienceSuggestedTags = audienceItems?.map((item) => String(item.level)).filter((level) => Boolean(AUDIENCE_NAMES[level])) ?? [];
  const audienceEditor = <div className="score-analysis-subsection audience-analysis-block">
    <div className="score-analysis-subhead"><h5>适用人群</h5><span>AI 建议仅供参考；PM 确认值单独保存</span></div>
    <AudienceEditor requirementId={detail.id} audience={detail.audience ?? { tags: [], confirmed: false, version: 0 }} suggestedTags={audienceSuggestedTags} onSaved={() => onSaved(detail.id)} />
  </div>;
  const aiAnalysisBody = detail.analysis
    ? <>
      <div className="score-analysis-subsection">
        <div className="score-input-head"><h5>模块、类型与整体判断</h5><ArcoTypography.Text type="secondary" className="rq-caption">AI 生成 · 可被推翻</ArcoTypography.Text></div>
        <ArcoGrid.Row gutter={[12, 12]} className="advice-grid">
          {adviceCards.map((card) => (
            <ArcoGrid.Col key={card.label} xs={24} sm={12}>
              <ArcoCard size="small" className="rq-subcard advice-card">
                <ArcoTypography.Text type="secondary" className="rq-caption">{card.label}</ArcoTypography.Text>
                <div style={{ marginTop: 4 }}><strong>{card.conclusion}</strong></div>
                {card.rationale && <p className="detail-note">理由：{card.rationale}</p>}
                {card.evidence && card.evidence.length > 0 && <p className="detail-note">证据：{card.evidence.join("；")}</p>}
                {card.missing && <ArcoTag size="small" color="orange" style={{ marginTop: 6 }}>需要补充信息</ArcoTag>}
              </ArcoCard>
            </ArcoGrid.Col>
          ))}
        </ArcoGrid.Row>
      </div>
    </>
    : <ArcoEmpty
        className="rq-empty"
        description={
          <div className="rq-empty-copy">
            <strong>尚未分析</strong>
            <span>{detail.pipeline.analysis === "running" ? "AI 分析正在进行中；完成后刷新查看结果。" : "该需求还没有可用的 AI 分析结果。"}</span>
            <ArcoSpace size={8}>
              <ArcoButton type="secondary" htmlType="button" size="small" onClick={() => void onAct(async () => { await retryAnalysis(detail.id); return "AI 分析重试已入队"; }, detail.id)} disabled={busy || !analysisRetryable} title={analysisRetryable ? "提交 AI 分析（会消耗一次模型调用）" : analysisDisabledReason}>{analysisActionLabel}</ArcoButton>
              <span className="subtle-text">会消耗一次模型调用</span>
            </ArcoSpace>
          </div>
        }
      />;
  const aiAnalysisContent = <>{audienceEditor}{aiAnalysisBody}<div className="rq-action-bar"><BetaPanel requirementId={detail.id} /></div></>;

  return <div className="req-detail-page">
    <ArcoCard className="rq-card req-detail-summary">
      <div className="req-summary-backbar" style={{ marginBottom: 12 }}><ArcoButton htmlType="button" onClick={onBack} type="secondary" size="small"><ArrowLeft size={14} />返回需求池</ArcoButton></div>
      <div className="req-summary-top">
        <div className="req-summary-heading">
          <h2 className="req-summary-title" style={{ marginBottom: 0 }}>
            <span>{detail.title}</span>
            {detail.pool === "group" ? <>{" "}{poolChip("group")}</> : null}
          </h2>
          <div className="mono-cell" style={{ marginTop: 4 }}>{detail.platformRequirementId ?? (detail.sourceRequirementId ? `REQ-${detail.sourceRequirementId.slice(0, 8)}` : "WEB")} · v{detail.sourceVersion}</div>
          {detail.duplicateOf && <ArcoAlert className="rq-inline-alert" type="warning" showIcon role="note" content={<>该需求与另一条需求标题相同，仅作疑似重复提示；两条记录仍按各自的来源 ID 独立保留，是否压制由人工判定决定。<a href={`?requirement=${detail.duplicateOf}`}>查看另一条</a></>} />}
          {detail.duplicates && detail.duplicates.length > 0 && <ArcoAlert className="rq-inline-alert" type="warning" showIcon role="note" content={<>发现 {detail.duplicates.length} 条同标题疑似重复需求：{detail.duplicates.map((duplicate, index) => <span key={duplicate.id}>{index > 0 ? "、" : ""}<a href={`?requirement=${duplicate.id}`}>{duplicate.title}</a></span>)}。这些记录均独立保留；可在下方「重复处理」确认重复或忽略，被压制记录不再进入 AI 分析、Base 推送与通知。</>} />}
        </div>
        <div className="req-summary-score" aria-label="评分与优先级摘要">
          <ArcoTypography.Text type="secondary" className="rq-caption">{summaryCurrent ? "当前综合评分" : summaryAi ? "AI 建议" : "综合评分"}</ArcoTypography.Text>
          {summaryScore ? <>
            <div className="summary-score-line">
              <strong>{summaryScore.score.toFixed(2)}</strong>
              <ArcoTag color={PRIORITY_TAG_COLORS[summaryScore.priority] ?? "gray"}>{summaryScore.priority}</ArcoTag>
            </div>
            <ArcoTypography.Text type="secondary" className="rq-caption">v{summaryScore.version} · {scoreOriginLabel(summaryScore.origin)}{summaryScore.scoreConfidence ? ` · ${summaryScore.scoreConfidence}置信度` : ""}</ArcoTypography.Text>
            <ArcoButton type="text" size="small" htmlType="button" onClick={() => scrollToSection("req-scoring-heading")}>查看评分与依据</ArcoButton>
          </> : <div><strong>暂无评分</strong><div className="subtle-text">AI 分析后生成，或手动填写</div></div>}
        </div>
      </div>
      <div className="req-summary-meta">
        <ArcoSpace size={8} align="center" wrap>
          <ArcoTypography.Text type="secondary">负责人</ArcoTypography.Text>
          <OwnerBadge owner={owner} />
          {detail.manualOwner && <ArcoTag size="small" color="arcoblue" title="只影响这一条需求，不会改动同 TB 执行人的其他需求">手动指定</ArcoTag>}
          {detail.manualOwner && <ArcoButton type="text" size="small" disabled={busy || suppressed} title={suppressed ? "已压制需求不会推送；请先撤销判定" : undefined} onClick={() => void onAct(async () => {
            const result = await clearOwner(detail.id);
            return `已恢复默认负责人（${pipelineLabel("owner", result.ownerState)}）${result.status === "queued" ? "，Base 推送已排队" : "；等待默认负责人映射"}`;
          }, detail.id)} htmlType="button">恢复默认负责人</ArcoButton>}
        </ArcoSpace>
        <div className="req-stage-row" role="group" aria-label="处理状态">{stages.map(([stage, state]) => <StageBadge key={stage} stage={stage} state={state} />)}</div>
        <div role="group" aria-label="需求操作">
          <ArcoSpace size={8} wrap>
            <ArcoButton htmlType="button" aria-expanded={ownerPickerOpen} aria-controls={ownerEditorId} onClick={() => setOwnerPickerOpen((open) => !open)} disabled={busy || suppressed} type="primary" size="small">{suppressed ? "分配 / 变更负责人（已压制）" : "分配 / 变更负责人"}</ArcoButton>
            <ArcoTooltip content={analysisRetryable ? "重新提交 AI 分析（会消耗一次模型调用）" : analysisDisabledReason}>
              <ArcoButton type="secondary" htmlType="button" size="small" onClick={() => void onAct(async () => { await retryAnalysis(detail.id); return "AI 分析重试已入队"; }, detail.id)} disabled={busy || !analysisRetryable} title={analysisRetryable ? "重新提交 AI 分析（会消耗一次模型调用）" : analysisDisabledReason}>{analysisActionLabel}</ArcoButton>
            </ArcoTooltip>
            <span className="subtle-text">会消耗一次模型调用</span>
            <ArcoTooltip content={pushRetryable ? "重新提交 Base 推送" : pushDisabledReason}>
              <ArcoButton type="secondary" htmlType="button" size="small" onClick={() => void onAct(async () => { const result = await pushRequirement(detail.id); return result.status === "queued" ? "Base 推送重试已入队" : `推送状态：${result.status}`; }, detail.id)} disabled={busy || !pushRetryable} title={pushRetryable ? "重新提交 Base 推送" : pushDisabledReason}>重试 Base 推送</ArcoButton>
            </ArcoTooltip>
            {canDelete && onDelete ? <ArcoButton type="outline" htmlType="button" size="small" status="danger" onClick={onDelete}>移入回收站</ArcoButton> : null}
            <ArcoButton htmlType="button" onClick={onRefresh} disabled={busy} type="secondary" size="small"><RefreshCw size={14} />刷新</ArcoButton>
          </ArcoSpace>
        </div>
      </div>
      <p className="detail-note">{guidance}</p>
      {ownerPickerOpen && !suppressed && <div className="detail-owner-editor" id={ownerEditorId}>
        <p className="detail-note" style={{ marginTop: 0, marginBottom: 8 }}>只修改当前这一条需求的负责人，不会改动同 TB 执行人名下的其他需求或全局映射；保存后重新排队 Base 推送。{detail.manualOwner ? "点击「恢复默认负责人」可回到 TB 执行人映射。" : ""}</p>
        <FeishuUserPicker key={detail.id} disabled={busy} saveLabel={ownerSaveLabel} onMap={async (user) => {
          const ok = await onAct(async () => {
            const result = await setOwner(detail.id, { feishuUserId: user.feishuUserId, feishuIdType: user.feishuIdType, tbDisplayName: user.name });
            return `${user.name} 负责人已${ownerMapped ? "变更" : "分配"}（${pipelineLabel("owner", result.ownerState)}），推送已排队`;
          }, detail.id);
          if (ok) setOwnerPickerOpen(false);
        }} />
      </div>}
    </ArcoCard>

    <StateBanner loadError={error} notice={notice} onCloseNotice={onCloseNotice} />

    {detail.sourceMissingSince && <ArcoAlert type="warning" showIcon role="status" content={`该需求的 Teambition 来源记录已不在最近一次全量同步中（${timeLabel(detail.sourceMissingSince)} 起未出现）。记录与处理状态保留；如来源恢复出现，标记会自动清除。`} />}
    {suppressed && <ArcoAlert
      className="suppressed-detail-banner"
      type="error"
      showIcon
      role="alert"
      title={`该需求已被压制（${suppressedLabel}）`}
      content="被压制的需求不会进入 AI 分析、Base 推送与通知；记录仍保留。请在下方「重复处理」撤销判定后恢复为活跃。"
      action={<ArcoButton type="secondary" htmlType="button" size="small" onClick={() => scrollToSection("req-duplicate-heading")}>前往撤销判定</ArcoButton>}
    />}

    <ArcoCard
      className="rq-card req-section"
      aria-labelledby="req-l1-heading"
      title={<h3 id="req-l1-heading" className="rq-section-heading">需求信息</h3>}
      extra={<ArcoTag>{sourceInfo?.note ?? "来自 Teambition"}</ArcoTag>}
    >
      <div className="req-field">
        <TbFieldLabel kind={sourceKind}>标题</TbFieldLabel>
        <p className="req-l1-title">{detail.title}</p>
      </div>
      <div className="req-field req-description-field">
        <TbFieldLabel kind={sourceKind}>描述</TbFieldLabel>
        {facts.description ? <>
          <p className={`req-description${descriptionExpanded ? " is-expanded" : ""}`}>{facts.description}</p>
          {facts.description.length > 140 && <ArcoButton type="text" size="small" htmlType="button" onClick={() => setDescriptionExpanded((expanded) => !expanded)}>{descriptionExpanded ? "收起描述" : "展开全部"}</ArcoButton>}
        </> : <span className="req-empty-value" title="Teambition 未提供该字段">—</span>}
      </div>
      {(isTbSource || facts.proposerName) ? (
        <ArcoDescriptions
          size="small"
          column={{ xs: 1, sm: 2, md: 3 }}
          style={{ marginTop: 12 }}
          data={[
            { label: <TbFieldLabel kind={sourceKind}>提出人</TbFieldLabel>, value: <SourceValue value={facts.proposerName} /> },
            ...(isTbSource ? [
              { label: <TbFieldLabel kind={sourceKind}>执行人</TbFieldLabel>, value: <SourceValue value={facts.executorName} /> },
              { label: <TbFieldLabel kind={sourceKind}>状态</TbFieldLabel>, value: <SourceValue value={facts.tbStatus} emptyHint="Teambition 未提供该字段；工作台不推断状态名称" /> },
              { label: <TbFieldLabel kind={sourceKind}>链接</TbFieldLabel>, value: <SourceValue value={facts.tbUrl} href emptyHint="Teambition 未提供该字段" /> },
              { label: <TbFieldLabel kind={sourceKind}>创建时间</TbFieldLabel>, value: <SourceValue value={sourceCreatedAt} emptyHint="Teambition 未提供该字段" /> },
              { label: <TbFieldLabel kind={sourceKind}>更新时间</TbFieldLabel>, value: <SourceValue value={updatedAt ?? facts.updatedAt} emptyHint="Teambition 未提供该字段" /> },
            ] : []),
          ]}
        />
      ) : null}
      {(detail.intakeModule || detail.productModel || detail.requirementType || detail.constraintNotes || detail.supplementUrl) ? (
        <ArcoDescriptions
          size="small"
          column={{ xs: 1, sm: 2 }}
          style={{ marginTop: 12 }}
          title="录入上下文"
          data={[
            ...(detail.intakeModule ? [{ label: "模块（录入）", value: detail.intakeModule }] : []),
            ...(detail.productModel ? [{ label: "产品/型号", value: detail.productModel }] : []),
            ...(detail.requirementType ? [{ label: "需求类型（录入）", value: detail.requirementType }] : []),
            ...(detail.constraintNotes ? [{ label: "边界/限制", value: detail.constraintNotes }] : []),
            ...(detail.supplementUrl ? [{ label: "来源链接", value: safeHttpUrl(detail.supplementUrl) ? <a href={safeHttpUrl(detail.supplementUrl)!} target="_blank" rel="noreferrer">{detail.supplementUrl}</a> : detail.supplementUrl }] : []),
          ]}
        />
      ) : null}
      <ManualEditSection detail={detail} onSaved={() => onSaved(detail.id)} />
    </ArcoCard>

    {/* 决策按 (来源配置, TB 需求ID) 保存，非 Teambition 来源没有这个身份、后端会 404：仅 TB 显示。
        PRD-31：base_form 详情改为只读展示相似需求；手工/聊天粘贴不展示重复处理。 */}
    {isTbSource
      ? <DuplicateDecisionSection detail={detail} onSaved={() => onSaved(detail.id)} />
      : sourceKind === "base_form"
        ? <SimilarRequirementSection requirementId={detail.id} title={detail.title} />
        : null}

    <ScoringPanel requirementId={detail.id} scoring={detail.scoring} dimensionInsights={dimensionInsights} onSaved={() => onSaved(detail.id)}>
      {aiAnalysisContent}
    </ScoringPanel>

    <PriorityOverrideSection detail={detail} onSaved={() => onSaved(detail.id)} />

    <AnalysisContextSection detail={detail} onSaved={() => onSaved(detail.id)} />

    <RequirementAssessmentSection requirementId={detail.id} onSaved={() => setAssessmentRevision((value) => value + 1)} />
    <PrdPromptSection key={detail.id} requirementId={detail.id} assessmentRevision={assessmentRevision} />

    <ArcoCard
      className="rq-card req-section"
      aria-labelledby="req-status-heading"
      title={<h3 id="req-status-heading" className="rq-section-heading">处理与推送</h3>}
      extra={<ArcoTag>系统状态</ArcoTag>}
    >
      <ArcoDescriptions
        size="small"
        column={{ xs: 1, sm: 2 }}
        data={[
          { label: "四阶段状态", value: <div className="req-stage-row">{stages.map(([stage, state]) => <StageBadge key={stage} stage={stage} state={state} />)}</div> },
          { label: "负责人映射方式", value: pipelineLabel("owner", detail.pipeline.owner) },
          { label: "Base 记录", value: <BaseRecordReference recordId={detail.baseRecordId} url={detail.baseRecordUrl ?? null} /> },
          { label: "推送时间", value: pushTime ?? <span className="req-empty-value" title="接口未返回推送时间">—</span> },
          { label: "最近一次失败", value: failureText ?? <span className="req-empty-value" title="没有最近失败记录">—</span> },
        ]}
      />
      <p className="detail-note">推送成功不代表飞书 PM 通知已送达；PM 处理状态与通知送达以飞书多维表格为准。</p>
    </ArcoCard>

    <ArcoCard className="rq-card req-section req-audit-section">
      <Collapse className="req-audit" defaultActiveKey={[]}>
        <Collapse.Item name="requirement-audit" header="查看依据与历史">
          <ArcoDescriptions
            size="small"
            layout="vertical"
            column={{ xs: 1, sm: 2 }}
            data={[
              { label: "原文证据", value: <TextList items={evidence} /> },
              { label: "事实（来自源文本）", value: <TextList items={factItems} /> },
              { label: "AI 推断（非事实）", value: <TextList items={inferenceItems} prefix="【AI 推断】" /> },
              { label: "缺失信息", value: <TextList items={missingInputs} /> },
              { label: "分析盲点", value: <TextList items={blindSpots} /> },
              { label: "Base 记录号", value: detail.baseRecordId ? <code className="base-ref-id">{detail.baseRecordId}</code> : <span className="req-empty-value">尚未写入飞书 Base</span> },
            ]}
          />
          <ArcoDivider className="rq-compact-divider" />
          <div className="req-source-snapshot">
            <ArcoTypography.Text type="secondary" className="rq-caption">源快照（只读 JSON）</ArcoTypography.Text>
            <pre className="source-snapshot-pre">{JSON.stringify(detail.source ?? {}, null, 2)}</pre>
          </div>
          <ArcoDivider className="rq-compact-divider" />
          <h4 className="req-audit-title" style={{ marginBottom: 8 }}>分析版本历史</h4>
          {analysisVersions.length
            ? <ArcoTable<AnalysisVersionSummary>
              rowKey="analysisVersion"
              data={analysisVersions}
              pagination={false}
              border={false}
              columns={[
                { title: "分析版本", dataIndex: "analysisVersion", width: 100, render: (_value, version) => <span className="mono-cell">v{version.analysisVersion}</span> },
                { title: "状态", dataIndex: "status", width: 120, render: (_value, version) => <StageBadge stage="analysis" state={version.status} /> },
                { title: "模块", dataIndex: "moduleSuggestion", render: (_value, version) => version.moduleSuggestion ?? "—" },
                { title: "优先级", dataIndex: "priority", width: 100, render: (_value, version) => version.priority ?? "空" },
                { title: "开始时间", dataIndex: "startedAt", width: 180, render: (_value, version) => timeLabel(version.startedAt) },
                { title: "失败摘要", dataIndex: "safeErrorSummary", render: (_value, version) => version.safeErrorSummary ?? "—" },
              ]}
            />
            : <p className="req-empty-value">尚无分析版本历史</p>}
        </Collapse.Item>
      </Collapse>
    </ArcoCard>
    {/* 5c-1：详情底部只读区块，回答「这条需求怎么来的」。不展示 Base 表 ID / record URL / 原始 payload。 */}
    <div className="req-origin-line" aria-label="这条需求怎么来的">
      <strong>这条需求怎么来的</strong>
      <span><em>来源</em>{sourceLabel}</span>
      <span><em>来源渠道</em>{detail.sourceChannel || "未填写"}</span>
      <span><em>提出人</em>{facts.proposerName || "未填写"}</span>
      <span><em>创建时间</em>{platformCreatedAt ?? "未填写"}</span>
    </div>
  </div>;
}

type RequirementSourceKind = "base_form" | "web_manual" | "chat_paste";

/** 5c-1：来源判定。Teambition 是默认来源（返回 null）；聊天粘贴按 source_payload.intakeOrigin 区分。 */
function requirementSourceKind(row: { sourceType?: string | null; source?: Record<string, unknown> | null }): RequirementSourceKind | null {
  // 兼容旧响应：没有 sourceType 的记录按 Teambition 处理（历史行默认来源）。
  const sourceType = row.sourceType ? String(row.sourceType) : "teambition";
  if (sourceType === "base_form") return "base_form";
  if (sourceType === "web_manual") {
    const origin = row.source && typeof row.source === "object" ? row.source.intakeOrigin : undefined;
    return origin === "chat_paste" ? "chat_paste" : "web_manual";
  }
  return null;
}

/**
 * 5c-1：来源徽标/说明。Teambition 不挂徽标（默认来源，332/333 都是它）；
 * 其余来源的文案带渠道细分（如「多维表格·销售」），扫视时能直接看出从哪来。
 */
function requirementSourceInfo(row: { sourceType?: string | null; sourceChannel?: string | null; source?: Record<string, unknown> | null }): { kind: RequirementSourceKind; name: string; channel: string | null; note: string } | null {
  const kind = requirementSourceKind(row);
  if (!kind) return null;
  const name = kind === "chat_paste" ? "聊天粘贴" : kind === "web_manual" ? "手工" : "多维表格";
  // 渠道为空时只显示来源名：不出现「·null」「·undefined」或空括号。
  const channel = typeof row.sourceChannel === "string" && row.sourceChannel.trim() !== "" ? row.sourceChannel.trim() : null;
  const noteName = kind === "web_manual" ? "手工录入" : name;
  return { kind, name, channel, note: `来自${noteName}${channel ? ` · ${channel}` : ""}` };
}

function isRowActionTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("button, a, input, select, textarea"));
}

function RequirementsTable({ rows, loading, showSource = true, showPool = false, emptyState, onOpen, onAssign, onDelete }: { rows: RequirementSummary[]; loading: boolean; showSource?: boolean; showPool?: boolean; emptyState?: { title: string; description: string }; onOpen: (row: RequirementSummary) => void; onAssign: (row: RequirementSummary) => void; onDelete?: (row: RequirementSummary) => void }) {
  // 首屏加载骨架屏；空态保留表头（Arco Pro 2.0 Search Table 规范）。
  if (loading && !rows.length) return <SkeletonTableRows rows={6} columns={6} />;
  const sourceTagColor = (kind: RequirementSourceKind) => kind === "base_form" ? "arcoblue" : kind === "chat_paste" ? "purple" : "orange";
  const badgeTagColor = (className: string) => className === "status-danger" ? "red" : className === "status-warning" ? "orange" : "gray";
  const columns = [
    {
      title: "需求标题",
      dataIndex: "title",
      render: (_value: unknown, row: RequirementSummary) => {
        const badge = processingBadge(row);
        const suppressed = requirementProcessingState(row) !== "active";
        const sourceInfo = showSource ? requirementSourceInfo(row) : null;
        return <ArcoSpace size={6} wrap align="center" className="req-row-title-cell">
          <span className="req-row-title" title={row.title}>{row.title}</span>
          {sourceInfo ? <ArcoTag size="small" color={sourceTagColor(sourceInfo.kind)} className="source-badge" title={sourceInfo.note}>{sourceInfo.name}{sourceInfo.channel ? `·${sourceInfo.channel}` : ""}</ArcoTag> : null}
          {showPool ? poolChip(row.pool) : null}
          {badge ? <ArcoTag size="small" color={badgeTagColor(badge.className)} className="processing-badge" title={badge.title}>{badge.label}</ArcoTag> : null}
          {row.sourceMissingSince ? <ArcoTag size="small" className="processing-badge" title={`上次全量同步（${timeLabel(row.sourceMissingSince)}）未再出现该 TB 需求；记录保留，处理与推送状态不变`}>来源已移除</ArcoTag> : null}
          {suppressed ? <span className="sr-only">（已压制：不进入 AI 分析/Base 推送/通知）</span> : null}
        </ArcoSpace>;
      },
    },
    {
      title: "优先级",
      dataIndex: "effectivePriority",
      width: 96,
      render: (_value: unknown, row: RequirementSummary) => row.effectivePriority
        ? <ArcoTag size="small" color={PRIORITY_TAG_COLORS[row.effectivePriority] ?? "gray"} title={row.priorityOverride ? `人工覆盖：${row.priorityOverride.priority}（${row.priorityOverride.reason}）` : "当前评分建议"}>{row.effectivePriority}{row.priorityOverride ? " *" : ""}</ArcoTag>
        : <span className="req-empty-value">—</span>,
    },
    {
      title: "负责人",
      dataIndex: "executorName",
      width: 170,
      render: (_value: unknown, row: RequirementSummary) => {
        const owner = requirementOwnerView(row);
        return <ArcoButton type="text" size="small" className="owner-cell-button" title={owner.unassigned ? "分配负责人" : "变更负责人"}
          onClick={(event) => { event.stopPropagation(); onAssign(row); }} htmlType="button">
          <OwnerBadge owner={owner} />
          <span className="owner-cell-edit">{owner.unassigned ? "分配" : "变更"}</span>
        </ArcoButton>;
      },
    },
    {
      title: "处理状态",
      dataIndex: "pipeline",
      width: 300,
      render: (_value: unknown, row: RequirementSummary) => <ArcoSpace size={[4, 4]} wrap className="req-row-stages">
        {([["pull", row.pipeline.pull], ["analysis", row.pipeline.analysis], ["owner", row.pipeline.owner], ["push", row.pipeline.push]] as const).map(([stage, state]) => <StageBadge key={stage} stage={stage as PipelineStage} state={state} />)}
      </ArcoSpace>,
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      width: 180,
      render: (_value: unknown, row: RequirementSummary) => {
        const time = requirementTime(row);
        const timeText = formatDateTime(time.value);
        return <span className="req-row-time" title={timeText ? (time.fallbackToCreated ? "接口未返回更新时间，显示 Teambition 创建时间" : time.value ?? undefined) : "接口未返回更新时间"}>{timeText ?? <span className="req-empty-value">—</span>}</span>;
      },
    },
    {
      title: "操作",
      dataIndex: "id",
      width: 120,
      render: (_value: unknown, row: RequirementSummary) => {
        const owner = requirementOwnerView(row);
        return <ArcoSpace size={4} className="req-row-action">
          {owner.unassigned ? <ArcoButton htmlType="button" onClick={() => onAssign(row)} type="text" size="small">分配</ArcoButton> : null}
          {onDelete ? <ArcoButton type="text" status="danger" size="small" onClick={(event) => { event.stopPropagation(); onDelete(row); }} htmlType="button">删除</ArcoButton> : null}
        </ArcoSpace>;
      },
    },
  ];
  return <div className="table-scroll req-list-scroll">
    <ArcoTable<RequirementSummary>
      className="req-list"
      rowKey="id"
      scroll={{ x: 1100 }}
      columns={columns}
      data={rows}
      pagination={false}
      border={false}
      noDataElement={<ArcoEmpty className="rq-empty" description={<div className="rq-empty-copy"><strong>{emptyState?.title ?? "没有匹配的需求"}</strong><span>{emptyState?.description ?? "数据仅在 API 返回后显示，不使用演示数据。"}</span></div>} />}
      onRow={(row) => ({
        style: { cursor: "pointer" },
        tabIndex: 0,
        "aria-label": `${requirementProcessingState(row) !== "active" ? "打开已压制需求" : "打开需求"}：${row.title}`,
        onClick: (event: MouseEvent<HTMLElement>) => { if (!isRowActionTarget(event.target)) onOpen(row); },
        onKeyDown: (event: KeyboardEvent<HTMLElement>) => { if ((event.key === "Enter" || event.key === " ") && !isRowActionTarget(event.target)) { event.preventDefault(); onOpen(row); } },
      })}
      rowClassName={(row: RequirementSummary) => {
        const owner = requirementOwnerView(row);
        const suppressed = requirementProcessingState(row) !== "active";
        const sourceKind = showSource ? requirementSourceKind(row) : null;
        // 非默认来源在行首加 3px 竖色条，扫视时比 chip 更快；TB 行不加，避免整屏噪音。
        return `req-row${owner.unassigned ? " is-pending-owner" : ""}${sourceKind ? ` is-source-${sourceKind}` : ""}${suppressed ? " is-suppressed" : ""}`;
      }}
    />
  </div>;
}

// 审计结果列独立渲染（result 枚举 succeeded/failed/denied），不复用流水线阶段标签
function auditResultLabel(result: AuditEvent["result"]) {
  const map: Record<AuditEvent["result"], { label: string; status: "success" | "error" | "default" }> = {
    succeeded: { label: "成功", status: "success" },
    failed: { label: "失败", status: "error" },
    denied: { label: "已拒绝", status: "default" },
  };
  const item = map[result];
  return <ArcoBadge status={item.status} text={item.label} />;
}

// ---------- 工单 17：负责人映射（pending 服务端筛选 + 现有映射列表） ----------

/** PR-05：待匹配负责人按 TB 执行人聚合，先让 PM 看到“缺谁”，再逐条指定。 */
function pendingExecutorSummary(rows: RequirementSummary[]): string {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const name = row.executorName?.trim();
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  if (!counts.size) return "未返回 TB 负责人姓名（可能已离职或未同步）";
  return [...counts.entries()].sort((left, right) => right[1] - left[1]).map(([name, count]) => `${name}×${count}`).join("、");
}

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

  const load = useCallback(async (nextCursor: string | null) => {
    const version = ++loadRequestVersion.current;
    if (nextCursor) setLoadingMore(true); else setLoadState("loading");
    setLoadError(null);
    const [pendingPage, mappingPage] = await Promise.allSettled([
      listRequirements({ ownerState: "pending_mapping", limit: 25, ...(nextCursor ? { cursor: nextCursor } : {}) }),
      listMappings(),
    ]);
    if (version !== loadRequestVersion.current) return;
    // 任一关键请求失败即进入错误态（自述的可恢复行为：不静默吞掉局部失败）
    if (pendingPage.status === "rejected" || mappingPage.status === "rejected") {
      const cause = pendingPage.status === "rejected" ? pendingPage.reason : mappingPage.status === "rejected" ? mappingPage.reason : null;
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
    return () => { loadRequestVersion.current += 1; };
  }, [load]);

  const submit = async (requirementId: string, user: FeishuUserSelection) => {
    setBusy(true); setNotice(null);
    try {
      const result = await setOwner(requirementId, { feishuUserId: user.feishuUserId, feishuIdType: user.feishuIdType, tbDisplayName: user.name });
      setNotice(`${user.name} 已指定为这条需求的负责人（${result.ownerState}），Base 推送已入队。`);
      setTargetId(null);
      onRefresh(); await load(null);
    } catch (cause) { setNotice(errorText(cause)); }
    finally { setBusy(false); }
  };
  const matchMethodLabel: Record<PersonMapping["matchMethod"], string> = { tb_user_id: "TB 用户 ID", unique_name: "姓名唯一匹配", manual: "人工指定" };

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
    <StateBanner loadError={loadError} notice={notice} onCloseNotice={() => setNotice(null)} />
    {pending.length ? <ArcoAlert className="rq-inline-alert" type="info" showIcon={false} content={<><strong>待匹配 {pending.length}{cursor ? "+" : ""} 条</strong>，按 TB 负责人聚合：{pendingExecutorSummary(pending)}</>} /> : null}
    {loadState === "loading" && !pending.length ? <SkeletonTableRows rows={4} columns={3} /> : <ArcoTable<RequirementSummary>
      rowKey="id"
      data={pending}
      pagination={false}
      border={false}
      noDataElement={<ArcoEmpty className="rq-empty" description={<div className="rq-empty-copy"><strong>没有待匹配的负责人</strong><span>未匹配需求会出现在这里，等待为每一条需求单独指定负责人。</span></div>} />}
      columns={[
        { title: "需求", dataIndex: "title", render: (_value, row) => <div className="requirement-title"><span className="req-id">{requirementDisplayId(row)}</span><strong>{row.title}</strong></div> },
        { title: "TB 负责人", dataIndex: "executorName", width: 140, render: (_value, row) => row.executorName ?? "待匹配" },
        { title: "操作", dataIndex: "id", width: 320, render: (_value, row) => targetId === row.id
            ? <ArcoSpace size={8} wrap align="center"><FeishuUserPicker key={row.id} disabled={busy} onMap={(user) => submit(row.id, user)} saveLabel="保存" /><ArcoButton htmlType="button" onClick={() => setTargetId(null)} disabled={busy} type="secondary" size="small">取消</ArcoButton></ArcoSpace>
            : <ArcoButton htmlType="button" onClick={() => setTargetId(row.id)} type="secondary" size="small">选择飞书用户</ArcoButton> },
      ]}
    />}
    {cursor && <div className="rq-action-bar" style={{ textAlign: "center" }}><ArcoButton type="secondary" htmlType="button" size="small" disabled={loadingMore || busy} onClick={() => void load(cursor)}>{loadingMore ? "加载中…" : "加载更多待匹配需求"}</ArcoButton></div>}
    {mappings.length > 0 && <><ArcoDivider /><ArcoTable<PersonMapping>
      rowKey="id"
      data={mappings}
      pagination={false}
      border={false}
      columns={[
        { title: "TB 用户 / 姓名", dataIndex: "teambitionDisplayName", render: (_value, mapping) => mapping.teambitionDisplayName ?? mapping.teambitionUserId ?? "（仅姓名匹配占位）" },
        { title: "飞书用户", dataIndex: "feishuUserId", render: (_value, mapping) => <span className="mono-cell">{mapping.feishuUserId}</span> },
        { title: "匹配方式", dataIndex: "matchMethod", width: 140, render: (_value, mapping) => matchMethodLabel[mapping.matchMethod] ?? mapping.matchMethod },
        { title: "更新时间", dataIndex: "updatedAt", width: 190, render: (_value, mapping) => timeLabel(mapping.updatedAt) },
      ]}
    /></>}
  </ArcoCard>;
}

// ---------- 工单 17：审计日志（按对象/时间筛选，服务端数据） ----------

export function AuditPanel() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [entityId, setEntityId] = useState("");
  const [eventType, setEventType] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const loadRequestVersion = useRef(0);

  const load = useCallback(async (filter: { entityId: string; eventType: string; since: string; until: string }) => {
    const version = ++loadRequestVersion.current;
    setLoadState("loading"); setLoadError(null);
    try {
      const items = await listAudit({ entityId: filter.entityId || undefined, eventType: filter.eventType || undefined, since: filter.since || undefined, until: filter.until || undefined, limit: AUDIT_PAGE_LIMIT });
      if (version !== loadRequestVersion.current) return;
      setEvents(items);
      setLoadState("ready");
    } catch (cause) {
      if (version !== loadRequestVersion.current) return;
      setLoadError(errorText(cause)); setLoadState("error");
    }
  }, []);
  useEffect(() => {
    void load({ entityId: "", eventType: "", since: "", until: "" });
    return () => { loadRequestVersion.current += 1; };
  }, [load]);

  return <ArcoCard
    bordered={false}
    className="rq-card requirements-panel"
    title={
      <div className="rq-card-title">
        <h2>审计日志</h2>
        <ArcoTypography.Text type="secondary" className="rq-card-subtitle">同步、分析、映射、推送与配置操作的留痕；对象、事件类型与时间筛选由服务端执行。审计日志暂不支持按池筛选。</ArcoTypography.Text>
      </div>
    }
  >
    <div className="audit-filter-bar">
      <div className="audit-filter-field">
        <label>对象 ID</label>
        <ArcoInput aria-label="对象 ID 筛选" placeholder="按对象 ID 筛选" style={{ minWidth: 170 }} value={entityId} onChange={(value: string) => setEntityId(value)} />
      </div>
      <div className="audit-filter-field">
        <label>事件类型</label>
        <ArcoInput aria-label="事件类型筛选" placeholder="事件类型，如 analysis.retry" style={{ minWidth: 230 }} value={eventType} onChange={(value: string) => setEventType(value)} />
      </div>
      <div className="audit-filter-field">
        <label>开始时间</label>
        <input type="datetime-local" aria-label="开始时间" className="rq-datetime-input" value={since} onChange={(e) => setSince(e.target.value)} />
      </div>
      <div className="audit-filter-field">
        <label>结束时间</label>
        <input type="datetime-local" aria-label="结束时间" className="rq-datetime-input" value={until} onChange={(e) => setUntil(e.target.value)} />
      </div>
      <ArcoButton htmlType="button" onClick={() => void load({ entityId: entityId.trim(), eventType: eventType.trim(), since: since ? new Date(since).toISOString() : "", until: until ? new Date(until).toISOString() : "" })} type="primary" size="small">筛选</ArcoButton>
    </div>
    <StateBanner loadError={loadError} notice={null} onCloseNotice={() => undefined} />
    {events.length >= AUDIT_PAGE_LIMIT && <ArcoAlert className="rq-inline-alert" type="info" showIcon={false} content={`已加载最近 ${AUDIT_PAGE_LIMIT} 条审计记录；更早的记录请缩小时间范围或按对象筛选。`} />}
    {loadState === "loading" && !events.length ? <SkeletonTableRows rows={6} columns={6} /> : <ArcoTable<AuditEvent> scroll={{ x: 1040 }}
      rowKey="id"
      data={events}
      pagination={false}
      border={false}
      noDataElement={<ArcoEmpty className="rq-empty" description={<div className="rq-empty-copy"><strong>没有匹配的审计记录</strong><span>调整筛选条件或执行操作后再试。</span></div>} />}
      columns={[
        { title: "时间", dataIndex: "occurredAt", width: 180, render: (_value, event) => timeLabel(event.occurredAt) },
        { title: "操作者", dataIndex: "actorId", width: 140, render: (_value, event) => event.actorId ?? "系统" },
        { title: "动作", dataIndex: "eventType", width: 220, render: (_value, event) => <ArcoButton type="text" size="mini" className="mono-cell" title="只看该类型事件" onClick={() => { setEventType(event.eventType); void load({ entityId: entityId.trim(), eventType: event.eventType, since: since ? new Date(since).toISOString() : "", until: until ? new Date(until).toISOString() : "" }); }} htmlType="button">{event.eventType}</ArcoButton> },
        { title: "对象", dataIndex: "entityId", width: 230, render: (_value, event) => <span className="mono-cell">{event.entityType}:{event.entityId.slice(0, 8)}</span> },
        { title: "结果", dataIndex: "result", width: 110, render: (_value, event) => auditResultLabel(event.result) },
        { title: "安全摘要", dataIndex: "safeDetails", render: (_value, event) => Object.keys(event.safeDetails).length ? JSON.stringify(event.safeDetails) : "—" },
      ]}
    />}
  </ArcoCard>;
}

// ---------- 运维视图：失败 / 卡住的作业（只读） ----------

const opsRate = (value: number | null): string => value === null ? "—" : `${value}%`;

function opsJobColumns() {
  return [
    { title: "作业类型", dataIndex: "jobType", width: 130, render: (_value: unknown, job: OpsJob) => <span className="mono-cell">{job.jobType}</span> },
    { title: "尝试", dataIndex: "attemptCount", width: 90, render: (_value: unknown, job: OpsJob) => `${job.attemptCount} / ${job.maxAttempts}` },
    { title: "需求", dataIndex: "requirementId", width: 140, render: (_value: unknown, job: OpsJob) => job.requirementId ? <ArcoTooltip content={job.requirementId}><span className="mono-cell" title={job.requirementId}>{job.requirementId.slice(0, 8)}</span></ArcoTooltip> : "—" },
    { title: "错误码", dataIndex: "lastErrorCode", width: 200, render: (_value: unknown, job: OpsJob) => job.lastErrorCode ? <ArcoTooltip content={job.lastErrorCode}><span className="mono-cell" style={{ whiteSpace: "nowrap", wordBreak: "normal" }} title={job.lastErrorCode}>{job.lastErrorCode}</span></ArcoTooltip> : "—" },
    { title: "安全摘要", dataIndex: "lastErrorSummary", render: (_value: unknown, job: OpsJob) => job.lastErrorSummary ?? "—" },
    { title: "更新时间", dataIndex: "updatedAt", width: 180, render: (_value: unknown, job: OpsJob) => timeLabel(job.updatedAt) },
  ];
}

function OpsJobTable({ jobs, loading, error, emptyTitle, emptyHint }: { jobs: OpsJob[]; loading?: boolean; error?: string | null; emptyTitle: string; emptyHint: string }) {
  if (loading && !jobs.length) return <SkeletonTableRows rows={3} columns={6} />;
  return <ArcoTable<OpsJob>
    rowKey="id"
    data={jobs}
    pagination={false}
    border={false}
    scroll={{ x: 980 }}
    noDataElement={<ArcoEmpty className="rq-empty" description={<div className="rq-empty-copy"><strong>{error ? "作业列表暂不可用" : emptyTitle}</strong><span>{error ? "请检查 API 连接后重试。" : emptyHint}</span></div>} />}
    columns={opsJobColumns()}
  />;
}

export function OpsPanel() {
  const [items, setItems] = useState<{ failed: OpsJob[]; stuck: OpsJob[] } | null>(null);
  const [migrations, setMigrations] = useState<Awaited<ReturnType<typeof getReadiness>>["migrations"] | null>(null);
  const [metrics, setMetrics] = useState<OpsMetrics | null>(null);
  const [gates, setGates] = useState<GatesResponse | null>(null);
  const [gatesLoadState, setGatesLoadState] = useState<LoadState>("loading");
  const [gateEditing, setGateEditing] = useState<string | null>(null);
  const [gateEvidence, setGateEvidence] = useState("");
  const [gateError, setGateError] = useState<string | null>(null);
  const [days, setDays] = useState(7);
  // 作业与指标按池查看；迁移是两个池共用的平台状态；上线 Gate 只属于产品池（集团池视图不显示、不请求）。
  const [pool, setPool] = useState<RequirementPool>("product");
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadRequestVersion = useRef(0);

  const load = useCallback(async () => {
    const version = ++loadRequestVersion.current;
    setLoadState("loading"); setGatesLoadState("loading"); setLoadError(null);
    // 迁移与指标是辅助信息：读取失败不影响作业列表。
    // 上线 Gate 只在产品池视图显示，集团池视图不请求；切回产品池时 load 会重新取。
    const [jobsResult, readyResult, metricsResult, gatesResult] = await Promise.allSettled([getOpsJobs({ limit: 50, pool: pool === "group" ? "group" : undefined }), getReadiness(), getOpsMetrics({ days, pool: pool === "group" ? "group" : undefined }), pool === "product" ? getGates() : Promise.resolve(null)]);
    if (version !== loadRequestVersion.current) return;
    if (jobsResult.status === "fulfilled") { setItems(jobsResult.value.items); setLoadState("ready"); }
    else { setItems(null); setLoadError(errorText(jobsResult.reason)); setLoadState("error"); }
    setMigrations(readyResult.status === "fulfilled" ? readyResult.value.migrations ?? null : null);
    setMetrics(metricsResult.status === "fulfilled" ? metricsResult.value : null);
    if (gatesResult.status === "fulfilled" && gatesResult.value && Array.isArray(gatesResult.value.gates)) {
      setGates(gatesResult.value); setGatesLoadState("ready");
    } else {
      setGates(null); setGatesLoadState(pool === "product" ? "error" : "ready");
    }
  }, [days, pool]);

  const confirmGateAction = async (id: string) => {
    const evidence = gateEvidence.trim();
    if (!evidence) { setGateError("请填写证据（截图/记录链接/日期）。"); return; }
    setGateError(null);
    try {
      await setGate(id, { confirmed: true, evidence });
      setGateEditing(null); setGateEvidence("");
      setGates(await getGates());
    } catch (cause) { setGateError(errorText(cause)); }
  };
  const revokeGate = async (id: string) => {
    setGateError(null);
    try { await setGate(id, { confirmed: false }); setGates(await getGates()); }
    catch (cause) { setGateError(errorText(cause)); }
  };
  useEffect(() => {
    void load();
    return () => { loadRequestVersion.current += 1; };
  }, [load]);

  const gateTag = gates
    ? <ArcoTag color={gates.ready ? "green" : "orange"}>{gates.ready ? "已满足" : "未满足"}</ArcoTag>
    : gatesLoadState === "loading"
      ? <ArcoTag color="orange">加载中</ArcoTag>
      : <ArcoTag color="gray">不可用</ArcoTag>;

  return <div className="ops-stack">
    <ArcoCard bordered={false} className="rq-card">
      <div className="ops-toolbar">
        <ArcoSpace size={10} wrap align="center">
          <span className="pool-switch-label">所属池</span>
          <ArcoRadio.Group
            type="button"
            size="small"
            aria-label="作业运维池筛选"
            value={pool}
            onChange={(value: RequirementPool) => setPool(value)}
            options={[{ label: "产品池", value: "product" }, { label: "集团池", value: "group" }]}
          />
        </ArcoSpace>
        <ArcoButton type="secondary" size="small" onClick={() => void load()} disabled={loadState === "loading"} htmlType="button"><RefreshCw size={14} />刷新</ArcoButton>
      </div>
      <StateBanner loadError={loadError} notice={null} onCloseNotice={() => undefined} />
      <ArcoAlert
        className="rq-inline-alert"
        style={{ marginBottom: 0 }}
        type={migrations?.upToDate === false ? "error" : migrations?.upToDate === true ? "success" : "info"}
        showIcon
        role="status"
        content={migrations
          ? migrations.upToDate === true
            ? `迁移：已应用 ${migrations.latest ?? "未知"}，与代码一致`
            : migrations.upToDate === false
              ? `迁移：库中最新 ${migrations.latest ?? "未知"}，代码期望 ${migrations.expected}；请先应用待执行迁移`
              : `迁移：无法读取应用迁移记录（目标环境由平台管理迁移）；代码期望 ${migrations.expected}，无法判断是否落后`
          : "迁移状态：不可用"}
      />
    </ArcoCard>

    <ArcoCard
      bordered={false}
      className="rq-card"
      title={<h3>运营指标</h3>}
      extra={
        <ArcoRadio.Group
          type="button"
          size="small"
          aria-label="运营指标时间窗口"
          value={days}
          onChange={(value: number) => setDays(value)}
          options={[{ label: "近 7 天", value: 7 }, { label: "近 30 天", value: 30 }]}
        />
      }
    >
      {metrics ? <>
        <ArcoGrid.Row gutter={[12, 12]}>
          {[
            { label: "同步成功率", value: opsRate(metrics.sync.successRate), detail: `${metrics.sync.succeeded}/${metrics.sync.total} 批` },
            { label: "分析成功率", value: opsRate(metrics.analysis.successRate), detail: `${metrics.analysis.analyzed}/${metrics.analysis.total} 次` },
            { label: "推送成功率", value: opsRate(metrics.push.successRate), detail: `${metrics.push.pushed}/${metrics.push.total} 次` },
            { label: "低置信度占比", value: opsRate(metrics.analysis.lowConfidenceRate), detail: `${metrics.analysis.lowConfidence}/${metrics.analysis.analyzed} 条分析` },
          ].map((card) => (
            <ArcoGrid.Col key={card.label} xs={12} md={6}>
              <div className="rq-stat-tile">
                <ArcoStatistic title={card.label} value={card.value} />
                <span className="rq-stat-extra">{card.detail}</span>
              </div>
            </ArcoGrid.Col>
          ))}
        </ArcoGrid.Row>
        <p className="detail-note">
          负责人：自动 {metrics.owner.autoMapped} · 手工 {metrics.owner.manuallyMapped} · 待匹配 {metrics.owner.pendingMapping} · 无需 {metrics.owner.notRequired}；
          重复：已压制 {metrics.duplicate.confirmedSuppressed} · 疑似 {metrics.duplicate.suspected}；
          评分：AI 建议 {metrics.scoring.aiSuggested} · 人工修改 {metrics.scoring.manual} · 采用 AI {metrics.scoring.aiApplied}（采纳率 {opsRate(metrics.scoring.adoptionRate)}）
        </p>
        {metrics.analysis.failureCodes.length > 0 && <p className="detail-note">分析失败码：{metrics.analysis.failureCodes.map((item) => `${item.code}×${item.count}`).join("、")}</p>}
        {pool === "product" && metrics.baseForm && <p className="detail-note">多维表格同步（已暂停，以下为历史值）：扫描 {metrics.baseForm.scanned} 行 · 已收录 {metrics.baseForm.created + metrics.baseForm.recorded} · 校验失败 {metrics.baseForm.rejected} · 写回失败 {metrics.baseForm.writeBackFailed} · 读取失败 {metrics.baseForm.readFailed ? "是" : "否"} · 最近一次同步 {metrics.baseForm.lastRunAt ? timeLabel(metrics.baseForm.lastRunAt) : "—"}{metrics.baseForm.lastError ? ` · ${metrics.baseForm.lastError}` : ""}</p>}
      </> : <ArcoTypography.Text type="secondary">运营指标暂不可用。</ArcoTypography.Text>}
    </ArcoCard>

    {/* 上线 Gate 是产品池的上线判据（G1 为产品口径条数）；集团池视图不显示，避免误读。 */}
    {pool === "product" && <ArcoCard
      bordered={false}
      className="rq-card"
      title={<h3>上线 Gate</h3>}
      extra={gateTag}
    >
      {gates ? <ul className="gate-list">
        {gates.gates.map((gate) => <li key={gate.id} className={`gate-row is-${gate.status}`}>
          <div className="gate-main">
            <strong>{gate.id} · {gate.title}</strong>
            <span>{gate.requirement}</span>
            <ArcoTypography.Text type="secondary" className="rq-caption">自动：{gate.auto.detail}</ArcoTypography.Text>
          </div>
          <div className="gate-side">
            <ArcoTag size="small" color={gate.status === "pass" ? "green" : gate.status === "fail" ? "red" : "orange"}>{gate.status === "pass" ? "通过" : gate.status === "fail" ? "未通过" : "待确认"}</ArcoTag>
            {gate.manual.required && (gate.manual.confirmed
              ? <ArcoSpace size={4} align="center">
                  <ArcoTooltip content={gate.manual.evidence ?? ""}><span className="subtle-text" title={gate.manual.evidence}>{`已确认 · ${gate.manual.by ?? "—"} · ${timeLabel(gate.manual.at)}`}</span></ArcoTooltip>
                  <ArcoButton type="text" status="danger" size="mini" onClick={() => void revokeGate(gate.id)} htmlType="button">撤销</ArcoButton>
                </ArcoSpace>
              : <ArcoButton type="secondary" size="mini" onClick={() => { setGateEditing(gate.id); setGateEvidence(""); setGateError(null); }} htmlType="button">记录证据</ArcoButton>)}
          </div>
          {gateEditing === gate.id && <div className="gate-form">
            <ArcoInput aria-label={`${gate.id} 证据`} value={gateEvidence} onChange={(value: string) => setGateEvidence(value)} placeholder="截图/记录链接/日期等可核对证据" />
            <ArcoButton type="primary" size="small" onClick={() => void confirmGateAction(gate.id)} htmlType="button">确认通过</ArcoButton>
            <ArcoButton type="secondary" size="small" onClick={() => { setGateEditing(null); setGateError(null); }} htmlType="button">取消</ArcoButton>
          </div>}
        </li>)}
      </ul> : <ArcoTypography.Text type="secondary">Gate 状态暂不可用。</ArcoTypography.Text>}
      {gateError && <ArcoAlert className="rq-inline-alert" type="error" showIcon role="alert" content={gateError} />}
    </ArcoCard>}

    <ArcoCard
      bordered={false}
      className="rq-card"
      title={
        <div className="rq-card-title">
          <h3>失败作业</h3>
          <ArcoTypography.Text type="secondary" className="rq-card-subtitle">恢复由各自的重试入口或恢复器完成；本页不提供写入操作。</ArcoTypography.Text>
        </div>
      }
    >
      <OpsJobTable jobs={items?.failed ?? []} loading={loadState === "loading"} error={loadError} emptyTitle="没有失败作业" emptyHint="最近没有处于 failed 状态的作业。" />
    </ArcoCard>

    <ArcoCard
      bordered={false}
      className="rq-card"
      title={
        <div className="rq-card-title">
          <h3>卡住的运行中作业</h3>
          <ArcoTypography.Text type="secondary" className="rq-card-subtitle">尝试次数已用尽且租约过期，等待回收器或人工处理；仅含 base_push / kano_run。</ArcoTypography.Text>
        </div>
      }
    >
      <OpsJobTable jobs={items?.stuck ?? []} loading={loadState === "loading"} error={loadError} emptyTitle="没有卡住的作业" emptyHint="运行中的作业都有有效租约或仍有重试机会。" />
    </ArcoCard>
  </div>;
}

// ---------- 全局错误边界：面板崩溃时显示可恢复状态而非白屏 ----------

interface ErrorBoundaryState { error: Error | null }
export class PanelErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };
  static getDerivedStateFromError(error: Error): ErrorBoundaryState { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <ArcoCard className="rq-card">
          <div role="alert">
            <ArcoResult
              status="error"
              title="页面渲染出错"
              subTitle={`${this.state.error.message}。请刷新页面重试；问题持续时检查服务端日志。`}
              extra={<ArcoButton type="primary" htmlType="button" size="small" onClick={() => this.setState({ error: null })}>重试渲染</ArcoButton>}
            />
          </div>
        </ArcoCard>
      );
    }
    return this.props.children;
  }
}

// ---------- 菜单收敛：团队管理 / 同步记录（同一入口下的页签，不做重复菜单） ----------

/** ARCO-06 收尾：Arco Tabs 自身不渲染 role=tablist；挂载后在头部补 role/aria-label，保留 tab/tabpanel 关联。 */
function AccessibleTabs({ label, activeTab, onChange, extra, children }: { label: string; activeTab: string; onChange: (key: string) => void; extra?: ReactNode; children: ReactNode }) {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const header = hostRef.current?.querySelector<HTMLElement>(".arco-tabs-header");
    if (!header) return;
    header.setAttribute("role", "tablist");
    header.setAttribute("aria-label", label);
  });
  return <div ref={hostRef}><ArcoTabs activeTab={activeTab} onChange={onChange} extra={extra}>{children}</ArcoTabs></div>;
}

export function TeamPanel({ initialTab, onRefresh }: { initialTab?: WorkbenchTab | null; onRefresh: () => void }) {
  const [tab, setTab] = useState<"people" | "mappings">(initialTab === "mappings" ? "mappings" : "people");
  useEffect(() => { if (initialTab === "people" || initialTab === "mappings") setTab(initialTab); }, [initialTab]);
  return <div className="composite-page">
    {/* ARCO-06：自定义 tablist 改为受控 Arco Tabs；role=tab/tabpanel 与 aria-controls 由组件生成，aria-label 语义保留在外层 group。 */}
    <AccessibleTabs label="团队管理" activeTab={tab} onChange={(key) => setTab(key as "people" | "mappings")}>
      <ArcoTabs.TabPane key="people" title="人员"><PeoplePanel /></ArcoTabs.TabPane>
      <ArcoTabs.TabPane key="mappings" title="负责人映射"><MappingsPanel onRefresh={onRefresh} /></ArcoTabs.TabPane>
    </AccessibleTabs>
  </div>;
}

export function SyncRecordsPanel({ initialTab, onRefresh }: { initialTab?: WorkbenchTab | null; onRefresh: () => void }) {
  const [tab, setTab] = useState<"batches" | "audit">(initialTab === "audit" ? "audit" : "batches");
  // 批次按池筛选：接口不支持 pool=all，不做「全部」视图（两次请求的游标无法合并）。
  const [pool, setPool] = useState<RequirementPool>("product");
  useEffect(() => { if (initialTab === "batches" || initialTab === "audit") setTab(initialTab); }, [initialTab]);
  return <div className="composite-page">
    {/* ARCO-06：受控 Arco Tabs；批次所属池筛选放在同步批次 TabPane 内部，切到审计日志时页签栏不会上下跳动。 */}
    <AccessibleTabs label="同步记录" activeTab={tab} onChange={(key) => setTab(key as "batches" | "audit")}>
      <ArcoTabs.TabPane key="batches" title="同步批次">
        <div className="pool-switch">
          <span className="pool-switch-label">批次所属池</span>
          <ArcoRadio.Group
            type="button"
            size="small"
            aria-label="同步批次池筛选"
            value={pool}
            onChange={(value: RequirementPool) => setPool(value)}
            options={[{ label: "产品池", value: "product" }, { label: "集团池", value: "group" }]}
          />
          <ArcoTypography.Text type="secondary" className="rq-caption">审计日志暂不支持按池筛选。</ArcoTypography.Text>
        </div>
        <BatchesPanel onRefresh={onRefresh} pool={pool} />
      </ArcoTabs.TabPane>
      <ArcoTabs.TabPane key="audit" title="审计日志"><AuditPanel /></ArcoTabs.TabPane>
    </AccessibleTabs>
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
  return <ArcoCard bordered={false} className="rq-card requirements-panel guide-panel">
    <div className="guide-section">
      <h3>一、数据从哪里来，到哪里去</h3>
      <ArcoTypography.Paragraph type="secondary">Teambition 拥有需求原文，应用拥有处理状态，飞书多维表格拥有 PM 处理结果和通知。三者各管一段，互不覆盖。</ArcoTypography.Paragraph>
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
      <h3>二、五个阶段各自在做什么</h3>
      <ArcoTable<{ name: string; from: string; desc: string; who: string }>
        rowKey="name"
        data={stages}
        pagination={false}
        border={false}
        columns={[
          { title: "阶段", dataIndex: "name", width: 120, render: (_value, stage) => <strong>{stage.name}</strong> },
          { title: "数据归属", dataIndex: "from", width: 160 },
          { title: "做什么", dataIndex: "desc" },
          { title: "谁触发", dataIndex: "who", width: 160 },
        ]}
      />
      <p className="guide-note">四个状态互相独立，各自推进：分析失败不影响推送，负责人空缺也不阻断推送。判断一条需求卡在哪，看它停在哪一列变红或变琥珀。</p>
    </div>

    <ArcoDivider />

    <div className="guide-section">
      <h3>三、状态怎么读</h3>
      <ArcoGrid.Row gutter={[12, 12]}>
        {states.map((stage) => (
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
      <h3>四、每天该做什么</h3>
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
      <h3>五、什么时候会收到通知</h3>
      <ArcoTable<string[]>
        rowKey={(row: string[]) => row[0] ?? ""}
        data={notices}
        pagination={false}
        border={false}
        columns={[
          { title: "事件", render: (_value, row) => row[0] },
          { title: "是否通知", width: 120, render: (_value, row) => <ArcoTag size="small" color={row[1] === "不发" ? "gray" : "green"}>{row[1]}</ArcoTag> },
          { title: "为什么", render: (_value, row) => row[2] },
        ]}
      />
      <p className="guide-note">同一事件重复推送不会重复通知：事件 ID 是确定性的，Base 只有看到变化才会发消息。</p>
    </div>

    <ArcoDivider />

    <div className="guide-section">
      <h3>六、常见问题</h3>
      <ArcoDescriptions
        size="small"
        layout="vertical"
        column={1}
        data={[
          { label: "需求改了但 Base 没变？", value: "推送是排队执行的，通常几十秒内完成。若长期不动，去需求池看它的推送状态和最近失败原因。" },
          { label: "负责人是空的怎么办？", value: "说明这个 TB 执行人还没对应飞书账号。在「团队管理 → 负责人映射」里补一条，或在需求详情页直接分配。空负责人的需求本身仍会推送到 Base，不阻塞。" },
          { label: "通知没收到？", value: "先确认这条需求是否发生过「分配负责人 / 内容实质变更 / AI 重试成功」之一——首次推送和改错别字都不会发。再确认 Base 里的「系统通知收件人」是否有值。" },
          { label: "AI 分析失败了怎么办？", value: "系统会自动重试最多 3 次；也可以在详情页手动点「重试 AI 分析」。分析失败不影响已推送的需求内容。" },
          { label: "页面上的「推送成功」等于消息已送达吗？", value: "不等于。推送成功只表示 Base 已写入；消息是否送达取决于 Base 自动化规则是否开启。可在多维表格里查看自动化运行记录。" },
        ]}
      />
    </div>
  </ArcoCard>;
}
