import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { fromPosixPath } from "../src/paths.js";
import { executePush, planPush } from "../src/push.js";
import { createLocalPage, pullPageTree, readManifest } from "../src/workspace.js";
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

    expect(plan.pages).toHaveLength(1);
    expect(plan.pages[0]!.source).toBe("markdown");
    expect(plan.pages[0]!.nextVersionNumber).toBe(3);
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

    expect(pushed.pages).toHaveLength(1);
    expect(client.updates[0]!.storageValue).toBe("<p>New</p>");
    expect(client.updates[0]!.versionNumber).toBe(5);
    expect(client.updates[0]!.message).toBe("agent update");
  });

  it("plans and uploads a new attachment", async () => {
    const root = await tempDir();
    const client = new FakeConfluenceClient({
      "100": makePage({
        id: "100",
        title: "API Runbook",
        storage: "<p>Body</p>"
      })
    });
    const manifest = await pullPageTree({ client, rootPageId: "100", outDir: root, maxDepth: 0 });
    const page = manifest.pages[0]!;
    await fs.writeFile(fromPosixPath(root, `${page.folderPath}/attachments/result.txt`), "new attachment", "utf8");

    const plan = await planPush({
      root,
      client,
      source: "auto",
      allowLossy: false,
      force: false,
      remoteCheck: true
    });

    expect(plan.pages).toHaveLength(0);
    expect(plan.attachments).toHaveLength(1);
    expect(plan.attachments[0]!.kind).toBe("new");

    const pushed = await executePush({
      root,
      client,
      source: "auto",
      allowLossy: false,
      force: false,
      remoteCheck: true,
      message: "attach result",
      minorEdit: true
    });

    expect(pushed.attachments).toHaveLength(1);
    expect(client.attachmentUploads[0]!.fileName).toBe("result.txt");
    expect(new TextDecoder().decode(client.attachmentUploads[0]!.data)).toBe("new attachment");
    expect(client.attachmentUploads[0]!.comment).toBe("attach result");
  });

  it("creates a pending local page and uploads its attachments", async () => {
    const root = await tempDir();
    const client = new FakeConfluenceClient({
      "100": makePage({
        id: "100",
        title: "API Runbook",
        storage: "<p>Body</p>",
        spaceId: "S1"
      })
    });
    await pullPageTree({ client, rootPageId: "100", outDir: root, maxDepth: 0 });
    const entry = await createLocalPage({
      root,
      title: "Incident Runbook",
      parentId: "100",
      body: "# Incident Runbook\n\nFirst draft"
    });
    await fs.writeFile(fromPosixPath(root, `${entry.folderPath}/attachments/evidence.txt`), "evidence", "utf8");

    const plan = await planPush({
      root,
      client,
      source: "auto",
      allowLossy: false,
      force: false,
      remoteCheck: true
    });

    expect(plan.pages).toHaveLength(1);
    expect(plan.pages[0]!.action).toBe("create");
    expect(plan.attachments).toHaveLength(1);

    await executePush({
      root,
      client,
      source: "auto",
      allowLossy: false,
      force: false,
      remoteCheck: true,
      message: "create runbook"
    });

    expect(client.createdPages).toHaveLength(1);
    expect(client.createdPages[0]!.parentId).toBe("100");
    expect(client.createdPages[0]!.spaceId).toBe("S1");
    expect(client.attachmentUploads[0]!.pageId).toBe("1001");

    const manifest = await readManifest(root);
    expect(manifest.pages.some((page) => page.id === entry.id)).toBe(false);
    expect(manifest.pages.some((page) => page.id === "1001" && !page.isNew)).toBe(true);
  });
});
