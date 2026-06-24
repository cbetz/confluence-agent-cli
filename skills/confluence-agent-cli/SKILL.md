# Confluence Agent CLI

Use this skill when the user asks you to edit, audit, update, summarize, or maintain Confluence pages through this repository's `conf` CLI.

## Workflow

1. Inspect local state first:

   ```bash
   conf status --dir wiki
   conf diff --dir wiki
   ```

   If no local `wiki/` folder exists yet, pull by page URL when available:

   ```bash
   conf doctor "https://example.atlassian.net/wiki/spaces/ENG/pages/123456/Runbook"
   conf pull "https://example.atlassian.net/wiki/spaces/ENG/pages/123456/Runbook" --out wiki --depth 3
   ```

2. Edit `page.md` for ordinary content changes.

3. If `meta.json` has `"lossyConversionRisk": true`, prefer editing `page.storage.html` instead of `page.md` unless the user explicitly accepts a lossy Markdown rewrite.

4. Before pushing, always run:

   ```bash
   conf diff --dir wiki
   conf push --dir wiki --dry-run
   ```

5. Push only after the dry run looks correct:

   ```bash
   conf push --dir wiki --message "Describe the change"
   ```

## Rules

- Do not edit files under `wiki/.confagent/` directly.
- Do not pass `--force` unless the user explicitly accepts overwriting remote changes.
- Do not pass `--allow-lossy` unless the user explicitly accepts possible Confluence macro/storage loss.
- If both `page.md` and `page.storage.html` changed for a page, choose one source deliberately with `--source markdown` or `--source storage`.
- Treat `page.storage.html` as Confluence storage markup, not normal browser HTML.
