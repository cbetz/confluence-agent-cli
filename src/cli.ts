#!/usr/bin/env node
import { Command, InvalidArgumentError } from "commander";
import { writeProjectConfig, loadAuthConfig } from "./config.js";
import { ConfluenceClient } from "./confluenceClient.js";
import { CliError } from "./errors.js";
import { planPush, executePush } from "./push.js";
import { listLocalChanges, pullPageTree, renderDiff } from "./workspace.js";
import type { PushSource } from "./types.js";

const program = new Command();

program
  .name("conf")
  .description("Git-like Confluence pull/diff/push workflow for agents.")
  .version("0.1.0");

program
  .command("init")
  .description("Create local Confluence CLI config.")
  .requiredOption("--base-url <url>", "Confluence base URL, for example https://example.atlassian.net")
  .option("--email <email>", "Atlassian account email for API token auth")
  .action(async (options: { baseUrl: string; email?: string }) => {
    const filePath = await writeProjectConfig(process.cwd(), {
      baseUrl: options.baseUrl,
      email: options.email
    });
    console.log(`Wrote ${filePath}`);
    console.log("Set CONFLUENCE_API_TOKEN in your shell, or use CONFLUENCE_BEARER_TOKEN.");
  });

program
  .command("pull")
  .description("Pull a Confluence page tree into local agent-editable files.")
  .argument("<page-id>", "Root Confluence page ID")
  .option("--out <dir>", "Output directory", "wiki")
  .option("--depth <n>", "Child page depth to pull", parseNonNegativeInteger, 3)
  .action(async (pageId: string, options: { out: string; depth: number }) => {
    const client = new ConfluenceClient(await loadAuthConfig(process.cwd()));
    const manifest = await pullPageTree({
      client,
      rootPageId: pageId,
      outDir: options.out,
      maxDepth: options.depth
    });
    console.log(`Pulled ${manifest.pages.length} page(s) into ${options.out}`);
  });

program
  .command("status")
  .description("Show locally changed pulled pages.")
  .option("--dir <dir>", "Pulled workspace directory", "wiki")
  .action(async (options: { dir: string }) => {
    const changes = await listLocalChanges(options.dir);
    if (changes.length === 0) {
      console.log("No local changes.");
      return;
    }

    for (const change of changes) {
      const files = [
        change.markdownChanged ? "page.md" : undefined,
        change.storageChanged ? "page.storage.html" : undefined
      ]
        .filter(Boolean)
        .join(", ");
      console.log(`${change.entry.id} ${change.entry.title} (${files})`);
    }
  });

program
  .command("diff")
  .description("Print local changes as unified diffs.")
  .option("--dir <dir>", "Pulled workspace directory", "wiki")
  .action(async (options: { dir: string }) => {
    const diff = await renderDiff(options.dir);
    process.stdout.write(diff || "No local changes.\n");
  });

program
  .command("push")
  .description("Push local page changes back to Confluence.")
  .option("--dir <dir>", "Pulled workspace directory", "wiki")
  .option("--dry-run", "Plan changes without updating Confluence")
  .option("--source <mode>", "auto, markdown, or storage", parsePushSource, "auto")
  .option("--allow-lossy", "Allow Markdown pushes for pages with Confluence macro/storage markup")
  .option("--force", "Allow push when the remote version changed since pull")
  .option("--message <text>", "Confluence version message")
  .option("--minor-edit", "Mark pushed versions as minor edits")
  .option("--no-remote-check", "Skip live version checks before planning")
  .action(
    async (options: {
      dir: string;
      dryRun?: boolean;
      source: PushSource;
      allowLossy?: boolean;
      force?: boolean;
      message?: string;
      minorEdit?: boolean;
      remoteCheck: boolean;
    }) => {
      const client = options.remoteCheck || !options.dryRun ? new ConfluenceClient(await loadAuthConfig(process.cwd())) : undefined;
      const pushOptions = {
        root: options.dir,
        client,
        source: options.source,
        allowLossy: Boolean(options.allowLossy),
        force: Boolean(options.force),
        remoteCheck: options.remoteCheck,
        message: options.message,
        minorEdit: options.minorEdit
      };

      const items = options.dryRun
        ? await planPush(pushOptions)
        : await executePush({ ...pushOptions, client: client ?? new ConfluenceClient(await loadAuthConfig(process.cwd())) });

      if (items.length === 0) {
        console.log("No local changes.");
        return;
      }

      for (const item of items) {
        const versionText = item.nextVersionNumber ? ` -> v${item.nextVersionNumber}` : "";
        console.log(`${options.dryRun ? "Would push" : "Pushed"} ${item.entry.id} ${item.entry.title} from ${item.source}${versionText}`);
        if (item.warning) {
          console.log(`  warning: ${item.warning}`);
        }
      }
    }
  );

program.parseAsync(process.argv).catch((error: unknown) => {
  if (error instanceof CliError) {
    console.error(error.message);
    process.exit(error.exitCode);
  }

  if (error instanceof Error) {
    console.error(error.message);
    process.exit(1);
  }

  console.error(String(error));
  process.exit(1);
});

function parseNonNegativeInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0 || String(parsed) !== value) {
    throw new InvalidArgumentError("Expected a non-negative integer.");
  }
  return parsed;
}

function parsePushSource(value: string): PushSource {
  if (value === "auto" || value === "markdown" || value === "storage") {
    return value;
  }
  throw new InvalidArgumentError("Expected auto, markdown, or storage.");
}
