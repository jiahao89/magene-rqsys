import type { Pool, PoolClient } from "pg";
import { stableHash, substantiveHash } from "../../sync/hashes.js";
import { randomUUID } from "node:crypto";
import type {
  AnalysisRunRecord, AuditEventRecord, BasePushRunRecord, BatchState, FunctionModuleEntry,
  ModuleDictionaryVersionRecord, PersonMappingRecord, PmSnapshotRecord,
  PipelineJobRecord, PipelineJobType, PriorityLevel, PriorityRuleVersionRecord,
  RequirementManualOwner, RequirementRecord, SourceConfigRecord, SourceSnapshotRecord, SyncBatchRecord, SyncItemAction,
  SyncItemRecord, SyncTrigger, AudienceLevel } from "../../domain/persistence.js";
import { normalizeScheduleTime, type AnalysisState, type OwnerState, type PullState, type PushState } from "../../domain/workflow.js";
import { assertTransition } from "../../domain/transitions.js";
import type { ResolvedSourceConfigUpdate } from "../../contracts/source.js";
import { DEFAULT_FUNCTION_MODULES, DEFAULT_TEAM_MEMBERS, mergeTeamBindings, type TeamMappingRow, type TeamPersonBindingInput, type TeamPersonRecord } from "../../domain/team-directory.js";
import { normalizeOwnerName } from "../../owner/mapping.js";
import type {
  AnalysisRunRepository, AuditEventInput, AuditEventRepository, BasePushRunRepository,
  ModuleDictionaryRepository, PersonMappingRepository, PmSnapshotRepository,
  PipelineJobRepository, PriorityRuleRepository, RequirementQueryRepository,
  RequirementSearchCursor, SourceConfigRepository, SourceSnapshotRepository, SyncBatchRepository, SyncItemRepository, TeamDirectoryRepository,
} from "../../application/repositories.js";
import { encodeRequirementCursor } from "../../application/requirement-cursor.js";
import { encodeBatchCursor } from "../../application/batch-cursor.js";
import { redactSafeDetails } from "../../audit/event.js";

export interface RequirementRowWrite {
  sourceConfigId: string;
  teambitionRequirementId: string;
  title: string;
  description: string | null;
  scope: string | null;
  acceptanceCriteria: string | null;
  proposerUserId: string | null;
  proposerName: string | null;
  executorUserId: string | null;
  executorName: string | null;
  statusId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  sourceUrl: string | null;
  uniqueId: number | null;
  attachmentRefs: string[];
  customFields: unknown[];
  payload: Record<string, unknown>;
  sourceHash: string;
  substantiveHash: string;
  sourceVersion: number;
  latestBatchId: string;
  snapshot?: { payload: Record<string, unknown>; isSubstantiveChange: boolean; capturedAt: string };
}

const manualOwner=(r:any):RequirementManualOwner|null=>r.manual_owner_feishu_user_id?{feishuUserId:r.manual_owner_feishu_user_id,feishuIdType:r.manual_owner_feishu_id_type,name:r.manual_owner_name??null,assignedBy:r.manual_owner_assigned_by??null,assignedAt:asDate(r.manual_owner_assigned_at)!,pushedFeishuUserId:r.manual_owner_pushed_feishu_user_id??null,assignmentVersion:Number(r.manual_owner_assignment_version??1)}:null;
const requirement=(r:any):RequirementRecord=>({id:r.id,platformRequirementId:r.platform_requirement_id,sourceType:r.source_type??"teambition",sourceChannel:r.source_channel??null,productModel:r.product_model??null,requirementType:r.requirement_type??null,constraintNotes:r.constraint_notes??null,supplementUrl:r.supplement_url??null,intakeModule:r.intake_module??null,audienceTags:Array.isArray(r.audience_tags)?r.audience_tags.filter((level:unknown): level is AudienceLevel=>typeof level==="string"&&["L1","L2","L3","L4","L5","L6"].includes(level as string)):[],audienceConfirmed:Boolean(r.audience_confirmed),audienceVersion:Number(r.audience_version??0),sourceConfigId:r.source_config_id,teambitionRequirementId:r.teambition_requirement_id,teambitionUniqueId:r.teambition_unique_id,title:r.title,description:r.description,scope:r.scope,acceptanceCriteria:r.acceptance_criteria,proposerUserId:r.proposer_user_id,proposerName:r.proposer_name,executorUserId:r.executor_user_id,executorName:r.executor_name,sourceStatusId:r.source_status_id,sourceCreatedAt:asDate(r.source_created_at),sourceUpdatedAt:asDate(r.source_updated_at),sourceUrl:r.source_url,attachmentRefs:r.attachment_refs,sourceCustomFields:r.source_custom_fields,sourcePayload:r.source_payload,sourceHash:r.source_hash,substantiveHash:r.substantive_hash,sourceVersion:Number(r.source_version),latestBatchId:r.latest_batch_id,baseRecordId:r.base_record_id,lastPushedAt:asDate(r.last_pushed_at),pipeline:{pull:r.pull_state,analysis:r.analysis_state,owner:r.owner_state,push:r.push_state},manualOwner:manualOwner(r),lastPushedOwner:r.last_pushed_owner_feishu_user_id?{feishuUserId:r.last_pushed_owner_feishu_user_id,feishuIdType:r.last_pushed_owner_feishu_id_type}:null,duplicateOfRequirementId:r.duplicate_of_requirement_id??null,firstSeenAt:asDate(r.first_seen_at)!,lastSeenAt:asDate(r.last_seen_at)!,createdAt:asDate(r.created_at)!,updatedAt:asDate(r.updated_at)!});

const asDate=(v:Date|string|null):string|null=>v===null?null:new Date(v).toISOString();
const sourceConfig=(r:any):SourceConfigRecord=>({id:r.id,provider:r.provider,externalProjectId:r.external_project_id,externalProjectName:r.external_project_name,requirementTypeId:r.requirement_type_id,enabled:r.enabled,scheduleEnabled:r.schedule_enabled,scheduleWeekday:r.schedule_weekday,scheduleLocalTime:normalizeScheduleTime(r.schedule_local_time),scheduleTimezone:r.schedule_timezone,ownerNames:r.owner_names,fieldMap:r.field_map,createdAt:asDate(r.created_at)!,updatedAt:asDate(r.updated_at)!});
const batch=(r:any):SyncBatchRecord=>({id:r.id,sourceConfigId:r.source_config_id,triggerType:r.trigger_type,actorId:r.actor_id,idempotencyKey:r.idempotency_key,status:r.status,startedAt:asDate(r.started_at)!,completedAt:asDate(r.completed_at),totalCount:r.total_count,succeededCount:r.succeeded_count,failedCount:r.failed_count,errorSummary:r.error_summary,createdAt:asDate(r.created_at)!});
const item=(r:any):SyncItemRecord=>({id:r.id,batchId:r.batch_id,requirementId:r.requirement_id,teambitionRequirementId:r.teambition_requirement_id,action:r.action,status:r.status,errorCode:r.error_code,errorDetail:r.error_detail,startedAt:asDate(r.started_at)!,completedAt:asDate(r.completed_at)});
const snapshot=(r:any):SourceSnapshotRecord=>({id:r.id,requirementId:r.requirement_id,sourceVersion:r.source_version,sourceHash:r.source_hash,substantiveHash:r.substantive_hash,payload:r.payload,isSubstantiveChange:r.is_substantive_change,capturedAt:asDate(r.captured_at)!});
const analysis=(r:any):AnalysisRunRecord=>({id:r.id,requirementId:r.requirement_id,sourceVersion:r.source_version,analysisVersion:r.analysis_version,status:r.status,moduleSuggestion:r.module_suggestion,confidence:r.confidence,confidenceReason:r.confidence_reason,priority:r.priority,structuredResult:r.structured_result,provider:r.provider,model:r.model,promptVersion:r.prompt_version,moduleDictionaryVersion:r.module_dictionary_version,priorityRuleVersionId:r.priority_rule_version_id,safeErrorCode:r.safe_error_code,safeErrorSummary:r.safe_error_summary,startedAt:asDate(r.started_at)!,completedAt:asDate(r.completed_at)});
const mapping=(r:any):PersonMappingRecord=>({id:r.id,sourceConfigId:r.source_config_id,teambitionUserId:r.teambition_user_id,teambitionDisplayName:r.teambition_display_name,normalizedName:r.normalized_name,feishuUserId:r.feishu_user_id,feishuIdType:r.feishu_id_type,matchMethod:r.match_method,active:r.active,createdBy:r.created_by,createdAt:asDate(r.created_at)!,updatedAt:asDate(r.updated_at)!});
const pmSnapshot=(r:any):PmSnapshotRecord=>({id:r.id,requirementId:r.requirement_id,sourceVersion:r.source_version,baseRecordId:r.base_record_id,pmValues:r.pm_values,capturedAt:asDate(r.captured_at)!});
const basePush=(r:any):BasePushRunRecord=>({id:r.id,requirementId:r.requirement_id,sourceVersion:r.source_version,pushVersion:r.push_version,status:r.status,idempotencyKey:r.idempotency_key,baseRecordId:r.base_record_id,safeErrorCode:r.safe_error_code,safeErrorSummary:r.safe_error_summary,startedAt:asDate(r.started_at)!,completedAt:asDate(r.completed_at)});
const job=(r:any):PipelineJobRecord=>({id:r.id,jobType:r.job_type,dedupeKey:r.dedupe_key,payload:r.payload,status:r.status,attemptCount:r.attempt_count,maxAttempts:r.max_attempts,availableAt:asDate(r.available_at)!,lockedUntil:asDate(r.locked_until),lastErrorCode:r.last_error_code,lastErrorSummary:r.last_error_summary,createdAt:asDate(r.created_at)!,updatedAt:asDate(r.updated_at)!});
const audit=(r:any):AuditEventRecord=>({id:r.id,actorId:r.actor_id,eventType:r.event_type,entityType:r.entity_type,entityId:r.entity_id,result:r.result,safeDetails:r.safe_details,occurredAt:asDate(r.occurred_at)!});
const dictionary=(r:any):ModuleDictionaryVersionRecord=>({version:r.version,status:r.status,entries:r.entries,createdBy:r.created_by,createdAt:asDate(r.created_at)!,publishedAt:asDate(r.published_at)});
const priorityRule=(r:any):PriorityRuleVersionRecord=>({id:r.id,version:r.version,status:r.status,rules:r.rules,validationEvidence:r.validation_evidence,createdBy:r.created_by,createdAt:asDate(r.created_at)!,publishedAt:asDate(r.published_at)});

async function appendAuditInTransaction(client:PoolClient,event:AuditEventInput,entityId:string){
	await client.query("INSERT INTO audit_events(id,actor_id,event_type,entity_type,entity_id,result,safe_details,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[event.id,event.actorId,event.eventType,event.entityType,entityId,event.result,redactSafeDetails(event.safeDetails),event.occurredAt]);
}
export class ActiveBatchConflict extends Error{constructor(){super("An active batch already exists for this source");this.name="ActiveBatchConflict";}}
export class PostgresSourceConfigRepository implements SourceConfigRepository{
  constructor(private readonly pool:Pool){}
  async list(){const{rows}=await this.pool.query("SELECT * FROM source_configs ORDER BY created_at,id");return rows.map(sourceConfig);}
  async get(id:string){const{rows}=await this.pool.query("SELECT * FROM source_configs WHERE id=$1",[id]);return rows[0]?sourceConfig(rows[0]):null;}
  async update(id:string,u:ResolvedSourceConfigUpdate,auditEvent?:AuditEventInput){
    const c=await this.pool.connect();
    try{
      await c.query("BEGIN");
      const{rows}=await c.query("UPDATE source_configs SET external_project_id=$2,external_project_name=$3,requirement_type_id=$4,enabled=$5,schedule_enabled=$6,schedule_weekday=$7,schedule_local_time=$8,schedule_timezone=$9,owner_names=$10,field_map=$11,updated_at=now() WHERE id=$1 RETURNING *",[id,u.projectId,u.projectName,u.requirementTypeId,u.enabled,u.schedule.enabled,u.schedule.weekday,u.schedule.time,u.schedule.timezone,JSON.stringify(u.ownerNames),JSON.stringify(u.fieldMap)]);
      if(rows[0]&&auditEvent)await appendAuditInTransaction(c,auditEvent,id);
      await c.query("COMMIT");
      return rows[0]?sourceConfig(rows[0]):null;
    }catch(error){await c.query("ROLLBACK");throw error;}finally{c.release();}
  }
  async create(p:ResolvedSourceConfigUpdate & {auditEvent?:AuditEventInput}):Promise<SourceConfigRecord>{
    const c=await this.pool.connect();
    try{
      await c.query("BEGIN");
      const{rows}=await c.query("INSERT INTO source_configs(id,external_project_id,external_project_name,requirement_type_id,enabled,schedule_enabled,schedule_weekday,schedule_local_time,schedule_timezone,owner_names,field_map) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",[randomUUID(),p.projectId,p.projectName,p.requirementTypeId,p.enabled,p.schedule.enabled,p.schedule.weekday,p.schedule.time,p.schedule.timezone,JSON.stringify(p.ownerNames),JSON.stringify(p.fieldMap)]);
      if(p.auditEvent)await appendAuditInTransaction(c,p.auditEvent,String(rows[0].id));
      await c.query("COMMIT");
      return sourceConfig(rows[0]);
    }catch(error){await c.query("ROLLBACK");throw error;}finally{c.release();}
  }
}
export class PostgresSyncBatchRepository implements SyncBatchRepository{constructor(private readonly pool:Pool){}async create(p:{sourceConfigId:string;triggerType:SyncTrigger;actorId:string|null;idempotencyKey:string;startedAt:string}){const c=await this.pool.connect();try{await c.query("BEGIN");await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0)) IS NULL AS lock_acquired",[p.sourceConfigId]);const existing=await c.query("SELECT * FROM sync_batches WHERE source_config_id=$1 AND idempotency_key=$2",[p.sourceConfigId,p.idempotencyKey]);if(existing.rows[0]){await c.query("COMMIT");return batch(existing.rows[0]);}const active=await c.query("SELECT 1 FROM sync_batches WHERE source_config_id=$1 AND status='running' LIMIT 1",[p.sourceConfigId]);if(active.rowCount)throw new ActiveBatchConflict();const{rows}=await c.query("INSERT INTO sync_batches(id,source_config_id,trigger_type,actor_id,idempotency_key,started_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",[randomUUID(),p.sourceConfigId,p.triggerType,p.actorId,p.idempotencyKey,p.startedAt]);await c.query("COMMIT");return batch(rows[0]);}catch(error){await c.query("ROLLBACK");throw error;}finally{c.release();}}async get(id:string){const{rows}=await this.pool.query("SELECT * FROM sync_batches WHERE id=$1",[id]);return rows[0]?batch(rows[0]):null;}async findByIdempotencyKey(s:string,k:string){const{rows}=await this.pool.query("SELECT * FROM sync_batches WHERE source_config_id=$1 AND idempotency_key=$2",[s,k]);return rows[0]?batch(rows[0]):null;}async list(q:{status?:BatchState;since?:string;until?:string;limit:number;cursor?:{startedAt:string;id:string}}){const{rows}=await this.pool.query("SELECT * FROM sync_batches WHERE ($1::text IS NULL OR status=$1) AND ($2::timestamptz IS NULL OR started_at >= $2) AND ($3::timestamptz IS NULL OR started_at <= $3) AND ($4::timestamptz IS NULL OR (started_at,id)<($4::timestamptz,$5::uuid)) ORDER BY started_at DESC,id DESC LIMIT $6",[q.status??null,q.since??null,q.until??null,q.cursor?.startedAt??null,q.cursor?.id??null,q.limit+1]);const more=rows.length>q.limit,page=rows.slice(0,q.limit);return{items:page.map(batch),nextCursor:more?encodeBatchCursor({startedAt:asDate(page.at(-1)!.started_at)!,id:String(page.at(-1)!.id)}):null};}async complete(id:string,r:{status:BatchState;totalCount:number;succeededCount:number;failedCount:number;errorSummary:string|null;completedAt:string}){const{rows}=await this.pool.query("UPDATE sync_batches SET status=$2,total_count=$3,succeeded_count=$4,failed_count=$5,error_summary=$6,completed_at=$7 WHERE id=$1 RETURNING *",[id,r.status,r.totalCount,r.succeededCount,r.failedCount,r.errorSummary,r.completedAt]);return rows[0]?batch(rows[0]):null;}}
export class PostgresSyncItemRepository implements SyncItemRepository{constructor(private readonly pool:Pool){}async upsert(p:{batchId:string;requirementId:string|null;teambitionRequirementId:string;action:SyncItemAction;status:"succeeded"|"failed";errorCode?:string;errorDetail?:string;startedAt:string;completedAt:string}){const{rows}=await this.pool.query("INSERT INTO sync_items(id,batch_id,requirement_id,teambition_requirement_id,action,status,error_code,error_detail,started_at,completed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(batch_id,teambition_requirement_id) DO UPDATE SET requirement_id=excluded.requirement_id,action=excluded.action,status=excluded.status,error_code=excluded.error_code,error_detail=excluded.error_detail,started_at=excluded.started_at,completed_at=excluded.completed_at /* A retry records its most recent orchestrator-measured start. */ RETURNING *",[randomUUID(),p.batchId,p.requirementId,p.teambitionRequirementId,p.action,p.status,p.errorCode??null,p.errorDetail??null,p.startedAt,p.completedAt]);return item(rows[0]);}async get(id:string){const{rows}=await this.pool.query("SELECT * FROM sync_items WHERE id=$1",[id]);return rows[0]?item(rows[0]):null;}async listByBatch(id:string){const{rows}=await this.pool.query("SELECT * FROM sync_items WHERE batch_id=$1 ORDER BY started_at,id",[id]);return rows.map(item);}}
export class PostgresSourceSnapshotRepository implements SourceSnapshotRepository{constructor(private readonly pool:Pool){}async append(p:{requirementId:string;sourceVersion:number;sourceHash:string;substantiveHash:string;payload:Record<string,unknown>;isSubstantiveChange:boolean;capturedAt:string}){const{rows}=await this.pool.query("INSERT INTO source_snapshots(id,requirement_id,source_version,source_hash,substantive_hash,payload,is_substantive_change,captured_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(requirement_id,source_version) DO NOTHING RETURNING *",[randomUUID(),p.requirementId,p.sourceVersion,p.sourceHash,p.substantiveHash,p.payload,p.isSubstantiveChange,p.capturedAt]);if(rows[0])return snapshot(rows[0]);const q=await this.pool.query("SELECT * FROM source_snapshots WHERE requirement_id=$1 AND source_version=$2",[p.requirementId,p.sourceVersion]);return snapshot(q.rows[0]);}async latest(id:string){const{rows}=await this.pool.query("SELECT * FROM source_snapshots WHERE requirement_id=$1 ORDER BY source_version DESC LIMIT 1",[id]);return rows[0]?snapshot(rows[0]):null;}async getAtVersion(id:string,version:number){const{rows}=await this.pool.query("SELECT * FROM source_snapshots WHERE requirement_id=$1 AND source_version=$2",[id,version]);return rows[0]?snapshot(rows[0]):null;}}
export class PostgresRequirementRepository implements RequirementQueryRepository{constructor(private readonly pool:Pool){}async upsertRequirement(sourceConfigId:string,externalId:string,d:RequirementRowWrite){
  const c=await this.pool.connect();
  try{
    await c.query("BEGIN");
    const lookup="SELECT id,platform_requirement_id,source_version,source_hash,executor_user_id,executor_name FROM requirements WHERE source_config_id=$1 AND teambition_requirement_id=$2 FOR UPDATE";
    let q=await c.query(lookup,[sourceConfigId,externalId]);
    let old=q.rows[0];
    if(!old?.platform_requirement_id){
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0)) IS NULL AS lock_acquired",["rqsys:platform-requirement-id"]);
      q=await c.query(lookup,[sourceConfigId,externalId]);
      old=q.rows[0];
    }
    const created=!old,id=old?.id??randomUUID(),hash=d.sourceHash,version=created?1:Number(old.source_version)+(old.source_hash===hash?0:1);
    let platformRequirementId=old?.platform_requirement_id;
    if(!platformRequirementId){
      const next=await c.query("SELECT COALESCE(MAX(SUBSTRING(platform_requirement_id FROM 4)::bigint),0)+1 AS next_number FROM requirements WHERE platform_requirement_id ~ '^RQ-[0-9]+$'");
      platformRequirementId=`RQ-${String(next.rows[0].next_number).padStart(6,"0")}`;
    }
    const sourceChanged=created||old.source_hash!==hash;
    const values=[id,sourceConfigId,externalId,d.uniqueId,d.title,d.description,d.scope,d.acceptanceCriteria,d.proposerUserId,d.proposerName,d.executorUserId,d.executorName,d.statusId,d.createdAt,d.updatedAt,d.sourceUrl,JSON.stringify(d.attachmentRefs),JSON.stringify(d.customFields),JSON.stringify(d.payload),hash,d.substantiveHash,version,d.latestBatchId,platformRequirementId];
    const saved=await c.query("INSERT INTO requirements(id,source_config_id,teambition_requirement_id,teambition_unique_id,title,description,scope,acceptance_criteria,proposer_user_id,proposer_name,executor_user_id,executor_name,source_status_id,source_created_at,source_updated_at,source_url,attachment_refs,source_custom_fields,source_payload,source_hash,substantive_hash,source_version,latest_batch_id,platform_requirement_id,pull_state,analysis_state,owner_state,push_state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,'synced','pending','pending_mapping','pending') ON CONFLICT(source_config_id,teambition_requirement_id) DO UPDATE SET teambition_unique_id=excluded.teambition_unique_id,title=excluded.title,description=excluded.description,scope=excluded.scope,acceptance_criteria=excluded.acceptance_criteria,proposer_user_id=excluded.proposer_user_id,proposer_name=excluded.proposer_name,executor_user_id=excluded.executor_user_id,executor_name=excluded.executor_name,source_status_id=excluded.source_status_id,source_created_at=excluded.source_created_at,source_updated_at=excluded.source_updated_at,source_url=excluded.source_url,attachment_refs=excluded.attachment_refs,source_custom_fields=excluded.source_custom_fields,source_payload=excluded.source_payload,source_hash=excluded.source_hash,substantive_hash=excluded.substantive_hash,source_version=excluded.source_version,latest_batch_id=excluded.latest_batch_id,pull_state='synced',analysis_state=CASE WHEN requirements.substantive_hash IS DISTINCT FROM excluded.substantive_hash THEN 'pending' ELSE requirements.analysis_state END,owner_state=CASE WHEN requirements.executor_user_id IS DISTINCT FROM excluded.executor_user_id OR (requirements.executor_user_id IS NULL AND excluded.executor_user_id IS NULL AND requirements.executor_name IS DISTINCT FROM excluded.executor_name) THEN 'pending_mapping' ELSE requirements.owner_state END,push_state=CASE WHEN requirements.source_hash IS DISTINCT FROM excluded.source_hash THEN 'pending' ELSE requirements.push_state END,last_seen_at=now(),updated_at=now() RETURNING id",values);
    const savedId=String(saved.rows[0].id);
    if(sourceChanged&&d.snapshot){
      await c.query("INSERT INTO source_snapshots(id,requirement_id,source_version,source_hash,substantive_hash,payload,is_substantive_change,captured_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(requirement_id,source_version) DO NOTHING",[randomUUID(),savedId,version,hash,d.substantiveHash,JSON.stringify(d.snapshot.payload),d.snapshot.isSubstantiveChange,d.snapshot.capturedAt]);
    }
    await c.query("COMMIT");
    return{id:savedId,created,sourceVersion:version,sourceHash:hash,substantiveHash:d.substantiveHash};
  }catch(error){await c.query("ROLLBACK");throw error;}finally{c.release();}
}
// V02-T02/T04：手工收录（web_manual）。需求、首个来源快照、幂等回执与首分析作业在同一事务提交；
// 失败整体回滚，不留"已收录却永久无任务"的半条需求。编号与 TB 导入复用同一事务锁分配器。
// V02-T07：手工编辑（仅 web_manual）。一个事务内完成：回执幂等判定 → 行锁版本比对 →
// 实质/元数据分流（实质=标题/描述/产品/边界：新版本+快照+审计+分析任务+推送重置；
// 元数据=渠道/链接/类型：仅更新投影并入队非实质推送）；无变化不新建版本。
async updateManualRequirement(p:{requirementId:string;expectedSourceVersion:number;idempotencyKey:string;actorId:string;requestHash:string;title?:string;description?:string|null;sourceChannel?:string;productModel?:string|null;requirementType?:string|null;constraintNotes?:string|null;supplementUrl?:string|null;}){
  const c=await this.pool.connect();
  try{
    await c.query("BEGIN");
    const receipt=await c.query("SELECT request_hash,outcome,substantive_changed,source_version FROM requirement_edit_receipts WHERE idempotency_key=$1",[p.idempotencyKey]);
    if(receipt.rows[0]){
      const hit=receipt.rows[0];
      await c.query("COMMIT");
      if(String(hit.request_hash)!==p.requestHash) return{outcome:"key_conflict" as const};
      return{outcome:"replay" as const,sourceVersion:Number(hit.source_version),substantiveChanged:Boolean(hit.substantive_changed)};
    }
    const row=(await c.query("SELECT id,source_type,source_version,title,description,source_channel,product_model,requirement_type,constraint_notes,supplement_url,source_hash,substantive_hash FROM requirements WHERE id=$1 FOR UPDATE",[p.requirementId])).rows[0];
    if(!row){await c.query("COMMIT");return{outcome:"not_found" as const};}
    if(String(row.source_type)!=="web_manual"){await c.query("COMMIT");return{outcome:"not_manual" as const};}
    const currentVersion=Number(row.source_version);
    if(currentVersion!==p.expectedSourceVersion){await c.query("COMMIT");return{outcome:"version_conflict" as const,currentSourceVersion:currentVersion};}
    const nextTitle=p.title!==undefined?p.title.trim():String(row.title);
    const nextDescription=p.description!==undefined?p.description:String(row.description??null);
    const nextChannel=p.sourceChannel!==undefined?p.sourceChannel:String(row.source_channel);
    const nextProduct=p.productModel!==undefined?p.productModel:row.product_model===null?null:String(row.product_model);
    const nextType=p.requirementType!==undefined?p.requirementType:row.requirement_type===null?null:String(row.requirement_type);
    const nextNotes=p.constraintNotes!==undefined?p.constraintNotes:row.constraint_notes===null?null:String(row.constraint_notes);
    const nextUrl=p.supplementUrl!==undefined?p.supplementUrl:row.supplement_url===null?null:String(row.supplement_url);
    const payload={sourceType:"web_manual",title:nextTitle,description:nextDescription,sourceChannel:nextChannel,productModel:nextProduct,requirementType:nextType,constraintNotes:nextNotes,supplementUrl:nextUrl};
    const nextSubstantive=substantiveHash({title:nextTitle,description:nextDescription,scope:null,acceptanceCriteria:null,attachmentRefs:[]});
    const metadataChanged=(nextChannel!==String(row.source_channel))||(nextUrl!==(row.supplement_url===null?null:String(row.supplement_url)))||(nextType!==(row.requirement_type===null?null:String(row.requirement_type)));
    const definitionChanged=(nextSubstantive!==String(row.substantive_hash))||(nextProduct!==(row.product_model===null?null:String(row.product_model)))||(nextNotes!==(row.constraint_notes===null?null:String(row.constraint_notes)));
    if(!definitionChanged&&!metadataChanged){
      await c.query("INSERT INTO requirement_edit_receipts(idempotency_key,actor_id,request_hash,requirement_id,outcome,substantive_changed,source_version) VALUES($1,$2,$3,$4,'unchanged',false,$5)",[p.idempotencyKey,p.actorId,p.requestHash,p.requirementId,currentVersion]);
      await c.query("COMMIT");
      return{outcome:"unchanged" as const,sourceVersion:currentVersion,replay:false as const};
    }
    const hash=stableHash(payload);
    const latestAnalysis=(await c.query("SELECT COALESCE(MAX(analysis_version),0) AS v FROM analysis_runs WHERE requirement_id=$1",[p.requirementId])).rows[0];
    const analysisVersion=Number(latestAnalysis?.v??0);
    let newVersion=currentVersion;
    if(definitionChanged){
      newVersion=currentVersion+1;
      await c.query("UPDATE requirements SET title=$2,description=$3,source_channel=$4,product_model=$5,requirement_type=$6,constraint_notes=$7,supplement_url=$8,source_hash=$9,substantive_hash=$10,source_version=$11,analysis_state='pending',push_state='pending',updated_at=now() WHERE id=$1",[p.requirementId,nextTitle,nextDescription,nextChannel,nextProduct,nextType,nextNotes,nextUrl,hash,nextSubstantive,newVersion]);
      await c.query("INSERT INTO source_snapshots(id,requirement_id,source_version,source_hash,substantive_hash,payload,is_substantive_change,captured_at) VALUES($1,$2,$3,$4,$5,$6,true,now())",[randomUUID(),p.requirementId,newVersion,hash,nextSubstantive,JSON.stringify(payload)]);
      await c.query("INSERT INTO pipeline_jobs(id,job_type,dedupe_key,payload,available_at,max_attempts) VALUES($1,'analysis',$2,$3,now(),5) ON CONFLICT(dedupe_key) DO NOTHING",[randomUUID(),`analysis:${p.requirementId}:v${newVersion}`,JSON.stringify({requirementId:p.requirementId,sourceVersion:newVersion,actorId:p.actorId})]);
    }else{
      await c.query("UPDATE requirements SET source_channel=$2,requirement_type=$3,supplement_url=$4,source_hash=$5,updated_at=now() WHERE id=$1",[p.requirementId,nextChannel,nextType,nextUrl,hash]);
      await c.query("INSERT INTO pipeline_jobs(id,job_type,dedupe_key,payload,available_at,max_attempts) VALUES($1,'base_push',$2,$3,now(),5) ON CONFLICT(dedupe_key) DO NOTHING",[randomUUID(),`base-push:${p.requirementId}:sv${currentVersion}:av${analysisVersion}:meta:${randomUUID().slice(0,8)}`,JSON.stringify({requirementId:p.requirementId,actorId:p.actorId,sourceVersion:currentVersion,analysisVersion})]);
    }
    await c.query("INSERT INTO audit_events(id,actor_id,event_type,entity_type,entity_id,result,safe_details,occurred_at) VALUES($1,$2,'intake.updated','requirement',$3,'succeeded',$4,now())",[randomUUID(),p.actorId,p.requirementId,JSON.stringify({sourceVersion:newVersion,substantive:definitionChanged})]);
    await c.query("INSERT INTO requirement_edit_receipts(idempotency_key,actor_id,request_hash,requirement_id,outcome,substantive_changed,source_version) VALUES($1,$2,$3,$4,'updated',$5,$6)",[p.idempotencyKey,p.actorId,p.requestHash,p.requirementId,definitionChanged,newVersion]);
    await c.query("COMMIT");
    return{outcome:"updated" as const,sourceVersion:newVersion,substantiveChanged:definitionChanged,replay:false as const};
  }catch(error){await c.query("ROLLBACK");throw error;}finally{c.release();}
}
// V02-T09：人工人群标签保存。多选（含明确空集）→ confirmed=true、版本递增；不改优先级/PM 状态、
// 不触发 AI/推送/通知（调用方仅落库与审计）。期望版本不匹配返回冲突供前端恢复。
async setAudienceTags(requirementId:string,p:{tags:("L1"|"L2"|"L3"|"L4"|"L5"|"L6")[];expectedVersion:number;actorId:string;}):Promise<{outcome:"updated";version:number}|{outcome:"version_conflict";currentVersion:number}|{outcome:"not_found"}>{
  const c=await this.pool.connect();
  try{
    await c.query("BEGIN");
    const{rows}=await c.query("SELECT audience_version FROM requirements WHERE id=$1 FOR UPDATE",[requirementId]);
    if(!rows[0]){await c.query("COMMIT");return{outcome:"not_found" as const};}
    const current=Number(rows[0].audience_version);
    if(current!==p.expectedVersion){await c.query("COMMIT");return{outcome:"version_conflict" as const,currentVersion:current};}
    const next=current+1;
    await c.query("UPDATE requirements SET audience_tags=$2,audience_confirmed=true,audience_version=$3,updated_at=now() WHERE id=$1",[requirementId,JSON.stringify([...new Set(p.tags)]),next]);
    await c.query("INSERT INTO audit_events(id,actor_id,event_type,entity_type,entity_id,result,safe_details,occurred_at) VALUES($1,$2,'audience.updated','requirement',$3,'succeeded',$4,now())",[randomUUID(),p.actorId,requirementId,JSON.stringify({fromVersion:current,toVersion:next,tags:[...new Set(p.tags)]})]);
    await c.query("COMMIT");
    return{outcome:"updated" as const,version:next};
  }catch(error){await c.query("ROLLBACK");throw error;}finally{c.release();}
}
private riceDraft(r:any):import("../../domain/persistence.js").RiceDraftRecord{return{requirementId:String(r.requirement_id),reachInput:r.reach_input??null,impactInput:r.impact_input??null,confidenceInput:r.confidence_input??null,effortInput:r.effort_input??null,notes:r.notes??null,sourceVersion:Number(r.source_version),editVersion:Number(r.edit_version),updatedBy:r.updated_by??"",updatedAt:(r.updated_at instanceof Date?r.updated_at.toISOString():String(r.updated_at))};}
// V02-T11：RICE Beta 草稿。乐观并发（edit_version）+ 历史追加，单事务；与主流程零耦合。
async getRiceDraft(requirementId:string){const{rows}=await this.pool.query("SELECT * FROM rice_drafts WHERE requirement_id=$1",[requirementId]);return rows[0]?this.riceDraft(rows[0]):null;}
async saveRiceDraft(p:{requirementId:string;expectedEditVersion:number;actorId:string;sourceVersion:number;reachInput?:string|null;impactInput?:string|null;confidenceInput?:string|null;effortInput?:string|null;notes?:string|null;}){
  const c=await this.pool.connect();
  try{
    await c.query("BEGIN");
    const{rows}=await c.query("SELECT * FROM rice_drafts WHERE requirement_id=$1 FOR UPDATE",[p.requirementId]);
    const existing=rows[0];
    if(existing){
      const current=Number(existing.edit_version);
      if(current!==p.expectedEditVersion){await c.query("COMMIT");return{outcome:"version_conflict" as const,currentEditVersion:current};}
      const next=current+1;
      const merged={reachInput:p.reachInput!==undefined?p.reachInput:existing.reach_input,impactInput:p.impactInput!==undefined?p.impactInput:existing.impact_input,confidenceInput:p.confidenceInput!==undefined?p.confidenceInput:existing.confidence_input,effortInput:p.effortInput!==undefined?p.effortInput:existing.effort_input,notes:p.notes!==undefined?p.notes:existing.notes};
      await c.query("UPDATE rice_drafts SET reach_input=$2,impact_input=$3,confidence_input=$4,effort_input=$5,notes=$6,source_version=$7,edit_version=$8,updated_by=$9,updated_at=now() WHERE requirement_id=$1",[p.requirementId,merged.reachInput,merged.impactInput,merged.confidenceInput,merged.effortInput,merged.notes,p.sourceVersion,next,p.actorId]);
      await c.query("INSERT INTO rice_draft_history(id,requirement_id,edit_version,snapshot,actor_id) VALUES($1,$2,$3,$4,$5)",[randomUUID(),p.requirementId,next,JSON.stringify({...merged,sourceVersion:p.sourceVersion}),p.actorId]);
      await c.query("COMMIT");
      return{outcome:"saved" as const,editVersion:next};
    }
    if(p.expectedEditVersion!==0){await c.query("COMMIT");return{outcome:"version_conflict" as const,currentEditVersion:0};}
    const draft={reachInput:p.reachInput??null,impactInput:p.impactInput??null,confidenceInput:p.confidenceInput??null,effortInput:p.effortInput??null,notes:p.notes??null};
    await c.query("INSERT INTO rice_drafts(requirement_id,reach_input,impact_input,confidence_input,effort_input,notes,source_version,edit_version,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,1,$8)",[p.requirementId,draft.reachInput,draft.impactInput,draft.confidenceInput,draft.effortInput,draft.notes,p.sourceVersion,p.actorId]);
    await c.query("INSERT INTO rice_draft_history(id,requirement_id,edit_version,snapshot,actor_id) VALUES($1,$2,1,$3,$4)",[randomUUID(),p.requirementId,JSON.stringify({...draft,sourceVersion:p.sourceVersion}),p.actorId]);
    await c.query("COMMIT");
    return{outcome:"saved" as const,editVersion:1};
  }catch(error){await c.query("ROLLBACK");throw error;}finally{c.release();}
}
async findIntakeReceipt(key:string){const{rows}=await this.pool.query("SELECT requirement_id,request_hash,actor_id FROM requirement_intake_receipts WHERE idempotency_key=$1",[key]);return rows[0]?{requirementId:String(rows[0].requirement_id),requestHash:String(rows[0].request_hash),actorId:String(rows[0].actor_id)}:null;}
async createManualRequirement(p:{idempotencyKey:string;actorId:string;requestHash:string;title:string;description:string|null;sourceChannel:string;productModel?:string|null;requirementType?:string|null;constraintNotes?:string|null;supplementUrl?:string|null;intakeModule?:string|null;owner?:{feishuUserId:string;feishuIdType:"open_id"|"user_id"|"union_id";name?:string|null};}){
  const c=await this.pool.connect();
  try{
    await c.query("BEGIN");
    const existing=await c.query("SELECT requirement_id,request_hash FROM requirement_intake_receipts WHERE idempotency_key=$1",[p.idempotencyKey]);
    if(existing.rows[0]){const replayRow=await c.query("SELECT platform_requirement_id FROM requirements WHERE id=$1",[existing.rows[0].requirement_id]);await c.query("COMMIT");return{requirementId:String(existing.rows[0].requirement_id),platformRequirementId:String(replayRow.rows[0]?.platform_requirement_id??""),replay:true};}
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0)) IS NULL AS lock_acquired",["rqsys:platform-requirement-id"]);
    const next=await c.query("SELECT COALESCE(MAX(SUBSTRING(platform_requirement_id FROM 4)::bigint),0)+1 AS next_number FROM requirements WHERE platform_requirement_id ~ '^RQ-[0-9]+$'");
    const platformRequirementId=`RQ-${String(next.rows[0].next_number).padStart(6,"0")}`;
    const payload={sourceType:"web_manual",title:p.title,description:p.description,sourceChannel:p.sourceChannel,productModel:p.productModel??null,requirementType:p.requirementType??null,constraintNotes:p.constraintNotes??null,supplementUrl:p.supplementUrl??null,intakeModule:p.intakeModule??null};
    const hash=stableHash(payload);
    const sub=substantiveHash({title:p.title,description:p.description,scope:null,acceptanceCriteria:null,attachmentRefs:[]});
    const id=randomUUID();
    const ownerState=p.owner?"manually_mapped":"not_required";
    await c.query("INSERT INTO requirements(id,source_type,source_channel,source_config_id,teambition_requirement_id,title,description,product_model,requirement_type,constraint_notes,supplement_url,intake_module,source_hash,substantive_hash,source_version,platform_requirement_id,pull_state,analysis_state,owner_state,push_state,manual_owner_feishu_user_id,manual_owner_feishu_id_type,manual_owner_name,manual_owner_assigned_by,manual_owner_assigned_at,source_payload) VALUES($1,'web_manual',$2,NULL,NULL,$3,$4,$5,$6,$7,$8,$9,$10,$11,1,$12,'collected','pending',$13,'pending',$14,$15,$16,$17,$18,$19)",[id,p.sourceChannel,p.title,p.description,p.productModel??null,p.requirementType??null,p.constraintNotes??null,p.supplementUrl??null,p.intakeModule??null,hash,sub,platformRequirementId,ownerState,p.owner?.feishuUserId??null,p.owner?.feishuIdType??null,p.owner?.name??null,p.actorId,p.owner?new Date().toISOString():null,JSON.stringify(payload)]);
    await c.query("INSERT INTO source_snapshots(id,requirement_id,source_version,source_hash,substantive_hash,payload,is_substantive_change,captured_at) VALUES($1,$2,1,$3,$4,$5,true,now())",[randomUUID(),id,hash,sub,JSON.stringify(payload)]);
    await c.query("INSERT INTO requirement_intake_receipts(idempotency_key,actor_id,request_hash,requirement_id) VALUES($1,$2,$3,$4)",[p.idempotencyKey,p.actorId,p.requestHash,id]);
    await c.query("INSERT INTO pipeline_jobs(id,job_type,dedupe_key,payload,available_at,max_attempts) VALUES($1,'analysis',$2,$3,now(),5) ON CONFLICT(dedupe_key) DO NOTHING",[randomUUID(),`analysis:${id}:v1`,JSON.stringify({requirementId:id,sourceVersion:1,actorId:p.actorId})]);
    // 审计与需求同事务提交（V02-T04-AC04）：入库失败时整笔回滚，不留无审计的收录。
    await c.query("INSERT INTO audit_events(id,actor_id,event_type,entity_type,entity_id,result,safe_details,occurred_at) VALUES($1,$2,'intake.created','requirement',$3,'succeeded',$4,now())",[randomUUID(),p.actorId,id,JSON.stringify({sourceType:"web_manual",sourceChannel:p.sourceChannel})]);
    await c.query("COMMIT");
    return{requirementId:id,platformRequirementId,replay:false};
  }catch(error){await c.query("ROLLBACK");throw error;}finally{c.release();}
}
async get(id:string){const{rows}=await this.pool.query("SELECT * FROM requirements WHERE id=$1",[id]);return rows[0]?requirement(rows[0]):null;}
async findForSync(sourceConfigId:string,teambitionRequirementId:string){const{rows}=await this.pool.query("SELECT id,source_version,source_hash,substantive_hash,analysis_state FROM requirements WHERE source_config_id=$1 AND teambition_requirement_id=$2",[sourceConfigId,teambitionRequirementId]);return rows[0]?{id:String(rows[0].id),sourceVersion:Number(rows[0].source_version),sourceHash:String(rows[0].source_hash),substantiveHash:String(rows[0].substantive_hash),analysisState:String(rows[0].analysis_state) as AnalysisState}:null;}
async getPipelineCounts(){const{rows}=await this.pool.query("SELECT COUNT(*)::int AS total,COUNT(*) FILTER (WHERE pull_state='synced')::int AS pull_synced,COUNT(*) FILTER (WHERE analysis_state='analyzed')::int AS analysis_analyzed,COUNT(*) FILTER (WHERE owner_state IN ('auto_mapped','manually_mapped','not_required'))::int AS owner_resolved,COUNT(*) FILTER (WHERE push_state='pushed')::int AS push_pushed,COUNT(*) FILTER (WHERE pull_state='failed' OR analysis_state='failed_retryable' OR push_state='failed')::int AS failed,COUNT(*) FILTER (WHERE push_state='failed')::int AS push_failed,COUNT(*) FILTER (WHERE push_state='pending')::int AS push_pending FROM requirements WHERE (teambition_requirement_id IS NULL OR teambition_requirement_id NOT LIKE $1)",["rqsys-fixture-%"]);const row=rows[0]??{};return{total:Number(row.total??0),pullSynced:Number(row.pull_synced??0),analysisAnalyzed:Number(row.analysis_analyzed??0),ownerResolved:Number(row.owner_resolved??0),pushPushed:Number(row.push_pushed??0),failed:Number(row.failed??0),pushFailed:Number(row.push_failed??0),pushPending:Number(row.push_pending??0)};}
async search(q:{q?:string;executorName?:string;pullState?:PullState;analysisState?:AnalysisState;ownerState?:OwnerState;pushState?:PushState;batchId?:string;since?:string;until?:string;limit:number;cursor?:RequirementSearchCursor}){const values:unknown[]=[q.q??null,q.executorName??null,q.pullState??null,q.analysisState??null,q.ownerState??null,q.pushState??null,q.batchId??null,q.since??null,q.until??null,q.cursor?.createdAt??null,q.cursor?.id??null,q.limit+1];const{rows}=await this.pool.query("SELECT * FROM requirements WHERE ($1::text IS NULL OR title ILIKE '%'||$1||'%') AND ($2::text IS NULL OR lower(btrim(executor_name))=lower(btrim($2))) AND ($3::text IS NULL OR pull_state=$3) AND ($4::text IS NULL OR analysis_state=$4) AND ($5::text IS NULL OR owner_state=$5) AND ($6::text IS NULL OR push_state=$6) AND ($7::uuid IS NULL OR latest_batch_id=$7) AND ($8::timestamptz IS NULL OR last_seen_at >= $8) AND ($9::timestamptz IS NULL OR last_seen_at <= $9) AND ($10::timestamptz IS NULL OR (date_trunc('milliseconds', created_at),id)<(date_trunc('milliseconds',$10::timestamptz),$11::uuid)) ORDER BY date_trunc('milliseconds', created_at) DESC,id DESC LIMIT $12",values);const more=rows.length>q.limit,page=rows.slice(0,q.limit);return{items:page.map(requirement),nextCursor:more?encodeRequirementCursor({createdAt:asDate(page.at(-1)!.created_at)!,id:String(page.at(-1)!.id)}):null};}
async updateAnalysisState(requirementId:string,to:AnalysisState){const{rows}=await this.pool.query("SELECT analysis_state FROM requirements WHERE id=$1",[requirementId]);if(!rows[0])throw new Error(`Requirement not found: ${requirementId}`);assertTransition("analysis",String(rows[0].analysis_state) as AnalysisState,to);await this.pool.query("UPDATE requirements SET analysis_state=$2,updated_at=now() WHERE id=$1",[requirementId,to]);}
async setOwner(requirementId:string,feishuUserId:string|null,state:OwnerState){const{rows}=await this.pool.query("SELECT owner_state FROM requirements WHERE id=$1",[requirementId]);if(!rows[0])throw new Error(`Requirement not found: ${requirementId}`);assertTransition("owner",String(rows[0].owner_state) as OwnerState,state);await this.pool.query("UPDATE requirements SET owner_state=$2,updated_at=now() WHERE id=$1",[requirementId,state]);}
async assignManualOwner(requirementId:string,owner:Omit<RequirementManualOwner,"pushedFeishuUserId"|"assignmentVersion">){
  const c=await this.pool.connect();
  try{
    await c.query("BEGIN");
    const{rows}=await c.query("SELECT owner_state FROM requirements WHERE id=$1 FOR UPDATE",[requirementId]);
    if(!rows[0])throw new Error(`Requirement not found: ${requirementId}`);
    assertTransition("owner",String(rows[0].owner_state) as OwnerState,"manually_mapped");
    await c.query("UPDATE requirements SET owner_state='manually_mapped',manual_owner_feishu_user_id=$2,manual_owner_feishu_id_type=$3,manual_owner_name=$4,manual_owner_assigned_by=$5,manual_owner_assigned_at=$6,manual_owner_assignment_version=manual_owner_assignment_version+1,updated_at=now() WHERE id=$1",[requirementId,owner.feishuUserId,owner.feishuIdType,owner.name,owner.assignedBy,owner.assignedAt]);
    await c.query("COMMIT");
  }catch(error){await c.query("ROLLBACK");throw error;}finally{c.release();}
}
async markManualOwnerPushed(requirementId:string,feishuUserId:string){await this.pool.query("UPDATE requirements SET manual_owner_pushed_feishu_user_id=$2,updated_at=now() WHERE id=$1 AND manual_owner_feishu_user_id=$2",[requirementId,feishuUserId]);}
async clearManualOwner(requirementId:string){await this.pool.query("UPDATE requirements SET manual_owner_feishu_user_id=NULL,manual_owner_feishu_id_type=NULL,manual_owner_name=NULL,manual_owner_assigned_by=NULL,manual_owner_assigned_at=NULL,manual_owner_pushed_feishu_user_id=NULL,updated_at=now() WHERE id=$1",[requirementId]);}
async markLastPushedOwner(requirementId:string,owner:{feishuUserId:string;feishuIdType:"open_id"|"user_id"|"union_id"}|null){await this.pool.query("UPDATE requirements SET last_pushed_owner_feishu_user_id=$2,last_pushed_owner_feishu_id_type=$3,updated_at=now() WHERE id=$1",[requirementId,owner?.feishuUserId??null,owner?.feishuIdType??null]);}
async listDuplicates(requirementId:string){const{rows}=await this.pool.query("SELECT id,title,teambition_requirement_id FROM requirements WHERE duplicate_of_requirement_id=$1 ORDER BY source_created_at NULLS LAST,teambition_requirement_id",[requirementId]);return rows.map((r:any)=>({id:String(r.id),title:String(r.title),teambitionRequirementId:String(r.teambition_requirement_id)}));}
async listTitleCandidates(sourceConfigId:string){const{rows}=await this.pool.query("SELECT id,teambition_requirement_id,title,source_created_at,duplicate_of_requirement_id FROM requirements WHERE source_config_id=$1",[sourceConfigId]);return rows.map((r:any)=>({id:String(r.id),teambitionRequirementId:String(r.teambition_requirement_id),title:String(r.title),sourceCreatedAt:asDate(r.source_created_at),duplicateOfRequirementId:r.duplicate_of_requirement_id??null}));}
async setDuplicateOf(requirementId:string,canonicalRequirementId:string|null){await this.pool.query("UPDATE requirements SET duplicate_of_requirement_id=$2,updated_at=now() WHERE id=$1 AND duplicate_of_requirement_id IS DISTINCT FROM $2",[requirementId,canonicalRequirementId]);}
async setBaseRecord(requirementId:string,baseRecordId:string,pushedAt:string){await this.pool.query("UPDATE requirements SET base_record_id=$2,last_pushed_at=$3,updated_at=now() WHERE id=$1",[requirementId,baseRecordId,pushedAt]);}
async setPushState(requirementId:string,state:PushState){const{rows}=await this.pool.query("SELECT push_state FROM requirements WHERE id=$1",[requirementId]);if(!rows[0])throw new Error(`Requirement not found: ${requirementId}`);assertTransition("push",String(rows[0].push_state) as PushState,state);await this.pool.query("UPDATE requirements SET push_state=$2,updated_at=now() WHERE id=$1",[requirementId,state]);}
// 同一需求的推送串行化：advisory lock 必须与事务在同一连接上取得，随 COMMIT/ROLLBACK 自动释放。
// 事务保持打开期间，外层 fn 的普通查询仍由连接池执行；第二个调用会在取锁处等待第一个事务结束。
async withRequirementLock<T>(requirementId:string,fn:()=>Promise<T>):Promise<T>{
  const c=await this.pool.connect();
  try{
    await c.query("BEGIN");
    // pg_advisory_xact_lock 返回 void 列；妙搭的池包装层会对结果做 JSON 解析，
    // 遇到无值的 void 列会抛 "Unexpected end of JSON input"，导致取锁失败、推送直接报错。
    // 显式转成 text 让列有确定值（空串），既保持阻塞语义也不会被解析器噎住。
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))::text AS locked",[requirementId]);
    const result=await fn();
    await c.query("COMMIT");
    return result;
  }catch(error){
    try{await c.query("ROLLBACK");}catch{/* 连接已失效时由 release 兜底，不掩盖原始错误 */}
    throw error;
  }finally{c.release();}
}}
export { PostgresAnalysisRunRepository };
import { PostgresAnalysisRunRepository } from "./analysis-run-repository.js";

/** 人工映射冲突：目标飞书账号已绑定到另一位人员。HTTP 层据此返回 409，不伪装成依赖故障。 */
export class PersonMappingConflict extends Error {
  constructor(message = "The Feishu account is already mapped to another person.") { super(message); this.name = "PersonMappingConflict"; }
}
export class PostgresPersonMappingRepository implements PersonMappingRepository {
  constructor(private readonly pool: Pool) {}
  async upsertManual(p: { sourceConfigId: string; teambitionUserId: string | null; teambitionDisplayName: string | null; feishuUserId: string; feishuIdType: "open_id" | "user_id" | "union_id"; createdBy: string | null; now: string }) {
    const normalized = p.teambitionDisplayName?.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase() ?? null;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query("SELECT * FROM person_mappings WHERE source_config_id=$1 AND active AND match_method='manual' AND teambition_user_id IS NOT DISTINCT FROM $2 AND feishu_user_id=$3 AND feishu_id_type=$4 LIMIT 1 FOR UPDATE", [p.sourceConfigId, p.teambitionUserId, p.feishuUserId, p.feishuIdType]);
      if (existing.rows[0]) { await client.query("COMMIT"); return mapping(existing.rows[0]); }
      // 人员页绑定与需求详情的人工映射共用 person_mappings：同一飞书账号不能同时指向两位人员，
      // 否则按姓名自动匹配会出现两个人抢一个账号。冲突交给 HTTP 层返回 409。
      if (p.teambitionUserId === null) {
        const taken = await client.query("SELECT teambition_display_name FROM person_mappings WHERE source_config_id=$1 AND active AND feishu_user_id=$2 AND feishu_id_type=$3 AND normalized_name IS DISTINCT FROM $4 LIMIT 1 FOR UPDATE", [p.sourceConfigId, p.feishuUserId, p.feishuIdType, normalized]);
        if (taken.rows[0]) throw new PersonMappingConflict(`该飞书账号已绑定到「${String(taken.rows[0].teambition_display_name ?? "其他人员")}」，请先解除那边的人员绑定。`);
      }
      // 人员维度（无 TB user ID）按规范化姓名去重，且不限制 match_method：
      // 人员页绑定是 unique_name、需求详情人工映射是 manual，两者同时活跃会让按姓名解析变成歧义。
      await client.query("UPDATE person_mappings SET active=false,updated_at=$2 WHERE source_config_id=$1 AND active AND teambition_user_id IS NOT DISTINCT FROM $3 AND ($3::text IS NOT NULL OR normalized_name IS NOT DISTINCT FROM $4)", [p.sourceConfigId, p.now, p.teambitionUserId, normalized]);
      const { rows } = await client.query("INSERT INTO person_mappings(id,source_config_id,teambition_user_id,teambition_display_name,normalized_name,feishu_user_id,feishu_id_type,match_method,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,'manual',$8,$9,$9) RETURNING *", [randomUUID(), p.sourceConfigId, p.teambitionUserId, p.teambitionDisplayName, normalized, p.feishuUserId, p.feishuIdType, p.createdBy, p.now]);
      await client.query("COMMIT");
      return mapping(rows[0]);
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  async resolveActive(s: string, b: { tbUserId?: string; normalizedName?: string }) {
    // 同名多条不同身份是歧义；同名同身份（人员页绑定 + 需求详情映射指向同一账号）不算歧义。
    const sql = b.tbUserId
      ? "SELECT * FROM person_mappings WHERE source_config_id=$1 AND active AND teambition_user_id=$2 ORDER BY updated_at DESC,id"
      : "SELECT * FROM person_mappings WHERE source_config_id=$1 AND active AND normalized_name=$2 ORDER BY updated_at DESC,id";
    const { rows } = await this.pool.query(sql, [s, b.tbUserId ?? b.normalizedName]);
    if (rows.length === 0) return null;
    return new Set(rows.map((row) => `${row.feishu_user_id}|${row.feishu_id_type}`)).size === 1 ? mapping(rows[0]) : null;
  }
  async listActive(sourceConfigId: string) {
    const { rows } = await this.pool.query("SELECT * FROM person_mappings WHERE source_config_id=$1 AND active ORDER BY updated_at DESC,id", [sourceConfigId]);
    return rows.map(mapping);
  }
}
export class PostgresPmSnapshotRepository implements PmSnapshotRepository{constructor(private readonly pool:Pool){}async append(p:{requirementId:string;sourceVersion:number;baseRecordId:string;pmValues:Record<string,unknown>;capturedAt:string}){const{rows}=await this.pool.query("INSERT INTO pm_snapshots(id,requirement_id,source_version,base_record_id,pm_values,captured_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",[randomUUID(),p.requirementId,p.sourceVersion,p.baseRecordId,p.pmValues,p.capturedAt]);return pmSnapshot(rows[0]);}async latest(id:string){const{rows}=await this.pool.query("SELECT * FROM pm_snapshots WHERE requirement_id=$1 ORDER BY source_version DESC,captured_at DESC LIMIT 1",[id]);return rows[0]?pmSnapshot(rows[0]):null;}}
export class PostgresBasePushRunRepository implements BasePushRunRepository{constructor(private readonly pool:Pool){}async append(p:{requirementId:string;sourceVersion:number;pushVersion:number;idempotencyKey:string;startedAt:string}){const{rows}=await this.pool.query("INSERT INTO base_push_runs(id,requirement_id,source_version,push_version,status,idempotency_key,started_at) VALUES($1,$2,$3,$4,'running',$5,$6) ON CONFLICT(idempotency_key) DO NOTHING RETURNING *",[randomUUID(),p.requirementId,p.sourceVersion,p.pushVersion,p.idempotencyKey,p.startedAt]);if(rows[0])return basePush(rows[0]);const q=await this.pool.query("SELECT * FROM base_push_runs WHERE idempotency_key=$1",[p.idempotencyKey]);return basePush(q.rows[0]);}async findByIdempotencyKey(key:string){const{rows}=await this.pool.query("SELECT * FROM base_push_runs WHERE idempotency_key=$1",[key]);return rows[0]?basePush(rows[0]):null;}async latest(requirementId:string){const{rows}=await this.pool.query("SELECT * FROM base_push_runs WHERE requirement_id=$1 ORDER BY started_at DESC,id DESC LIMIT 1",[requirementId]);return rows[0]?basePush(rows[0]):null;}async latestSuccessful(requirementId:string){const{rows}=await this.pool.query("SELECT * FROM base_push_runs WHERE requirement_id=$1 AND status='pushed' ORDER BY source_version DESC,push_version DESC LIMIT 1",[requirementId]);return rows[0]?basePush(rows[0]):null;}async restart(id:string,startedAt:string){const{rows}=await this.pool.query("UPDATE base_push_runs SET status='running',started_at=$2,completed_at=NULL,safe_error_code=NULL,safe_error_summary=NULL WHERE id=$1 AND status IN ('failed','running') RETURNING *",[id,startedAt]);return rows[0]?basePush(rows[0]):null;}async updateResult(id:string,r:{status:"pushed"|"failed";baseRecordId?:string;safeErrorCode?:string;safeErrorSummary?:string;completedAt:string}){const{rows}=await this.pool.query("UPDATE base_push_runs SET status=$2,base_record_id=$3,safe_error_code=$4,safe_error_summary=$5,completed_at=$6 WHERE id=$1 RETURNING *",[id,r.status,r.baseRecordId??null,r.safeErrorCode??null,r.safeErrorSummary??null,r.completedAt]);return rows[0]?basePush(rows[0]):null;}}
export class PostgresPipelineJobRepository implements PipelineJobRepository{constructor(private readonly pool:Pool){}async enqueue(p:{jobType:PipelineJobType;dedupeKey:string;payload:Record<string,unknown>;availableAt:string;maxAttempts?:number}){
  const inserted=await this.pool.query("INSERT INTO pipeline_jobs(id,job_type,dedupe_key,payload,available_at,max_attempts) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(dedupe_key) DO UPDATE SET payload=excluded.payload,available_at=excluded.available_at,status='queued',attempt_count=0,locked_until=NULL,last_error_code=NULL,last_error_summary=NULL,updated_at=now() WHERE pipeline_jobs.status IN ('failed','cancelled') RETURNING *",[randomUUID(),p.jobType,p.dedupeKey,p.payload,p.availableAt,p.maxAttempts??5]);
  if(inserted.rows[0])return job(inserted.rows[0]);
  const existing=await this.pool.query("SELECT * FROM pipeline_jobs WHERE dedupe_key=$1",[p.dedupeKey]);
  if(!existing.rows[0])throw new Error("Pipeline job enqueue did not return or find a persisted job");
  return job(existing.rows[0]);
}async findByDedupeKey(key:string){const{rows}=await this.pool.query("SELECT * FROM pipeline_jobs WHERE dedupe_key=$1",[key]);return rows[0]?job(rows[0]):null;}async renewLease(id:string,p:{expectedAttempt:number;leaseMs:number;now:string}){const{rowCount}=await this.pool.query("UPDATE pipeline_jobs SET locked_until=$3::timestamptz + ($4::text||' milliseconds')::interval, updated_at=$3 WHERE id=$1 AND status='running' AND attempt_count=$2",[id,p.expectedAttempt,p.now,p.leaseMs]);return (rowCount??0)>0;}async claimNext(_worker:string,lease:number,now:string){const c=await this.pool.connect();try{await c.query("BEGIN");const{rows}=await c.query("SELECT id FROM pipeline_jobs WHERE ((status='queued' AND available_at <= $1) OR (status='running' AND locked_until <= $1)) AND attempt_count<max_attempts ORDER BY available_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1",[now]);if(!rows[0]){await c.query("COMMIT");return null;}const claimed=await c.query("UPDATE pipeline_jobs SET status='running',attempt_count=attempt_count+1,locked_until=$2::timestamptz + ($3::text||' milliseconds')::interval,updated_at=$2 WHERE id=$1 RETURNING *",[rows[0].id,now,lease]);await c.query("COMMIT");return job(claimed.rows[0]);}catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}}async reschedule(id:string,r:{expectedAttempt:number;backoffMs:number;errorCode?:string;errorSummary?:string;now:string}){const{rows}=await this.pool.query("UPDATE pipeline_jobs SET status='queued',available_at=$2::timestamptz + ($3::text||' milliseconds')::interval,locked_until=NULL,last_error_code=$4,last_error_summary=$5,updated_at=$2 WHERE id=$1 AND status='running' AND attempt_count=$6 RETURNING *",[id,r.now,String(r.backoffMs),r.errorCode??null,r.errorSummary??null,r.expectedAttempt]);return rows[0]?job(rows[0]):null;}async complete(id:string,r:{expectedAttempt:number;status:"succeeded"|"failed"|"cancelled";errorCode?:string;errorSummary?:string;now:string;settleSyncBatch?:boolean}){const{rows}=await this.pool.query(r.settleSyncBatch?"WITH completed AS (UPDATE pipeline_jobs SET status=$2,last_error_code=$3,last_error_summary=$4,locked_until=NULL,updated_at=$5 WHERE id=$1 AND status='running' AND attempt_count=$6 RETURNING *), settled AS (UPDATE sync_batches b SET status='failed',error_summary=$4,completed_at=$5 FROM completed WHERE completed.job_type='sync' AND completed.status='failed' AND b.id::text=(completed.payload->>'batchId') AND b.status='running' RETURNING b.id) SELECT * FROM completed":"UPDATE pipeline_jobs SET status=$2,last_error_code=$3,last_error_summary=$4,locked_until=NULL,updated_at=$5 WHERE id=$1 AND status='running' AND attempt_count=$6 RETURNING *",[id,r.status,r.errorCode??null,r.errorSummary??null,r.now,r.expectedAttempt]);return rows[0]?job(rows[0]):null;}}
export class PostgresAuditEventRepository implements AuditEventRepository{constructor(private readonly pool:Pool){}async append(e:AuditEventRecord){await this.pool.query("INSERT INTO audit_events(id,actor_id,event_type,entity_type,entity_id,result,safe_details,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[e.id,e.actorId,e.eventType,e.entityType,e.entityId,e.result,redactSafeDetails(e.safeDetails),e.occurredAt]);}async search(q:{entityId?:string;since?:string;until?:string;limit:number}){const{rows}=await this.pool.query("SELECT * FROM audit_events WHERE ($1::text IS NULL OR entity_id=$1) AND ($2::timestamptz IS NULL OR occurred_at >= $2) AND ($3::timestamptz IS NULL OR occurred_at <= $3) ORDER BY occurred_at DESC,id DESC LIMIT $4",[q.entityId??null,q.since??null,q.until??null,q.limit]);return rows.map(audit);}}
export class PostgresModuleDictionaryRepository implements ModuleDictionaryRepository{
  constructor(private readonly pool:Pool){}
  async list(){const{rows}=await this.pool.query("SELECT * FROM module_dictionary_versions ORDER BY version DESC");return rows.map(dictionary);}
  async get(v:number){const{rows}=await this.pool.query("SELECT * FROM module_dictionary_versions WHERE version=$1",[v]);return rows[0]?dictionary(rows[0]):null;}
  async create(p:{entries:unknown[];createdBy:string;now:string;auditEvent?:AuditEventInput}){
    const c=await this.pool.connect();
    try{
      await c.query("BEGIN");await c.query("SELECT pg_advisory_xact_lock(hashtextextended('module_dictionary_versions',0)) IS NULL AS lock_acquired");
      const{rows}=await c.query("INSERT INTO module_dictionary_versions(version,status,entries,created_by,created_at) SELECT COALESCE(MAX(version),0)+1,'draft',$1,$2,$3 FROM module_dictionary_versions RETURNING *",[JSON.stringify(p.entries),p.createdBy,p.now]);
      if(p.auditEvent)await appendAuditInTransaction(c,p.auditEvent,String(rows[0]!.version));
      await c.query("COMMIT");return dictionary(rows[0]!);
    }catch(error){await c.query("ROLLBACK");throw error;}finally{c.release();}
  }
  async publish(v:number,publishedAt:string,auditEvent?:AuditEventInput){
    const c=await this.pool.connect();
    try{
      await c.query("BEGIN");await c.query("SELECT pg_advisory_xact_lock(hashtextextended('module_dictionary_versions',0)) IS NULL AS lock_acquired");
      await c.query("UPDATE module_dictionary_versions SET status='retired' WHERE status='published' AND version<>$1",[v]);
      const{rows}=await c.query("UPDATE module_dictionary_versions SET status='published',published_at=$2 WHERE version=$1 AND status='draft' RETURNING *",[v,publishedAt]);
      if(!rows[0])throw new Error("Dictionary publish requires an existing draft version");
      if(auditEvent)await appendAuditInTransaction(c,auditEvent,String(v));
      await c.query("COMMIT");return dictionary(rows[0]);
    }catch(error){await c.query("ROLLBACK");throw error;}finally{c.release();}
  }
}
function moduleDirectoryEntries(value: unknown): FunctionModuleEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): FunctionModuleEntry[] => {
    if (typeof entry === "string" && entry.trim()) return [{ name: entry.trim(), personName: null }];
    if (typeof entry !== "object" || entry === null || typeof (entry as { name?: unknown }).name !== "string") return [];
    const row = entry as { name: string; personName?: unknown };
    return row.name.trim() ? [{ name: row.name.trim(), personName: typeof row.personName === "string" && row.personName.trim() ? row.personName.trim() : null }] : [];
  });
}
function directoryNames(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean) : [];
}
function duplicateName(names: string[], candidate: string): boolean {
  return names.some((name) => name.toLocaleLowerCase() === candidate.toLocaleLowerCase());
}
// 人员页绑定读取的映射列：只需要“姓名 → 飞书身份”的关系，不读取任何联系方式。
// 归并规则在 domain/team-directory.ts（两仓共享），这里只负责取列。
const TEAM_MAPPING_COLUMNS = "normalized_name,feishu_user_id,feishu_id_type,updated_at";
export class TeamDirectoryConflict extends Error {
  constructor(message = "The team directory changed; refresh and retry.") { super(message); this.name = "TeamDirectoryConflict"; }
}
export class PostgresTeamDirectoryRepository implements TeamDirectoryRepository {
  constructor(private readonly pool: Pool) {}
  async listPeople(): Promise<TeamPersonRecord[]> {
    const { rows } = await this.pool.query("SELECT id,owner_names,EXISTS(SELECT 1 FROM module_dictionary_versions WHERE status='published') AS has_dictionary FROM source_configs ORDER BY created_at,id LIMIT 1");
    if (!rows[0]) return [];
    return this.peopleWithBindings(this.pool, String(rows[0].id), this.effectiveRoster(rows[0]!));
  }
  async addPerson(name: string, event: AuditEventInput) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const source = await this.lockSource(client);
      if (duplicateName(source.people, name)) throw new TeamDirectoryConflict("该人员已存在。");
      const updated = [...source.people, name];
      await client.query("UPDATE source_configs SET owner_names=$2::jsonb,updated_at=now() WHERE id=$1", [source.id, JSON.stringify(updated)]);
      await appendAuditInTransaction(client, event, name);
      const people = await this.peopleWithBindings(client, source.id, updated);
      await client.query("COMMIT");
      return people;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  async renamePerson(from: string, to: string, event: AuditEventInput) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('module_dictionary_versions',0)) IS NULL AS lock_acquired");
      const source = await this.lockSource(client);
      if (!source.people.includes(from)) throw new TeamDirectoryConflict("人员不存在或已被修改。");
      if (from !== to && duplicateName(source.people.filter((name) => name !== from), to)) throw new TeamDirectoryConflict("该人员已存在。");
      const updatedPeople = source.people.map((name) => name === from ? to : name);
      const modules = await this.lockedModules(client);
      const updatedModules = modules.map((module) => module.personName === from ? { ...module, personName: to } : module);
      await client.query("UPDATE source_configs SET owner_names=$2::jsonb,updated_at=now() WHERE id=$1", [source.id, JSON.stringify(updatedPeople)]);
      // 绑定按规范化姓名关联：改名必须同步迁移，否则人员页显示“未绑定”、旧姓名仍占着映射。
      if (from !== to) await this.migrateBindingsOnRename(client, source.id, from, to, event.occurredAt);
      if (JSON.stringify(modules) !== JSON.stringify(updatedModules)) await this.publishModules(client, updatedModules, event.actorId ?? "system", event.occurredAt, { ...event, id: randomUUID(), eventType: "module_dictionary.updated", entityType: "module_dictionary", safeDetails: { entryCount: updatedModules.length } });
      await appendAuditInTransaction(client, event, from);
      const people = await this.peopleWithBindings(client, source.id, updatedPeople);
      await client.query("COMMIT");
      return people;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  async deletePerson(name: string, event: AuditEventInput) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('module_dictionary_versions',0)) IS NULL AS lock_acquired");
      const source = await this.lockSource(client);
      if (!source.people.includes(name)) throw new TeamDirectoryConflict("人员不存在或已被删除。");
      const updatedPeople = source.people.filter((person) => person !== name);
      const modules = await this.lockedModules(client);
      const updatedModules = modules.map((module) => module.personName === name ? { ...module, personName: null } : module);
      await client.query("UPDATE source_configs SET owner_names=$2::jsonb,updated_at=now() WHERE id=$1", [source.id, JSON.stringify(updatedPeople)]);
      // 删除人员同时解除其飞书绑定，避免已离开的人继续被自动匹配到新需求。
      await client.query("UPDATE person_mappings SET active=false,updated_at=$3 WHERE source_config_id=$1 AND active AND normalized_name=$2", [source.id, normalizeOwnerName(name), event.occurredAt]);
      if (JSON.stringify(modules) !== JSON.stringify(updatedModules)) await this.publishModules(client, updatedModules, event.actorId ?? "system", event.occurredAt, { ...event, id: randomUUID(), eventType: "module_dictionary.updated", entityType: "module_dictionary", safeDetails: { entryCount: updatedModules.length } });
      await appendAuditInTransaction(client, event, name);
      const people = await this.peopleWithBindings(client, source.id, updatedPeople);
      await client.query("COMMIT");
      return people;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  async bindPersonFeishu(name: string, binding: TeamPersonBindingInput, event: AuditEventInput) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const source = await this.lockSource(client);
      if (!source.people.includes(name)) throw new TeamDirectoryConflict("人员不存在或已被修改。");
      const normalized = normalizeOwnerName(name);
      const existing = await client.query("SELECT teambition_user_id,feishu_user_id,feishu_id_type FROM person_mappings WHERE source_config_id=$1 AND active AND normalized_name=$2 FOR UPDATE", [source.id, normalized]);
      const rows = existing.rows as Array<{ teambition_user_id: string | null; feishu_user_id: string; feishu_id_type: string }>;
      // 同一个姓名若已指向多个不同飞书账号，先人工核对，不用“绑定”动作替人拍板。
      if (new Set(rows.map((row) => `${row.feishu_user_id}|${row.feishu_id_type}`)).size > 1) throw new TeamDirectoryConflict("该姓名存在多条指向不同飞书账号的映射，请先在「负责人映射」中核对后再绑定。");
      const alreadyBound = rows.length > 0 && rows.every((row) => row.feishu_user_id === binding.feishuUserId && row.feishu_id_type === binding.feishuIdType);
      if (!alreadyBound) {
        // 同一飞书账号只能对应一位人员。先看这个账号现有的活跃映射：
        // - 已属于另一位有姓名的人员：必须人工先解绑，绑定时不替人改归属。
        // - 只有 TB user ID、没有姓名（历史需求级映射没取到执行人姓名）：这种行不属于“另一个人”，
        //   绑定时补全姓名并复用，避免管理员卡在“已绑定到「其他人员」”。
        const owned = await client.query("SELECT id,normalized_name,teambition_display_name FROM person_mappings WHERE source_config_id=$1 AND active AND feishu_user_id=$2 AND feishu_id_type=$3 FOR UPDATE", [source.id, binding.feishuUserId, binding.feishuIdType]);
        const ownerRows = owned.rows as Array<{ id: string; normalized_name: string | null; teambition_display_name: string | null }>;
        const differentPerson = ownerRows.find((row) => row.normalized_name !== null && row.normalized_name !== normalized);
        if (differentPerson) throw new TeamDirectoryConflict(`该飞书账号已绑定到「${String(differentPerson.teambition_display_name ?? "其他人员")}」，请先解除那边的人员绑定。`);
        const canAdopt = (row: { normalized_name: string | null; teambition_display_name: string | null }) => row.normalized_name === null && (row.teambition_display_name === null || normalizeOwnerName(row.teambition_display_name) === normalized);
        const unnamedOther = ownerRows.find((row) => row.normalized_name === null && !canAdopt(row));
        if (unnamedOther) throw new TeamDirectoryConflict(`该飞书账号已绑定到「${String(unnamedOther.teambition_display_name ?? "其他人员")}」，请先解除那边的人员绑定。`);
        const adoptable = ownerRows.filter(canAdopt);
        if (rows.length > 0) {
          // 同一姓名已有映射（例如需求详情里的人工映射）：原地改绑，避免新增同姓名映射把自动匹配变成歧义。
          await client.query("UPDATE person_mappings SET feishu_user_id=$3,feishu_id_type=$4,updated_at=$5 WHERE source_config_id=$1 AND active AND normalized_name=$2", [source.id, normalized, binding.feishuUserId, binding.feishuIdType, event.occurredAt]);
        } else if (adoptable.length === 0) {
          // 人员页绑定按“姓名唯一匹配”生效，不是逐条需求的人工分配：首推保持静默，owner 状态落 auto_mapped。
          await client.query("INSERT INTO person_mappings(id,source_config_id,teambition_user_id,teambition_display_name,normalized_name,feishu_user_id,feishu_id_type,match_method,created_by,created_at,updated_at) VALUES($1,$2,NULL,$3,$4,$5,$6,'unique_name',$7,$8,$8)", [randomUUID(), source.id, name, normalized, binding.feishuUserId, binding.feishuIdType, event.actorId, event.occurredAt]);
        }
        for (const row of adoptable) {
          // 复用原行（保留 TB user ID 和 match_method），只补姓名；不新增同账号映射。
          await client.query("UPDATE person_mappings SET teambition_display_name=$2,normalized_name=$3,updated_at=$4 WHERE id=$1 AND active", [row.id, name, normalized, event.occurredAt]);
        }
        await appendAuditInTransaction(client, event, name);
      }
      const people = await this.peopleWithBindings(client, source.id, source.people);
      await client.query("COMMIT");
      return people;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  async unbindPersonFeishu(name: string, event: AuditEventInput) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const source = await this.lockSource(client);
      if (!source.people.includes(name)) throw new TeamDirectoryConflict("人员不存在或已被删除。");
      const result = await client.query("UPDATE person_mappings SET active=false,updated_at=$3 WHERE source_config_id=$1 AND active AND normalized_name=$2 RETURNING id", [source.id, normalizeOwnerName(name), event.occurredAt]);
      if (result.rows.length > 0) await appendAuditInTransaction(client, event, name);
      const people = await this.peopleWithBindings(client, source.id, source.people);
      await client.query("COMMIT");
      return people;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  async listModules() {
    const { rows } = await this.pool.query("SELECT version,entries FROM module_dictionary_versions WHERE status='published' ORDER BY version DESC LIMIT 1");
    return rows[0] ? { version: Number(rows[0].version), items: moduleDirectoryEntries(rows[0].entries) } : { version: 0, items: [...DEFAULT_FUNCTION_MODULES] };
  }
  async saveModules(expectedVersion: number, items: FunctionModuleEntry[], createdBy: string, now: string, event: AuditEventInput) {
    // Defence in depth for the HTTP boundary (see TeamModulesSaveSchema): publishing
    // an empty dictionary would retire the active taxonomy in favour of nothing,
    // which is strictly worse than having no published version at all.
    if (items.length === 0) throw new TeamDirectoryConflict("模块列表不能为空。");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('module_dictionary_versions',0)) IS NULL AS lock_acquired");
      const source = await client.query("SELECT id,owner_names FROM source_configs ORDER BY created_at,id LIMIT 1 FOR UPDATE");
      if (!source.rows[0]) throw new TeamDirectoryConflict("请先配置 Teambition 数据源。");
      const dictionary = await client.query("SELECT version FROM module_dictionary_versions WHERE status='published' ORDER BY version DESC LIMIT 1 FOR UPDATE");
      const currentVersion = dictionary.rows[0] ? Number(dictionary.rows[0].version) : 0;
      if (currentVersion !== expectedVersion) throw new TeamDirectoryConflict();
      const people = await this.effectivePeople(client, source.rows[0].owner_names);
      if (items.some((item) => item.personName !== null && !people.includes(item.personName))) throw new TeamDirectoryConflict("模块负责人必须来自人员字典。");
      // Before the first published dictionary, an empty owner_names value means
      // the built-in roster is active. Persist that roster with the first save
      // so publishing the dictionary does not make the people list disappear.
      if (currentVersion === 0 && directoryNames(source.rows[0].owner_names).length === 0) {
        await client.query("UPDATE source_configs SET owner_names=$2::jsonb,updated_at=now() WHERE id=$1", [source.rows[0].id, JSON.stringify(people)]);
      }
      const updated = await this.publishModules(client, items, createdBy, now, event);
      await client.query("COMMIT");
      return { version: updated.version, items };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  private async publishModules(client: PoolClient, items: FunctionModuleEntry[], createdBy: string, now: string, event: AuditEventInput) {
    await client.query("UPDATE module_dictionary_versions SET status='retired' WHERE status='published'");
    const { rows } = await client.query("INSERT INTO module_dictionary_versions(version,status,entries,created_by,created_at,published_at) SELECT COALESCE(MAX(version),0)+1,'published',$1,$2,$3,$3 FROM module_dictionary_versions RETURNING version", [JSON.stringify(items), createdBy, now]);
    await appendAuditInTransaction(client, event, String(rows[0]!.version));
    return { version: Number(rows[0]!.version) };
  }
  private effectiveRoster(row: { owner_names?: unknown; has_dictionary?: unknown }) {
    const names = directoryNames(row.owner_names);
    return names.length || row.has_dictionary ? names : [...DEFAULT_TEAM_MEMBERS];
  }
  private async lockSource(client: PoolClient) {
    const { rows } = await client.query("SELECT id,owner_names FROM source_configs ORDER BY created_at,id LIMIT 1 FOR UPDATE");
    if (!rows[0]) throw new TeamDirectoryConflict("请先配置 Teambition 数据源。");
    return { id: String(rows[0].id), people: await this.effectivePeople(client, rows[0].owner_names) };
  }
  private async lockedModules(client: PoolClient) {
    const dictionary = await client.query("SELECT version,entries FROM module_dictionary_versions WHERE status='published' ORDER BY version DESC LIMIT 1 FOR UPDATE");
    return moduleDirectoryEntries(dictionary.rows[0]?.entries ?? DEFAULT_FUNCTION_MODULES);
  }
  /**
   * 改名时迁移该姓名的活跃映射。目标姓名已有同一飞书身份时合并（停用目标行），
   * 已有不同身份时拒绝：同一姓名出现多条不同账号会让自动匹配退化为“待匹配”。
   */
  private async migrateBindingsOnRename(client: PoolClient, sourceConfigId: string, from: string, to: string, occurredAt: string) {
    const fromNormalized = normalizeOwnerName(from);
    const toNormalized = normalizeOwnerName(to);
    if (fromNormalized === toNormalized) {
      await client.query("UPDATE person_mappings SET teambition_display_name=$3,updated_at=$4 WHERE source_config_id=$1 AND active AND normalized_name=$2", [sourceConfigId, fromNormalized, to, occurredAt]);
      return;
    }
    const { rows: renameRows } = await client.query("SELECT normalized_name,feishu_user_id,feishu_id_type FROM person_mappings WHERE source_config_id=$1 AND active AND normalized_name IN ($2,$3) FOR UPDATE", [sourceConfigId, fromNormalized, toNormalized]);
    const rows = renameRows as Array<{ normalized_name: string | null; feishu_user_id: string; feishu_id_type: string }>;
    const moved = rows.filter((row) => row.normalized_name === fromNormalized);
    const occupied = rows.filter((row) => row.normalized_name === toNormalized);
    const identity = (row: { feishu_user_id: string; feishu_id_type: string }) => `${row.feishu_user_id}|${row.feishu_id_type}`;
    const movedIdentities = new Set(moved.map(identity));
    if (occupied.some((row) => !movedIdentities.has(identity(row)))) throw new TeamDirectoryConflict("目标姓名已有指向其他飞书账号的映射，请先在「负责人映射」中核对后再改名。");
    if (occupied.length > 0) await client.query("UPDATE person_mappings SET active=false,updated_at=$3 WHERE source_config_id=$1 AND active AND normalized_name=$2", [sourceConfigId, toNormalized, occurredAt]);
    await client.query("UPDATE person_mappings SET teambition_display_name=$3,normalized_name=$4,updated_at=$5 WHERE source_config_id=$1 AND active AND normalized_name=$2", [sourceConfigId, fromNormalized, to, toNormalized, occurredAt]);
  }
  private async peopleWithBindings(client: Pool | PoolClient, sourceConfigId: string, people: string[]): Promise<TeamPersonRecord[]> {
    const { rows } = await client.query(`SELECT ${TEAM_MAPPING_COLUMNS} FROM person_mappings WHERE source_config_id=$1 AND active AND normalized_name IS NOT NULL`, [sourceConfigId]);
    return mergeTeamBindings(people, rows as TeamMappingRow[]);
  }
  private async effectivePeople(client: PoolClient, ownerNames: unknown) {
    const names = directoryNames(ownerNames);
    if (names.length) return names;
    const { rows } = await client.query("SELECT EXISTS(SELECT 1 FROM module_dictionary_versions WHERE status='published') AS has_dictionary");
    return rows[0]?.has_dictionary ? [] : [...DEFAULT_TEAM_MEMBERS];
  }
}
export class PostgresPriorityRuleRepository implements PriorityRuleRepository{
  constructor(private readonly pool:Pool){}
  async get(id:string){const{rows}=await this.pool.query("SELECT * FROM priority_rule_versions WHERE id=$1",[id]);return rows[0]?priorityRule(rows[0]):null;}
  async getPublished(){const{rows}=await this.pool.query("SELECT * FROM priority_rule_versions WHERE status='published' ORDER BY version DESC LIMIT 1");return rows[0]?priorityRule(rows[0]):null;}
  async list(){const{rows}=await this.pool.query("SELECT * FROM priority_rule_versions ORDER BY version DESC");return rows.map(priorityRule);}
  async create(p:{rules:Record<string,unknown>;validationEvidence:unknown[];createdBy:string;now:string;auditEvent?:AuditEventInput}){
    const c=await this.pool.connect(),id=randomUUID();
    try{
      await c.query("BEGIN");await c.query("SELECT pg_advisory_xact_lock(hashtextextended('priority_rule_versions',0)) IS NULL AS lock_acquired");
      const{rows}=await c.query("INSERT INTO priority_rule_versions(id,version,status,rules,validation_evidence,created_by,created_at) SELECT $1,COALESCE(MAX(version),0)+1,'draft',$2,$3,$4,$5 FROM priority_rule_versions RETURNING *",[id,JSON.stringify(p.rules),JSON.stringify(p.validationEvidence),p.createdBy,p.now]);
      if(p.auditEvent)await appendAuditInTransaction(c,p.auditEvent,id);
      await c.query("COMMIT");return priorityRule(rows[0]!);
    }catch(error){await c.query("ROLLBACK");throw error;}finally{c.release();}
  }
  async publish(id:string,publishedAt:string,auditEvent?:AuditEventInput){
    const c=await this.pool.connect();
    try{
      await c.query("BEGIN");await c.query("SELECT pg_advisory_xact_lock(hashtextextended('priority_rule_versions',0)) IS NULL AS lock_acquired");
      await c.query("UPDATE priority_rule_versions SET status='retired' WHERE status='published' AND id<>$1",[id]);
      const{rows}=await c.query("UPDATE priority_rule_versions SET status='published',published_at=$2 WHERE id=$1 AND status='draft' RETURNING *",[id,publishedAt]);
      if(!rows[0])throw new Error("Priority rule publish requires an existing draft version");
      if(auditEvent)await appendAuditInTransaction(c,auditEvent,id);
      await c.query("COMMIT");return priorityRule(rows[0]);
    }catch(error){await c.query("ROLLBACK");throw error;}finally{c.release();}
  }
}
export class PostgresRepositories{readonly sources:PostgresSourceConfigRepository;readonly batches:PostgresSyncBatchRepository;readonly items:PostgresSyncItemRepository;readonly audit:PostgresAuditEventRepository;readonly jobs:PostgresPipelineJobRepository;readonly sourceSnapshots:PostgresSourceSnapshotRepository;readonly requirements:PostgresRequirementRepository;readonly analyses:PostgresAnalysisRunRepository;readonly people:PostgresPersonMappingRepository;readonly pmSnapshots:PostgresPmSnapshotRepository;readonly basePushes:PostgresBasePushRunRepository;readonly dictionaries:PostgresModuleDictionaryRepository;readonly directory:PostgresTeamDirectoryRepository;readonly priorityRules:PostgresPriorityRuleRepository;constructor(pool:Pool){this.sources=new PostgresSourceConfigRepository(pool);this.batches=new PostgresSyncBatchRepository(pool);this.items=new PostgresSyncItemRepository(pool);this.audit=new PostgresAuditEventRepository(pool);this.jobs=new PostgresPipelineJobRepository(pool);this.sourceSnapshots=new PostgresSourceSnapshotRepository(pool);this.requirements=new PostgresRequirementRepository(pool);this.analyses=new PostgresAnalysisRunRepository(pool);this.people=new PostgresPersonMappingRepository(pool);this.pmSnapshots=new PostgresPmSnapshotRepository(pool);this.basePushes=new PostgresBasePushRunRepository(pool);this.dictionaries=new PostgresModuleDictionaryRepository(pool);this.directory=new PostgresTeamDirectoryRepository(pool);this.priorityRules=new PostgresPriorityRuleRepository(pool);}}
