import { describe, expect, it } from "vitest";
import {
  formatDateTime,
  requirementDisplayId,
  requirementExecutorName,
  requirementOwnerView,
  requirementProposerName,
  requirementSourceFacts,
  requirementSourceName,
  requirementTime,
  sortRequirementsForAttention,
  type RequirementLike,
} from "./requirement-view";

function makeReq(overrides: Partial<RequirementLike> = {}): RequirementLike {
  return {
    id: "req-1",
    title: "测试需求",
    pipeline: { pull: "synced", analysis: "analyzed", owner: "auto_mapped", push: "pushed" },
    ...overrides,
  };
}

describe("requirement-view", () => {
  it("formats display ID with platformRequirementId > REQ-sourceId > WEB precedence", () => {
    expect(requirementDisplayId({ platformRequirementId: "RQ-000042", sourceRequirementId: "tb-1" })).toBe("RQ-000042");
    expect(requirementDisplayId({ platformRequirementId: null, sourceRequirementId: "tb-1" })).toBe("REQ-tb-1");
    expect(requirementDisplayId({ platformRequirementId: undefined, sourceRequirementId: null })).toBe("WEB");
  });

  it("extracts executor and proposer names from direct fields, mappedFields, and nested custom_fields JSON", () => {
    expect(requirementExecutorName(makeReq({ source: { executorName: "张三" } }))).toBe("张三");
    expect(requirementExecutorName(makeReq({ source: { mappedFields: { executorName: "李四" } } }))).toBe("李四");
    expect(requirementExecutorName(makeReq({
      source: {
        executor_id: "u-99",
        custom_fields: JSON.stringify([{ value: [{ meta: { userId: "u-99" }, title: "王五" }] }]),
      },
    }))).toBe("王五");
    expect(requirementProposerName({
      source: {
        sourcePayload: {
          creator_id: "c-1",
          custom_fields: [{ userid: "c-1", name: "赵六" }],
        },
      },
    })).toBe("赵六");
  });

  it("renders owner view accurately across all owner states without misattributing manually mapped owners", () => {
    expect(requirementOwnerView(makeReq({ pipeline: { pull: "synced", analysis: "analyzed", owner: "pending_mapping", push: "pending" } }))).toMatchObject({
      label: "待分配", unassigned: true, notRequired: false,
    });
    expect(requirementOwnerView(makeReq({ pipeline: { pull: "synced", analysis: "analyzed", owner: "not_required", push: "pushed" } }))).toMatchObject({
      label: "无需负责人", unassigned: false, notRequired: true,
    });
    expect(requirementOwnerView(makeReq({ source: { executorName: "执行人A" } }))).toMatchObject({
      label: "执行人A", name: "执行人A",
    });
    // manually_mapped without explicit ownerName must NOT fall back to TB executorName
    expect(requirementOwnerView(makeReq({
      pipeline: { pull: "synced", analysis: "analyzed", owner: "manually_mapped", push: "pushed" },
      source: { executorName: "执行人A" },
    }))).toMatchObject({ label: "已手动指定", name: null });
    expect(requirementOwnerView(makeReq({
      pipeline: { pull: "synced", analysis: "analyzed", owner: "manually_mapped", push: "pushed" },
      ownerName: "负责人B",
      source: { executorName: "执行人A" },
    }))).toMatchObject({ label: "负责人B", name: "负责人B" });
  });

  it("resolves updated time before falling back to created time and handles invalid dates", () => {
    expect(requirementTime(makeReq({ updatedAt: "2026-11-20T08:00:00Z", source: { created: "2026-11-01T08:00:00Z" } }))).toEqual({
      value: "2026-11-20T08:00:00Z", fallbackToCreated: false,
    });
    expect(requirementTime(makeReq({ source: { created: "2026-11-01T08:00:00Z" } }))).toEqual({
      value: "2026-11-01T08:00:00Z", fallbackToCreated: true,
    });
    expect(requirementTime(makeReq())).toEqual({ value: null, fallbackToCreated: false });
    expect(formatDateTime(null)).toBeNull();
    expect(formatDateTime("not-a-date")).toBeNull();
    expect(formatDateTime("2026-11-20T08:00:00Z")).toBeTruthy();
  });

  it("sorts requirements by attention priority (pending_mapping > push failed > push pending > pushed) and recency", () => {
    const pushedOld = makeReq({ id: "1", title: "已推送旧", updatedAt: "2026-11-01T00:00:00Z", pipeline: { pull: "synced", analysis: "analyzed", owner: "auto_mapped", push: "pushed" } });
    const pushedNew = makeReq({ id: "2", title: "已推送新", updatedAt: "2026-11-10T00:00:00Z", pipeline: { pull: "synced", analysis: "analyzed", owner: "auto_mapped", push: "pushed" } });
    const pushPending = makeReq({ id: "3", title: "待推送", updatedAt: "2026-11-02T00:00:00Z", pipeline: { pull: "synced", analysis: "analyzed", owner: "auto_mapped", push: "pending" } });
    const pushFailed = makeReq({ id: "4", title: "推送失败", updatedAt: "2026-11-03T00:00:00Z", pipeline: { pull: "synced", analysis: "analyzed", owner: "auto_mapped", push: "failed" } });
    const pendingOwner = makeReq({ id: "5", title: "待分配", updatedAt: "2026-11-01T00:00:00Z", pipeline: { pull: "synced", analysis: "analyzed", owner: "pending_mapping", push: "pending" } });

    const sorted = sortRequirementsForAttention([pushedOld, pushPending, pushedNew, pushFailed, pendingOwner]);
    expect(sorted.map((item) => item.id)).toEqual(["5", "4", "3", "2", "1"]);
  });

  it("maps source names and extracts detail source facts with top-level description precedence", () => {
    expect(requirementSourceName({ sourceType: "base_form" })).toBe("多维表格");
    expect(requirementSourceName({ sourceType: "web_manual", source: { intakeOrigin: "chat_paste" } })).toBe("聊天粘贴");
    expect(requirementSourceName({ sourceType: "web_manual" })).toBe("手工");
    expect(requirementSourceName({ sourceType: "teambition" })).toBe("Teambition");

    const facts = requirementSourceFacts({
      description: "编辑后的最新描述",
      sourceUrl: "https://www.teambition.com/task/1",
      source: {
        description: "旧快照描述",
        proposerName: "提出人",
        executorName: "执行人",
        tbStatusName: "进行中",
        created: "2026-11-01T00:00:00Z",
        updated: "2026-11-02T00:00:00Z",
      },
    });
    expect(facts).toEqual({
      description: "编辑后的最新描述",
      proposerName: "提出人",
      executorName: "执行人",
      tbStatus: "进行中",
      tbUrl: "https://www.teambition.com/task/1",
      createdAt: "2026-11-01T00:00:00Z",
      updatedAt: "2026-11-02T00:00:00Z",
    });
  });
});
