import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../hooks/useTheme", () => ({
  useTheme: () => ({
    resolvedTheme: "light" as const,
  }),
}));

describe("ChatMarkdown", () => {
  it("opens external markdown links with noopener noreferrer semantics", async () => {
    const { default: ChatMarkdown } = await import("./ChatMarkdown");
    const markup = renderToStaticMarkup(
      <ChatMarkdown text="[Open site](https://example.com)" cwd={undefined} />,
    );

    expect(markup).toContain('href="https://example.com"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener noreferrer"');
  });

  it("keeps file links on the editor-opening path", async () => {
    const { default: ChatMarkdown } = await import("./ChatMarkdown");
    const markup = renderToStaticMarkup(
      <ChatMarkdown text="[Open file](src/main.ts:12)" cwd="/Users/julius/project" />,
    );

    expect(markup).toContain('href="src/main.ts:12"');
    expect(markup).not.toContain('target="_blank"');
    expect(markup).not.toContain('rel="noopener noreferrer"');
  });
});
