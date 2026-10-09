import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  cleanup();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("RQ-Sys local workbench", () => {
  it("shows a recoverable service error instead of claiming the API is configured", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent("无法连接到本地 API");
    expect(screen.getByRole("button", { name: "重试连接" })).toBeInTheDocument();
  });

  it("loads source configuration from the API and can request a manual sync", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ status: "ok", service: "rq-sys-api" }))
      .mockResolvedValueOnce(Response.json({ items: [{
        id: "source-1", projectId: "project-1", projectName: "产品需求", requirementTypeId: "req-type",
        enabled: true, schedule: { enabled: false, weekday: null, time: null, timezone: null }, ownerNames: [], fieldMap: {},
      }] }))
      .mockResolvedValueOnce(Response.json({ items: [] }))
      .mockResolvedValueOnce(Response.json({ items: [] }));

    render(<App />);
    expect(await screen.findByText("产品需求")).toBeInTheDocument();
    expect(screen.getByText("还没有同步批次")).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(Response.json({ batchId: "batch-42", status: "running" }, { status: 202 }));
    fireEvent.click(screen.getByRole("button", { name: "立即同步" }));

    expect(await screen.findByText("批次 batch-42 已提交")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/sync/run", expect.objectContaining({ method: "POST" })));
  });

  it("renders an honest empty state when the API has no sources or batches", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ status: "ok", service: "rq-sys-api" }))
      .mockResolvedValueOnce(Response.json({ items: [] }))
      .mockResolvedValueOnce(Response.json({ items: [] }))
      .mockResolvedValueOnce(Response.json({ items: [] }));

    render(<App />);

    expect(await screen.findByText("尚未配置数据源")).toBeInTheDocument();
    expect(screen.getByText("还没有同步批次")).toBeInTheDocument();
  });
});
