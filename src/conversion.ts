import { marked } from "marked";
import TurndownService from "turndown";

const confluenceRichMarkupPattern = /<(ac|ri):[a-zA-Z0-9-]+[\s>]/;

export function hasLossyConversionRisk(storageHtml: string): boolean {
  return confluenceRichMarkupPattern.test(storageHtml);
}

export function storageToMarkdown(storageHtml: string): string {
  const service = new TurndownService({
    codeBlockStyle: "fenced",
    headingStyle: "atx",
    bulletListMarker: "-"
  });

  const keep = service.keep.bind(service) as (filter: string[]) => void;
  keep([
    "ac:structured-macro",
    "ac:parameter",
    "ac:plain-text-body",
    "ac:rich-text-body",
    "ri:attachment",
    "ri:url",
    "ri:page"
  ]);

  const markdown = service.turndown(storageHtml);
  return `${markdown.trim()}\n`;
}

export function markdownToStorage(markdown: string): string {
  const html = marked.parse(markdown, {
    async: false,
    gfm: true
  });

  if (typeof html !== "string") {
    throw new Error("Markdown rendering unexpectedly returned a Promise.");
  }

  return html.trim();
}
