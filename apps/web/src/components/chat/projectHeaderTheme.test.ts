import { describe, expect, it } from "vitest";
import {
  resolveProjectBadgeStyle,
  resolveProjectHeaderClassName,
  resolveProjectHeaderStyle,
} from "./projectHeaderTheme";

describe("resolveProjectHeaderClassName", () => {
  it("keeps the default border palette when there is no project color", () => {
    expect(resolveProjectHeaderClassName("border-b px-3", null)).toContain("border-border");
  });

  it("upgrades the header border when a project color is set", () => {
    const className = resolveProjectHeaderClassName("border-b px-3", "#22c55e");
    expect(className).toContain("border-b-2");
    expect(className).not.toContain("border-border");
  });
});

describe("resolveProjectHeaderStyle", () => {
  it("returns undefined without a project color", () => {
    expect(resolveProjectHeaderStyle(null)).toBeUndefined();
  });

  it("builds a tinted background and border for colored projects", () => {
    expect(resolveProjectHeaderStyle("#3b82f6")).toEqual({
      backgroundColor: "color-mix(in srgb, #3b82f6 12%, var(--background))",
      borderBottomColor: "color-mix(in srgb, #3b82f6 72%, var(--border))",
    });
  });
});

describe("resolveProjectBadgeStyle", () => {
  it("tints the project badge when a project color is set", () => {
    expect(resolveProjectBadgeStyle("#ef4444")).toEqual({
      backgroundColor: "color-mix(in srgb, #ef4444 14%, var(--background))",
      borderColor: "color-mix(in srgb, #ef4444 56%, var(--border))",
    });
  });
});
