import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RequirementDetailSkeleton, SkeletonCards, SkeletonTableRows } from "./skeleton";

describe("loading skeletons", () => {
  it("announces loading state to assistive tech", () => {
    render(<SkeletonTableRows rows={3} columns={4} />);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(region.querySelectorAll("tr")).toHaveLength(3);
  });

  it("renders card and detail placeholders without exposing decorative nodes", () => {
    const { container } = render(<><SkeletonCards count={2} /><RequirementDetailSkeleton /></>);
    expect(screen.getAllByRole("status")).toHaveLength(2);
    expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(5);
  });
});
