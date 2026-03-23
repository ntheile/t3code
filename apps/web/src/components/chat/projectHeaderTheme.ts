import type { CSSProperties } from "react";
import { cn } from "~/lib/utils";

const DEFAULT_HEADER_BACKGROUND = "var(--background)";
const DEFAULT_HEADER_BORDER = "var(--border)";

export function resolveProjectHeaderClassName(baseClassName: string, projectColor: string | null) {
  return cn(baseClassName, projectColor ? "border-b-2" : "border-border");
}

export function resolveProjectHeaderStyle(projectColor: string | null): CSSProperties | undefined {
  if (!projectColor) {
    return undefined;
  }

  return {
    backgroundColor: `color-mix(in srgb, ${projectColor} 12%, ${DEFAULT_HEADER_BACKGROUND})`,
    borderBottomColor: `color-mix(in srgb, ${projectColor} 72%, ${DEFAULT_HEADER_BORDER})`,
  };
}

export function resolveProjectBadgeStyle(projectColor: string | null): CSSProperties | undefined {
  if (!projectColor) {
    return undefined;
  }

  return {
    backgroundColor: `color-mix(in srgb, ${projectColor} 14%, ${DEFAULT_HEADER_BACKGROUND})`,
    borderColor: `color-mix(in srgb, ${projectColor} 56%, ${DEFAULT_HEADER_BORDER})`,
  };
}
