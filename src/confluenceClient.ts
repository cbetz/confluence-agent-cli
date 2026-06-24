import { z } from "zod";
import { CliError } from "./errors.js";
import type { AuthConfig, ChildPage, ConfluenceAttachment, ConfluencePage } from "./types.js";

const pageSchema = z.object({
  id: z.coerce.string(),
  status: z.string().default("current"),
  title: z.string(),
  spaceId: z.coerce.string(),
  parentId: z.coerce.string().optional(),
  version: z
    .object({
      number: z.number(),
      message: z.string().optional(),
      minorEdit: z.boolean().optional(),
      createdAt: z.string().optional()
    })
    .default({ number: 1 }),
  body: z
    .object({
      storage: z
        .object({
          value: z.string().optional(),
          representation: z.string().optional()
        })
        .optional()
    })
    .default({})
});

const childPageSchema = z.object({
  id: z.coerce.string(),
  title: z.string(),
  status: z.string().default("current"),
  spaceId: z.coerce.string(),
  childPosition: z.number().optional()
});

const childrenResponseSchema = z.object({
  results: z.array(childPageSchema),
  _links: z
    .object({
      next: z.string().optional()
    })
    .optional()
});

const attachmentSchema = z.object({
  id: z.coerce.string(),
  status: z.string().default("current"),
  title: z.string(),
  pageId: z.coerce.string().optional(),
  mediaType: z.string().optional(),
  comment: z.string().optional(),
  fileSize: z.number().optional(),
  downloadLink: z.string().optional(),
  webuiLink: z.string().optional(),
  version: z
    .object({
      number: z.number(),
      message: z.string().optional(),
      minorEdit: z.boolean().optional(),
      createdAt: z.string().optional()
    })
    .default({ number: 1 }),
  _links: z
    .object({
      download: z.string().optional(),
      webui: z.string().optional()
    })
    .optional()
});

const attachmentsResponseSchema = z.object({
  results: z.array(attachmentSchema),
  _links: z
    .object({
      next: z.string().optional(),
      base: z.string().optional()
    })
    .optional()
});

export interface ConfluenceGateway {
  readonly baseUrl: string;
  getPage(id: string): Promise<ConfluencePage>;
  listChildPages(id: string): Promise<ChildPage[]>;
  listPageAttachments(pageId: string): Promise<ConfluenceAttachment[]>;
  downloadAttachment(attachment: ConfluenceAttachment): Promise<Uint8Array>;
  uploadAttachment(input: {
    pageId: string;
    fileName: string;
    data: Uint8Array;
    comment?: string;
    minorEdit?: boolean;
  }): Promise<void>;
  updatePage(input: {
    id: string;
    title: string;
    status?: string;
    spaceId: string;
    parentId?: string;
    storageValue: string;
    versionNumber: number;
    message?: string;
    minorEdit?: boolean;
  }): Promise<ConfluencePage>;
  pageUrl(id: string): string;
}

export class ConfluenceClient implements ConfluenceGateway {
  constructor(private readonly config: AuthConfig) {}

  get baseUrl(): string {
    return this.config.baseUrl;
  }

  async getPage(id: string): Promise<ConfluencePage> {
    const response = await this.requestJson(
      `/wiki/api/v2/pages/${encodeURIComponent(id)}?body-format=storage&include-version=true`
    );
    const parsed = pageSchema.parse(response);
    if (parsed.body.storage?.value === undefined) {
      throw new CliError(`Page ${id} did not include a storage body. Check page permissions or Confluence API behavior.`);
    }
    return parsed;
  }

  async listChildPages(id: string): Promise<ChildPage[]> {
    const pages: ChildPage[] = [];
    let next: string | undefined = `/wiki/api/v2/pages/${encodeURIComponent(id)}/children?limit=50`;

    while (next) {
      const response = childrenResponseSchema.parse(await this.requestJson(next));
      pages.push(...response.results);
      next = response._links?.next;
    }

    return pages;
  }

  async listPageAttachments(pageId: string): Promise<ConfluenceAttachment[]> {
    const attachments: ConfluenceAttachment[] = [];
    let next: string | undefined = `/wiki/api/v2/pages/${encodeURIComponent(pageId)}/attachments?limit=50`;

    while (next) {
      const response = attachmentsResponseSchema.parse(await this.requestJson(next));
      attachments.push(...response.results);
      next = response._links?.next;
    }

    return attachments;
  }

  async downloadAttachment(attachment: ConfluenceAttachment): Promise<Uint8Array> {
    const downloadLink = attachment.downloadLink ?? attachment._links?.download;
    if (!downloadLink) {
      throw new CliError(`Attachment ${attachment.title} (${attachment.id}) does not include a download link.`);
    }

    return this.requestBytes(downloadLink);
  }

  async uploadAttachment(input: {
    pageId: string;
    fileName: string;
    data: Uint8Array;
    comment?: string;
    minorEdit?: boolean;
  }): Promise<void> {
    const form = new FormData();
    const fileBuffer = new ArrayBuffer(input.data.byteLength);
    new Uint8Array(fileBuffer).set(input.data);
    form.append("file", new Blob([fileBuffer]), input.fileName);

    if (input.comment) {
      form.append("comment", input.comment);
    }

    if (input.minorEdit !== undefined) {
      form.append("minorEdit", String(input.minorEdit));
    }

    await this.requestJson(`/wiki/rest/api/content/${encodeURIComponent(input.pageId)}/child/attachment?status=current`, {
      method: "PUT",
      headers: {
        "X-Atlassian-Token": "nocheck"
      },
      body: form
    });
  }

  async updatePage(input: {
    id: string;
    title: string;
    status?: string;
    spaceId: string;
    parentId?: string;
    storageValue: string;
    versionNumber: number;
    message?: string;
    minorEdit?: boolean;
  }): Promise<ConfluencePage> {
    const body = {
      id: input.id,
      status: input.status ?? "current",
      title: input.title,
      spaceId: input.spaceId,
      parentId: input.parentId,
      body: {
        representation: "storage",
        value: input.storageValue
      },
      version: {
        number: input.versionNumber,
        message: input.message,
        minorEdit: input.minorEdit
      }
    };

    const response = await this.requestJson(`/wiki/api/v2/pages/${encodeURIComponent(input.id)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    return pageSchema.parse(response);
  }

  pageUrl(id: string): string {
    return `${this.config.baseUrl}/wiki/spaces/-/pages/${encodeURIComponent(id)}`;
  }

  private async requestJson(pathOrUrl: string, init: RequestInit = {}): Promise<unknown> {
    const url = this.resolveUrl(pathOrUrl);
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    headers.set("Authorization", this.authHeader());

    const response = await fetch(url, {
      ...init,
      headers
    });

    if (!response.ok) {
      let detail = "";
      try {
        detail = await response.text();
      } catch {
        detail = response.statusText;
      }

      throw new CliError(formatApiError(url, response.status, response.statusText, detail));
    }

    return response.json();
  }

  private async requestBytes(pathOrUrl: string, init: RequestInit = {}): Promise<Uint8Array> {
    const url = this.resolveUrl(pathOrUrl);
    const headers = new Headers(init.headers);
    headers.set("Authorization", this.authHeader());

    const response = await fetch(url, {
      ...init,
      headers
    });

    if (!response.ok) {
      let detail = "";
      try {
        detail = await response.text();
      } catch {
        detail = response.statusText;
      }

      throw new CliError(formatApiError(url, response.status, response.statusText, detail));
    }

    return new Uint8Array(await response.arrayBuffer());
  }

  private resolveUrl(pathOrUrl: string): string {
    if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
      return pathOrUrl;
    }

    if (pathOrUrl.startsWith("/")) {
      if (pathOrUrl.startsWith("/rest/") || pathOrUrl.startsWith("/download/")) {
        return `${this.config.baseUrl}/wiki${pathOrUrl}`;
      }
      return `${this.config.baseUrl}${pathOrUrl}`;
    }

    return `${this.config.baseUrl}/${pathOrUrl}`;
  }

  private authHeader(): string {
    if (this.config.bearerToken) {
      return `Bearer ${this.config.bearerToken}`;
    }

    if (!this.config.email || !this.config.apiToken) {
      throw new CliError("Missing basic auth email or API token.");
    }

    return `Basic ${Buffer.from(`${this.config.email}:${this.config.apiToken}`).toString("base64")}`;
  }
}

function formatApiError(url: string, status: number, statusText: string, detail: string): string {
  const safeDetail = detail.slice(0, 800);

  if (status === 401) {
    return `Confluence authentication failed for ${url}. Check CONFLUENCE_EMAIL and CONFLUENCE_API_TOKEN, or CONFLUENCE_BEARER_TOKEN.`;
  }

  if (status === 403) {
    return `Confluence access denied for ${url}. Check that the account can use Confluence and has access to the requested page. ${safeDetail}`;
  }

  if (status === 404) {
    return `Confluence resource not found for ${url}. The page may not exist, or the account may not have access. ${safeDetail}`;
  }

  return `Confluence API ${status} ${statusText}: ${safeDetail}`;
}
