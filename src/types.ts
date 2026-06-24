export type AuthConfig = {
  baseUrl: string;
  email?: string;
  apiToken?: string;
  bearerToken?: string;
};

export type ProjectConfig = {
  baseUrl: string;
  email?: string;
};

export type ConfluencePage = {
  id: string;
  status: string;
  title: string;
  spaceId: string;
  parentId?: string;
  version: {
    number: number;
    message?: string;
    minorEdit?: boolean;
    createdAt?: string;
  };
  body: {
    storage?: {
      value?: string;
      representation?: string;
    };
  };
};

export type ChildPage = {
  id: string;
  title: string;
  status: string;
  spaceId: string;
  childPosition?: number;
};

export type ConfluenceAttachment = {
  id: string;
  status: string;
  title: string;
  pageId?: string;
  mediaType?: string;
  comment?: string;
  fileSize?: number;
  downloadLink?: string;
  webuiLink?: string;
  version: {
    number: number;
    message?: string;
    minorEdit?: boolean;
    createdAt?: string;
  };
  _links?: {
    download?: string;
    webui?: string;
  };
};

export type AttachmentManifestEntry = {
  id?: string;
  pageId: string;
  title: string;
  fileName: string;
  filePath: string;
  mediaType?: string;
  comment?: string;
  fileSize?: number;
  versionNumber?: number;
  downloadLink?: string;
  webuiLink?: string;
  lastPulledSha256: string;
  pulledAt: string;
};

export type PageAttachmentManifest = {
  schemaVersion: 1;
  pageId: string;
  attachments: AttachmentManifestEntry[];
};

export type PageManifestEntry = {
  id: string;
  title: string;
  folderPath: string;
  markdownPath: string;
  storagePath: string;
  metaPath: string;
  attachmentsPath?: string;
  attachmentsMetaPath?: string;
  spaceId: string;
  parentId?: string;
  versionNumber: number;
  lastPulledMarkdownSha256: string;
  lastPulledStorageSha256: string;
  lossyConversionRisk: boolean;
  pulledAt: string;
};

export type PullManifest = {
  schemaVersion: 1;
  baseUrl: string;
  rootPageId: string;
  pulledAt: string;
  pages: PageManifestEntry[];
};

export type PageMeta = PageManifestEntry & {
  schemaVersion: 1;
  confluenceUrl: string;
};

export type LocalPageChange = {
  entry: PageManifestEntry;
  markdownChanged: boolean;
  storageChanged: boolean;
  markdownSha256: string;
  storageSha256: string;
};

export type LocalAttachmentChange = {
  page: PageManifestEntry;
  attachment?: AttachmentManifestEntry;
  title: string;
  fileName: string;
  filePath: string;
  sha256: string;
  kind: "new" | "modified";
};

export type LocalChanges = {
  pages: LocalPageChange[];
  attachments: LocalAttachmentChange[];
};

export type PushSource = "auto" | "markdown" | "storage";

export type PushPlanItem = {
  entry: PageManifestEntry;
  source: Exclude<PushSource, "auto">;
  nextVersionNumber?: number;
  remoteVersionNumber?: number;
  warning?: string;
};

export type AttachmentPushPlanItem = {
  page: PageManifestEntry;
  attachment?: AttachmentManifestEntry;
  title: string;
  fileName: string;
  filePath: string;
  kind: "new" | "modified";
};

export type PushPlan = {
  pages: PushPlanItem[];
  attachments: AttachmentPushPlanItem[];
};
