import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ConfluenceGateway } from "../src/confluenceClient.js";
import type { ChildPage, ConfluencePage } from "../src/types.js";

export async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "conf-agent-"));
}

export function makePage(input: Partial<ConfluencePage> & { id: string; title: string; storage: string }): ConfluencePage {
  return {
    id: input.id,
    status: input.status ?? "current",
    title: input.title,
    spaceId: input.spaceId ?? "123",
    parentId: input.parentId,
    version: input.version ?? { number: 1 },
    body: {
      storage: {
        value: input.storage,
        representation: "storage"
      }
    }
  };
}

export class FakeConfluenceClient implements ConfluenceGateway {
  readonly baseUrl = "https://example.atlassian.net";
  readonly updates: Array<{
    id: string;
    storageValue: string;
    versionNumber: number;
    message?: string;
    minorEdit?: boolean;
  }> = [];

  constructor(
    private readonly pages: Record<string, ConfluencePage>,
    private readonly children: Record<string, ChildPage[]> = {}
  ) {}

  async getPage(id: string): Promise<ConfluencePage> {
    const page = this.pages[id];
    if (!page) {
      throw new Error(`Missing fake page ${id}`);
    }
    return page;
  }

  async listChildPages(id: string): Promise<ChildPage[]> {
    return this.children[id] ?? [];
  }

  async updatePage(input: {
    id: string;
    storageValue: string;
    versionNumber: number;
    message?: string;
    minorEdit?: boolean;
  }): Promise<ConfluencePage> {
    this.updates.push(input);
    const page = this.pages[input.id];
    if (!page) {
      throw new Error(`Missing fake page ${input.id}`);
    }
    const updated = makePage({
      ...page,
      storage: input.storageValue,
      version: { number: input.versionNumber }
    });
    this.pages[input.id] = updated;
    return updated;
  }

  pageUrl(id: string): string {
    return `${this.baseUrl}/wiki/spaces/-/pages/${id}`;
  }
}
