import fs from "node:fs/promises";
import { markdownToStorage, storageToMarkdown } from "./conversion.js";
import type { ConfluenceGateway } from "./confluenceClient.js";
import { CliError } from "./errors.js";
import { fromPosixPath } from "./paths.js";
import {
  listLocalAttachmentChanges,
  listLocalChanges,
  readPageAttachmentManifest,
  refreshAttachmentState,
  refreshPageState
} from "./workspace.js";
import type {
  AttachmentPushPlanItem,
  LocalAttachmentChange,
  LocalPageChange,
  PushPlan,
  PushPlanItem,
  PushSource
} from "./types.js";

type PushOptions = {
  root: string;
  client?: ConfluenceGateway;
  source: PushSource;
  allowLossy: boolean;
  force: boolean;
  remoteCheck: boolean;
  message?: string;
  minorEdit?: boolean;
};

export async function planPush(options: PushOptions): Promise<PushPlan> {
  const changes = await listLocalChanges(options.root);
  const attachments = await listLocalAttachmentChanges(options.root);
  const pageItems: PushPlanItem[] = [];

  for (const change of changes) {
    const source = resolveSource(change, options.source, options.allowLossy);
    let remoteVersionNumber: number | undefined;
    let nextVersionNumber = change.entry.versionNumber + 1;

    if (options.remoteCheck) {
      if (!options.client) {
        throw new CliError("Remote version check requires Confluence credentials.");
      }

      const remote = await options.client.getPage(change.entry.id);
      remoteVersionNumber = remote.version.number;

      if (remoteVersionNumber !== change.entry.versionNumber && !options.force) {
        throw new CliError(
          `Remote page changed since pull: ${change.entry.title} (${change.entry.id}) is at version ${remoteVersionNumber}, local base is ${change.entry.versionNumber}. Pull again or use --force.`
        );
      }

      nextVersionNumber = remoteVersionNumber + 1;
    }

    pageItems.push({
      entry: change.entry,
      source,
      remoteVersionNumber,
      nextVersionNumber,
      warning:
        source === "markdown" && change.entry.lossyConversionRisk
          ? "Markdown conversion may drop Confluence macro/storage details."
          : undefined
    });
  }

  const attachmentItems = await planAttachmentPush(options, attachments);

  return {
    pages: pageItems,
    attachments: attachmentItems
  };
}

export async function executePush(options: PushOptions & { client: ConfluenceGateway }): Promise<PushPlan> {
  const plan = await planPush(options);

  for (const item of plan.pages) {
    const markdownPath = fromPosixPath(options.root, item.entry.markdownPath);
    const storagePath = fromPosixPath(options.root, item.entry.storagePath);
    let markdown: string;
    let storage: string;

    if (item.source === "markdown") {
      markdown = await fs.readFile(markdownPath, "utf8");
      storage = markdownToStorage(markdown);
      await fs.writeFile(storagePath, storage, "utf8");
    } else {
      storage = await fs.readFile(storagePath, "utf8");
      markdown = storageToMarkdown(storage);
      await fs.writeFile(markdownPath, markdown, "utf8");
    }

    const updated = await options.client.updatePage({
      id: item.entry.id,
      title: item.entry.title,
      status: "current",
      spaceId: item.entry.spaceId,
      parentId: item.entry.parentId,
      storageValue: storage,
      versionNumber: item.nextVersionNumber ?? item.entry.versionNumber + 1,
      message: options.message,
      minorEdit: options.minorEdit
    });

    await refreshPageState({
      root: options.root,
      entry: item.entry,
      versionNumber: updated.version.number,
      markdown,
      storage
    });
  }

  for (const item of plan.attachments) {
    const bytes = await fs.readFile(fromPosixPath(options.root, item.filePath));
    await options.client.uploadAttachment({
      pageId: item.page.id,
      fileName: item.title,
      data: bytes,
      comment: options.message,
      minorEdit: options.minorEdit
    });
  }

  const pagesWithAttachmentUpdates = new Map(plan.attachments.map((item) => [item.page.id, item.page]));
  for (const page of pagesWithAttachmentUpdates.values()) {
    await refreshAttachmentState({
      root: options.root,
      client: options.client,
      page
    });
  }

  return plan;
}

async function planAttachmentPush(
  options: PushOptions,
  changes: LocalAttachmentChange[]
): Promise<AttachmentPushPlanItem[]> {
  if (options.remoteCheck && changes.length > 0 && !options.client) {
    throw new CliError("Remote attachment check requires Confluence credentials.");
  }

  const items: AttachmentPushPlanItem[] = [];
  const remoteAttachmentsByPage = new Map<string, Map<string, number>>();

  for (const change of changes) {
    if (options.remoteCheck && change.kind === "modified") {
      const remoteByTitle = await getRemoteAttachmentVersions(options.client!, remoteAttachmentsByPage, change.page.id);
      const remoteVersion = remoteByTitle.get(change.title);
      const localVersion = change.attachment?.versionNumber;

      if (remoteVersion !== undefined && localVersion !== undefined && remoteVersion !== localVersion && !options.force) {
        throw new CliError(
          `Remote attachment changed since pull: ${change.title} on ${change.page.title} is at version ${remoteVersion}, local base is ${localVersion}. Pull again or use --force.`
        );
      }
    }

    const currentManifest = await readPageAttachmentManifest(options.root, change.page);
    const known = currentManifest.attachments.find((attachment) => attachment.fileName === change.fileName);
    items.push({
      page: change.page,
      attachment: known,
      title: known?.title ?? change.title,
      fileName: change.fileName,
      filePath: change.filePath,
      kind: change.kind
    });
  }

  return items;
}

async function getRemoteAttachmentVersions(
  client: ConfluenceGateway,
  cache: Map<string, Map<string, number>>,
  pageId: string
): Promise<Map<string, number>> {
  const cached = cache.get(pageId);
  if (cached) {
    return cached;
  }

  const remote = await client.listPageAttachments(pageId);
  const byTitle = new Map(remote.map((attachment) => [attachment.title, attachment.version.number]));
  cache.set(pageId, byTitle);
  return byTitle;
}

function resolveSource(
  change: LocalPageChange,
  requestedSource: PushSource,
  allowLossy: boolean
): Exclude<PushSource, "auto"> {
  if (requestedSource !== "auto") {
    validateSource(change, requestedSource, allowLossy);
    return requestedSource;
  }

  if (change.markdownChanged && change.storageChanged) {
    throw new CliError(
      `Both page.md and page.storage.html changed for ${change.entry.title}. Re-run push with --source markdown or --source storage.`
    );
  }

  if (change.storageChanged) {
    return "storage";
  }

  validateSource(change, "markdown", allowLossy);
  return "markdown";
}

function validateSource(change: LocalPageChange, source: Exclude<PushSource, "auto">, allowLossy: boolean): void {
  if (source === "markdown" && change.entry.lossyConversionRisk && !allowLossy) {
    throw new CliError(
      `${change.entry.title} contains Confluence macro/storage markup. Refusing Markdown push because it may be lossy. Edit page.storage.html, use --source storage, or pass --allow-lossy.`
    );
  }
}
