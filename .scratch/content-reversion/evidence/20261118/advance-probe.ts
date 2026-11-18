import { createAnalysisAdvancer } from "/Volumes/Files/A_Projects/RQ-Sys/apps/api/src/pipeline/advance.ts";

const base: any = {
  id: "req-1", platformRequirementId: "RQ-000001", sourceType: "teambition", sourceChannel: null,
  sourceConfigId: "src-1", teambitionRequirementId: "tb-1", title: "A", description: null,
  proposerName: null, executorUserId: null, executorName: null, sourceHash: "h", substantiveHash: "sub-a",
  sourceVersion: 3, baseRecordId: "rec-1", lastPushedAt: "2026-11-18T00:00:00.000Z",
  pipeline: { pull: "synced", analysis: "pending", owner: "not_required", push: "pending" },
  manualOwner: null,
};
function fixture(req: any) {
  const jobs: any[] = [];
  return {
    jobs,
    deps: {
      requirements: { get: async () => req, setOwner: async () => {} },
      people: { resolveActive: async () => null },
      jobs: { enqueue: async (j: any) => { jobs.push(j); } },
      audit: { append: async () => {} },
      now: () => new Date("2026-11-18T01:00:00.000Z"),
    } as any,
  };
}
async function main() {
  const cases: [string, any, string][] = [
    ["R1 push=running, A 分析成功", { ...base, pipeline: { ...base.pipeline, push: "running" } }, "analyzed"],
    ["R2 push=running, A 分析失败", { ...base, pipeline: { ...base.pipeline, push: "running" } }, "failed_retryable"],
    ["R3 push=pushed(B), A 分析失败", { ...base, pipeline: { ...base.pipeline, push: "pushed" } }, "failed_retryable"],
    ["对照 push=pending, A 分析失败", { ...base, pipeline: { ...base.pipeline, push: "pending" } }, "failed_retryable"],
    ["对照 push=pending, A 分析成功", { ...base, pipeline: { ...base.pipeline, push: "pending" } }, "analyzed"],
  ];
  for (const [label, req, status] of cases) {
    const f = fixture(req);
    const outcome = await createAnalysisAdvancer(f.deps)(base.id, status as any, "worker", 3);
    console.log(label, "→", outcome, "jobs:", f.jobs.map((j) => j.dedupeKey));
  }
}
void main();
