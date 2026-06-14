# pgbeam

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
