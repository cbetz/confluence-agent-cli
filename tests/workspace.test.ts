import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fromPosixPath } from "../src/paths.js";
import { listLocalChanges, pullPageTree, renderDiff } from "../src/workspace.js";
import { FakeConfluenceClient, makePage, tempDir } from "./helpers.js";

describe("workspace", () => {
  it("pulls a page and tracks markdown changes", async () => {
    const root = await tempDir();
    const client = new FakeConfluenceClient({
      "100": makePage({
        id: "100",
        title: "API Runbook",
        storage: "<h1>API Runbook</h1><p>Old step</p>"
      })
    });

    const manifest = await pullPageTree({
      client,
      rootPageId: "100",
      outDir: root,
      maxDepth: 0
    });

    expect(manifest.pages).toHaveLength(1);
    const page = manifest.pages[0]!;
    await fs.appendFile(fromPosixPath(root, page.markdownPath), "\nNew step\n", "utf8");

    const changes = await listLocalChanges(root);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.markdownChanged).toBe(true);

    const diff = await renderDiff(root);
    expect(diff).toContain("+New step");
    expect(await fs.readFile(path.join(root, ".confagent", "manifest.json"), "utf8")).toContain("API Runbook");
  });
});
