// 数据源与计划页面：Teambition 产品池/集团池配置、多维表格收集表只读卡片、飞书 Base 地址。
import { useEffect, useRef, useState } from "react";
import { Alert as ArcoAlert, Badge as ArcoBadge, Button as ArcoButton, Card as ArcoCard, Collapse, Descriptions as ArcoDescriptions, Empty as ArcoEmpty, Grid as ArcoGrid, Input as ArcoInput, Message as ArcoMessage, Space as ArcoSpace, Switch as ArcoSwitch, Tag as ArcoTag, Typography as ArcoTypography } from "@arco-design/web-react";
import { ApiError, createSource, getBaseLinks, getOpsMetrics, isAbortError, listBatches, updateSource, type BaseLinks, type BatchSummary, type OpsMetrics, type RequirementPool, type SourceConfig, type SourceConfigUpdate } from "../api";
import { formatDateTime } from "../requirement-view";
import { safeHttpUrl } from "../safe-url";
import { checkScheduleHealth } from "../schedule";
import { errorText, StateBanner, type LoadState } from "../panel-shared";
import { useUnsavedGuard } from "../unsaved-guard";

const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const DEFAULT_TB_PROJECT_NAME = "室外产品-码表软固件需求池";
const DEFAULT_GROUP_PROJECT_NAME = "需求收集与管理";

function scheduleDays(schedule: SourceConfig["schedule"]): number[] {
  return schedule.weekdays ?? (schedule.weekday === null ? [] : [schedule.weekday]);
}
function scheduleLabel(schedule: SourceConfig["schedule"]): string {
  if (!schedule.enabled) return "未启用";
  const days = scheduleDays(schedule);
  const label = days.length ? days.map((day) => WEEKDAY_LABELS[day - 1] ?? String(day)).join("/") : "每周";
  return `${label} ${schedule.time ?? "时间未设置"} ${schedule.timezone ?? ""}`.trim();
}

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
  // 方案 A：同一 provider 两条来源配置，按 pool 分组渲染；≥1200px 两列，窄屏单列；align="start" 避免左卡被人为拉长。
  const product = sources.find((item) => (item.pool ?? "product") === "product");
  const group = sources.find((item) => item.pool === "group");
  return <div className="sources-page">
    <ArcoGrid.Row gutter={[16, 16]} align="start">
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
  const [lastBatch, setLastBatch] = useState<BatchSummary | null>(null);
  const [lastBatchState, setLastBatchState] = useState<LoadState>("loading");
  const executorNames = draft.executorAllowlist ?? [];
  const emptyAllowlist = isGroup && executorNames.length === 0;

  const loadedKey = existing ? `${existing.id}|${existing.enabled}|${existing.projectName}|${existing.schedule.enabled}|${scheduleDays(existing.schedule).join(",")}|${existing.schedule.time}|${existing.schedule.timezone ?? ""}|${(existing.executorAllowlist ?? []).join(",")}` : "";
  const draftKey = existing ? `${existing.id}|${draft.enabled}|${draft.projectName}|${draft.schedule.enabled}|${scheduleDays(draft.schedule).join(",")}|${draft.schedule.time}|${draft.schedule.timezone ?? ""}|${(draft.executorAllowlist ?? []).join(",")}` : "";
  useUnsavedGuard(Boolean(existing) && loadedKey !== draftKey);

  useEffect(() => {
    if (!existing) return;
    setDraft({
      projectName: existing.projectName,
      enabled: existing.enabled,
      schedule: { ...existing.schedule },
      pool,
      ...(isGroup ? { executorAllowlist: existing.executorAllowlist ?? [] } : {}),
    });
  }, [loadedKey]);

  useEffect(() => {
    const controller = new AbortController();
    setLastBatchState("loading");
    void listBatches({ pool: isGroup ? "group" : undefined, limit: 1, signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) { setLastBatch(result.items[0] ?? null); setLastBatchState("ready"); } })
      .catch((cause) => { if (!controller.signal.aborted && !isAbortError(cause)) { setLastBatch(null); setLastBatchState("error"); } });
    return () => { controller.abort(); };
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
      {loadState === "error" && <ArcoAlert className="rq-inline-alert" type="error" showIcon role="alert" title="无法读取来源配置" content="请检查 API 连接后重试。" action={<ArcoButton type="secondary" size="mini" htmlType="button" onClick={onRefresh}>重试</ArcoButton>} />}
      <StateBanner loadError={loadError} notice={notice} onCloseNotice={() => setNotice(null)} />
      {unresolvedNames.length > 0 && <ArcoAlert className="rq-inline-alert" type="error" showIcon role="alert" title="执行人未解析" content={`${unresolvedNames.join("、")}：请填写 Teambition 组织目录中的准确姓名。`} />}
      <ArcoTypography.Paragraph type="secondary">{description}</ArcoTypography.Paragraph>
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

function BaseFormReadonlyPanel() {
  const [baseForm, setBaseForm] = useState<OpsMetrics["baseForm"]>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const shareUrlRef = useRef<HTMLElement | null>(null);
  const copyTimer = useRef<number | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void getOpsMetrics({ signal: controller.signal })
      .then((metrics) => { if (!controller.signal.aborted) setBaseForm(metrics.baseForm ?? null); })
      .catch((cause) => { if (!controller.signal.aborted && !isAbortError(cause)) setBaseForm(null); });
    return () => {
      controller.abort();
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    };
  }, []);
  const shareUrl = baseForm?.shareUrl ?? null;
  const copyShareUrl = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true); setCopyError(null);
      ArcoMessage.success("已复制收集表链接");
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
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

function BaseLinksPanel() {
  const [links, setLinks] = useState<BaseLinks | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const copyTimer = useRef<number | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void getBaseLinks(undefined, controller.signal)
      .then((value) => { if (!controller.signal.aborted) setLinks(value); })
      .catch((cause) => { if (!controller.signal.aborted && !isAbortError(cause)) { setLinks({ product: null, group: null }); setUnavailable(true); } });
    return () => {
      controller.abort();
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    };
  }, []);
  const copy = async (key: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(key); setCopyError(null);
      ArcoMessage.success("已复制 Base 地址");
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 2000);
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

export default SourcesPanel;
