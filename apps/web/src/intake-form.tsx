// V02-T04：需求池「新建需求」表单（Web 手工收录，web_manual）。
// 只必填标题/描述/渠道；四段提示是 placeholder 引导，不是四个必填项（PRD 3.2）。
// 幂等键在同一次提交意图内复用（失败重试不换键），成功或重新展开表单后重置。
import { useEffect, useRef, useState } from "react";
import { ApiError, REQUIREMENT_INTAKE_CHANNELS, REQUIREMENT_INTAKE_TYPES, createRequirement, getFunctionModules } from "./api";

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
  // 受控词典模块（G-MODULE）：只提供已发布选项；模块责任人仅作候选提示，不自动分配。
  useEffect(() => {
    if (!open) return;
    void getFunctionModules().then((directory) => setModules(directory.items)).catch(() => setModules([]));
  }, [open]);
  const moduleCandidate = modules.find((item) => item.name === intakeModule)?.personName ?? null;

  if (!open) {
    return <div className="toolbar-actions"><button className="button button-primary button-small" onClick={() => { setOpen(true); setError(null); }}>新建需求</button></div>;
  }

  const reset = () => {
    setTitle(""); setDescription(""); setChannel(""); setProductModel(""); setRequirementType(""); setConstraintNotes(""); setSupplementUrl(""); setIntakeModule(""); setError(null);
    idempotencyKey.current = crypto.randomUUID();
  };

  const submit = async () => {
    if (!title.trim() || !description.trim() || !channel) { setError("请填写标题、需求描述，并选择来源渠道。"); return; }
    setBusy(true); setError(null);
    try {
      const created = await createRequirement({
        title: title.trim(), description: description.trim(), sourceChannel: channel,
        ...(productModel.trim() ? { productModel: productModel.trim() } : {}),
        ...(requirementType ? { requirementType: requirementType as (typeof REQUIREMENT_INTAKE_TYPES)[number] } : {}),
        ...(constraintNotes.trim() ? { constraintNotes: constraintNotes.trim() } : {}),
        ...(supplementUrl.trim() ? { supplementUrl: supplementUrl.trim() } : {}),
        ...(intakeModule ? { intakeModule } : {}),
      }, undefined, idempotencyKey.current);
      reset();
      setOpen(false);
      onCreated(created.requirementId);
    } catch (cause) {
      // 失败保留输入与幂等键：网络恢复后重试仍是同一次提交，不会重复建需求。
      setError(cause instanceof ApiError ? cause.message : "提交失败，请重试；同一提交重试不会重复建需求。");
    } finally { setBusy(false); }
  };

  return <div className="rules-form intake-form" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
    <label className="field" style={{ flex: 2, minWidth: 240 }}>
      <span>标题 *</span>
      <input aria-label="新建需求标题" placeholder="一句话描述用户的问题或诉求" value={title} onChange={(event) => setTitle(event.target.value)} disabled={busy} />
    </label>
    <label className="field">
      <span>来源渠道 *</span>
      <select aria-label="新建来源渠道" value={channel} onChange={(event) => setChannel(event.target.value)} disabled={busy}>
        <option value="">请选择</option>
        {REQUIREMENT_INTAKE_CHANNELS.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
    </label>
    <label className="field">
      <span>产品/型号</span>
      <input aria-label="关联产品或型号" placeholder="选填，如码表 C606" value={productModel} onChange={(event) => setProductModel(event.target.value)} disabled={busy} />
    </label>
    <label className="field">
      <span>需求类型</span>
      <select aria-label="需求类型" value={requirementType} onChange={(event) => setRequirementType(event.target.value)} disabled={busy}>
        <option value="">未选择</option>
        {REQUIREMENT_INTAKE_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
    </label>
    <label className="field">
      <span>功能模块</span>
      <select aria-label="功能模块（录入）" value={intakeModule} onChange={(event) => setIntakeModule(event.target.value)} disabled={busy}>
        <option value="">未选择</option>
        {modules.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
      </select>
    </label>
    {moduleCandidate && <span className="status-hint" style={{ flexBasis: "100%" }}>该模块责任人：{moduleCandidate}（候选提示；负责人在创建后的详情里确认分配）</span>}
    <label className="field" style={{ flexBasis: "100%" }}>
      <span>边界/限制</span>
      <textarea aria-label="边界或限制" rows={2} placeholder="选填：兼容性、法规、成本、上市时间等已知约束；未知留空" value={constraintNotes} onChange={(event) => setConstraintNotes(event.target.value)} disabled={busy} />
    </label>
    <label className="field" style={{ flexBasis: "100%" }}>
      <span>来源链接</span>
      <input aria-label="来源链接" type="url" placeholder="选填：原始反馈或工单链接（http/https）" value={supplementUrl} onChange={(event) => setSupplementUrl(event.target.value)} disabled={busy} />
    </label>
    <label className="field" style={{ flexBasis: "100%" }}>
      <span>需求描述 *</span>
      <textarea aria-label="新建需求描述" rows={4} placeholder={"建议按四段描述（缺段不阻断提交，AI 会标出缺失项）：\n用户/场景：谁在什么场景下…\n现状问题：当前遇到…\n期望结果：希望…\n补充：约束、链接等（可留空）"} value={description} onChange={(event) => setDescription(event.target.value)} disabled={busy} />
    </label>
    <div className="field" style={{ flexBasis: "100%", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <button className="button button-primary button-small" onClick={() => void submit()} disabled={busy}>提交并进入分析</button>
      <button className="button button-secondary button-small" onClick={() => { setOpen(false); reset(); }} disabled={busy}>取消</button>
      {busy && <span className="status-hint" role="status">正在提交…</span>}
    </div>
    {error && <div className="field-error" role="alert" style={{ flexBasis: "100%" }}>{error}</div>}
  </div>;
}
