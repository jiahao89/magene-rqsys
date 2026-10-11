import { randomUUID } from "node:crypto";
import type { NormalizedTeambitionRequirement, SourceProjectConfig } from "../domain/workflow.js";
import { normalizeTeambitionTask, sourcePayloadHash } from "../adapters/teambition/normalize.js";
import type { TeambitionTaskRecord } from "../adapters/teambition/raw-types.js";
import { isSubstantiveChange, substantiveHash } from "./hashes.js";
import type { BatchState } from "../domain/workflow.js";

export interface SourcePage { items: TeambitionTaskRecord[]; hasMore: boolean; nextCursor: string | null; }
export interface SyncSourceReader { listRequirements(config: SourceProjectConfig, cursor?: string | null): Promise<SourcePage>; }
export interface SyncPersistence {
  findRequirement(sourceConfigId: string, sourceRequirementId: string): Promise<{id:string;sourceVersion:number;sourceHash:string;substantiveHash:string}|null>;
  upsertRequirement(input: NormalizedTeambitionRequirement & { sourceHash: string; substantiveHash: string; sourceVersion: number; latestBatchId: string; analysisRequired: boolean; snapshot: { payload: Record<string, unknown>; isSubstantiveChange: boolean; capturedAt: string } }): Promise<{id:string;created:boolean}>;
  appendSourceSnapshot(input:{requirementId:string;sourceVersion:number;sourceHash:string;substantiveHash:string;payload:Record<string,unknown>;isSubstantiveChange:boolean;capturedAt:string}):Promise<void>;
  writeSyncItem(input:{batchId:string;requirementId:string|null;teambitionRequirementId:string;action:"created"|"updated"|"unchanged";status:"succeeded"|"failed";errorCode:string|null;errorDetail:string|null;startedAt:string;completedAt:string}):Promise<void>;
  completeBatch(batchId:string,result:{status:BatchState;totalCount:number;succeededCount:number;failedCount:number;errorSummary:string|null;completedAt:string}):Promise<void>;
}
export interface SyncInput { batchId:string;sourceConfigId:string;config:SourceProjectConfig;startedAt?:string;onlyIds?:string[] }
// Queue payloads resolve configuration at the application composition seam; the orchestrator stays provider-agnostic.
export interface SyncJobContext { batchId:string;sourceConfigId:string;trigger:"manual"|"scheduled";actorId:string|null;onlyIds?:string[] }
export type SyncJobRunner = (job: SyncJobContext) => Promise<SyncResult>;
export interface SyncResult {batchId:string;status:BatchState;totalCount:number;succeededCount:number;failedCount:number;}

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
    } catch {
      const result:SyncResult={batchId:input.batchId,status:"failed",totalCount:0,succeededCount:0,failedCount:0};
      await this.persistence.completeBatch(input.batchId,{...result,errorSummary:"Teambition task list could not be fetched.",completedAt:clock().toISOString()});
      return result;
    }
    // 单项重试：只处理指定需求（按源需求 ID 过滤）
    const onlyIds=input.onlyIds?new Set(input.onlyIds):null;
    if(onlyIds)all=all.filter((record)=>record.id!==undefined&&onlyIds.has(record.id));
    let succeededCount=0,failedCount=0;
    for(const record of all){const began=clock().toISOString();let requirementId:string|null=null;let action:"created"|"updated"|"unchanged"="created";let status:"succeeded"|"failed"="succeeded";let errorCode:string|null=null,errorDetail:string|null=null;
      try{
        const normalized=normalizeTeambitionTask(input.config.projectId,record,input.config.fieldMap);const payload=persistedPayload(normalized);const hash=sourcePayloadHash(payload);const sub = substantiveHash(substantivePayload(normalized) as { title:string; description:string|null; scope:string|null; acceptanceCriteria:string|null; attachmentRefs:readonly string[] });const previous=await this.persistence.findRequirement(input.sourceConfigId,normalized.sourceRequirementId);const version=previous?previous.sourceVersion+(previous.sourceHash===hash?0:1):1;const changed=previous!==null&&previous.sourceHash!==hash;const substantive=isSubstantiveChange(previous?.substantiveHash??null,sub);
        if(previous&&previous.sourceHash===hash){requirementId=previous.id;action="unchanged";}
        else {const capturedAt=clock().toISOString();const upserted=await this.persistence.upsertRequirement({...normalized,sourceHash:hash,substantiveHash:sub,sourceVersion:version,latestBatchId:input.batchId,analysisRequired:!previous||substantive,snapshot:{payload,isSubstantiveChange:substantive,capturedAt}});requirementId=upserted.id;action=previous?"updated":"created";if(!previous||changed)await this.persistence.appendSourceSnapshot({requirementId,sourceVersion:version,sourceHash:hash,substantiveHash:sub,payload,isSubstantiveChange:substantive,capturedAt});}
      }catch{status="failed";errorCode="source_item_failed";errorDetail="Requirement could not be synchronized";}
      const completedAt=clock().toISOString();await this.persistence.writeSyncItem({batchId:input.batchId,requirementId,teambitionRequirementId:record.id,action,status,errorCode,errorDetail,startedAt:began,completedAt});if(status==="succeeded")succeededCount++;else failedCount++;
    }
    const result:SyncResult={batchId:input.batchId,status:failedCount===0?"succeeded":succeededCount===0?"failed":"partial_failure",totalCount:all.length,succeededCount,failedCount};
    await this.persistence.completeBatch(input.batchId,{...result,errorSummary:failedCount?`${failedCount} item(s) failed; inspect item results.`:null,completedAt:clock().toISOString()});return result;
  }
}
