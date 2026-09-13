# pgbeam

## 0.4.14

### Patch Changes

- a5fbfca: feat(proxy): scan result content on the wire for agent-directed text

## 0.4.13

### Patch Changes

- 3342c65: feat(policy): content_scan_mode and content_scan_max_bytes on the policy profile

## 0.4.12

### Patch Changes

- 3f33063: feat(api): split errors into RFC 9457 problem documents
- 022577d: feat(api): the audit log handed out a cursor with nowhere to put it, so a generated client could not page it at all
- eca3f27: feat(payments): an agent whose query budget runs out can buy more over HTTP 402
- c1fa878: feat(scan): the hostile-text detector was a library nobody could call without running Postgres through us
- 9818ecf: fix(api): a caller could tell whether a project existed in someone else's tenant, and two collections had no bound at all
- 3f33063: fix(sdk,cli): read the API's RFC 9457 problem documents

  `ApiError` now exposes `code`, `type`, `title`, `detail`, `instance`, `requestId` and `errors`, and its `message` comes from the document's `detail` rather than falling through to the status text. Branch on `code`: two conditions can share a status, and a 403 is either a permissions problem or a billing one. The CLI puts the code on the error line, lists field errors under it, and carries both in `--json` output.

## 0.4.11

### Patch Changes

- bd2d132: feat(api): an agent revoking fifty credentials had to make fifty calls
- 58d0ed0: feat(api): every write was last-writer-wins, so an agent's read-modify-write silently discarded whatever landed in between
- 43acb8e: feat(api): publish organization membership endpoints, split out of #2079
- 379b817: feat(webhooks): publish delivery contract and validate event types
- 7a26954: fix(api): a revoked agent credential could be put back to active, and the revoked password worked again
- 8deebf2: fix(ci): the conformance job reported a failure it could not name, on one run in three
- 43acb8e: fix(api): the member API contract claimed two things the server refuses

  `UpdateOrgMemberRoleRequest.role` and `CreateOrgInvitationRequest.role` now use a new `AssignableOrgRole` enum, which is `OrgRole` without `owner`. The server has always rejected `owner` on both paths with a 400, so every generated client, the CLI help and the reference pages were advertising a call that never works. Responses keep the full `OrgRole`, because a member really can be an owner. `role` is also no longer required on an invitation, matching the server, which defaults an absent role to `member`.

  `listOrgMembers` and `listOrgInvitations` now enforce the `page_size` range they declare. They read the query string directly and clamped anything outside 1 to 100 back to the default of 20, so `?page_size=500` was a documented 400 everywhere else in the API and a silent 20 here.

  `listOrgInvitations` now enforces the `status` enum it declares. Anything outside `pending`, `accepted`, `rejected` and `canceled` went to the database as a literal filter and came back as an empty page with a 200, so a caller who mistyped the status was told the organization has no invitations. It is a 400 now, as the contract has always said. `?status=` with no value is also a 400 rather than the unfiltered list; omit the parameter to list everything.

  `removeOrgMember`'s published description said "An owner cannot be removed; demote them first", and the server does neither half of that. It refuses only when the organization is down to its last owner, so removing any other owner returns 204, and demoting the last owner hits the same guard and returns the same 409. The description now says what the guard does: the last remaining owner cannot be removed or demoted, so transfer ownership first, which is the advice the 409 itself gives.

  Go SDK callers: nothing to migrate. `OrgRole` and `AssignableOrgRole` are both new types in `go.pgbeam.com/sdk` as of this release, which is what the minor bump is for.

## 0.4.10

### Patch Changes

- 8b04b38: feat(api): the contract never declared Idempotency-Key, and a reused key with a changed body replayed the wrong response

## 0.4.9

### Patch Changes

- dd2e970: chore(format): reflow prose to one line per paragraph, and let CI see it

## 0.4.8

### Patch Changes

- 6bf2e14: Update the published package description from the pre-pivot pooling-and-caching pitch to the current agent-gateway positioning.

## 0.4.7

### Patch Changes

- d3cce03: chore: release packages

## 0.4.6

### Patch Changes

- d3cce03: chore: release packages

## 0.4.5

### Patch Changes

- d3cce03: chore: release packages

## 0.4.4

### Patch Changes

- eb3390d: feat(usage): break down project usage by agent credential

## 0.4.3

### Patch Changes

- d5149ba: fix(docs): every published README sends readers to a host that serves nothing

## 0.4.2

### Patch Changes

- 89e2f33: Bound a lazy token by the same timeout as the request it authenticates.

  `PgBeamClient` accepts `token` as a function so a client can resolve a fresh JWT per call. That function is a network call of its own, and it was awaited before `fetcher` was entered, so it sat outside every bound this package applies: `timeoutMs`, `RetryConfig.totalBudgetMs`, and the `NetworkError.timedOut` flag callers branch on. An auth endpoint that accepted the request and never answered left the whole call outstanding with no ceiling at all, which no `try`/`catch` in the token function can prevent, because a request that never answers never rejects.

  The token is now resolved inside `fetcher`, under the same per-attempt `timeoutMs` as the request it authenticates, and a stall throws a `NetworkError` with `timedOut` true so existing retry policies keyed on that flag apply unchanged. `timeoutMs: 0` still disables the bound, a token function that rejects still propagates its own error, and the token is still resolved once per call rather than once per retry attempt.

## 0.4.1

### Patch Changes

- 08071bd: fix(openapi): stop describing CreateProjectRequest.database next to a `$ref`

## 0.4.0

### Minor Changes

- 2d6e1ee: Bound every API call with a timeout and a retry budget, and report what failed.

  `fetcher` now aborts an attempt after `timeoutMs` (default 30s, `0` disables it) and stops retrying once `RetryConfig.totalBudgetMs` (default 120s) is spent, so a long backoff ladder against a service that is down cannot outlive the budget. A request that never got an answer throws a `NetworkError` naming the method, URL, attempt count and elapsed time, with the `cause` chain flattened by the new `describeError` export instead of an opaque `TypeError: fetch failed`.

  The Pulumi provider uses a 15s request timeout and a 60s total budget, down from an unbounded ladder that could spend over five minutes before failing. Its generated `read()` now keeps the last known state when the API gave no considered answer (a refused or timed-out connection, or a gateway status), because a refresh that could not observe a resource has not found drift. Anything the API actually answered still fails the run.

## 0.3.14

### Patch Changes

- d78ddfc: feat(crm): org-scoped CRM with a graph-and-loop research agent

## 0.3.13

### Patch Changes

- 19fd607: feat(policies): least-privilege auto-policy recommender from audit traffic (BET-1)

## 0.3.12

### Patch Changes

- 06f9609: feat(cli): first-run golden path. New public `GET /v1/organizations` lists the organizations visible to the caller's credential (an org-scoped `pbo_` key sees exactly its org, a user credential sees memberships with roles). `pgbeam auth login` now verifies the key against the API before storing it (a rejected key fails the login and stores nothing) and resolves the organization automatically, auto-selecting a single org and prompting a pick among several. `orgs list` shows live organizations with the active one marked (falling back to saved profiles offline) and `orgs switch` with no argument lists and picks interactively. `auth status`/`whoami` verify the credential live when online and print the masked key, method, email, and org, degrading gracefully offline; `whoami --help` now shows its own name. Top-level `pgbeam link` and `pgbeam unlink` aliases are registered so every hint that references them works, and the project link is discovered by walking ancestor directories like git. `policies create` gains the write-safety flags `update` already had (`--write-mode`, `--approval-mode`, `--approval-timeout-seconds`, `--approval-auto-max-rows`, `--migration-safety`, `--table-allowlist`, `--table-denylist`). The "No organization set" error now names the exact dashboard location to copy an org ID, the `mcp --help` example shows the real `.mcp.json` stanza, and `agents mcp-config` explains all three ways to supply credentials when input is missing.

## 0.3.11

### Patch Changes

- 31cb990: feat(byoc): self-host enrollment hardening, optional `expires_at` on enrollment create/list and a rotate operation that mints a new `pbh_` token once and atomically invalidates the old one

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

- 728a7a5: Add agent credential expiry (`expires_at`). Credentials can now be issued with an optional expiry; the field is surfaced on agent credentials and on `credential_expired` audit log entries.

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

- 46b2b4b: feat: redesign IP filtering with labels, IPv6, and structured CIDR input
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
- 1dfa672: Add MCP (Model Context Protocol) server with Streamable HTTP transport

## 0.2.2

### Patch Changes

- 4ddbec1: Remove runtime dependency on @swc/helpers by bumping tsconfig target to ES2022

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
