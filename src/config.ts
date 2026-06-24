import fs from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { CliError } from "./errors.js";
import type { AuthConfig, ProjectConfig } from "./types.js";

const projectConfigSchema = z.object({
  baseUrl: z.string().url(),
  email: z.string().email().optional()
});

export async function writeProjectConfig(cwd: string, config: ProjectConfig): Promise<string> {
  const dir = path.join(cwd, ".confagent");
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, "config.yaml");
  await fs.writeFile(filePath, stringify(config), "utf8");
  return filePath;
}

export async function loadProjectConfig(cwd: string): Promise<ProjectConfig | undefined> {
  const filePath = await findUp(cwd, path.join(".confagent", "config.yaml"));
  if (!filePath) {
    return undefined;
  }

  const parsed = parse(await fs.readFile(filePath, "utf8"));
  return projectConfigSchema.parse(parsed);
}

export async function loadAuthConfig(cwd: string): Promise<AuthConfig> {
  const projectConfig = await loadProjectConfig(cwd);
  const baseUrl = process.env.CONFLUENCE_BASE_URL ?? projectConfig?.baseUrl;
  const email = process.env.CONFLUENCE_EMAIL ?? projectConfig?.email;
  const apiToken = process.env.CONFLUENCE_API_TOKEN;
  const bearerToken = process.env.CONFLUENCE_BEARER_TOKEN;

  if (!baseUrl) {
    throw new CliError(
      "Missing Confluence base URL. Run `conf init --base-url https://example.atlassian.net --email you@example.com` or set CONFLUENCE_BASE_URL."
    );
  }

  if (!bearerToken && (!email || !apiToken)) {
    throw new CliError(
      "Missing Confluence credentials. Set CONFLUENCE_API_TOKEN with an email, or set CONFLUENCE_BEARER_TOKEN."
    );
  }

  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    email,
    apiToken,
    bearerToken
  };
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

async function findUp(start: string, relativePath: string): Promise<string | undefined> {
  let current = path.resolve(start);

  while (true) {
    const candidate = path.join(current, relativePath);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      const next = path.dirname(current);
      if (next === current) {
        return undefined;
      }
      current = next;
    }
  }
}
