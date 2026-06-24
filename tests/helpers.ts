import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ConfluenceGateway } from "../src/confluenceClient.js";
import type { ChildPage, ConfluenceAttachment, ConfluencePage } from "../src/types.js";

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
  readonly createdPages: Array<{
    title: string;
    spaceId: string;
    parentId?: string;
    storageValue: string;
  }> = [];
  readonly attachmentUploads: Array<{
    pageId: string;
    fileName: string;
    data: Uint8Array;
    comment?: string;
    minorEdit?: boolean;
  }> = [];

  constructor(
    private readonly pages: Record<string, ConfluencePage>,
    private readonly children: Record<string, ChildPage[]> = {},
    private readonly attachments: Record<string, ConfluenceAttachment[]> = {},
    private readonly attachmentBytes: Record<string, Uint8Array> = {}
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

  async listPageAttachments(pageId: string): Promise<ConfluenceAttachment[]> {
    return this.attachments[pageId] ?? [];
  }

  async downloadAttachment(attachment: ConfluenceAttachment): Promise<Uint8Array> {
    const bytes = this.attachmentBytes[attachment.id];
    if (!bytes) {
      throw new Error(`Missing fake attachment bytes ${attachment.id}`);
    }
    return bytes;
  }

  async uploadAttachment(input: {
    pageId: string;
    fileName: string;
    data: Uint8Array;
    comment?: string;
    minorEdit?: boolean;
  }): Promise<void> {
    this.attachmentUploads.push(input);
    const current = this.attachments[input.pageId] ?? [];
    const existing = current.find((attachment) => attachment.title === input.fileName);
    const id = existing?.id ?? `att-${input.fileName}`;
    const versionNumber = (existing?.version.number ?? 0) + 1;
    const updated: ConfluenceAttachment = {
      id,
      pageId: input.pageId,
      title: input.fileName,
      status: "current",
      fileSize: input.data.byteLength,
      comment: input.comment,
      downloadLink: `/download/${id}`,
      version: { number: versionNumber }
    };
    this.attachments[input.pageId] = [...current.filter((attachment) => attachment.title !== input.fileName), updated];
    this.attachmentBytes[id] = input.data;
  }

  async createPage(input: {
    title: string;
    spaceId: string;
    parentId?: string;
    storageValue: string;
  }): Promise<ConfluencePage> {
    this.createdPages.push(input);
    const id = String(1000 + this.createdPages.length);
    const created = makePage({
      id,
      title: input.title,
      spaceId: input.spaceId,
      parentId: input.parentId,
      storage: input.storageValue,
      version: { number: 1 }
    });
    this.pages[id] = created;
    return created;
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
