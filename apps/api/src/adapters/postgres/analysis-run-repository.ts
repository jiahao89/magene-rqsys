import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import type { AnalysisRunRecord, PriorityLevel, SourcePool } from "../../domain/persistence.js";
import type { AnalysisRunRepository } from "../../application/repositories.js";

const asDate=(v:Date|string|null):string|null=>v===null?null:new Date(v).toISOString();
const from=(r:any):AnalysisRunRecord=>({id:r.id,requirementId:r.requirement_id,sourceVersion:r.source_version,analysisVersion:r.analysis_version,status:r.status,moduleSuggestion:r.module_suggestion,confidence:r.confidence,confidenceReason:r.confidence_reason,priority:r.priority,structuredResult:r.structured_result,provider:r.provider,model:r.model,promptVersion:r.prompt_version,moduleDictionaryVersion:r.module_dictionary_version,priorityRuleVersionId:r.priority_rule_version_id,safeErrorCode:r.safe_error_code,safeErrorSummary:r.safe_error_summary,startedAt:asDate(r.started_at)!,completedAt:asDate(r.completed_at)});

export class PostgresAnalysisRunRepository implements AnalysisRunRepository{
  constructor(private readonly pool:Pool){}
  // analysisVersion 由调用方按"需求最新版本+1"递增（DDL UNIQUE (requirement_id, analysis_version)），
  // 不按 source_version 分桶计算，避免源升版后版本号回绕冲突
  async append(p:{requirementId:string;sourceVersion:number;analysisVersion:number;startedAt:string;provider?:string;model?:string;promptVersion?:string;moduleDictionaryVersion?:number;priorityRuleVersionId?:string|null}){
    const{rows}=await this.pool.query("INSERT INTO analysis_runs(id,requirement_id,source_version,analysis_version,status,started_at,provider,model,prompt_version,module_dictionary_version,priority_rule_version_id) VALUES($1,$2,$3,$4,'running',$5,$6,$7,$8,$9,$10) RETURNING *",[randomUUID(),p.requirementId,p.sourceVersion,p.analysisVersion,p.startedAt,p.provider??null,p.model??null,p.promptVersion??null,p.moduleDictionaryVersion??null,p.priorityRuleVersionId??null]);
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
  async countRecentFailures(code:string,since:string){const{rows}=await this.pool.query("SELECT count(*)::int AS count FROM analysis_runs WHERE status='failed_retryable' AND safe_error_code=$1 AND started_at>=$2::timestamptz",[code,since]);return Number(rows[0]?.count??0);}
  // 总览 AI 区：拆成三条最简查询（全量/今日/最近一次）。不用 FILTER、标量子查询或数组参数——
  // 妙搭的 Drizzle 传输层会把数组参数按 chunk 展开（ANY(($2,$3)::text[]) 报 42809，2026-11-18 线上事故）。
  // analysis_runs 没有 started_at 索引（加索引要迁移，暂不做），当前量级下 count(*) 是全表扫描，可接受。
  async aiCallStats(since:string,pool?:SourcePool){
    // 0031：总览固定产品池，AI 调用统计也按池作用域，集团池的分析调用不进入总览。
    const scoped=(param:number)=>`r.requirement_id IN (SELECT req.id FROM requirements req LEFT JOIN source_configs sc ON sc.id=req.source_config_id WHERE ($${param}::text='product' AND (req.source_config_id IS NULL OR sc.pool='product')) OR ($${param}::text='group' AND sc.pool='group'))`;
    const target=pool??"product";
    const[total,today,last]=await Promise.all([
      this.pool.query(`SELECT count(*)::int AS total FROM analysis_runs r WHERE ${scoped(1)}`,[target]),
      this.pool.query(`SELECT count(*)::int AS today FROM analysis_runs r WHERE r.started_at>=$1::timestamptz AND ${scoped(2)}`,[since,target]),
      this.pool.query(`SELECT r.status,r.started_at FROM analysis_runs r WHERE ${scoped(1)} ORDER BY r.started_at DESC,r.id DESC LIMIT 1`,[target]),
    ]);
    const lastRow=last.rows[0];
    return{total:Number(total.rows[0]?.total??0),today:Number(today.rows[0]?.today??0),lastAt:lastRow?.started_at?new Date(lastRow.started_at).toISOString():null,lastStatus:lastRow?.status===null||lastRow?.status===undefined?null:String(lastRow.status)};
  }
  async listByRequirement(id:string){
    const{rows}=await this.pool.query("SELECT * FROM analysis_runs WHERE requirement_id=$1 ORDER BY analysis_version",[id]);
    return rows.map(from);
  }
}
