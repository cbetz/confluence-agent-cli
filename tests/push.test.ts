import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { fromPosixPath } from "../src/paths.js";
import { executePush, planPush } from "../src/push.js";
import { pullPageTree } from "../src/workspace.js";
import { FakeConfluenceClient, makePage, tempDir } from "./helpers.js";

describe("push", () => {
  it("allows empty Confluence storage bodies", async () => {
    const root = await tempDir();
    const client = new FakeConfluenceClient({
      "100": makePage({
        id: "100",
        title: "Empty Page",
        storage: ""
      })
    });

    const manifest = await pullPageTree({ client, rootPageId: "100", outDir: root, maxDepth: 0 });

    expect(manifest.pages[0]!.lastPulledStorageSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("plans a markdown push with a live next version", async () => {
    const root = await tempDir();
    const client = new FakeConfluenceClient({
      "100": makePage({
        id: "100",
        title: "API Runbook",
        storage: "<p>Old step</p>",
        version: { number: 2 }
      })
    });
    const manifest = await pullPageTree({ client, rootPageId: "100", outDir: root, maxDepth: 0 });
    const page = manifest.pages[0]!;
    await fs.writeFile(fromPosixPath(root, page.markdownPath), "New step\n", "utf8");

    const plan = await planPush({
      root,
      client,
      source: "auto",
      allowLossy: false,
      force: false,
      remoteCheck: true
    });

    expect(plan).toHaveLength(1);
    expect(plan[0]!.source).toBe("markdown");
    expect(plan[0]!.nextVersionNumber).toBe(3);
  });

  it("refuses lossy markdown pushes by default", async () => {
    const root = await tempDir();
    const client = new FakeConfluenceClient({
      "100": makePage({
        id: "100",
        title: "Macro Page",
        storage: '<ac:structured-macro ac:name="info"></ac:structured-macro>'
      })
    });
    const manifest = await pullPageTree({ client, rootPageId: "100", outDir: root, maxDepth: 0 });
    const page = manifest.pages[0]!;
    await fs.writeFile(fromPosixPath(root, page.markdownPath), "Rewrite\n", "utf8");

    await expect(
      planPush({
        root,
        source: "auto",
        allowLossy: false,
        force: false,
        remoteCheck: false
      })
    ).rejects.toThrow(/Refusing Markdown push/);
  });

  it("executes a storage push and refreshes local state", async () => {
    const root = await tempDir();
    const client = new FakeConfluenceClient({
      "100": makePage({
        id: "100",
        title: "Storage Page",
        storage: "<p>Old</p>",
        version: { number: 4 }
      })
    });
    const manifest = await pullPageTree({ client, rootPageId: "100", outDir: root, maxDepth: 0 });
    const page = manifest.pages[0]!;
    await fs.writeFile(fromPosixPath(root, page.storagePath), "<p>New</p>", "utf8");

    const pushed = await executePush({
      root,
      client,
      source: "auto",
      allowLossy: false,
      force: false,
      remoteCheck: true,
      message: "agent update",
      minorEdit: true
    });

    expect(pushed).toHaveLength(1);
    expect(client.updates[0]!.storageValue).toBe("<p>New</p>");
    expect(client.updates[0]!.versionNumber).toBe(5);
    expect(client.updates[0]!.message).toBe("agent update");
  });
});
