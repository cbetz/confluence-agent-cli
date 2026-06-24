import { describe, expect, it } from "vitest";
import { parsePageReference } from "../src/confluenceUrl.js";

describe("parsePageReference", () => {
  it("accepts a bare numeric page id", () => {
    expect(parsePageReference("393217")).toEqual({ pageId: "393217" });
  });

  it("extracts page id and base url from modern Confluence URLs", () => {
    expect(
      parsePageReference("https://example.atlassian.net/wiki/spaces/ABC/pages/393217/CLI+Test+Page")
    ).toEqual({
      pageId: "393217",
      baseUrl: "https://example.atlassian.net"
    });
  });

  it("extracts page id and base url from viewpage URLs", () => {
    expect(parsePageReference("https://example.atlassian.net/wiki/pages/viewpage.action?pageId=393217")).toEqual({
      pageId: "393217",
      baseUrl: "https://example.atlassian.net"
    });
  });

  it("rejects non-page inputs", () => {
    expect(() => parsePageReference("https://example.atlassian.net/wiki/spaces/ABC")).toThrow(/page ID/);
  });
});
