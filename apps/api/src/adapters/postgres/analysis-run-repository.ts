import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import type { AnalysisRunRecord, PriorityLevel } from "../../domain/persistence.js";
import type { AnalysisRunRepository } from "../../application/repositories.js";

const asDate=(v:Date|string|null):string|null=>v===null?null:new Date(v).toISOString();
const from=(r:any):AnalysisRunRecord=>({id:r.id,requirementId:r.requirement_id,sourceVersion:r.source_version,analysisVersion:r.analysis_version,status:r.status,moduleSuggestion:r.module_suggestion,confidence:r.confidence,confidenceReason:r.confidence_reason,priority:r.priority,structuredResult:r.structured_result,provider:r.provider,model:r.model,promptVersion:r.prompt_version,moduleDictionaryVersion:r.module_dictionary_version,priorityRuleVersionId:r.priority_rule_version_id,safeErrorCode:r.safe_error_code,safeErrorSummary:r.safe_error_summary,startedAt:asDate(r.started_at)!,completedAt:asDate(r.completed_at)});

export class PostgresAnalysisRunRepository implements AnalysisRunRepository{
  constructor(private readonly pool:Pool){}
  // analysisVersion 由调用方按"需求最新版本+1"递增（DDL UNIQUE (requirement_id, analysis_version)），
  // 不按 source_version 分桶计算，避免源升版后版本号回绕冲突
  async append(p:{requirementId:string;sourceVersion:number;analysisVersion:number;startedAt:string}){
    const{rows}=await this.pool.query("INSERT INTO analysis_runs(id,requirement_id,source_version,analysis_version,status,started_at) VALUES($1,$2,$3,$4,'running',$5) RETURNING *",[randomUUID(),p.requirementId,p.sourceVersion,p.analysisVersion,p.startedAt]);
    return from(rows[0]);
  }
  async complete(id:string,r:{status:"analyzed"|"failed_retryable";moduleSuggestion?:string;confidence?:"high"|"medium"|"low";confidenceReason?:string;priority?:PriorityLevel;structuredResult?:Record<string,unknown>;provider?:string;model?:string;promptVersion?:string;moduleDictionaryVersion?:number;priorityRuleVersionId?:string;safeErrorCode?:string;safeErrorSummary?:string;completedAt:string}){
    const{rows}=await this.pool.query("UPDATE analysis_runs SET status=$2,module_suggestion=$3,confidence=$4,confidence_reason=$5,priority=$6,structured_result=$7,provider=$8,model=$9,prompt_version=$10,module_dictionary_version=$11,priority_rule_version_id=$12,safe_error_code=$13,safe_error_summary=$14,completed_at=$15 WHERE id=$1 AND EXISTS(SELECT 1 FROM requirements r WHERE r.id=analysis_runs.requirement_id AND r.source_version=analysis_runs.source_version) RETURNING *",[id,r.status,r.moduleSuggestion??null,r.confidence??null,r.confidenceReason??null,r.priority??null,r.structuredResult??null,r.provider??null,r.model??null,r.promptVersion??null,r.moduleDictionaryVersion??null,r.priorityRuleVersionId??null,r.safeErrorCode??null,r.safeErrorSummary??null,r.completedAt]);
    return rows[0]?from(rows[0]):null;
  }
  async latest(id:string){
    const{rows}=await this.pool.query("SELECT * FROM analysis_runs WHERE requirement_id=$1 ORDER BY analysis_version DESC LIMIT 1",[id]);
    return rows[0]?from(rows[0]):null;
  }
  async listByRequirement(id:string){
    const{rows}=await this.pool.query("SELECT * FROM analysis_runs WHERE requirement_id=$1 ORDER BY analysis_version",[id]);
    return rows.map(from);
  }
}
