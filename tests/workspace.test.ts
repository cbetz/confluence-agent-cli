import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fromPosixPath } from "../src/paths.js";
import { createLocalPage, listLocalChanges, pullPageTree, renderDiff } from "../src/workspace.js";
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

  it("pulls page attachments and tracks attachment changes", async () => {
    const root = await tempDir();
    const client = new FakeConfluenceClient(
      {
        "100": makePage({
          id: "100",
          title: "API Runbook",
          storage: "<p>Body</p>"
        })
      },
      {},
      {
        "100": [
          {
            id: "att-1",
            status: "current",
            title: "evidence.txt",
            pageId: "100",
            mediaType: "text/plain",
            fileSize: 8,
            downloadLink: "/download/att-1",
            version: { number: 1 }
          }
        ]
      },
      {
        "att-1": new TextEncoder().encode("original")
      }
    );

    const manifest = await pullPageTree({
      client,
      rootPageId: "100",
      outDir: root,
      maxDepth: 0
    });

    const page = manifest.pages[0]!;
    const attachmentPath = fromPosixPath(root, `${page.folderPath}/attachments/evidence.txt`);
    expect(await fs.readFile(attachmentPath, "utf8")).toBe("original");

    await fs.writeFile(attachmentPath, "updated", "utf8");
    const diff = await renderDiff(root);
    expect(diff).toContain("Attachment changes:");
    expect(diff).toContain("M api-runbook-100/attachments/evidence.txt");
  });

  it("creates a pending local child page", async () => {
    const root = await tempDir();
    const client = new FakeConfluenceClient({
      "100": makePage({
        id: "100",
        title: "API Runbook",
        storage: "<p>Body</p>"
      })
    });
    await pullPageTree({ client, rootPageId: "100", outDir: root, maxDepth: 0 });

    const entry = await createLocalPage({
      root,
      title: "Incident Runbook",
      parentId: "100",
      body: "# Incident Runbook\n\nFirst draft"
    });

    expect(entry.isNew).toBe(true);
    expect(entry.parentId).toBe("100");
    expect(await fs.readFile(fromPosixPath(root, entry.markdownPath), "utf8")).toContain("First draft");

    const changes = await listLocalChanges(root);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.isNew).toBe(true);

    const diff = await renderDiff(root);
    expect(diff).toContain("Incident Runbook");
  });
});
