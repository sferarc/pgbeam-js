# pgbeam

## 0.3.10

### Patch Changes

- 19a6caf: feat(approvals): affected-row estimate, target tables, and statement kind on approval requests

## 0.3.9

### Patch Changes

- 642b681: feat(policies): traffic replay, evaluate recorded agent traffic against a candidate policy (API, CLI, dashboard, docs)

## 0.3.8

### Patch Changes

- 0db5320: feat(byoc): self-hosted data-plane packaging + entitlement enrollment
- 18d777f: feat(proxy): region discovery + per-project residency enforcement
- fae176d: Generate the CLI's API-surface commands from the OpenAPI contract so they can no longer drift.

  A new generator (`scripts/src/generate-cli.ts`, wired into `pnpm generate`) reads the same public OpenAPI bundle as the SDK and emits a command manifest; a small hand-written runtime turns each entry into a citty command with contract-derived flags, path parameters, pagination, tables, and detail views. The core resource reads/deletes/actions (projects, databases, agent credentials, policies, branches, custom domains) are now generated; bespoke commands (auth, mcp, env, link, interactive creators, secret rendering) stay hand-authored and compose with the generated leaves.

  Along the way this fixes several CLI bugs by construction: `domains`, `replicas`, `cache-rules`, and `env` are now registered as top-level commands (previously unreachable); `auth status`/`whoami` honor `--token` and the `PGBEAM_API_KEY`/`PGBEAM_TOKEN`/`PGBEAM_API_TOKEN` env vars instead of only the saved profile; boolean flags accept an explicit `true`/`false` value so `--flag false` is no longer silently parsed as true; and the SDK now returns the raw body for non-JSON responses (for example `text/csv`), fixing `pgbeam audit export`.

## 0.3.7

### Patch Changes

- 320102e: feat(policy): enforce standalone max_affected_rows hard write-row cap

## 0.3.6

### Patch Changes

- bb681f4: feat(marketplace): finish Vercel Marketplace integration (billing fix + dashboard + go-live wiring)

## 0.3.5

### Patch Changes

- 615a24f: feat(mcp): compact TS describe, instructions, annotations, per-tool telemetry, and OAuth challenge

## 0.3.4

### Patch Changes

- a369073: feat(dashboard): project-level kill-switch — block all agent connections

## 0.3.3

### Patch Changes

- 602fe55: feat(agent-gateway): PII auto-detection + guided masking (G10a)

## 0.3.2

### Patch Changes

- f2d1f56: feat: add Support Center with bidirectional Slack integration

## 0.3.1

### Patch Changes

- b1d406d: feat(mcp): serve DB MCP under per-project proxy host, drop mcp.pgbeam.app

## 0.3.0

### Minor Changes

- 728a7a5: Add agent credential expiry (`expires_at`). Credentials can now be issued with an
  optional expiry; the field is surfaced on agent credentials and on `credential_expired`
  audit log entries.

## 0.2.9

### Patch Changes

- ed8238a: feat: agent gateway — full roadmap release (v1 + post-v1, agents & humans)

## 0.2.8

### Patch Changes

- 4761ffe: feat: cloud-neutral proxy.pgbeam.app + recover prod deploy (BetterStack monitor)

## 0.2.7

### Patch Changes

- 6ba336f: feat: agent gateway — safe Postgres access for AI agents

## 0.2.6

### Patch Changes

- 46b2b4b: feat: redesign IP filtering with labels, IPv6, and structured CIDR
  input
- bc47c25: Redesign rate limits page: plan-driven limits with slider overrides

## 0.2.5

### Patch Changes

- 7d6e350: feat: auto-generate provider docs and IaC code from OpenAPI spec

## 0.2.4

### Patch Changes

- bbab027: Add comprehensive test coverage across backend and frontend

## 0.2.3

### Patch Changes

- 0115d96: Add IP allowlisting, query timeout, and auto read routing
- 1dfa672: Add MCP (Model Context Protocol) server with Streamable HTTP
  transport

## 0.2.2

### Patch Changes

- 4ddbec1: Remove runtime dependency on @swc/helpers by bumping tsconfig target
  to ES2022

## 0.2.1

### Patch Changes

- 6583d1a: feat: SDK-level retry with idempotency keys

## 0.2.0

### Minor Changes

- 7e3b06b: CLI and SDK installation, publishing, and exposure
  - Rename SDK package to `pgbeam` for npm publishing
  - Set up changesets for automated versioning and releases
  - Add GitHub Actions release workflow (npm publish + CLI S3 upload)
  - Add CLI upgrade notifier with S3 version checking and 24h cache
  - Rewrite CLI install script with cross-platform support
  - Add CLI section to marketing landing page
  - Update docs with install options and MCP server details
  - Add pgbeam-releases S3 bucket to Pulumi IaC
