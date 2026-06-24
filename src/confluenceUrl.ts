import { CliError } from "./errors.js";

export type ParsedPageReference = {
  pageId: string;
  baseUrl?: string;
};

export function parsePageReference(input: string): ParsedPageReference {
  if (/^\d+$/.test(input)) {
    return { pageId: input };
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new CliError(`Expected a Confluence page ID or URL, got: ${input}`);
  }

  const pageIdFromPath = extractPageIdFromPath(url.pathname);
  const pageId = pageIdFromPath ?? url.searchParams.get("pageId");

  if (!pageId || !/^\d+$/.test(pageId)) {
    throw new CliError(`Could not find a numeric Confluence page ID in URL: ${input}`);
  }

  return {
    pageId,
    baseUrl: `${url.protocol}//${url.host}`
  };
}

function extractPageIdFromPath(pathname: string): string | undefined {
  const parts = pathname.split("/").filter(Boolean);

  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index] === "pages" && parts[index + 1] && /^\d+$/.test(parts[index + 1]!)) {
      return parts[index + 1];
    }
  }

  return undefined;
}
