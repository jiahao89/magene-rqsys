// 同步记录页面：同步批次历史（支持失败项重试）与审计日志。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert as ArcoAlert, Badge as ArcoBadge, Button as ArcoButton, Card as ArcoCard, Empty as ArcoEmpty, Form as ArcoForm, Input as ArcoInput, Radio as ArcoRadio, Select as ArcoSelect, Space as ArcoSpace, Table as ArcoTable, Tabs as ArcoTabs, Typography as ArcoTypography } from "@arco-design/web-react";
import { RefreshCw } from "lucide-react";
import { AUDIT_PAGE_LIMIT, getBatch, isAbortError, listAudit, listBatches, retrySyncItem, type AuditEvent, type BatchDetail, type BatchSummary, type RequirementPool } from "../api";
import { SkeletonTableRows } from "../skeleton";
import type { WorkbenchTab } from "../workbench-routing";
import { AccessibleTabs, errorText, poolChip, StateBanner, stateChip, timeLabel, type LoadState } from "../panel-shared";

function triggerLabel(batch: { triggerType?: string; actorId?: string | null }): string {
  const mode = batch.triggerType === "scheduled" ? "周计划" : batch.triggerType === "manual" ? "手动" : (batch.triggerType ?? "—");
  return `${mode}${batch.actorId ? ` · ${batch.actorId.slice(0, 8)}` : ""}`;
}

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
  const appliedFiltersRef = useRef({ status: "", since: "", until: "" });
  const listRequestVersion = useRef(0);
  const detailRequestVersion = useRef(0);
  const listControllerRef = useRef<AbortController | null>(null);
  const detailControllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async (filter: { status: string; since: string; until: string }, nextCursor: string | null) => {
    appliedFiltersRef.current = filter;
    const version = ++listRequestVersion.current;
    listControllerRef.current?.abort();
    const controller = new AbortController();
    listControllerRef.current = controller;
    setLoadState("loading"); setLoadError(null);
    try {
      const toIso = (value: string): string | undefined => {
        if (!value) return undefined;
        const time = new Date(value);
        return Number.isNaN(time.getTime()) ? undefined : time.toISOString();
      };
      const page = await listBatches({ status: filter.status || undefined, since: toIso(filter.since), until: toIso(filter.until), pool: pool === "group" ? ("group" as const) : undefined, limit: 10, ...(nextCursor ? { cursor: nextCursor } : {}), signal: controller.signal });
      if (version !== listRequestVersion.current) return;
      setBatches((prev) => nextCursor ? [...prev, ...page.items] : page.items);
      setCursor(page.nextCursor);
      setLoadState("ready");
    } catch (cause) {
      if (version !== listRequestVersion.current || isAbortError(cause)) return;
      if (!nextCursor) { setBatches([]); setCursor(null); }
      setLoadError(errorText(cause)); setLoadState("error");
    }
  }, [pool]);

  useEffect(() => {
    void load({ status: "", since: "", until: "" }, null);
    return () => {
      listRequestVersion.current += 1;
      detailRequestVersion.current += 1;
      listControllerRef.current?.abort();
      detailControllerRef.current?.abort();
    };
  }, [load]);

  const open = useCallback(async (id: string) => {
    const version = ++detailRequestVersion.current;
    detailControllerRef.current?.abort();
    const controller = new AbortController();
    detailControllerRef.current = controller;
    setOpenBatch(null); setDetailError(null); setNotice(null);
    try {
      const detail = await getBatch(id, undefined, controller.signal);
      if (version !== detailRequestVersion.current) return;
      setOpenBatch(detail);
    } catch (cause) {
      if (version !== detailRequestVersion.current || isAbortError(cause)) return;
      setDetailError(errorText(cause));
    }
  }, []);

  const retryItem = useCallback(async (item: BatchDetail["items"][number]) => {
    setBusy(true); setNotice(null);
    try {
      const key = retryKeys.current.get(item.id) ?? crypto.randomUUID();
      retryKeys.current.set(item.id, key);
      const result = await retrySyncItem(item.id, undefined, key);
      retryKeys.current.delete(item.id);
      onRefresh(); setNotice(`失败项已重新入队：批次 ${result.batchId}`);
      if (openBatch) {
        try { setOpenBatch(await getBatch(openBatch.id)); } catch { /* keep the previous detail */ }
      }
    } catch (cause) { setNotice(errorText(cause)); }
    finally { setBusy(false); }
  }, [onRefresh, openBatch]);

  const detailColumns = useMemo(() => [
    { title: "源需求 ID", dataIndex: "teambitionRequirementId", render: (_value: unknown, item: BatchDetail["items"][number]) => <span className="mono-cell">{item.teambitionRequirementId}</span> },
    { title: "动作", dataIndex: "action" },
    { title: "状态", dataIndex: "status", render: (_value: unknown, item: BatchDetail["items"][number]) => <ArcoBadge status={item.status === "failed" ? "error" : "success"} text={item.status === "failed" ? "失败" : "成功"} /> },
    { title: "错误", dataIndex: "errorCode", render: (_value: unknown, item: BatchDetail["items"][number]) => item.errorCode ?? "—" },
    { title: "操作", render: (_value: unknown, item: BatchDetail["items"][number]) => item.status === "failed" && <ArcoButton htmlType="button" onClick={() => void retryItem(item)} disabled={busy} type="secondary" size="small">重试</ArcoButton> },
  ], [retryItem, busy]);

  const batchColumns = useMemo(() => [
    { title: "批次 ID", dataIndex: "id", render: (_value: unknown, batch: BatchSummary) => <span className="mono-cell">{batch.id}</span> },
    { title: "池", dataIndex: "pool", width: 90, render: (_value: unknown, batch: BatchSummary) => poolChip(batch.pool) },
    { title: "状态", dataIndex: "status", render: (_value: unknown, batch: BatchSummary) => stateChip(batch.status) },
    { title: "触发", dataIndex: "triggerType", render: (_value: unknown, batch: BatchSummary) => triggerLabel(batch) },
    { title: "需求总数", dataIndex: "totalCount" },
    { title: "成功", dataIndex: "succeededCount" },
    { title: "失败", dataIndex: "failedCount", render: (_value: unknown, batch: BatchSummary) => <span className={batch.failedCount ? "text-danger" : ""}>{batch.failedCount}</span> },
    { title: "开始时间", dataIndex: "startedAt", render: (_value: unknown, batch: BatchSummary) => timeLabel(batch.startedAt) },
    { title: "明细", render: (_value: unknown, batch: BatchSummary) => <ArcoButton htmlType="button" onClick={() => void open(batch.id)} type="text" size="small">查看</ArcoButton> },
  ], [open]);

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
      <StateBanner loadError={loadError ?? detailError} notice={notice} onCloseNotice={() => setNotice(null)} onRetry={() => void load(appliedFiltersRef.current, null)} />
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
            columns={detailColumns}
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
          columns={batchColumns}
        />
        {cursor && <div className="rq-action-bar"><ArcoButton htmlType="button" onClick={() => void load(appliedFiltersRef.current, cursor)} disabled={loadState === "loading"} type="secondary" size="small">加载更多</ArcoButton></div>}
      </>}
    </ArcoCard>
  );
}

function auditResultLabel(result: AuditEvent["result"]) {
  if (result === "succeeded") return <ArcoBadge status="success" text="成功" />;
  if (result === "denied") return <ArcoBadge status="warning" text="已拒绝" />;
  return <ArcoBadge status="error" text="失败" />;
}

export function AuditPanel() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [entityId, setEntityId] = useState("");
  const [eventType, setEventType] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const loadRequestVersion = useRef(0);
  const loadControllerRef = useRef<AbortController | null>(null);
  const lastFilterRef = useRef({ entityId: "", eventType: "", since: "", until: "" });

  const load = useCallback(async (filter: { entityId: string; eventType: string; since: string; until: string }) => {
    lastFilterRef.current = filter;
    const version = ++loadRequestVersion.current;
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    setLoadState("loading"); setLoadError(null);
    try {
      const items = await listAudit({ entityId: filter.entityId || undefined, eventType: filter.eventType || undefined, since: filter.since || undefined, until: filter.until || undefined, limit: AUDIT_PAGE_LIMIT, signal: controller.signal });
      if (version !== loadRequestVersion.current) return;
      setEvents(items);
      setLoadState("ready");
    } catch (cause) {
      if (version !== loadRequestVersion.current || isAbortError(cause)) return;
      setLoadError(errorText(cause)); setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void load({ entityId: "", eventType: "", since: "", until: "" });
    return () => {
      loadRequestVersion.current += 1;
      loadControllerRef.current?.abort();
    };
  }, [load]);

  const filterByEventType = useCallback((type: string) => {
    setEventType(type);
    void load({ entityId: entityId.trim(), eventType: type, since: since ? new Date(since).toISOString() : "", until: until ? new Date(until).toISOString() : "" });
  }, [entityId, since, until, load]);

  const auditColumns = useMemo(() => [
    { title: "时间", dataIndex: "occurredAt", width: 180, render: (_value: unknown, event: AuditEvent) => timeLabel(event.occurredAt) },
    { title: "操作者", dataIndex: "actorId", width: 140, render: (_value: unknown, event: AuditEvent) => event.actorId ?? "系统" },
    { title: "动作", dataIndex: "eventType", width: 220, render: (_value: unknown, event: AuditEvent) => <ArcoButton type="text" size="mini" className="mono-cell" title="只看该类型事件" onClick={() => filterByEventType(event.eventType)} htmlType="button">{event.eventType}</ArcoButton> },
    { title: "对象", dataIndex: "entityId", width: 230, render: (_value: unknown, event: AuditEvent) => <span className="mono-cell">{event.entityType}:{event.entityId.slice(0, 8)}</span> },
    { title: "结果", dataIndex: "result", width: 110, render: (_value: unknown, event: AuditEvent) => auditResultLabel(event.result) },
    { title: "安全摘要", dataIndex: "safeDetails", render: (_value: unknown, event: AuditEvent) => Object.keys(event.safeDetails).length ? JSON.stringify(event.safeDetails) : "—" },
  ], [filterByEventType]);

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
    <StateBanner loadError={loadError} notice={null} onCloseNotice={() => undefined} onRetry={() => void load(lastFilterRef.current)} />
    {events.length >= AUDIT_PAGE_LIMIT && <ArcoAlert className="rq-inline-alert" type="info" showIcon={false} content={`已加载最近 ${AUDIT_PAGE_LIMIT} 条审计记录；更早的记录请缩小时间范围或按对象筛选。`} />}
    {loadState === "loading" && !events.length ? <SkeletonTableRows rows={6} columns={6} /> : <ArcoTable<AuditEvent> scroll={{ x: 1040 }}
      rowKey="id"
      data={events}
      pagination={false}
      border={false}
      noDataElement={<ArcoEmpty className="rq-empty" description={<div className="rq-empty-copy"><strong>没有匹配的审计记录</strong><span>调整筛选条件或执行操作后再试。</span></div>} />}
      columns={auditColumns}
    />}
  </ArcoCard>;
}

export function SyncRecordsPanel({ initialTab, onRefresh }: { initialTab?: WorkbenchTab | null; onRefresh: () => void }) {
  const [tab, setTab] = useState<"batches" | "audit">(initialTab === "audit" ? "audit" : "batches");
  const [pool, setPool] = useState<RequirementPool>("product");
  useEffect(() => { if (initialTab === "batches" || initialTab === "audit") setTab(initialTab); }, [initialTab]);
  return <div className="composite-page">
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

export default SyncRecordsPanel;
