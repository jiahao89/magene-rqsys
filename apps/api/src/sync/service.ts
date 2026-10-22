import { randomUUID } from "node:crypto";
import type { NormalizedTeambitionRequirement, SourceProjectConfig } from "../domain/workflow.js";
import { normalizeTeambitionTask, sourcePayloadHash } from "../adapters/teambition/normalize.js";
import type { TeambitionTaskRecord } from "../adapters/teambition/raw-types.js";
import { isSubstantiveChange, substantiveHash } from "./hashes.js";
import type { AnalysisState, BatchState } from "../domain/workflow.js";

export interface SourcePage { items: TeambitionTaskRecord[]; hasMore: boolean; nextCursor: string | null; }
export interface SyncSourceReader { listRequirements(config: SourceProjectConfig, cursor?: string | null): Promise<SourcePage>; }
export interface SyncPersistence {
  findRequirement(sourceConfigId: string, sourceRequirementId: string): Promise<{id:string;sourceVersion:number;sourceHash:string;substantiveHash:string;analysisState:AnalysisState}|null>;
  upsertRequirement(input: NormalizedTeambitionRequirement & { sourceHash: string; substantiveHash: string; sourceVersion: number; latestBatchId: string; analysisRequired: boolean; snapshot: { payload: Record<string, unknown>; isSubstantiveChange: boolean; capturedAt: string } }): Promise<{id:string;created:boolean}>;
  appendSourceSnapshot(input:{requirementId:string;sourceVersion:number;sourceHash:string;substantiveHash:string;payload:Record<string,unknown>;isSubstantiveChange:boolean;capturedAt:string}):Promise<void>;
  writeSyncItem(input:{batchId:string;requirementId:string|null;teambitionRequirementId:string;action:"created"|"updated"|"unchanged";status:"succeeded"|"failed";errorCode:string|null;errorDetail:string|null;startedAt:string;completedAt:string}):Promise<void>;
  completeBatch(batchId:string,result:{status:BatchState;totalCount:number;succeededCount:number;failedCount:number;errorSummary:string|null;completedAt:string}):Promise<void>;
}
export interface SyncInput { batchId:string;sourceConfigId:string;config:SourceProjectConfig;startedAt?:string;onlyIds?:string[];mode?:SyncExecutionMode }
// Queue payloads resolve configuration at the application composition seam; the orchestrator stays provider-agnostic.
export type SyncExecutionMode = "full_pipeline" | "source_only";
export interface SyncJobContext { batchId:string;sourceConfigId:string;trigger:"manual"|"scheduled";actorId:string|null;onlyIds?:string[];testFixture?:boolean;mode?:SyncExecutionMode }
export function shouldProcessSyncDownstream(mode: SyncExecutionMode | undefined): boolean { return mode !== "source_only"; }
export type SyncJobRunner = (job: SyncJobContext) => Promise<SyncResult>;
export interface SyncResult {batchId:string;status:BatchState;totalCount:number;succeededCount:number;failedCount:number;}


/** 标题去重键：TB 原始数据里存在“需求 ID 不同、标题内容相同”的重复项。 */
export function requirementTitleKey(title: unknown): string | null {
  if (typeof title !== "string") return null;
  const key = title.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase();
  return key.length > 0 ? key : null;
}

/**
 * 同一标题只保留最早的 TB 记录（created 升序，created 相同时按需求 ID），
 * 其余视为 TB 原始数据重复，不进入需求池。空标题不参与去重。
 */
export function dedupeRequirementTitles(records: TeambitionTaskRecord[]): TeambitionTaskRecord[] {
  const canonical = new Map<string, { id: string; created: string }>();
  for (const record of records) {
    const key = requirementTitleKey(record.content);
    if (!key) continue;
    const created = typeof record.created === "string" ? record.created : "";
    const current = canonical.get(key);
    if (!current || created < current.created || (created === current.created && record.id < current.id)) canonical.set(key, { id: record.id, created });
  }
  return records.filter((record) => {
    const key = requirementTitleKey(record.content);
    return !key || canonical.get(key)?.id === record.id;
  });
}
function substantivePayload(requirement:NormalizedTeambitionRequirement):Record<string,unknown>{
  // 附件引用只取字段映射已批准的来源，不做 ID 子串推断
  const mapped=requirement.mappedFields;
  const rawRefs=mapped.attachmentRefs??mapped.attachment_refs;
  const attachmentRefs=Array.isArray(rawRefs)?rawRefs.filter((x):x is string=>typeof x==="string"):[];
  return {title:requirement.title,description:mapped.description??null,scope:mapped.scope??null,acceptanceCriteria:mapped.acceptanceCriteria??null,attachmentRefs};
}
function persistedPayload(requirement:NormalizedTeambitionRequirement):Record<string,unknown>{
  return {sourceProjectId:requirement.sourceProjectId,sourceRequirementId:requirement.sourceRequirementId,title:requirement.title,sourceUniqueId:requirement.sourceUniqueId,sourceCreatedAt:requirement.sourceCreatedAt,sourceUpdatedAt:requirement.sourceUpdatedAt,sourceCreatorId:requirement.sourceCreatorId,sourceExecutorId:requirement.sourceExecutorId,sourceStatusId:requirement.sourceStatusId,sourceTypeId:requirement.sourceTypeId,mappedFields:requirement.mappedFields,sourcePayload:requirement.sourcePayload};
}
export class SyncOrchestrator {
  constructor(private readonly source:SyncSourceReader,private readonly persistence:SyncPersistence,private readonly options:{now?:()=>Date;id?:()=>string}={}){}
  async run(input:SyncInput):Promise<SyncResult>{
    let cursor:string|null=null;let all:TeambitionTaskRecord[]=[];const seen=new Set<string>();const clock=this.options.now??(()=>new Date());
    try {
      while(true){const page=await this.source.listRequirements(input.config,cursor);for(const record of page.items){if(!record.id)continue;if(seen.has(record.id))continue;seen.add(record.id);all.push(record);}if(!page.hasMore)break;if(!page.nextCursor||page.nextCursor===cursor)throw new Error("Teambition pagination cursor did not advance");cursor=page.nextCursor;}
    } catch (error) {
      // 此前这里把原因整个丢掉，只写一句固定文案：5 次重试无法区分"网关 key 过期"与"偶发抖动"，
      // 目标环境排障只能靠猜。现在落一个**脱敏的结构化代码**（不写 provider 原文、不含凭据）。
      const code = classifyPullFailure(error);
      const result:SyncResult={batchId:input.batchId,status:"failed",totalCount:0,succeededCount:0,failedCount:0};
      await this.persistence.completeBatch(input.batchId,{...result,errorSummary:`Teambition task list could not be fetched (${code}).`,completedAt:clock().toISOString()});
      return result;
    }
    // 单项重试：只处理指定需求（按源需求 ID 过滤）
    const onlyIds=input.onlyIds?new Set(input.onlyIds):null;
    if(onlyIds)all=all.filter((record)=>record.id!==undefined&&onlyIds.has(record.id));
    // TB 原始数据里存在“需求 ID 不同、标题相同”的重复项：需求池只保留最早的一条，
    // 其余不进入导入流程（批次计数按实际处理数统计，不写 sync_items）。
    all=dedupeRequirementTitles(all);
    let succeededCount=0,failedCount=0;
    for(const record of all){const began=clock().toISOString();let requirementId:string|null=null;let action:"created"|"updated"|"unchanged"="created";let status:"succeeded"|"failed"="succeeded";let errorCode:string|null=null,errorDetail:string|null=null;let failureCode="source_item_invalid";
      try{
        const normalized=normalizeTeambitionTask(input.config.projectId,record,input.config.fieldMap);const payload=persistedPayload(normalized);const hash=sourcePayloadHash(payload);const sub = substantiveHash(substantivePayload(normalized) as { title:string; description:string|null; scope:string|null; acceptanceCriteria:string|null; attachmentRefs:readonly string[] });failureCode="source_item_read_failed";const previous=await this.persistence.findRequirement(input.sourceConfigId,normalized.sourceRequirementId);const version=previous?previous.sourceVersion+(previous.sourceHash===hash?0:1):1;const changed=previous!==null&&previous.sourceHash!==hash;const substantive=isSubstantiveChange(previous?.substantiveHash??null,sub);
        const analysisRequired=!previous||substantive||previous.analysisState==="pending";
        // Source-only leaves all downstream states untouched. A later full run
        // must re-touch even unchanged source rows so pending owner/push work can resume.
        if(previous&&previous.sourceHash===hash&&!analysisRequired&&input.mode==="source_only"){requirementId=previous.id;action="unchanged";}
        else {const capturedAt=clock().toISOString();failureCode="source_item_write_failed";const upserted=await this.persistence.upsertRequirement({...normalized,sourceHash:hash,substantiveHash:sub,sourceVersion:version,latestBatchId:input.batchId,analysisRequired,snapshot:{payload,isSubstantiveChange:substantive,capturedAt}});requirementId=upserted.id;action=previous?(changed?"updated":"unchanged"):"created";if(!previous||changed){failureCode="source_snapshot_failed";await this.persistence.appendSourceSnapshot({requirementId,sourceVersion:version,sourceHash:hash,substantiveHash:sub,payload,isSubstantiveChange:substantive,capturedAt});}}
      }catch{status="failed";errorCode=failureCode;errorDetail=failureCode==="source_snapshot_failed"?"Requirement updated, but its source snapshot could not be saved":"Requirement could not be synchronized";}
      const completedAt=clock().toISOString();await this.persistence.writeSyncItem({batchId:input.batchId,requirementId,teambitionRequirementId:record.id,action,status,errorCode,errorDetail,startedAt:began,completedAt});if(status==="succeeded")succeededCount++;else failedCount++;
    }
    const result:SyncResult={batchId:input.batchId,status:failedCount===0?"succeeded":succeededCount===0?"failed":"partial_failure",totalCount:all.length,succeededCount,failedCount};
    await this.persistence.completeBatch(input.batchId,{...result,errorSummary:failedCount?`${failedCount} item(s) failed; inspect item results.`:null,completedAt:clock().toISOString()});return result;
  }
}

/**
 * 拉取失败的脱敏分类。只读取结构化字段（HTTP 状态、错误类型），不解析 message 文本，
 * 不写入任何凭据或 provider 原文——用于区分"配置/认证错误"与"可重试的抖动"。
 */
function classifyPullFailure(error: unknown): string {
  const withStatus = error as { statusCode?: number | null; status?: number | null } | null;
  const status = withStatus?.statusCode ?? withStatus?.status ?? null;
  if (typeof status === "number") {
    if (status === 401 || status === 403) return `TB_HTTP_${status}_AUTH`;
    if (status === 404) return "TB_HTTP_404_NOT_FOUND";
    if (status === 429) return "TB_HTTP_429_RATE_LIMITED";
    if (status >= 500) return `TB_HTTP_${status}_UPSTREAM`;
    return `TB_HTTP_${status}`;
  }
  if (error instanceof SyntaxError) return "TB_INVALID_JSON";
  if (error instanceof Error && /pagination cursor did not advance/.test(error.message)) return "TB_PAGINATION_STALLED";
  return "TB_UNKNOWN";
}
