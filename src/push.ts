import fs from "node:fs/promises";
import { markdownToStorage, storageToMarkdown } from "./conversion.js";
import type { ConfluenceGateway } from "./confluenceClient.js";
import { CliError } from "./errors.js";
import { fromPosixPath } from "./paths.js";
import { listLocalChanges, refreshPageState } from "./workspace.js";
import type { LocalPageChange, PushPlanItem, PushSource } from "./types.js";

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

export async function planPush(options: PushOptions): Promise<PushPlanItem[]> {
  const changes = await listLocalChanges(options.root);
  const items: PushPlanItem[] = [];

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

    items.push({
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

  return items;
}

export async function executePush(options: PushOptions & { client: ConfluenceGateway }): Promise<PushPlanItem[]> {
  const items = await planPush(options);

  for (const item of items) {
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

  return items;
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
