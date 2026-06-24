import fs from "node:fs/promises";
import path from "node:path";
import { createTwoFilesPatch } from "diff";
import { hasLossyConversionRisk, markdownToStorage, storageToMarkdown } from "./conversion.js";
import { CliError } from "./errors.js";
import { sha256 } from "./hash.js";
import {
  attachmentFileName,
  fromPosixPath,
  manifestPath,
  originalAttachmentPath,
  originalMarkdownPath,
  originalStoragePath,
  pageFolderName,
  STATE_DIR,
  toPosixPath
} from "./paths.js";
import type { ConfluenceGateway } from "./confluenceClient.js";
import type {
  AttachmentManifestEntry,
  ConfluencePage,
  LocalAttachmentChange,
  LocalChanges,
  LocalPageChange,
  PageAttachmentManifest,
  PageManifestEntry,
  PageMeta,
  PullManifest
} from "./types.js";

export async function readManifest(root: string): Promise<PullManifest> {
  try {
    return JSON.parse(await fs.readFile(manifestPath(root), "utf8")) as PullManifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new CliError(`No Confluence workspace found at ${root}. Run \`conf pull <page-id> --out ${root}\` first.`);
    }
    throw error;
  }
}

export async function pullPageTree(input: {
  client: ConfluenceGateway;
  rootPageId: string;
  outDir: string;
  maxDepth: number;
}): Promise<PullManifest> {
  await fs.mkdir(path.join(input.outDir, STATE_DIR, "originals"), { recursive: true });
  const pulledAt = new Date().toISOString();
  const pages: PageManifestEntry[] = [];

  async function visit(pageId: string, parentFolder: string, depth: number): Promise<void> {
    const page = await input.client.getPage(pageId);
    const entry = await writePulledPage({
      client: input.client,
      root: input.outDir,
      parentFolder,
      page,
      pulledAt
    });
    pages.push(entry);

    if (depth >= input.maxDepth) {
      return;
    }

    const childPages = await input.client.listChildPages(page.id);
    for (const child of childPages) {
      await visit(child.id, fromPosixPath(input.outDir, entry.folderPath), depth + 1);
    }
  }

  await visit(input.rootPageId, input.outDir, 0);

  const manifest: PullManifest = {
    schemaVersion: 1,
    baseUrl: input.client.baseUrl,
    rootPageId: input.rootPageId,
    pulledAt,
    pages
  };
  await fs.writeFile(manifestPath(input.outDir), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

export async function createLocalPage(input: {
  root: string;
  title: string;
  parentId: string;
  body?: string;
}): Promise<PageManifestEntry> {
  const manifest = await readManifest(input.root);
  const parent = manifest.pages.find((entry) => entry.id === input.parentId);

  if (!parent) {
    throw new CliError(`Parent page ${input.parentId} is not in ${input.root}. Pull the parent page tree first.`);
  }

  if (parent.isNew) {
    throw new CliError("Creating a local child under another pending local page is not supported yet.");
  }

  const localId = `local-${Date.now().toString(36)}`;
  const folder = nextAvailablePageFolder(input.root, fromPosixPath(input.root, parent.folderPath), input.title, localId);
  await fs.mkdir(folder, { recursive: true });

  const markdown = `${input.body?.trim() || `# ${input.title}`}\n`;
  const storage = markdownToStorage(markdown);
  const markdownPath = path.join(folder, "page.md");
  const storagePath = path.join(folder, "page.storage.html");
  const metaPath = path.join(folder, "meta.json");
  const attachmentsPath = path.join(folder, "attachments");
  const attachmentsMetaPath = path.join(folder, "attachments.json");
  const pulledAt = new Date().toISOString();

  await fs.mkdir(attachmentsPath, { recursive: true });
  await fs.writeFile(markdownPath, markdown, "utf8");
  await fs.writeFile(storagePath, storage, "utf8");
  await fs.writeFile(originalMarkdownPath(input.root, localId), "", "utf8");
  await fs.writeFile(originalStoragePath(input.root, localId), "", "utf8");

  const entry: PageManifestEntry = {
    id: localId,
    title: input.title,
    isNew: true,
    parentLocalId: parent.id,
    folderPath: toPosixPath(path.relative(input.root, folder)),
    markdownPath: toPosixPath(path.relative(input.root, markdownPath)),
    storagePath: toPosixPath(path.relative(input.root, storagePath)),
    metaPath: toPosixPath(path.relative(input.root, metaPath)),
    attachmentsPath: toPosixPath(path.relative(input.root, attachmentsPath)),
    attachmentsMetaPath: toPosixPath(path.relative(input.root, attachmentsMetaPath)),
    spaceId: parent.spaceId,
    parentId: parent.id,
    versionNumber: 0,
    lastPulledMarkdownSha256: sha256(""),
    lastPulledStorageSha256: sha256(""),
    lossyConversionRisk: false,
    pulledAt
  };

  const attachmentManifest: PageAttachmentManifest = {
    schemaVersion: 1,
    pageId: localId,
    attachments: []
  };
  await fs.writeFile(attachmentsMetaPath, `${JSON.stringify(attachmentManifest, null, 2)}\n`, "utf8");
  await writePageMeta(input.root, entry, "");

  manifest.pages.push(entry);
  manifest.pulledAt = pulledAt;
  await fs.writeFile(manifestPath(input.root), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return entry;
}

export async function listLocalChanges(root: string): Promise<LocalPageChange[]> {
  const manifest = await readManifest(root);
  const changes: LocalPageChange[] = [];

  for (const entry of manifest.pages) {
    const markdown = await fs.readFile(fromPosixPath(root, entry.markdownPath), "utf8");
    const storage = await fs.readFile(fromPosixPath(root, entry.storagePath), "utf8");
    const markdownSha256 = sha256(markdown);
    const storageSha256 = sha256(storage);
    const markdownChanged = entry.isNew || markdownSha256 !== entry.lastPulledMarkdownSha256;
    const storageChanged = !entry.isNew && storageSha256 !== entry.lastPulledStorageSha256;

    if (markdownChanged || storageChanged) {
      changes.push({
        entry,
        markdownChanged,
        storageChanged,
        isNew: entry.isNew,
        markdownSha256,
        storageSha256
      });
    }
  }

  return changes;
}

export async function listAllLocalChanges(root: string): Promise<LocalChanges> {
  return {
    pages: await listLocalChanges(root),
    attachments: await listLocalAttachmentChanges(root)
  };
}

export async function listLocalAttachmentChanges(root: string): Promise<LocalAttachmentChange[]> {
  const manifest = await readManifest(root);
  const changes: LocalAttachmentChange[] = [];

  for (const page of manifest.pages) {
    const attachmentManifest = await readPageAttachmentManifest(root, page);
    const byFileName = new Map(attachmentManifest.attachments.map((attachment) => [attachment.fileName, attachment]));
    const attachmentsDir = pageAttachmentsDir(root, page);
    const names = await listFilesIfExists(attachmentsDir);

    for (const fileName of names) {
      const filePath = path.join(attachmentsDir, fileName);
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) {
        continue;
      }

      const bytes = await fs.readFile(filePath);
      const currentSha256 = sha256(bytes);
      const attachment = byFileName.get(fileName);

      if (!attachment) {
        changes.push({
          page,
          title: fileName,
          fileName,
          filePath: toPosixPath(path.relative(root, filePath)),
          sha256: currentSha256,
          kind: "new"
        });
        continue;
      }

      if (currentSha256 !== attachment.lastPulledSha256) {
        changes.push({
          page,
          attachment,
          title: attachment.title,
          fileName,
          filePath: attachment.filePath,
          sha256: currentSha256,
          kind: "modified"
        });
      }
    }
  }

  return changes;
}

export async function renderDiff(root: string): Promise<string> {
  const changes = await listAllLocalChanges(root);
  const patches: string[] = [];

  for (const change of changes.pages) {
    if (change.markdownChanged) {
      const original = await fs.readFile(originalMarkdownPath(root, change.entry.id), "utf8");
      const current = await fs.readFile(fromPosixPath(root, change.entry.markdownPath), "utf8");
      patches.push(
        createTwoFilesPatch(
          `${change.entry.markdownPath} (pulled)`,
          change.entry.markdownPath,
          original,
          current,
          "",
          ""
        )
      );
    }

    if (change.storageChanged) {
      const original = await fs.readFile(originalStoragePath(root, change.entry.id), "utf8");
      const current = await fs.readFile(fromPosixPath(root, change.entry.storagePath), "utf8");
      patches.push(
        createTwoFilesPatch(
          `${change.entry.storagePath} (pulled)`,
          change.entry.storagePath,
          original,
          current,
          "",
          ""
        )
      );
    }
  }

  if (changes.attachments.length > 0) {
    const lines = ["Attachment changes:"];
    for (const attachment of changes.attachments) {
      lines.push(`${attachment.kind === "new" ? "A" : "M"} ${attachment.filePath}`);
    }
    patches.push(lines.join("\n"));
  }

  return patches.join("\n");
}

export async function updateManifestEntry(root: string, updated: PageManifestEntry): Promise<void> {
  const manifest = await readManifest(root);
  manifest.pages = manifest.pages.map((entry) => (entry.id === updated.id ? updated : entry));
  manifest.pulledAt = new Date().toISOString();
  await fs.writeFile(manifestPath(root), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export async function refreshPageState(input: {
  root: string;
  entry: PageManifestEntry;
  versionNumber: number;
  storage: string;
  markdown: string;
}): Promise<PageManifestEntry> {
  const pulledAt = new Date().toISOString();
  await fs.writeFile(originalMarkdownPath(input.root, input.entry.id), input.markdown, "utf8");
  await fs.writeFile(originalStoragePath(input.root, input.entry.id), input.storage, "utf8");

  const updated: PageManifestEntry = {
    ...input.entry,
    versionNumber: input.versionNumber,
    pulledAt,
    lastPulledMarkdownSha256: sha256(input.markdown),
    lastPulledStorageSha256: sha256(input.storage),
    lossyConversionRisk: hasLossyConversionRisk(input.storage)
  };
  await writePageMeta(input.root, updated);
  await updateManifestEntry(input.root, updated);
  return updated;
}

export async function finalizeCreatedPage(input: {
  root: string;
  localEntry: PageManifestEntry;
  createdPage: ConfluencePage;
  storage: string;
  markdown: string;
  confluenceUrl?: string;
}): Promise<PageManifestEntry> {
  const pulledAt = new Date().toISOString();
  const updated: PageManifestEntry = {
    ...input.localEntry,
    id: input.createdPage.id,
    title: input.createdPage.title,
    isNew: undefined,
    parentLocalId: undefined,
    spaceId: input.createdPage.spaceId,
    parentId: input.createdPage.parentId,
    versionNumber: input.createdPage.version.number,
    pulledAt,
    lastPulledMarkdownSha256: sha256(input.markdown),
    lastPulledStorageSha256: sha256(input.storage),
    lossyConversionRisk: hasLossyConversionRisk(input.storage)
  };

  await fs.writeFile(originalMarkdownPath(input.root, updated.id), input.markdown, "utf8");
  await fs.writeFile(originalStoragePath(input.root, updated.id), input.storage, "utf8");

  const attachmentManifest = await readPageAttachmentManifest(input.root, input.localEntry);
  const updatedAttachmentManifest: PageAttachmentManifest = {
    ...attachmentManifest,
    pageId: updated.id,
    attachments: attachmentManifest.attachments.map((attachment) => ({
      ...attachment,
      pageId: updated.id
    }))
  };
  await fs.writeFile(fromPosixPath(input.root, updated.attachmentsMetaPath ?? `${updated.folderPath}/attachments.json`), `${JSON.stringify(updatedAttachmentManifest, null, 2)}\n`, "utf8");

  const manifest = await readManifest(input.root);
  manifest.pages = manifest.pages.map((entry) => (entry.id === input.localEntry.id ? updated : entry));
  manifest.pulledAt = pulledAt;
  await fs.writeFile(manifestPath(input.root), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writePageMeta(input.root, updated, input.confluenceUrl);

  await removeIfExists(originalMarkdownPath(input.root, input.localEntry.id));
  await removeIfExists(originalStoragePath(input.root, input.localEntry.id));

  return updated;
}

export async function refreshAttachmentState(input: {
  root: string;
  client: ConfluenceGateway;
  page: PageManifestEntry;
}): Promise<PageAttachmentManifest> {
  return writePageAttachments({
    root: input.root,
    client: input.client,
    page: input.page,
    folder: fromPosixPath(input.root, input.page.folderPath),
    pulledAt: new Date().toISOString()
  });
}

async function writePulledPage(input: {
  client: ConfluenceGateway;
  root: string;
  parentFolder: string;
  page: ConfluencePage;
  pulledAt: string;
}): Promise<PageManifestEntry> {
  const storage = input.page.body.storage?.value ?? "";
  const markdown = storageToMarkdown(storage);
  const folder = path.join(input.parentFolder, pageFolderName(input.page.title, input.page.id));
  await fs.mkdir(folder, { recursive: true });

  const markdownPath = path.join(folder, "page.md");
  const storagePath = path.join(folder, "page.storage.html");
  const metaPath = path.join(folder, "meta.json");
  const attachmentsPath = path.join(folder, "attachments");
  const attachmentsMetaPath = path.join(folder, "attachments.json");

  await fs.writeFile(markdownPath, markdown, "utf8");
  await fs.writeFile(storagePath, storage, "utf8");
  await fs.writeFile(originalMarkdownPath(input.root, input.page.id), markdown, "utf8");
  await fs.writeFile(originalStoragePath(input.root, input.page.id), storage, "utf8");

  const entry: PageManifestEntry = {
    id: input.page.id,
    title: input.page.title,
    folderPath: toPosixPath(path.relative(input.root, folder)),
    markdownPath: toPosixPath(path.relative(input.root, markdownPath)),
    storagePath: toPosixPath(path.relative(input.root, storagePath)),
    metaPath: toPosixPath(path.relative(input.root, metaPath)),
    attachmentsPath: toPosixPath(path.relative(input.root, attachmentsPath)),
    attachmentsMetaPath: toPosixPath(path.relative(input.root, attachmentsMetaPath)),
    spaceId: input.page.spaceId,
    parentId: input.page.parentId,
    versionNumber: input.page.version.number,
    lastPulledMarkdownSha256: sha256(markdown),
    lastPulledStorageSha256: sha256(storage),
    lossyConversionRisk: hasLossyConversionRisk(storage),
    pulledAt: input.pulledAt
  };

  await writePageMeta(input.root, entry, input.client.pageUrl(input.page.id));
  await writePageAttachments({
    root: input.root,
    client: input.client,
    page: entry,
    folder,
    pulledAt: input.pulledAt
  });
  return entry;
}

async function writePageMeta(root: string, entry: PageManifestEntry, confluenceUrl?: string): Promise<void> {
  const existing = await readExistingMeta(root, entry).catch(() => undefined);
  const meta: PageMeta = {
    ...entry,
    schemaVersion: 1,
    confluenceUrl: confluenceUrl ?? existing?.confluenceUrl ?? ""
  };
  await fs.writeFile(fromPosixPath(root, entry.metaPath), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
}

async function readExistingMeta(root: string, entry: PageManifestEntry): Promise<PageMeta> {
  return JSON.parse(await fs.readFile(fromPosixPath(root, entry.metaPath), "utf8")) as PageMeta;
}

async function writePageAttachments(input: {
  root: string;
  client: ConfluenceGateway;
  page: PageManifestEntry;
  folder: string;
  pulledAt: string;
}): Promise<PageAttachmentManifest> {
  const attachmentsDir = pageAttachmentsDir(input.root, input.page);
  await fs.mkdir(attachmentsDir, { recursive: true });
  await fs.mkdir(path.join(input.root, STATE_DIR, "originals", "attachments", input.page.id), { recursive: true });

  const remoteAttachments = await input.client.listPageAttachments(input.page.id);
  const usedFileNames = new Set<string>();
  const attachments: AttachmentManifestEntry[] = [];

  for (const attachment of remoteAttachments) {
    const fileName = uniqueAttachmentFileName(attachment.title, attachment.id, usedFileNames);
    const bytes = await input.client.downloadAttachment(attachment);
    const filePath = path.join(attachmentsDir, fileName);
    const originalPath = originalAttachmentPath(input.root, input.page.id, fileName);

    await fs.writeFile(filePath, bytes);
    await fs.writeFile(originalPath, bytes);

    attachments.push({
      id: attachment.id,
      pageId: input.page.id,
      title: attachment.title,
      fileName,
      filePath: toPosixPath(path.relative(input.root, filePath)),
      mediaType: attachment.mediaType,
      comment: attachment.comment,
      fileSize: attachment.fileSize,
      versionNumber: attachment.version.number,
      downloadLink: attachment.downloadLink ?? attachment._links?.download,
      webuiLink: attachment.webuiLink ?? attachment._links?.webui,
      lastPulledSha256: sha256(bytes),
      pulledAt: input.pulledAt
    });
  }

  const manifest: PageAttachmentManifest = {
    schemaVersion: 1,
    pageId: input.page.id,
    attachments
  };
  await fs.writeFile(pageAttachmentsMetaPath(input.root, input.page), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

export async function readPageAttachmentManifest(root: string, page: PageManifestEntry): Promise<PageAttachmentManifest> {
  try {
    return JSON.parse(await fs.readFile(pageAttachmentsMetaPath(root, page), "utf8")) as PageAttachmentManifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        schemaVersion: 1,
        pageId: page.id,
        attachments: []
      };
    }
    throw error;
  }
}

function pageAttachmentsDir(root: string, page: PageManifestEntry): string {
  return fromPosixPath(root, page.attachmentsPath ?? `${page.folderPath}/attachments`);
}

function pageAttachmentsMetaPath(root: string, page: PageManifestEntry): string {
  return fromPosixPath(root, page.attachmentsMetaPath ?? `${page.folderPath}/attachments.json`);
}

async function listFilesIfExists(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function uniqueAttachmentFileName(title: string, id: string, usedFileNames: Set<string>): string {
  const safe = attachmentFileName(title);
  if (!usedFileNames.has(safe)) {
    usedFileNames.add(safe);
    return safe;
  }

  const parsed = path.parse(safe);
  const withId = `${parsed.name}-${id}${parsed.ext}`;
  usedFileNames.add(withId);
  return withId;
}

function nextAvailablePageFolder(root: string, parentFolder: string, title: string, id: string): string {
  return path.join(parentFolder, pageFolderName(title, id));
}

async function removeIfExists(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}
