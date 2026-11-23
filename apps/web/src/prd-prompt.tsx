// PRD 提示词（S2）：详情「需求评估」下方的独立区块。
// 按需生成、版本化、只读结果、可复制；不自动调用模型、不写 Base、不发通知。
import { useCallback, useEffect, useRef, useState } from "react";
import { Button as ArcoButton, Input as ArcoInput } from "@arco-design/web-react";
import {
  ApiError,
  createPrdPrompt,
  listPrdPrompts,
  listRequirementAssessments,
  type PrdPromptVersion,
  type RequirementAssessment,
} from "./api";

/** 规格 §3.1：固定 10 个二级标题，顺序一致。 */
const PRD_CHAPTERS = [
  "角色与任务",
  "背景与问题",
  "目标与成功指标",
  "用户与场景",
  "需求范围（做/不做）",
  "功能需求与优先级",
  "约束与依赖",
  "验收标准",
  "风险、假设与待确认",
  "输出要求（PRD 结构）",
] as const;

const VERDICT_LABELS: Record<string, string> = { advance: "建议推进", hold: "建议暂缓", investigate: "待调查" };
const STATUS_LABELS: Record<string, string> = { running: "生成中", succeeded: "已生成", failed: "失败" };
const ERROR_LABELS: Record<string, string> = {
  timeout: "生成超时",
  provider_error: "模型服务错误",
  invalid_output: "输出不合规",
  analysis_failure: "分析数据缺失",
  ASSESSMENT_REQUIRED: "缺少成功评估",
  PRD_PROMPT_IN_PROGRESS: "已有生成中的版本",
};

/** 调研结论：后端顶层字段优先，兼容旧的 inputs 嵌套形状。 */
function investigationNotesOf(item: PrdPromptVersion): string {
  return item.investigationNotes ?? item.inputs?.investigationNotes ?? "";
}

function formatTime(value?: string | null): string {
  if (!value) return "—";
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? value : time.toLocaleString("zh-CN");
}

/** 失败文案：稳定错误码优先，429 带等待秒数，超时单独提示。 */
function errorMessage(cause: unknown, timedOut = false): string {
  if (timedOut) return "生成超时（最长约 95 秒），请稍后重试；已填写的调研结论会保留。";
  if (cause instanceof ApiError) {
    if (cause.code === "ASSESSMENT_REQUIRED") return "请先生成一条成功的需求评估，再生成 PRD 提示词。";
    if (cause.code === "PRD_PROMPT_IN_PROGRESS") return "已有生成中的版本，请稍候再试。";
    if (cause.status === 429) return `AI 调用过于频繁，请 ${cause.retryAfterSeconds ?? 60} 秒后重试。`;
    if (cause.status === 503) return "AI 暂时不可用，请稍后重试；已填写的调研结论会保留。";
    if (/[\u4e00-\u9fff]/.test(cause.message)) return cause.message;
    return `生成失败（${cause.code}），请稍后重试。`;
  }
  return "生成失败：无法连接服务，请稍后重试。";
}

export function PrdPromptSection({ requirementId, assessmentRevision = 0, timeoutMs = 95_000 }: { requirementId: string; assessmentRevision?: number; timeoutMs?: number }) {
  const [assessments, setAssessments] = useState<RequirementAssessment[] | null>(null);
  const [items, setItems] = useState<PrdPromptVersion[] | null>(null);
  const [assessError, setAssessError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const promptRef = useRef<HTMLPreElement | null>(null);
  const copyTimer = useRef<number | null>(null);
  // 首次载入历史时把最新版本的调研结论回填到输入框；之后不覆盖用户正在编辑的内容。
  const historyInitialized = useRef(false);

  const loadAssessments = useCallback(async () => {
    setAssessError(null);
    try {
      setAssessments(await listRequirementAssessments(requirementId));
    } catch (cause) {
      setAssessments([]);
      setAssessError(errorMessage(cause));
    }
  }, [requirementId]);

  const loadHistory = useCallback(async () => {
    setHistoryError(null);
    try {
      const list = await listPrdPrompts(requirementId);
      setItems(list);
      if (!historyInitialized.current) {
        historyInitialized.current = true;
        const latest = list[0];
        if (latest) setNotes((previous) => previous === "" ? investigationNotesOf(latest) : previous);
      }
    } catch (cause) {
      setItems([]);
      setHistoryError(errorMessage(cause));
    }
  }, [requirementId]);

  useEffect(() => { void loadAssessments(); void loadHistory(); }, [loadAssessments, loadHistory]);
  // 详情页生成评估成功后 revision 递增：只重拉评估列表，解锁生成按钮（历史与输入不动）。
  useEffect(() => { if (assessmentRevision > 0) void loadAssessments(); }, [assessmentRevision, loadAssessments]);
  useEffect(() => () => { if (copyTimer.current !== null) window.clearTimeout(copyTimer.current); }, []);

  const latestAssessment = (assessments ?? [])
    .filter((item) => item.status === "succeeded" && item.output)
    .sort((a, b) => b.version - a.version)[0] ?? null;
  const current = items?.find((item) => item.version === selectedVersion) ?? items?.[0] ?? null;
  const inProgress = current?.status === "running";
  const loaded = assessments !== null && items !== null;
  const canGenerate = Boolean(latestAssessment) && !busy && !inProgress && loaded;
  const noAssessment = assessments !== null && !latestAssessment;

  const selectVersion = (item: PrdPromptVersion) => {
    setSelectedVersion(item.version);
    setNotes(investigationNotesOf(item));
    setExpanded(false);
    setError(null);
    setNotice(null);
    setCopied(false);
  };

  const generate = async () => {
    if (!latestAssessment || !canGenerate) return;
    setBusy(true); setError(null); setNotice(null); setCopied(false);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const created = await createPrdPrompt(requirementId, { assessmentId: latestAssessment.id, investigationNotes: notes }, undefined, controller.signal);
      setItems((previous) => [created, ...(previous ?? []).filter((item) => item.version !== created.version)].sort((a, b) => b.version - a.version));
      setSelectedVersion(created.version);
      setExpanded(false);
      if (created.status === "succeeded") setNotice(`v${created.version} 已生成；内容可以复制，不写 Base、不发通知。`);
      else setError(`生成失败：${ERROR_LABELS[created.errorCode ?? ""] ?? created.errorCode ?? "未知原因"}。可重新生成。`);
      if (created.status !== "succeeded") void loadHistory();
    } catch (cause) {
      setError(errorMessage(cause, controller.signal.aborted));
      // 失败也刷新历史：服务端会落一条 failed 版本，界面要能看到并可重试。
      void loadHistory();
    } finally {
      window.clearTimeout(timer);
      setBusy(false);
    }
  };

  const copyPrompt = async () => {
    const text = current?.output?.prompt;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板不可用：选中整段提示词，供手动复制。
      const node = promptRef.current;
      if (node) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      setCopied(false);
    }
  };

  const emptyNotes = current?.status === "succeeded" && !investigationNotesOf(current).trim();

  return <section className="req-section req-prd-prompt-section" aria-labelledby="req-prd-prompt-heading">
    <div className="req-section-head">
      <h3 id="req-prd-prompt-heading">PRD 提示词</h3>
      <span className="req-source-note">AI 建议，非结论 · 按需生成</span>
    </div>

    {assessError ? <p className="field-error" role="alert">{assessError}</p> : null}
    {noAssessment ? <div className="notice-banner" role="status">
      <span>先生成一条成功的需求评估，才能生成 PRD 提示词。<a className="link-button" href="#req-assessment-heading">前往需求评估</a></span>
    </div> : null}
    {latestAssessment ? <div className="prd-prompt-meta">
      <span className="status-chip status-live"><span />评估 v{latestAssessment.version} · {VERDICT_LABELS[latestAssessment.output?.verdict ?? ""] ?? "已生成"}</span>
      <span className="subtle-text">基于该评估结论和下面的调研结论生成。</span>
    </div> : null}

    <label className="field">
      <span>调研结论（0–8,000 字）</span>
      <ArcoInput.TextArea
        aria-label="调研结论"
        value={notes}
        onChange={(value: string) => setNotes(value)}
        maxLength={8000}
        showWordLimit
        rows={4}
        disabled={!latestAssessment || busy}
        placeholder="把调查结论与证据粘进来；不要粘贴客户姓名、电话、邮箱、订单号、密钥。"
      />
    </label>
    <p className="detail-note">调研结论可空；为空时生成的提示词会标注「调研结论未回填」并保留开放问题。发送模型前会自动掩码 PII。</p>

    <div className="rules-form">
      <ArcoButton type="primary" size="small" htmlType="button" onClick={() => void generate()} disabled={!canGenerate}>
        {busy ? "生成中…（约 60 秒，最长 90 秒）" : items?.length ? "重新生成" : "生成 PRD 提示词"}
      </ArcoButton>
      {busy ? <span className="status-hint" role="status">生成中，请勿关闭页面（约 60 秒，最长 90 秒）。</span> : null}
    </div>
    {error ? <p className="field-error" role="alert">{error}</p> : null}
    {notice ? <p className="status-hint" role="status">{notice}</p> : null}
    {historyError ? <p className="field-error" role="alert">{historyError}</p> : null}

    {!loaded ? <p className="status-hint">正在读取评估与历史版本…</p> : null}

    {loaded && !current ? <div className="req-empty-state">
      <strong>还没有 PRD 提示词</strong>
      <span>先完成评估和调查，再生成。</span>
    </div> : null}

    {current ? <div className="prd-prompt-result">
      <div className="prd-prompt-result-head">
        <strong>v{current.version} · {STATUS_LABELS[current.status] ?? current.status}</strong>
        <span className="subtle-text">{formatTime(current.createdAt)}{current.completedAt ? ` · 完成 ${formatTime(current.completedAt)}` : ""}</span>
        {current.status === "succeeded" && current.output ? <ArcoButton size="small" htmlType="button" onClick={() => void copyPrompt()}>{copied ? "已复制" : "复制提示词"}</ArcoButton> : null}
      </div>

      {current.status === "running" ? <p className="status-hint">已有生成中的版本，请稍候；同一需求不会并发生成。</p> : null}
      {current.status === "failed" ? <p className="field-error" role="alert">生成失败：{ERROR_LABELS[current.errorCode ?? ""] ?? current.errorCode ?? "未知原因"}。已填写的调研结论会保留，可重新生成。</p> : null}

      {current.output ? <>
        <div className="prd-prompt-chapters" aria-label="提示词包含的章节">
          <span className="subtle-text">包含 10 个章节：</span>
          {PRD_CHAPTERS.map((chapter) => <span className="prd-chapter-chip" key={chapter}>{chapter}</span>)}
        </div>
        <pre ref={promptRef} className={`prd-prompt-text${expanded ? " is-expanded" : ""}`} aria-label="PRD 提示词内容">{current.output.prompt}</pre>
        {current.output.prompt.length > 400 ? <ArcoButton type="text" className="link-button" size="small" htmlType="button" onClick={() => setExpanded((value) => !value)}>{expanded ? "收起" : "展开全部"}</ArcoButton> : null}
        {emptyNotes ? <p className="detail-note">该版本生成时调研结论未回填；第 9 章应保留开放问题。</p> : null}
        {current.output.assumptions.length > 0 ? <div className="prd-prompt-list">
          <strong>假设</strong>
          <ul>{current.output.assumptions.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
        </div> : null}
        {current.output.openQuestions.length > 0 ? <div className="prd-prompt-list">
          <strong>待确认</strong>
          <ul>{current.output.openQuestions.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
        </div> : null}
      </> : null}

      {items && items.length > 0 ? <div className="prd-prompt-versions" role="group" aria-label="PRD 提示词版本历史">
        <span className="subtle-text">版本历史</span>
        {items.map((item) => <ArcoButton
          key={item.id}
          size="small"
          htmlType="button"
          type={item.version === current.version ? "primary" : "secondary"}
          aria-pressed={item.version === current.version}
          onClick={() => selectVersion(item)}
        >v{item.version} · {STATUS_LABELS[item.status] ?? item.status} · {formatTime(item.createdAt)}</ArcoButton>)}
      </div> : null}
    </div> : null}
  </section>;
}
