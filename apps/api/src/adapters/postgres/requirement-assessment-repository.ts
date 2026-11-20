import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import type { RequirementAssessmentRecord } from "../../domain/persistence.js";
import type { RequirementAssessmentRepository } from "../../application/repositories.js";

const asDate = (v: Date | string | null): string | null => (v === null ? null : new Date(v).toISOString());
const from = (r: any): RequirementAssessmentRecord => ({
  id: String(r.id),
  requirementId: String(r.requirement_id),
  version: Number(r.version),
  status: r.status,
  promptVersion: String(r.prompt_version),
  model: r.model ?? null,
  inputs: (r.inputs ?? {}) as Record<string, unknown>,
  output: (r.output ?? null) as Record<string, unknown> | null,
  errorCode: r.error_code ?? null,
  createdBy: String(r.created_by),
  createdAt: asDate(r.created_at)!,
  completedAt: asDate(r.completed_at),
});

export class PostgresRequirementAssessmentRepository implements RequirementAssessmentRepository {
  constructor(private readonly pool: Pool) {}

  // 同一需求的版本号在事务级 advisory lock 下递增，并在同一锁内做单飞判断：
  // 先把超过 staleAfterMs 的 running 标成 failed/timeout，再检查是否还有 running；
  // 有则返回 in_progress（不新建版本、调用方不调模型），否则插入新版本。
  async create(p: {
    requirementId: string;
    promptVersion: string;
    model: string | null;
    inputs: Record<string, unknown>;
    createdBy: string;
    at: string;
    staleAfterMs: number;
  }) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended('rqsys:requirement-assessment:'||$1,0))", [p.requirementId]);
      const staleBefore = new Date(Date.parse(p.at) - p.staleAfterMs).toISOString();
      await c.query(
        "UPDATE requirement_assessments SET status='failed', error_code='timeout', completed_at=$3 WHERE requirement_id=$1 AND status='running' AND created_at <= $2",
        [p.requirementId, staleBefore, p.at],
      );
      const running = await c.query(
        "SELECT * FROM requirement_assessments WHERE requirement_id=$1 AND status='running' ORDER BY version DESC LIMIT 1",
        [p.requirementId],
      );
      if (running.rows[0]) {
        // 提交（而不是回滚）以保留上面可能发生的 stale 版本过期标记。
        await c.query("COMMIT");
        return { outcome: "in_progress" as const, record: from(running.rows[0]) };
      }
      const next = await c.query("SELECT COALESCE(MAX(version),0)+1 AS next FROM requirement_assessments WHERE requirement_id=$1", [p.requirementId]);
      const { rows } = await c.query(
        "INSERT INTO requirement_assessments(id,requirement_id,version,status,prompt_version,model,inputs,created_by,created_at) VALUES($1,$2,$3,'running',$4,$5,$6,$7,$8) RETURNING *",
        [randomUUID(), p.requirementId, Number(next.rows[0]?.next ?? 1), p.promptVersion, p.model, JSON.stringify(p.inputs), p.createdBy, p.at],
      );
      await c.query("COMMIT");
      return { outcome: "created" as const, record: from(rows[0]) };
    } catch (error) {
      await c.query("ROLLBACK");
      throw error;
    } finally {
      c.release();
    }
  }

  // 只更新仍在 running 的版本：调用期间已被判超时的版本，迟到结果不写回成功。
  async complete(id: string, output: Record<string, unknown>, at: string) {
    const { rows } = await this.pool.query(
      "UPDATE requirement_assessments SET status='succeeded', output=$2, error_code=NULL, completed_at=$3 WHERE id=$1 AND status='running' RETURNING *",
      [id, JSON.stringify(output), at],
    );
    return rows[0] ? from(rows[0]) : null;
  }

  async fail(id: string, errorCode: string, at: string) {
    const { rows } = await this.pool.query(
      "UPDATE requirement_assessments SET status='failed', error_code=$2, completed_at=$3 WHERE id=$1 AND status='running' RETURNING *",
      [id, errorCode, at],
    );
    return rows[0] ? from(rows[0]) : null;
  }

  async list(requirementId: string) {
    const { rows } = await this.pool.query("SELECT * FROM requirement_assessments WHERE requirement_id=$1 ORDER BY version DESC", [requirementId]);
    return rows.map(from);
  }

  // GET 兜底：running 超过 2 分钟不允许永久停在「生成中」。
  async expireStaleRunning(requirementId: string, before: string, at: string) {
    const { rowCount } = await this.pool.query(
      "UPDATE requirement_assessments SET status='failed', error_code='timeout', completed_at=$3 WHERE requirement_id=$1 AND status='running' AND created_at < $2",
      [requirementId, before, at],
    );
    return rowCount ?? 0;
  }
}
