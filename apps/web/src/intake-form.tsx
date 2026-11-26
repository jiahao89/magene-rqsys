// V02-T04：需求池「新建需求」表单（Web 手工收录，web_manual）。
// 只必填标题/描述/渠道；四段提示是 placeholder 引导，不是四个必填项（PRD 3.2）。
// 幂等键在同一次提交意图内复用（失败重试不换键），成功或重新展开表单后重置。
import { useEffect, useRef, useState } from "react";
import { Button as ArcoButton, Input, Select } from "@arco-design/web-react";
import { ApiError, AUDIENCE_LEVELS, AUDIENCE_LEVEL_NAMES, REQUIREMENT_INTAKE_CHANNELS, REQUIREMENT_INTAKE_TYPES, createRequirement, extractIntakeDraft, getFunctionModules, getRiceDraft, listKanoEvidence, listKanoRuns, listRequirements, saveRiceDraft, setAudienceTags, triggerKanoRun, updateRequirement, type ChatIntakeDraft, type KanoEvidenceVersionDto, type KanoRunDto, type RequirementSummary, type RiceDraft } from "./api";
import { ConfirmModal } from "./confirm-modal";
import { requirementSourceName } from "./requirement-view";
import { safeHttpUrl } from "./safe-url";

/** PRD-26 5a 补丁：服务端与客户端共用同一组上限，提交前拦截，避免落到英文通用校验错误。 */
const INTAKE_LIMITS = { title: 200, description: 20_000, productModel: 100, constraintNotes: 2_000, supplementUrl: 500, proposerName: 100 } as const;
/** 聊天抽取的客户端超时：服务端 AI 超时 20 秒，留 10 秒给网络与网关。 */
const INTAKE_EXTRACT_TIMEOUT_MS = 30_000;

/** 聊天文本先过 PII 掩码；「（姓名已掩码）」这类占位不是真实提出人，不展示也不提交。 */
function isMaskedPlaceholder(value: string | null): boolean {
  return !!value && value.includes("已掩码");
}

function waitLabel(seconds: number): string {
  if (seconds >= 3600) return `${Math.ceil(seconds / 3600)} 小时`;
  if (seconds >= 60) return `${Math.ceil(seconds / 60)} 分钟`;
  return `${seconds} 秒`;
}

/** 按错误码给出可执行提示：429 读 Retry-After 说明还需等多久，500/503 说明可以先手工填写。 */
function intakeErrorMessage(cause: unknown, action: "整理" | "提交", fallback: string): string {
  if (!(cause instanceof ApiError)) return fallback;
  if (cause.status === 429) {
    if (!cause.retryAfterSeconds) return cause.message;
    const daily = cause.retryAfterSeconds >= 3600 ? "；可能是今日次数已用完，可先手工填写" : "";
    return `${cause.message}（还需等待约 ${waitLabel(cause.retryAfterSeconds)}${daily}）`;
  }
  if (cause.status === 500) return `服务端暂时无法完成这次${action}（配置或请求异常），可先手工填写或稍后重试。`;
  if (cause.status === 503 && action === "提交") return "服务暂时不可用，请稍后重试；同一提交重试不会重复建需求。";
  return cause.message;
}

export function IntakeForm({ onCreated }: { onCreated: (requirementId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [channel, setChannel] = useState<string>("");
  const [productModel, setProductModel] = useState("");
  const [requirementType, setRequirementType] = useState("");
  const [constraintNotes, setConstraintNotes] = useState("");
  const [supplementUrl, setSupplementUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef<string>(crypto.randomUUID());
  const [modules, setModules] = useState<Array<{ name: string; personName: string | null }>>([]);
  const [intakeModule, setIntakeModule] = useState("");
  // PRD-26：聊天粘贴。草稿只填表单，AI 填充的字段带标记，用户确认后才提交。
  const [chatText, setChatText] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [aiFilled, setAiFilled] = useState<string[]>([]);
  const [proposer, setProposer] = useState<string | null>(null);
  // PRD-31：草稿生成后/标题失焦/提交前按标题关键字查相似需求；只提示，不阻断提交、不写重复判定。
  const [similarRequirements, setSimilarRequirements] = useState<RequirementSummary[]>([]);
  const similarQuery = useRef("");
  const similarRequest = useRef(0);
  // 只有走过聊天草稿的提交才带 intakeOrigin=chat_paste；用户手工填的表单仍是普通 Web 收录。
  const [fromChatPaste, setFromChatPaste] = useState(false);
  // 服务端 fallback=true：模型输出不可用，标题/描述取自掩码原文，必须明确告诉用户「未经过 AI 整理」。
  const [fallbackDraft, setFallbackDraft] = useState(false);
  // 草稿与已填内容冲突时先确认：合并（只补空白）或覆盖，不静默冲掉用户输入。
  const [pendingDraft, setPendingDraft] = useState<{ draft: ChatIntakeDraft; conflicts: string[] } | null>(null);
  // 409：同一幂等键已用于不同内容（多半是上一次实际已创建、响应丢了）。给一个换新键重提的出口。
  const [conflict, setConflict] = useState(false);
  // 受控词典模块（G-MODULE）：只提供已发布选项；模块责任人仅作候选提示，不自动分配。
  useEffect(() => {
    if (!open) return;
    void getFunctionModules().then((directory) => setModules(directory.items)).catch(() => setModules([]));
  }, [open]);
  const moduleCandidate = modules.find((item) => item.name === intakeModule)?.personName ?? null;

  if (!open) {
    return <div className="toolbar-actions"><ArcoButton type="primary" size="small" htmlType="button" onClick={() => { setOpen(true); setError(null); }}>新建需求</ArcoButton><ArcoButton size="small" htmlType="button" onClick={() => { setOpen(true); setChatOpen(true); setError(null); }}>从聊天粘贴</ArcoButton></div>;
  }

  const reset = () => {
    setTitle(""); setDescription(""); setChannel(""); setProductModel(""); setRequirementType(""); setConstraintNotes(""); setSupplementUrl(""); setIntakeModule(""); setError(null);
    setChatText(""); setChatOpen(false); setChatError(null); setAiFilled([]); setProposer(null);
    setSimilarRequirements([]); similarQuery.current = ""; similarRequest.current += 1;
    setFromChatPaste(false); setFallbackDraft(false); setPendingDraft(null); setConflict(false);
    idempotencyKey.current = crypto.randomUUID();
  };

  /** 用户改过的字段不再算「AI 填充」：一编辑就撤掉该字段的标记。 */
  const clearAiMark = (field: string) => setAiFilled((prev) => prev.includes(field) ? prev.filter((item) => item !== field) : prev);

  /** 草稿与已填内容冲突的字段（草稿值为空也算，因为覆盖会把已有内容清空）。 */
  const draftConflicts = (draft: ChatIntakeDraft): string[] => {
    const conflicts: string[] = [];
    if (title.trim() && draft.title.trim() !== title.trim()) conflicts.push("标题");
    if (description.trim() && draft.description.trim() !== description.trim()) conflicts.push("需求描述");
    if (channel && (draft.sourceChannel ?? "") !== channel) conflicts.push("来源渠道");
    if (requirementType && (draft.requirementType ?? "") !== requirementType) conflicts.push("需求类型");
    if (productModel.trim() && (draft.productModel ?? "").trim() !== productModel.trim()) conflicts.push("产品/型号");
    if (constraintNotes.trim() && (draft.constraintNotes ?? "").trim() !== constraintNotes.trim()) conflicts.push("边界/限制");
    if (intakeModule && (draft.intakeModule ?? "") !== intakeModule) conflicts.push("功能模块");
    return conflicts;
  };

  /** 把草稿写入表单：merge 只补空白字段，overwrite 全量替换；标记只挂在本次真正由 AI 写入的字段上。 */
  const applyDraft = (draft: ChatIntakeDraft, mode: "merge" | "overwrite") => {
    const written = new Set<string>();
    const write = (field: string, current: string, next: string, set: (value: string) => void) => {
      if (mode === "overwrite" || current.trim() === "") {
        set(next);
        if (draft.aiFilled.includes(field)) written.add(field);
      }
    };
    write("title", title, draft.title, setTitle);
    write("description", description, draft.description, setDescription);
    write("sourceChannel", channel, draft.sourceChannel ?? "", setChannel);
    write("requirementType", requirementType, draft.requirementType ?? "", setRequirementType);
    write("productModel", productModel, draft.productModel ?? "", setProductModel);
    write("constraintNotes", constraintNotes, draft.constraintNotes ?? "", setConstraintNotes);
    write("intakeModule", intakeModule, draft.intakeModule ?? "", setIntakeModule);
    setProposer(isMaskedPlaceholder(draft.proposer) ? null : draft.proposer);
    setAiFilled((prev) => [...new Set([...(mode === "merge" ? prev.filter((field) => !written.has(field)) : []), ...written])]);
    setFromChatPaste(true);
  };
  const extract = async () => {
    if (!chatText.trim()) { setChatError("请先粘贴聊天内容。"); return; }
    setExtracting(true); setChatError(null); setConflict(false);
    // 重新整理就是新的一次抽取：旧的相似需求提示必须清空，不能配着新错误继续展示。
    setSimilarRequirements([]); similarQuery.current = ""; similarRequest.current += 1;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, INTAKE_EXTRACT_TIMEOUT_MS);
    try {
      const result = await extractIntakeDraft(chatText, undefined, controller.signal);
      setFallbackDraft(result.fallback === true);
      const conflicts = draftConflicts(result.draft);
      if (conflicts.length > 0) setPendingDraft({ draft: result.draft, conflicts });
      else {
        applyDraft(result.draft, "merge");
        // PRD-31：草稿生成后立即按草稿标题查一次；草稿自带的 similar 不直接展示。
        void lookupSimilar(result.draft.title);
      }
    } catch (cause) {
      setChatError(timedOut ? "整理超时，请重试或手工填写。" : intakeErrorMessage(cause, "整理", "无法整理聊天内容，请手工填写。"));
    } finally { clearTimeout(timer); setExtracting(false); }
  };
  const aiMark = (field: string) => aiFilled.includes(field) ? <small className="ai-filled-tag" title="由 AI 根据聊天内容填充，请核对后再提交"> AI 填充</small> : null;

  /**
   * PRD-31：草稿生成后、标题失焦或提交前按标题关键字查一次相似需求（最多 5 条）。
   * trim 后不足 2 字不查；2s 超时/4xx/5xx/网络错误一律静默隐藏，不影响提交、不重试。
   */
  const lookupSimilar = async (titleOverride?: string) => {
    const query = (titleOverride ?? title).trim();
    if (query.length < 2) { setSimilarRequirements([]); similarQuery.current = ""; return; }
    // 同一个标题只查一次；标题改动后 ref 会重置。
    if (query === similarQuery.current) return;
    similarQuery.current = query;
    const request = ++similarRequest.current;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 2000);
    try {
      const result = await listRequirements({ q: query, limit: 5, processingState: "active", signal: controller.signal });
      if (request !== similarRequest.current) return;
      setSimilarRequirements(result.items.slice(0, 5));
    } catch {
      if (request !== similarRequest.current) return;
      setSimilarRequirements([]);
    } finally {
      window.clearTimeout(timer);
    }
  };

  /** 提交前按服务端契约做本地校验（上限来自 pipeline.ts / PRD-26），给出中文字段级提示。 */
  const validateIntake = (): string | null => {
    if (!title.trim() || !description.trim() || !channel) return "请填写标题、需求描述，并选择来源渠道。";
    if (title.trim().length > INTAKE_LIMITS.title) return `标题不能超过 ${INTAKE_LIMITS.title} 字，当前 ${title.trim().length} 字。`;
    if (description.trim().length > INTAKE_LIMITS.description) return `需求描述不能超过 20,000 字，当前 ${description.trim().length.toLocaleString("zh-CN")} 字。`;
    if (productModel.trim().length > INTAKE_LIMITS.productModel) return `产品/型号不能超过 ${INTAKE_LIMITS.productModel} 字。`;
    if (constraintNotes.trim().length > INTAKE_LIMITS.constraintNotes) return `边界/限制不能超过 ${INTAKE_LIMITS.constraintNotes.toLocaleString("zh-CN")} 字。`;
    const link = supplementUrl.trim();
    if (link && !safeHttpUrl(link)) return "来源链接需以 http:// 或 https:// 开头，且不能包含账号密码。";
    if (link.length > INTAKE_LIMITS.supplementUrl) return `来源链接不能超过 ${INTAKE_LIMITS.supplementUrl} 字。`;
    return null;
  };
  const submit = async () => {
    const problem = validateIntake();
    if (problem) { setError(problem); return; }
    // 提交前再查一次相似需求；不 await、不阻断提交（PRD-31）。
    void lookupSimilar();
    setBusy(true); setError(null); setConflict(false);
    const proposerName = proposer && !isMaskedPlaceholder(proposer) ? proposer.trim().slice(0, INTAKE_LIMITS.proposerName) : null;
    try {
      const created = await createRequirement({
        title: title.trim(), description: description.trim(), sourceChannel: channel,
        ...(productModel.trim() ? { productModel: productModel.trim() } : {}),
        ...(requirementType ? { requirementType: requirementType as (typeof REQUIREMENT_INTAKE_TYPES)[number] } : {}),
        ...(constraintNotes.trim() ? { constraintNotes: constraintNotes.trim() } : {}),
        ...(supplementUrl.trim() ? { supplementUrl: supplementUrl.trim() } : {}),
        ...(intakeModule ? { intakeModule } : {}),
        ...(fromChatPaste ? { intakeOrigin: "chat_paste" as const } : {}),
        ...(proposerName ? { proposerName } : {}),
      }, undefined, idempotencyKey.current);
      reset();
      setOpen(false);
      onCreated(created.requirementId);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        // 同键不同内容：上一次可能其实已经创建成功。保留内容与键，先让用户去确认，再由用户决定换新键重提。
        setConflict(true);
        setError(`${cause.message}若上一次提交实际已成功，请先在需求池确认；确认没有这条需求后，可更换提交编号重试。`);
      } else {
        // 失败保留输入与幂等键：网络恢复后重试仍是同一次提交，不会重复建需求。
        setError(intakeErrorMessage(cause, "提交", "提交失败，请重试；同一提交重试不会重复建需求。"));
      }
    } finally { setBusy(false); }
  };
  /** 仅在用户明确确认「上次没建成」后使用：换新幂等键重提，可能产生重复需求。 */
  const retryWithNewKey = () => {
    idempotencyKey.current = crypto.randomUUID();
    setConflict(false); setError(null);
    void submit();
  };

  // PRD-31：最多展示 5 条，按接口返回顺序；来源名与列表一致。
  const visibleSimilar = similarRequirements.slice(0, 5).map((item) => ({
    id: item.id,
    platformRequirementId: item.platformRequirementId ?? null,
    title: item.title,
    sourceLabel: requirementSourceName(item),
  }));

  return <>
    <div className="rules-form intake-form" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
      <div className="field" style={{ flexBasis: "100%" }}>
        {!chatOpen
          ? <ArcoButton size="small" htmlType="button" onClick={() => setChatOpen(true)} disabled={busy}>从聊天粘贴</ArcoButton>
          : <>
              <span>聊天内容（粘贴后由 AI 整理成下面的表单，仍需你确认；聊天原文不会保存）</span>
              <Input.TextArea aria-label="聊天内容" rows={5} maxLength={20000} showWordLimit placeholder="把聊天里的需求原文粘贴到这里" value={chatText} onChange={(value: string) => setChatText(value)} disabled={busy || extracting} />
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
                <ArcoButton type="primary" size="small" htmlType="button" onClick={() => void extract()} disabled={busy || extracting || !chatText.trim()}>{extracting ? "整理中…" : "整理成需求草稿"}</ArcoButton>
                <ArcoButton size="small" htmlType="button" onClick={() => { setChatOpen(false); setChatError(null); }} disabled={extracting}>收起</ArcoButton>
                {aiFilled.length > 0 && <span className="status-hint" role="status">已填充表单，带「AI 填充」的字段请核对后再提交。</span>}
              </div>
              {chatError && <div className="field-error" role="alert">{chatError}</div>}
            </>}
        {fallbackDraft && <div className="field-error" role="alert" style={{ display: "block", marginTop: 4 }}>AI 没能整理这段聊天，标题和描述已按脱敏原文填入（未经过 AI 整理），请核对或改写后再提交。</div>}
        {proposer && !isMaskedPlaceholder(proposer) && <span className="status-hint" style={{ display: "block", marginTop: 4 }}>聊天中的提出人：{proposer}（只做展示，不进负责人匹配、不发通知；提交后显示在需求详情里）</span>}
      </div>
      <label className="field" style={{ flex: 2, minWidth: 240 }}>
        <span>标题 *{aiMark("title")}</span>
        <Input aria-label="新建需求标题" placeholder="一句话描述用户的问题或诉求" value={title} onChange={(value: string) => {
          setTitle(value); clearAiMark("title");
          // 标题一变，旧的相似结果就不再对应当前标题：立即清空并作废在途查询。
          setSimilarRequirements([]); similarQuery.current = ""; similarRequest.current += 1;
        }} onBlur={() => void lookupSimilar()} disabled={busy} />
      </label>
      {visibleSimilar.length > 0 && <div className="status-hint" role="status" style={{ flexBasis: "100%" }}>
        <strong>相似需求（按标题关键字匹配，仅供参考，不代表重复；不会阻断提交）</strong>
        <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
          {visibleSimilar.map((item) => <li key={item.id}>
            <a href={`?requirement=${item.id}`} target="_blank" rel="noreferrer">{item.platformRequirementId ? `${item.platformRequirementId} · ` : ""}{item.title}</a>
            <span className="subtle-text"> · {item.sourceLabel}</span>
          </li>)}
        </ul>
      </div>}
      <div className="field">
        <span>来源渠道 *{aiMark("sourceChannel")}</span>
        <Select aria-label="新建来源渠道" value={channel} onChange={(value: string) => { setChannel(value); clearAiMark("sourceChannel"); }} disabled={busy} placeholder="请选择" style={{ minWidth: 160 }} options={[{ label: "请选择", value: "" }, ...REQUIREMENT_INTAKE_CHANNELS.map((item) => ({ label: item, value: item }))]} />
      </div>
      <label className="field">
        <span>产品/型号{aiMark("productModel")}</span>
        <Input aria-label="关联产品或型号" placeholder="选填，如码表 C606" value={productModel} onChange={(value: string) => { setProductModel(value); clearAiMark("productModel"); }} disabled={busy} />
      </label>
      <div className="field">
        <span>需求类型{aiMark("requirementType")}</span>
        <Select aria-label="需求类型" value={requirementType} onChange={(value: string) => { setRequirementType(value); clearAiMark("requirementType"); }} disabled={busy} placeholder="未选择" style={{ minWidth: 160 }} options={[{ label: "未选择", value: "" }, ...REQUIREMENT_INTAKE_TYPES.map((item) => ({ label: item, value: item }))]} />
      </div>
      <div className="field">
        <span>功能模块{aiMark("intakeModule")}</span>
        <Select aria-label="功能模块（录入）" value={intakeModule} onChange={(value: string) => { setIntakeModule(value); clearAiMark("intakeModule"); }} disabled={busy} placeholder="未选择" style={{ minWidth: 160 }} options={[{ label: "未选择", value: "" }, ...modules.map((item) => ({ label: item.name, value: item.name }))]} />
      </div>
      {moduleCandidate && <span className="status-hint" style={{ flexBasis: "100%" }}>该模块责任人：{moduleCandidate}（候选提示；负责人在创建后的详情里确认分配）</span>}
      <label className="field" style={{ flexBasis: "100%" }}>
        <span>边界/限制{aiMark("constraintNotes")}</span>
        <Input.TextArea aria-label="边界或限制" rows={2} placeholder="选填：兼容性、法规、成本、上市时间等已知约束；未知留空" value={constraintNotes} onChange={(value: string) => { setConstraintNotes(value); clearAiMark("constraintNotes"); }} disabled={busy} />
      </label>
      <label className="field" style={{ flexBasis: "100%" }}>
        <span>来源链接</span>
        <Input aria-label="来源链接" type="url" placeholder="选填：原始反馈或工单链接（http/https）" value={supplementUrl} onChange={(value: string) => { setSupplementUrl(value); }} disabled={busy} />
      </label>
      <label className="field" style={{ flexBasis: "100%" }}>
        <span>需求描述 *{aiMark("description")}</span>
        <Input.TextArea aria-label="新建需求描述" rows={4} placeholder={"建议按四段描述（缺段不阻断提交，AI 会标出缺失项）：\n用户/场景：谁在什么场景下…\n现状问题：当前遇到…\n期望结果：希望…\n补充：约束、链接等（可留空）"} value={description} onChange={(value: string) => { setDescription(value); clearAiMark("description"); }} disabled={busy} />
      </label>
      <div className="field" style={{ flexBasis: "100%", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <ArcoButton type="primary" size="small" htmlType="button" onClick={() => void submit()} disabled={busy}>提交并进入分析</ArcoButton>
        <ArcoButton size="small" htmlType="button" onClick={() => { setOpen(false); reset(); }} disabled={busy}>取消</ArcoButton>
        {busy && <span className="status-hint" role="status">正在提交…</span>}
      </div>
      {error && <div className="field-error" role="alert" style={{ flexBasis: "100%" }}>{error}</div>}
      {conflict && <div className="field" style={{ flexBasis: "100%", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <ArcoButton size="small" htmlType="button" onClick={retryWithNewKey} disabled={busy}>换新键重提</ArcoButton>
        <span className="status-hint">只在你确认上一次没有创建成功时使用：换了提交编号后重复提交可能产生重复需求。</span>
      </div>}
    </div>
    <ConfirmModal
      visible={pendingDraft !== null}
      title="草稿与已填内容冲突"
      description={<>以下字段已经有内容：{pendingDraft?.conflicts.join("、")}。选择「只补空白字段」会保留你已填的内容；选择「覆盖已填字段」会按草稿替换这些字段。</>}
      okText="覆盖已填字段"
      cancelText="只补空白字段"
      onOk={() => { if (pendingDraft) { applyDraft(pendingDraft.draft, "overwrite"); void lookupSimilar(pendingDraft.draft.title); } setPendingDraft(null); }}
      onCancel={() => { if (pendingDraft) { applyDraft(pendingDraft.draft, "merge"); void lookupSimilar(pendingDraft.draft.title); } setPendingDraft(null); }}
    />
  </>;
}

export interface ManualEditSource {
  id: string;
  sourceVersion: number;
  sourceType: "teambition" | "web_manual" | "base_form";
  title: string;
  description: string | null;
  sourceChannel: string | null;
  productModel: string | null;
  requirementType: string | null;
  constraintNotes: string | null;
  supplementUrl: string | null;
}

/** V02-T07：手工需求编辑；PRD-30 起多维表格来源同样可编辑（只改平台侧，不回写收集表）。版本冲突时保留未提交内容并提示刷新。 */
export function ManualEditSection({ detail, onSaved }: { detail: ManualEditSource; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(detail.title);
  const [description, setDescription] = useState(detail.description ?? "");
  const [channel, setChannel] = useState(detail.sourceChannel ?? "");
  const [productModel, setProductModel] = useState(detail.productModel ?? "");
  const [requirementType, setRequirementType] = useState(detail.requirementType ?? "");
  const [constraintNotes, setConstraintNotes] = useState(detail.constraintNotes ?? "");
  const [supplementUrl, setSupplementUrl] = useState(detail.supplementUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const idempotencyKey = useRef<string>(crypto.randomUUID());
  const wasOpenRef = useRef(false);
  const lastDetailIdRef = useRef(detail.id);
  // 只在展开表单（false → true）或切换需求时以当前详情预填；父级后台刷新不冲掉正在编辑的草稿。
  useEffect(() => {
    const idChanged = lastDetailIdRef.current !== detail.id;
    lastDetailIdRef.current = detail.id;
    if (idChanged) {
      setOpen(false);
      setNotice(null);
      setError(null);
      wasOpenRef.current = false;
      return;
    }
    if (open && !wasOpenRef.current) {
      setTitle(detail.title); setDescription(detail.description ?? ""); setChannel(detail.sourceChannel ?? "");
      setProductModel(detail.productModel ?? ""); setRequirementType(detail.requirementType ?? "");
      setConstraintNotes(detail.constraintNotes ?? ""); setSupplementUrl(detail.supplementUrl ?? "");
      setError(null); setNotice(null); idempotencyKey.current = crypto.randomUUID();
    }
    wasOpenRef.current = open;
  }, [open, detail]);
  // 手工与多维表格来源都可编辑；聊天粘贴属 web_manual，沿用同一入口；Teambition 只读。
  if (detail.sourceType !== "web_manual" && detail.sourceType !== "base_form") return null;
  if (!open) {
    return <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <ArcoButton size="small" htmlType="button" onClick={() => setOpen(true)}>编辑需求</ArcoButton>
      {notice && <span className="status-hint" role="status">{notice}</span>}
    </div>;
  }
  const validateEdit = (): string | null => {
    if (!title.trim() || !description.trim() || !channel) return "标题、需求描述与来源渠道不能为空。";
    if (title.trim().length > INTAKE_LIMITS.title) return `标题不能超过 ${INTAKE_LIMITS.title} 字，当前 ${title.trim().length} 字。`;
    if (description.trim().length > INTAKE_LIMITS.description) return `需求描述不能超过 20,000 字，当前 ${description.trim().length.toLocaleString("zh-CN")} 字。`;
    if (productModel.trim().length > INTAKE_LIMITS.productModel) return `产品/型号不能超过 ${INTAKE_LIMITS.productModel} 字。`;
    if (constraintNotes.trim().length > INTAKE_LIMITS.constraintNotes) return `边界/限制不能超过 ${INTAKE_LIMITS.constraintNotes.toLocaleString("zh-CN")} 字。`;
    const link = supplementUrl.trim();
    if (link && !safeHttpUrl(link)) return "来源链接需以 http:// 或 https:// 开头，且不能包含账号密码。";
    if (link.length > INTAKE_LIMITS.supplementUrl) return `来源链接不能超过 ${INTAKE_LIMITS.supplementUrl} 字。`;
    return null;
  };
  const submit = async () => {
    const problem = validateEdit();
    if (problem) { setError(problem); return; }
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await updateRequirement(detail.id, {
        expectedSourceVersion: detail.sourceVersion,
        title: title.trim(), description: description.trim(), sourceChannel: channel,
        ...(productModel.trim() || detail.productModel ? { productModel: productModel.trim() || null } : {}),
        ...(requirementType || detail.requirementType ? { requirementType: requirementType || null } : {}),
        ...(constraintNotes.trim() || detail.constraintNotes ? { constraintNotes: constraintNotes.trim() || null } : {}),
        ...(supplementUrl.trim() || detail.supplementUrl ? { supplementUrl: supplementUrl.trim() || null } : {}),
      }, undefined, idempotencyKey.current);
      setOpen(false);
      setNotice(result.outcome === "unchanged" ? "内容无变化，未新建版本。" : `已保存到源版本 v${result.sourceVersion}${result.substantiveChanged ? "，将重跑分析" : ""}。`);
      onSaved();
    } catch (cause) {
      // 版本冲突/依赖失败：保留表单内容，用户刷新后可基于新版本重填（AC02）。
      setError(cause instanceof ApiError ? cause.message : "保存失败，请重试；同一保存重试不会产生第二个版本。");
    } finally { setBusy(false); }
  };
  return <div className="rules-form" style={{ alignItems: "flex-end", flexWrap: "wrap", borderTop: "1px solid rgba(125,131,140,.25)", paddingTop: 12 }}>
    {detail.sourceType === "base_form" ? <p className="detail-note" role="note" style={{ flexBasis: "100%", margin: 0 }}>修改只保存在需求平台，不会写回多维表格收集表。</p> : null}
    <label className="field" style={{ flex: 2, minWidth: 240 }}><span>标题 *</span><Input aria-label="编辑需求标题" value={title} onChange={(value: string) => setTitle(value)} disabled={busy} /></label>
    <div className="field"><span>来源渠道 *</span>
      <Select aria-label="编辑来源渠道" value={channel} onChange={(value: string) => setChannel(value)} disabled={busy} placeholder="请选择" style={{ minWidth: 160 }} options={[{ label: "请选择", value: "" }, ...REQUIREMENT_INTAKE_CHANNELS.map((item) => ({ label: item, value: item }))]} />
    </div>
    <label className="field"><span>产品/型号</span><Input aria-label="编辑产品或型号" value={productModel} onChange={(value: string) => setProductModel(value)} disabled={busy} /></label>
    <div className="field"><span>需求类型</span>
      <Select aria-label="编辑需求类型" value={requirementType} onChange={(value: string) => setRequirementType(value)} disabled={busy} placeholder="未选择" style={{ minWidth: 160 }} options={[{ label: "未选择", value: "" }, ...REQUIREMENT_INTAKE_TYPES.map((item) => ({ label: item, value: item }))]} />
    </div>
    <label className="field" style={{ flexBasis: "100%" }}><span>需求描述 *</span><Input.TextArea aria-label="编辑需求描述" rows={4} value={description} onChange={(value: string) => setDescription(value)} disabled={busy} /></label>
    <label className="field" style={{ flexBasis: "100%" }}><span>边界/限制</span><Input.TextArea aria-label="编辑边界或限制" rows={2} value={constraintNotes} onChange={(value: string) => setConstraintNotes(value)} disabled={busy} /></label>
    <label className="field" style={{ flexBasis: "100%" }}><span>来源链接</span><Input aria-label="编辑来源链接" type="url" value={supplementUrl} onChange={(value: string) => setSupplementUrl(value)} disabled={busy} /></label>
    <div className="field" style={{ flexBasis: "100%", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <ArcoButton type="primary" size="small" htmlType="button" onClick={() => void submit()} disabled={busy}>保存（基于 v{detail.sourceVersion}）</ArcoButton>
      <ArcoButton size="small" htmlType="button" onClick={() => setOpen(false)} disabled={busy}>取消</ArcoButton>
      {busy && <span className="status-hint" role="status">正在保存…</span>}
      {notice && <span className="status-hint" role="status">{notice}</span>}
    </div>
    {error && <div className="field-error" role="alert" style={{ flexBasis: "100%" }}>{error}</div>}
  </div>;
}

export interface AudienceState { tags: string[]; confirmed: boolean; version: number }

/** V02-T09 / 2026-10-28 UI revision：PM 人群标签编辑。
 *  AI 建议与 PM 当前值分开；未确认且有 AI 建议时默认选中首个建议（仅草稿，不自动保存）。
 *  修改不触发分析、推送或通知。 */
export function AudienceEditor({ requirementId, audience, suggestedTags = [], onSaved }: {
  requirementId: string;
  audience: AudienceState;
  suggestedTags?: string[];
  onSaved: () => void;
}) {
  const suggestedKey = suggestedTags.join(",");
  const defaultSelection = audience.confirmed ? audience.tags : suggestedTags.length > 0 ? [suggestedTags[0]] : [];
  const [selected, setSelected] = useState<string[]>(defaultSelection);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 确认版本变化或 AI 建议变化时重算草稿；普通详情刷新不覆盖用户未保存的多选。
  const confirmedTags = audience.confirmed ? audience.tags.join(",") : "";
  useEffect(() => {
    setSelected(audience.confirmed ? audience.tags : suggestedTags.length > 0 ? [suggestedTags[0]] : []);
    setError(null);
  }, [audience.version, confirmedTags, suggestedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (level: string) => setSelected((prev) => prev.includes(level) ? prev.filter((item) => item !== level) : [...prev, level]);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      await setAudienceTags(requirementId, { tags: selected, expectedVersion: audience.version });
      onSaved();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "保存失败，请重试。");
    } finally { setBusy(false); }
  };
  return <div className="audience-editor">
    <div className="audience-ai-row">
      <span className="audience-ai-label">AI 建议</span>
      {suggestedTags.length > 0
        ? <div className="audience-ai-chips">{suggestedTags.map((level) => <ArcoButton type="text" key={level} className={`audience-ai-chip${selected.includes(level) ? " is-in-draft" : ""}`} onClick={() => toggle(level)} disabled={busy} aria-pressed={selected.includes(level)} title="把该 AI 建议加入/移出本次选择" htmlType="button">{AUDIENCE_LEVEL_NAMES[level] ?? level}</ArcoButton>)}</div>
        : <span className="audience-ai-empty">AI 未给出人群建议</span>}
      <span className="audience-ai-hint">未确认时默认选中首个 AI 建议；可修改后保存</span>
    </div>
    <div className="audience-choice-row" role="group" aria-label="选择适用人群">
      {AUDIENCE_LEVELS.map((level) => (
        <ArcoButton type="text" key={level} aria-pressed={selected.includes(level)} className={`audience-tag${selected.includes(level) ? " is-selected" : ""}`} onClick={() => toggle(level)} disabled={busy} title={AUDIENCE_LEVEL_NAMES[level]} htmlType="button">
          {AUDIENCE_LEVEL_NAMES[level]}
        </ArcoButton>
      ))}
    </div>
    <div className="audience-actions">
      <ArcoButton type="text" className="audience-save-button" onClick={() => void save()} disabled={busy} htmlType="button">{busy ? "保存中…" : "保存人群标签"}</ArcoButton>
      {audience.confirmed && audience.tags.length === 0 && <span className="status-hint">已确认为空（不再默认采用 AI 建议）</span>}
      {!audience.confirmed && <span className="status-hint">尚未确认；当前选择是草稿，保存后才成为 PM 确认值</span>}
      {error && <span className="field-error" role="alert">{error}</span>}
    </div>
  </div>;
}

/** V02-T11：详情「Beta 分析」次级入口（默认收起）。RICE 草稿只落草稿与历史，
 *  打开面板不调用 AI、不影响主流程（AC01/AC06）。 */
export function BetaPanel({ requirementId }: { requirementId: string }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<RiceDraft | null>(null);
  const [reach, setReach] = useState(""); const [impact, setImpact] = useState("");
  const [confidence, setConfidence] = useState(""); const [effort, setEffort] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<KanoEvidenceVersionDto[]>([]);
  const [runs, setRuns] = useState<KanoRunDto[]>([]);
  const [selectedEvidence, setSelectedEvidence] = useState("");
  const [kanoBusy, setKanoBusy] = useState(false);
  const [kanoError, setKanoError] = useState<string | null>(null);
  useEffect(() => {
    setOpen(false);
    setDraft(null);
    setReach(""); setImpact(""); setConfidence(""); setEffort(""); setNotes("");
    setRuns([]); setError(null); setNotice(null); setKanoError(null);
  }, [requirementId]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const controller = new AbortController();
    // V02-T13：只读列出已批准资料；打开面板不运行任何模型。
    void listKanoEvidence(undefined, controller.signal).then((result) => {
      if (cancelled) return;
      const approved = result.items.filter((item) => item.status === "approved" && !item.piiFlagged);
      setEvidence(approved);
      setSelectedEvidence(approved[0] ? String(approved[0].version) : "");
    }).catch(() => { if (!cancelled) setEvidence([]); });
    void listKanoRuns(requirementId, undefined, controller.signal).then((result) => { if (!cancelled) setRuns(result.items); }).catch(() => { if (!cancelled) setRuns([]); });
    void getRiceDraft(requirementId, undefined, controller.signal).then((loaded) => {
      if (cancelled) return;
      setDraft(loaded);
      setReach(loaded.inputs.reach ?? ""); setImpact(loaded.inputs.impact ?? "");
      setConfidence(loaded.inputs.confidence ?? ""); setEffort(loaded.inputs.effort ?? "");
      setNotes(loaded.notes ?? "");
      setError(null); setNotice(null);
    }).catch(() => { if (!cancelled) setError("草稿读取失败，请重试。"); });
    return () => { cancelled = true; controller.abort(); };
  }, [open, requirementId]);
  if (!open) return <ArcoButton size="small" htmlType="button" onClick={() => setOpen(true)}>Beta 分析</ArcoButton>;
  const save = async () => {
    if (!draft) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await saveRiceDraft(requirementId, {
        reach: reach || null, impact: impact || null, confidence: confidence || null, effort: effort || null,
        notes: notes || null, expectedEditVersion: draft.editVersion,
      });
      // 保存成功即推进本地版本：后续刷新失败不再让下一次保存携带过期 expectedEditVersion（复查 #10）。
      setDraft((prev) => prev ? { ...prev, editVersion: result.editVersion } : prev);
      setNotice(`草稿已保存（v${result.editVersion}）。`);
      const reloaded = await getRiceDraft(requirementId);
      setDraft(reloaded);
      setNotice(`草稿已保存（v${result.editVersion}）${reloaded.score !== null ? ` · RICE = ${reloaded.score}` : " · 分数待补充完整输入"}。`);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "保存失败，请重试。");
    } finally { setBusy(false); }
  };
  return <div className="rules-form" style={{ alignItems: "flex-end", flexWrap: "wrap", borderTop: "1px solid rgba(125,131,140,.25)", paddingTop: 12 }}>
    <strong style={{ flexBasis: "100%" }}>RICE 草稿（Beta · 与主优先级无关）</strong>
    <label className="field"><span>Reach（草稿）</span><Input aria-label="RICE Reach 草稿" value={reach} onChange={(value: string) => setReach(value)} disabled={busy} placeholder="如：约 200 次/月（单位待配置）" /></label>
    <label className="field"><span>Impact（草稿）</span><Input aria-label="RICE Impact 草稿" value={impact} onChange={(value: string) => setImpact(value)} disabled={busy} /></label>
    <label className="field"><span>Confidence（草稿）</span><Input aria-label="RICE Confidence 草稿" value={confidence} onChange={(value: string) => setConfidence(value)} disabled={busy} /></label>
    <label className="field"><span>Effort（草稿）</span><Input aria-label="RICE Effort 草稿" value={effort} onChange={(value: string) => setEffort(value)} disabled={busy} /></label>
    <label className="field" style={{ flexBasis: "100%" }}><span>依据说明</span><Input.TextArea aria-label="RICE 依据说明" rows={2} value={notes} onChange={(value: string) => setNotes(value)} disabled={busy} /></label>
    <div className="field" style={{ flexBasis: "100%", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <ArcoButton type="primary" size="small" htmlType="button" onClick={() => void save()} disabled={busy || !draft}>保存草稿</ArcoButton>
      <ArcoButton size="small" htmlType="button" onClick={() => setOpen(false)} disabled={busy}>收起</ArcoButton>
      {draft && <span className="status-hint" role="status">状态：{draft.status} · 依据源版本 v{draft.sourceVersion} · 草稿版本 v{draft.editVersion}</span>}
      {notice && <span className="status-hint" role="status">{notice}</span>}
    </div>
    <div className="req-field" style={{ flexBasis: "100%", marginTop: 8 }}>
      <strong>Kano 资料（已批准快照 · 只读）</strong>
      {evidence.length === 0 ? <p className="status-hint">暂无已批准的访谈资料。</p> : <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
        {evidence.map((item) => {
          const safeUrl = safeHttpUrl(item.sourceUrl);
          return <li key={item.id}>v{item.version} · {item.title}{item.coverageNotes ? `（覆盖限制：${item.coverageNotes}）` : ""}{safeUrl ? <> · <a href={safeUrl} target="_blank" rel="noreferrer">来源</a></> : null}</li>;
        })}
      </ul>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
        <Select aria-label="Kano 资料版本" value={selectedEvidence} onChange={(value: string) => setSelectedEvidence(value)} disabled={kanoBusy || evidence.length === 0} placeholder="选择资料版本" style={{ minWidth: 200 }} options={[{ label: "选择资料版本", value: "" }, ...evidence.map((item) => ({ label: `v${item.version} · ${item.title}`, value: String(item.version) }))]} />
        <ArcoButton type="primary" size="small" htmlType="button" disabled={kanoBusy || !selectedEvidence} onClick={() => void (async () => {
          setKanoBusy(true); setKanoError(null);
          try {
            await triggerKanoRun(requirementId, Number(selectedEvidence));
            setRuns((await listKanoRuns(requirementId)).items);
          } catch (cause) {
            setKanoError(cause instanceof ApiError ? cause.message : "触发失败，请重试。");
          } finally { setKanoBusy(false); }
        })()}>生成 Kano 假设报告（手动）</ArcoButton>
        {kanoBusy && <span className="status-hint" role="status">已提交，运行中…</span>}
        {kanoError && <span className="field-error" role="alert">{kanoError}</span>}
      </div>
      {runs.length > 0 && <div style={{ marginTop: 8 }}>
        {runs.slice(0, 3).map((run) => <div key={run.id} className="req-field" style={{ borderTop: "1px dashed rgba(125,131,140,.3)", paddingTop: 8, marginTop: 8 }}>
          <strong>v{run.runVersion} · {run.status === "succeeded" ? (run.result?.researchStatus ?? "AI假设（待验证）") : run.status === "running" ? "运行中" : `失败（${run.safeErrorCode ?? ""}）`}{run.staleInputs ? " · 输入已过期，建议重跑" : ""}</strong>
          {run.result && <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {run.result.capabilities.map((capability, index) => <li key={index}><strong>{capability.capability}</strong>（{capability.audience ?? "人群待判断"}）→ 候选 <strong>{capability.candidateType}</strong>{capability.conflicts?.length ? ` · 冲突：${capability.conflicts.join("；")}` : ""}<br /><span className="status-hint">正向：{capability.positiveQuestion}／反向：{capability.negativeQuestion}</span><br /><span className="status-hint">推演倾向：{capability.simulatedLeaning.option}——{capability.simulatedLeaning.rationale}；证据 {capability.evidence.join(", ")}</span></li>)}
          </ul>}
          {run.result && run.result.gaps.length > 0 && <p className="status-hint">缺口：{run.result.gaps.join("；")}</p>}
          {run.result && <p className="status-hint">置信度：{run.result.confidence}——{run.result.confidenceReason}</p>}
          {run.status === "failed" && <p className="status-hint">{run.safeErrorSummary ?? ""}</p>}
        </div>)}
      </div>}
    </div>
    {error && <div className="field-error" role="alert" style={{ flexBasis: "100%" }}>{error}</div>}
  </div>;
}
