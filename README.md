# Confluence Agent CLI

Git-like Confluence pull/diff/push workflow for coding agents.

The goal is simple: turn Confluence pages into local files an agent can inspect, edit, diff, and push back without using the browser editor.

```bash
npm install -g confluence-agent-cli

conf init --base-url https://example.atlassian.net --email you@example.com
export CONFLUENCE_API_TOKEN=...

conf doctor https://example.atlassian.net/wiki/spaces/ENG/pages/123456/Runbook
conf pull https://example.atlassian.net/wiki/spaces/ENG/pages/123456/Runbook --out wiki --depth 2
conf status --dir wiki
conf diff --dir wiki
conf push --dir wiki --dry-run
conf push --dir wiki --message "Update runbook from agent"
```

## Why this exists

Agents are good at editing files. Confluence is not a file system.

This CLI creates a local page tree:

```text
wiki/
  .confagent/
    manifest.json
    originals/
  api-runbook-123456/
    page.md
    page.storage.html
    meta.json
```

Agents usually edit `page.md`. If a page contains Confluence macro or namespaced storage markup, the CLI marks it as a lossy conversion risk and refuses Markdown-based pushes by default. In those cases, edit `page.storage.html` or pass `--allow-lossy` deliberately.

## Commands

### `conf init`

Writes `.confagent/config.yaml`.

```bash
conf init --base-url https://example.atlassian.net --email you@example.com
```

Credentials are read from the environment:

- `CONFLUENCE_API_TOKEN` with `CONFLUENCE_EMAIL` or the configured email
- `CONFLUENCE_BEARER_TOKEN` for OAuth-style bearer auth

### `conf pull <page-id-or-url>`

Pulls the root page and child pages.

```bash
conf pull 123456 --out wiki --depth 3
conf pull https://example.atlassian.net/wiki/spaces/ENG/pages/123456/Runbook --out wiki --depth 3
```

`--depth 0` pulls only the root page.

If you pass a full Confluence page URL, the CLI extracts both the page ID and base URL. That means first-time users can skip `conf init` when `CONFLUENCE_EMAIL` and `CONFLUENCE_API_TOKEN` are set.

### `conf doctor [page-id-or-url]`

Checks local auth configuration and optional live page access.

```bash
conf doctor
conf doctor 123456
conf doctor https://example.atlassian.net/wiki/spaces/ENG/pages/123456/Runbook
```

The command prints the base URL and auth mode. When a page is provided, it verifies live access by fetching that page and printing its title/version.

### `conf status`

Shows changed pulled pages.

```bash
conf status --dir wiki
```

### `conf diff`

Prints unified diffs against the last pulled/pushed state.

```bash
conf diff --dir wiki
```

### `conf push`

Pushes local changes back to Confluence.

```bash
conf push --dir wiki --dry-run
conf push --dir wiki --message "Refresh deployment checklist"
```

Push behavior:

- Checks the live Confluence version before writing.
- Refuses to overwrite remote edits unless `--force` is passed.
- Chooses `page.md` when only Markdown changed.
- Chooses `page.storage.html` when only storage changed.
- Refuses when both changed unless `--source markdown` or `--source storage` is provided.
- Refuses lossy Markdown pushes unless `--allow-lossy` is provided.

## Install For Local Development

For normal use:

```bash
npm install -g confluence-agent-cli
conf --help
```

Or run without a global install:

```bash
npx confluence-agent-cli --help
```

For local development:

```bash
npm install
npm run build
npm link
```

Then run:

```bash
conf --help
```

Copy `.env.example` if you want a local env file, then source it before running the CLI:

```bash
cp .env.example .env
set -a
source .env
set +a
```

## Current Scope

Implemented:

- Pull Confluence page trees through the Confluence Cloud REST API v2.
- Pull by pasted Confluence page URL or numeric page ID.
- Verify auth and page access with `conf doctor`.
- Write local Markdown, raw storage HTML, metadata, manifest, and original snapshots.
- Show local status and unified diffs.
- Push Markdown or storage edits with optimistic version checks.
- Provide a small agent skill in `skills/confluence-agent-cli/SKILL.md`.

Not implemented yet:

- Creating new Confluence pages.
- Deleting pages.
- Attachment download/upload.
- Label sync.
- Comment sync.
- OAuth device flow.

## API Notes

The first version uses Confluence Cloud REST API v2 page endpoints:

- [Get page by ID and update page](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-page/)
- [Get child pages](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-children/)

Confluence storage format is XHTML-like, and Markdown conversion can be lossy for macros or rich Confluence-specific elements. The raw `page.storage.html` file is included for that reason.
