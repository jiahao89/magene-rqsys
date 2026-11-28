// 作业运维页面：迁移就绪度、运营指标、上线 Gate 核对（含防连点锁）、失败与卡住作业。
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert as ArcoAlert, Button as ArcoButton, Card as ArcoCard, Empty as ArcoEmpty, Grid as ArcoGrid, Input as ArcoInput, Radio as ArcoRadio, Space as ArcoSpace, Statistic as ArcoStatistic, Table as ArcoTable, Tag as ArcoTag, Tooltip as ArcoTooltip, Typography as ArcoTypography } from "@arco-design/web-react";
import { RefreshCw } from "lucide-react";
import { getGates, getOpsJobs, getOpsMetrics, getReadiness, isAbortError, setGate, type GatesResponse, type OpsJob, type OpsMetrics, type RequirementPool } from "../api";
import { SkeletonTableRows } from "../skeleton";
import { errorText, StateBanner, timeLabel, type LoadState } from "../panel-shared";

const opsRate = (value: number | null): string => value === null ? "—" : `${value}%`;

const OPS_JOB_COLUMNS = [
  { title: "作业类型", dataIndex: "jobType", width: 130, render: (_value: unknown, job: OpsJob) => <span className="mono-cell">{job.jobType}</span> },
  { title: "尝试", dataIndex: "attemptCount", width: 90, render: (_value: unknown, job: OpsJob) => `${job.attemptCount} / ${job.maxAttempts}` },
  { title: "需求", dataIndex: "requirementId", width: 140, render: (_value: unknown, job: OpsJob) => job.requirementId ? <ArcoTooltip content={job.requirementId}><span className="mono-cell" title={job.requirementId}>{job.requirementId.slice(0, 8)}</span></ArcoTooltip> : "—" },
  { title: "错误码", dataIndex: "lastErrorCode", width: 200, render: (_value: unknown, job: OpsJob) => job.lastErrorCode ? <ArcoTooltip content={job.lastErrorCode}><span className="mono-cell" style={{ whiteSpace: "nowrap", wordBreak: "normal" }} title={job.lastErrorCode}>{job.lastErrorCode}</span></ArcoTooltip> : "—" },
  { title: "安全摘要", dataIndex: "lastErrorSummary", render: (_value: unknown, job: OpsJob) => job.lastErrorSummary ?? "—" },
  { title: "更新时间", dataIndex: "updatedAt", width: 180, render: (_value: unknown, job: OpsJob) => timeLabel(job.updatedAt) },
];

function OpsJobTable({ jobs, loading, error, emptyTitle, emptyHint }: { jobs: OpsJob[]; loading?: boolean; error?: string | null; emptyTitle: string; emptyHint: string }) {
  if (loading && !jobs.length) return <SkeletonTableRows rows={3} columns={6} />;
  return <ArcoTable<OpsJob>
    rowKey="id"
    data={jobs}
    pagination={false}
    border={false}
    scroll={{ x: 980 }}
    noDataElement={<ArcoEmpty className="rq-empty" description={<div className="rq-empty-copy"><strong>{error ? "作业列表暂不可用" : emptyTitle}</strong><span>{error ? "请检查 API 连接后重试。" : emptyHint}</span></div>} />}
    columns={OPS_JOB_COLUMNS}
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
  const [gateBusy, setGateBusy] = useState(false);
  const gateBusyRef = useRef(false);
  const [days, setDays] = useState(7);
  const [pool, setPool] = useState<RequirementPool>("product");
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadRequestVersion = useRef(0);
  const loadControllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    const version = ++loadRequestVersion.current;
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    setLoadState("loading"); setGatesLoadState("loading"); setLoadError(null);
    const [jobsResult, readyResult, metricsResult, gatesResult] = await Promise.allSettled([
      getOpsJobs({ limit: 50, pool: pool === "group" ? "group" : undefined, signal: controller.signal }),
      getReadiness(undefined, controller.signal),
      getOpsMetrics({ days, pool: pool === "group" ? "group" : undefined, signal: controller.signal }),
      pool === "product" ? getGates(undefined, controller.signal) : Promise.resolve(null),
    ]);
    if (version !== loadRequestVersion.current || controller.signal.aborted) return;
    if (jobsResult.status === "fulfilled") { setItems(jobsResult.value.items); setLoadState("ready"); }
    else if (!isAbortError(jobsResult.reason)) { setItems(null); setLoadError(errorText(jobsResult.reason)); setLoadState("error"); }
    setMigrations(readyResult.status === "fulfilled" ? readyResult.value.migrations ?? null : null);
    setMetrics(metricsResult.status === "fulfilled" ? metricsResult.value : null);
    if (gatesResult.status === "fulfilled" && gatesResult.value && Array.isArray(gatesResult.value.gates)) {
      setGates(gatesResult.value); setGatesLoadState("ready");
    } else {
      setGates(null); setGatesLoadState(pool === "product" ? "error" : "ready");
    }
  }, [days, pool]);

  const confirmGateAction = async (id: string) => {
    if (gateBusyRef.current) return;
    const evidence = gateEvidence.trim();
    if (!evidence) { setGateError("请填写证据（截图/记录链接/日期）。"); return; }
    gateBusyRef.current = true;
    setGateBusy(true);
    setGateError(null);
    try {
      await setGate(id, { confirmed: true, evidence });
      setGateEditing(null); setGateEvidence("");
      setGates(await getGates());
    } catch (cause) { setGateError(errorText(cause)); }
    finally { gateBusyRef.current = false; setGateBusy(false); }
  };

  const revokeGate = async (id: string) => {
    if (gateBusyRef.current) return;
    gateBusyRef.current = true;
    setGateBusy(true);
    setGateError(null);
    try { await setGate(id, { confirmed: false }); setGates(await getGates()); }
    catch (cause) { setGateError(errorText(cause)); }
    finally { gateBusyRef.current = false; setGateBusy(false); }
  };

  useEffect(() => {
    void load();
    return () => {
      loadRequestVersion.current += 1;
      loadControllerRef.current?.abort();
    };
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
      <StateBanner loadError={loadError} notice={null} onCloseNotice={() => undefined} onRetry={() => void load()} />
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
      title={<h2>运营指标</h2>}
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
          重复：已排除 {metrics.duplicate.confirmedSuppressed} · 疑似 {metrics.duplicate.suspected}；
          评分：AI 建议 {metrics.scoring.aiSuggested} · 人工修改 {metrics.scoring.manual} · 采用 AI {metrics.scoring.aiApplied}（采纳率 {opsRate(metrics.scoring.adoptionRate)}）
        </p>
        {metrics.analysis.failureCodes.length > 0 && <p className="detail-note">分析失败码：{metrics.analysis.failureCodes.map((item) => `${item.code}×${item.count}`).join("、")}</p>}
        {pool === "product" && metrics.baseForm && <p className="detail-note">多维表格同步（已暂停，以下为历史值）：扫描 {metrics.baseForm.scanned} 行 · 已收录 {metrics.baseForm.created + metrics.baseForm.recorded} · 校验失败 {metrics.baseForm.rejected} · 写回失败 {metrics.baseForm.writeBackFailed} · 读取失败 {metrics.baseForm.readFailed ? "是" : "否"} · 最近一次同步 {metrics.baseForm.lastRunAt ? timeLabel(metrics.baseForm.lastRunAt) : "—"}{metrics.baseForm.lastError ? ` · ${metrics.baseForm.lastError}` : ""}</p>}
      </> : <ArcoTypography.Text type="secondary">运营指标暂不可用。</ArcoTypography.Text>}
    </ArcoCard>

    {pool === "product" && <ArcoCard
      bordered={false}
      className="rq-card"
      title={<h2>上线 Gate</h2>}
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
                  <ArcoButton type="text" status="danger" size="mini" disabled={gateBusy} onClick={() => void revokeGate(gate.id)} htmlType="button">撤销</ArcoButton>
                </ArcoSpace>
              : <ArcoButton type="secondary" size="mini" disabled={gateBusy} onClick={() => { setGateEditing(gate.id); setGateEvidence(""); setGateError(null); }} htmlType="button">记录证据</ArcoButton>)}
          </div>
          {gateEditing === gate.id && <div className="gate-form">
            <ArcoInput aria-label={`${gate.id} 证据`} value={gateEvidence} disabled={gateBusy} onChange={(value: string) => setGateEvidence(value)} placeholder="截图/记录链接/日期等可核对证据" />
            <ArcoButton type="primary" size="small" disabled={gateBusy} onClick={() => void confirmGateAction(gate.id)} htmlType="button">{gateBusy ? "提交中…" : "确认通过"}</ArcoButton>
            <ArcoButton type="secondary" size="small" disabled={gateBusy} onClick={() => { setGateEditing(null); setGateError(null); }} htmlType="button">取消</ArcoButton>
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
          <h2>失败作业</h2>
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
          <h2>卡住的运行中作业</h2>
          <ArcoTypography.Text type="secondary" className="rq-card-subtitle">尝试次数已用尽且租约过期，等待回收器或人工处理；仅含 base_push / kano_run。</ArcoTypography.Text>
        </div>
      }
    >
      <OpsJobTable jobs={items?.stuck ?? []} loading={loadState === "loading"} error={loadError} emptyTitle="没有卡住的作业" emptyHint="运行中的作业都有有效租约或仍有重试机会。" />
    </ArcoCard>
  </div>;
}

export default OpsPanel;
