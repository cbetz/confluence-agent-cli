import { describe, expect, it } from "vitest";
import { hasLossyConversionRisk, markdownToStorage, storageToMarkdown } from "../src/conversion.js";

describe("conversion", () => {
  it("converts simple storage html to markdown", () => {
    expect(storageToMarkdown("<h1>Hello</h1><p>World</p>")).toBe("# Hello\n\nWorld\n");
  });

  it("converts markdown to storage html", () => {
    expect(markdownToStorage("# Hello\n\n- A\n- B\n")).toContain("<h1>Hello</h1>");
  });

  it("detects Confluence namespaced markup as lossy risk", () => {
    expect(hasLossyConversionRisk('<ac:structured-macro ac:name="info"></ac:structured-macro>')).toBe(true);
    expect(hasLossyConversionRisk("<p>Plain</p>")).toBe(false);
  });
});
