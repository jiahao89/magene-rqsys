// 作业"延后"信号：handler 判定当前不能推进、但条件补齐后应当再执行（例如负责人待映射）。
// worker 把它记为 cancelled 终态而不是 succeeded：cancelled 可被同 dedupe key 的入队重置回 queued
// （enqueue 的 ON CONFLICT ... WHERE status IN ('failed','cancelled')），succeeded 则不会。
// 共用模块：root 与妙搭两仓逐字一致。

export class JobDeferredError extends Error {
  constructor(readonly reason: string) {
    super(`Job deferred: ${reason}`);
    this.name = "JobDeferredError";
  }
}
