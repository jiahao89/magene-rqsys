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
  // 总览 AI 区：合并为单条 CTE 查询（全量/今日/最近一次），减少 3× 全表扫描；
  // 不使用 FILTER 或数组参数，兼容妙搭 Drizzle 传输层。
  async aiCallStats(since:string,pool?:SourcePool){
    // 0031：总览固定产品池，AI 调用统计也按池作用域，集团池的分析调用不进入总览。
    const target=pool??"product";
    const{rows}=await this.pool.query(
      `WITH scoped AS (
        SELECT r.started_at,r.status,r.id FROM analysis_runs r
        WHERE r.requirement_id IN (
          SELECT req.id FROM requirements req LEFT JOIN source_configs sc ON sc.id=req.source_config_id
          WHERE ($2::text='product' AND (req.source_config_id IS NULL OR sc.pool='product')) OR ($2::text='group' AND sc.pool='group')
        )
      ), agg AS (
        SELECT count(*)::int AS total,COALESCE(SUM(CASE WHEN started_at>=$1::timestamptz THEN 1 ELSE 0 END),0)::int AS today FROM scoped
      ), latest AS (
        SELECT status,started_at FROM scoped ORDER BY started_at DESC,id DESC LIMIT 1
      )
      SELECT agg.total,agg.today,latest.status AS last_status,latest.started_at AS last_at FROM agg LEFT JOIN latest ON true`,
      [since,target],
    );
    const row=rows[0];
    return{total:Number(row?.total??0),today:Number(row?.today??0),lastAt:row?.last_at?new Date(row.last_at).toISOString():null,lastStatus:row?.last_status===null||row?.last_status===undefined?null:String(row.last_status)};
  }
  async listByRequirement(id:string){
    // 详情页只展示最新版本的 structured_result，历史版本仅需摘要元数据；
    // 仅对最大 analysis_version 返回 structured_result，避免拉取历史大 JSONB。
    const{rows}=await this.pool.query(
      "SELECT id,requirement_id,source_version,analysis_version,status,module_suggestion,confidence,confidence_reason,priority,CASE WHEN analysis_version=MAX(analysis_version) OVER () THEN structured_result ELSE NULL END AS structured_result,provider,model,prompt_version,module_dictionary_version,priority_rule_version_id,safe_error_code,safe_error_summary,started_at,completed_at FROM analysis_runs WHERE requirement_id=$1 ORDER BY analysis_version",
      [id],
    );
    return rows.map(from);
  }
  // 2026-11-24：旧 running 行被更高版本的成功分析取代后永远不会收尾（线上集团池 4 条）。
  // 只改 analysis_runs，不动 requirements 状态、不推 Base；interrupted 与历史崩溃残留口径一致。
  async closeSupersededRunning(at:string,requirementId?:string){
    const{rowCount}=await this.pool.query("UPDATE analysis_runs a SET status='failed_retryable',safe_error_code='interrupted',safe_error_summary='Superseded by a later successful analysis version.',completed_at=$1 WHERE a.status='running' AND ($2::uuid IS NULL OR a.requirement_id=$2::uuid) AND EXISTS (SELECT 1 FROM analysis_runs b WHERE b.requirement_id=a.requirement_id AND b.status='analyzed' AND b.analysis_version>a.analysis_version)",[at,requirementId??null]);
    return rowCount??0;
  }
}
