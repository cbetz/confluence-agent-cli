import path from "node:path";

export const STATE_DIR = ".confagent";
export const ORIGINALS_DIR = "originals";

export function toPosixPath(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}

export function fromPosixPath(root: string, value: string): string {
  return path.join(root, ...value.split(path.posix.sep));
}

export function slugify(input: string): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);

  return slug.length > 0 ? slug : "page";
}

export function pageFolderName(title: string, id: string): string {
  return `${slugify(title)}-${id}`;
}

export function attachmentFileName(title: string): string {
  const cleaned = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 120);

  return cleaned.length > 0 ? cleaned : "attachment";
}

export function originalMarkdownPath(root: string, id: string): string {
  return path.join(root, STATE_DIR, ORIGINALS_DIR, `${id}.md`);
}

export function originalStoragePath(root: string, id: string): string {
  return path.join(root, STATE_DIR, ORIGINALS_DIR, `${id}.storage.html`);
}

export function originalAttachmentPath(root: string, pageId: string, fileName: string): string {
  return path.join(root, STATE_DIR, ORIGINALS_DIR, "attachments", pageId, fileName);
}

export function manifestPath(root: string): string {
  return path.join(root, STATE_DIR, "manifest.json");
}
