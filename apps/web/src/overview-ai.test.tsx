import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { AiStatusCard, normalizeAiStatus } from "./overview-ai";
import type { OverviewAiStatus } from "./api";

const okAi: OverviewAiStatus = {
  status: "ok",
  statsAvailable: true,
  pausedUntil: null,
  pauseReason: null,
  analysis: { total: 120, today: 8 },
  chatIntake: { total: 30, today: 2 },
  lastCall: { at: "2026-11-18T07:30:00.000Z", kind: "analysis", result: "succeeded" },
};

describe("AiStatusCard", () => {
  it("shows the ok state, cumulative/today call counts and the last call", () => {
    render(<AiStatusCard ai={okAi} loadState="ready" />);
    expect(screen.getByRole("heading", { name: "AI 状态" })).toBeInTheDocument();
    expect(screen.getByText("正常")).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText("今日 8 次")).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
    expect(screen.getByText("今日 2 次")).toBeInTheDocument();
    // 今日合计 = 分析当日 8 + 聊天抽取当日 2。
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("分析 · 成功")).toBeInTheDocument();
    expect(screen.getByText(/\d{4}\/\d{1,2}\/\d{1,2}/)).toBeInTheDocument();
  });

  it("shows the pause reason and recovery time", () => {
    render(<AiStatusCard ai={{ ...okAi, status: "paused", pauseReason: "AI 额度受限", pausedUntil: "2026-11-18T10:00:00.000Z" }} loadState="ready" />);
    expect(screen.getByText("暂停中")).toBeInTheDocument();
    expect(screen.getByText(/AI 额度受限/)).toBeInTheDocument();
    expect(screen.getByText(/预计 .* 恢复/)).toBeInTheDocument();
  });

  it("explains the unconfigured state instead of showing zeros as healthy", () => {
    render(<AiStatusCard ai={{ ...okAi, status: "unconfigured" }} loadState="ready" />);
    expect(screen.getByText("未配置")).toBeInTheDocument();
    expect(screen.getByText(/未配置 AI 密钥/)).toBeInTheDocument();
  });

  it("shows 状态不可用 when the ai block is missing or malformed", () => {
    const { unmount } = render(<AiStatusCard ai={null} loadState="ready" />);
    expect(screen.getAllByText("状态不可用").length).toBeGreaterThan(0);
    unmount();
    render(<AiStatusCard ai={{ ...okAi, analysis: { total: -1, today: 0 } }} loadState="ready" />);
    expect(screen.getAllByText("状态不可用").length).toBeGreaterThan(0);
  });

  it("shows a loading state while the overview metrics are still loading", () => {
    render(<AiStatusCard ai={null} loadState="loading" />);
    expect(screen.getByText("读取中")).toBeInTheDocument();
    expect(screen.getByText(/正在读取 AI 状态/)).toBeInTheDocument();
  });

  it("refreshes once when a pause expires", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-18T10:00:00.000Z"));
    const onExpire = vi.fn();
    try {
      render(<AiStatusCard ai={{ ...okAi, status: "paused", pauseReason: "AI 额度受限", pausedUntil: "2026-11-18T10:00:05.000Z" }} loadState="ready" onExpire={onExpire} />);
      act(() => { vi.advanceTimersByTime(7_000); });
      expect(onExpire).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not schedule a refresh when the pause already expired", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-18T10:00:10.000Z"));
    const onExpire = vi.fn();
    try {
      render(<AiStatusCard ai={{ ...okAi, status: "paused", pausedUntil: "2026-11-18T10:00:05.000Z" }} loadState="ready" onExpire={onExpire} />);
      act(() => { vi.advanceTimersByTime(60_000); });
      expect(onExpire).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("degrades to 状态不可用（统计暂不可用） when the aggregation failed", () => {
    render(<AiStatusCard ai={{ ...okAi, status: "unavailable", statsAvailable: false, analysis: { total: 0, today: 0 }, chatIntake: { total: 0, today: 0 }, lastCall: { at: null, kind: null, result: null } }} loadState="ready" />);
    expect(screen.getByText("状态不可用（统计暂不可用）")).toBeInTheDocument();
    // 不把统计失败时的 0 当成真实用量展示。
    expect(screen.queryByText("120")).not.toBeInTheDocument();
    expect(screen.queryByText("今日 8 次")).not.toBeInTheDocument();
    expect(screen.queryByText("分析 · 成功")).not.toBeInTheDocument();
  });

  it("degrades on statsAvailable=false even when status is ok", () => {
    render(<AiStatusCard ai={{ ...okAi, statsAvailable: false }} loadState="ready" />);
    expect(screen.getByText("状态不可用（统计暂不可用）")).toBeInTheDocument();
    expect(screen.queryByText("120")).not.toBeInTheDocument();
  });

  it("keeps rendering counts for older payloads without statsAvailable", () => {
    const { statsAvailable: _ignored, ...legacy } = okAi;
    render(<AiStatusCard ai={legacy as OverviewAiStatus} loadState="ready" />);
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.queryByText("状态不可用（统计暂不可用）")).not.toBeInTheDocument();
  });

  it("treats an unrecognized status or oversized shape as unavailable", () => {
    expect(normalizeAiStatus({ ...okAi, status: "running" } as unknown as OverviewAiStatus)).toBeNull();
    expect(normalizeAiStatus({ ...okAi, lastCall: { at: "not-a-date", kind: "analysis", result: "succeeded" } })).toBeNull();
    expect(normalizeAiStatus({ ...okAi, statsAvailable: "yes" } as unknown as OverviewAiStatus)).toBeNull();
    expect(normalizeAiStatus({ ...okAi, status: "unavailable", statsAvailable: false })).not.toBeNull();
    expect(normalizeAiStatus(okAi)).toEqual(okAi);
  });
});
