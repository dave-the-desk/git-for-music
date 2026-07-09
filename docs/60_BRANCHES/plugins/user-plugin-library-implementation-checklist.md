# User Plugin Library + Sharing — Implementation Checklist

Actionable, file-referenced build-out of
[user-plugin-library-and-sharing-plan.md](./user-plugin-library-and-sharing-plan.md).
Read that first for the "why", the data model, and the **security constraints**
(Section 3 of the plan — non-negotiable).

**Ground rules (from `AGENTS.md`):** implement in the repo, add/adjust
Jest/Vitest tests, run the relevant checks until green, then refresh the vault
docs and the daily log. Never weaken existing tests. Keep edits minimal and
upstream. This feature is **additive** to the already-built plugin v1.

Legend: `[ ]` todo.

---

## Phase 0 — Confirm the seams (no code)

- [ ] Confirm `PluginMetadata` has no owner/module fields yet — `@/Users/davidriede/PROJECTS/git-for-music/packages/db/prisma/schema.prisma:506-517`.
- [ ] Confirm the bootstrap returns **all** plugin rows — `client.pluginMetadata.findMany` in `@/Users/davidriede/PROJECTS/git-for-music/packages/server/app/lib/daw/server/command-api.ts:2390-2403`.
- [ ] Confirm `DawProjectBootstrapPluginDefinition` has **no** `descriptorUrl` — `@/Users/davidriede/PROJECTS/git-for-music/packages/server/app/lib/daw/protocol/command-api.ts:537-545`.
- [ ] Confirm `loadWamModule` is never called in `DemoDawClient.tsx` (only in tests) — the production load gap to close.
- [ ] Confirm the audio proxy pattern to mirror — `@/Users/davidriede/PROJECTS/git-for-music/src/app/pages/api/daw/track-versions/[trackVersionId]/audio/index.ts`.
- [ ] Confirm the upload signer to reuse — `createAssetUploadTarget` in `@/Users/davidriede/PROJECTS/git-for-music/packages/server/app/lib/daw/server/assets/storage-provider.ts:324`.
- [ ] Record the security model + bundle-format decision in `@/Users/davidriede/PROJECTS/git-for-music/docs/01_PROTOCOLS/architecture-decision-log.md`.

---

## Phase 1 — Data model

- [ ] Extend `PluginMetadata` in `schema.prisma`: `displayName?`, `description?`, `ownerId?` (+ `owner` relation, `onDelete: Cascade`), `visibility` (`PluginVisibility` enum, default `PRIVATE`), `moduleObjectKey?`, `bundlePrefix?`, `bundleKind?` (`PluginBundleKind` enum), `sizeBytes?`, `checksum?`, `updatedAt`.
- [ ] Add `PluginGrant` model (`pluginId`, `demoId`, `grantedById`, `createdAt`, `@@unique([pluginId, demoId])`, `@@index([demoId])`).
- [ ] Add enums `PluginVisibility { PRIVATE PUBLIC }`, `PluginBundleKind { SINGLE_MODULE ZIP_BUNDLE }`.
- [ ] Add back-relations: `User.ownedPlugins`, `User.pluginGrants`, `Demo.pluginGrants`.
- [ ] Generate + write the Prisma migration; keep existing rows valid (`ownerId = null`, `visibility = PUBLIC` for any pre-seeded system plugins).
- [ ] Verify `@git-for-music/db` re-exports the new types.

---

## Phase 2 — Storage keys

- [ ] Add plugin storage-key builders (e.g. `buildPluginModuleObjectKey`, `buildPluginBundlePrefix`) alongside the track builders in `@/Users/davidriede/PROJECTS/git-for-music/packages/server/app/lib/daw/server/storage` (prefix `plugins/{ownerId}/{pluginId}/{version}/...`).
- [ ] Unit-test the key builders (shape, escaping) next to existing storage tests.

---

## Phase 3 — Backend plugin service (`packages/server/app/lib/plugins/`)

- [ ] `createPluginUploadTarget()` + `completePluginUpload()` — sign upload (reuse `storage-provider` signer with the new prefix) and persist `PluginMetadata` for `ownerId = user`. Validate size + allowed bundle kind; reject others.
- [ ] `listUserPlugins(userId)`, `updatePlugin(userId, pluginId, {displayName, description, visibility})`, `deletePlugin(userId, pluginId)` — **owner-only** authorization.
- [ ] `grantPluginToDemo({userId, pluginId, demoId})` / `revokePluginFromDemo(...)` — require the user owns the plugin AND is a member of the demo's project group. Idempotent grant (unique).
- [ ] `listPluginsForDemo(demoId)` — availability query: `visibility = PUBLIC` OR `ownerId = null` OR `PluginGrant(pluginId, demoId)` exists.
- [ ] `assertPluginModuleAccess(userId, pluginId)` — true if the user shares a demo/group with any availability path above (used by the module proxy).
- [ ] Tests: authorization matrix (owner vs non-owner, member vs non-member), availability resolution, idempotent grant, revoke.

---

## Phase 4 — API routes

Thin re-export under `src/app/api/...`, logic under `src/app/pages/api/...`, all session-guarded via `getAuthenticatedUserFromRequest`.

- [ ] `GET/POST /api/plugins` — list my library / create metadata.
- [ ] `POST /api/plugins/sign-upload`, `POST /api/plugins/complete-upload`.
- [ ] `PATCH/DELETE /api/plugins/[pluginId]` — owner-only edit/delete.
- [ ] `GET /api/plugins/[pluginId]/module/[...path]` — **access-gated same-origin proxy** (mirror the audio proxy). MUST: call `assertPluginModuleAccess`; set `Content-Type: text/javascript`, `X-Content-Type-Options: nosniff`, restrictive cache; never expose the raw signed URL.
- [ ] `POST /api/daw/projects/[projectId]/demos/[demoId]/plugin-grants` — grant library plugin or complete a demo-shared upload (auto-grant).
- [ ] `DELETE /api/daw/projects/[projectId]/demos/[demoId]/plugin-grants/[pluginId]` — revoke.
- [ ] Tests: 401 unauth, 403 wrong owner/non-member, 200 happy paths, proxy denies revoked/non-member access.

---

## Phase 5 — Bootstrap + protocol wiring

- [ ] Extend `DawProjectBootstrapPluginDefinition` (`protocol/command-api.ts:537-545`) with `descriptorUrl`, `ownerId`, `visibility`, `description`, `displayName`.
- [ ] Swap the bootstrap query in `server/command-api.ts:2390-2403` to `listPluginsForDemo(demoId)` and set `descriptorUrl = /api/plugins/{id}/module`.
- [ ] Update `serializePluginDefinition` (`server/command-api.ts:375-393`).
- [ ] Update the offline cache record `DawLocalCachePluginDefinitionRecord` and the client `PluginDefinition` type (`DemoDawClient.tsx:232-240`) with the new fields.
- [ ] Tests: snapshot-builder/command-api tests assert only available plugins are returned and `descriptorUrl` is present.

---

## Phase 6 — Close the WAM load-wiring gap (client)

- [ ] In `DemoDawClient.tsx`, before building/rebuilding a track graph, pre-resolve each referenced plugin via `loadWamModule(pluginKey, version, descriptorUrl)` (from `wam-host.ts`) using the bootstrap `descriptorUrl`.
- [ ] Route load failures through the existing `setPluginGraphIssue` channel (non-blocking; fall back to passthrough).
- [ ] Tests: extend engine/sync tests so an added plugin with a resolvable `descriptorUrl` builds a node; an unresolvable one degrades gracefully.

---

## Phase 7 — Account library page (private)

- [ ] Route `/account/plugins`: `src/app/account/plugins/page.tsx` → `src/app/pages/account/plugins/account-plugins-page.tsx`.
- [ ] UI: upload bundle, list owned plugins, edit `displayName`/`description`, toggle visibility, delete. Session-guard + only current user's plugins.
- [ ] Add `/account/plugins` to `@/Users/davidriede/PROJECTS/git-for-music/docs/30_UI/ui-routing.md`.
- [ ] Tests (web Vitest harness): render, upload emits sign→complete, edit + delete call the right endpoints.

---

## Phase 8 — Demo plugins page (in the DAW)

- [ ] Extend the Plugins tab in `DemoDawClient.tsx`:
  - [ ] **Upload here** → sign+complete then auto-grant to this demo.
  - [ ] **Add from my library** → picker → create `PluginGrant`.
  - [ ] Show provenance (shared upload vs granted) + owner revoke control.
  - [ ] Security notice: "Plugins run code in your browser."
- [ ] Refresh collaborators via the workspace SSE lane (`workspace_changed`), not the DAW op stream.
- [ ] Tests: extend `DemoDawClient.interaction.test.tsx` — upload, grant, revoke, and that a newly available plugin appears and can be added to a track.

---

## Phase 9 — Hardening

- [ ] Security review against plan Section 3 (same-origin, access-gated, MIME pinned, size/type validation). No public bucket URLs for modules.
- [ ] Revoke behavior: existing track instances keep state; module proxy denies for users who lost access → passthrough + issue. Add a test.
- [ ] Delete behavior: deleting a library plugin cascades grants; demos degrade gracefully.
- [ ] Enforce JSON-only `parameterSchema`; large bundles by-reference (already the design).

---

## Cross-cutting: tests to keep green

- [ ] `operation-reducer.test.ts`, `project-sync-engine.test.ts`, `wam-host.test.ts`, `DemoDawClient.interaction.test.tsx`.
- [ ] New: plugin-service auth/availability tests, plugin API route tests, module-proxy access tests, storage-key tests.
- [ ] Server command / snapshot-builder tests for the availability-scoped bootstrap.

## Definition of done

- [ ] A user can upload a WAM plugin to their private account library, rename it, and describe it — visible only to them.
- [ ] From a demo, a user can upload a plugin shared with all project members, or grant a library plugin to that demo.
- [ ] Granted/shared plugins appear in the demo's Plugins tab for all members and can be added to tracks and **heard**.
- [ ] Modules load only through the access-gated same-origin proxy; revocation/deletion degrade gracefully.
- [ ] All existing and new tests pass; vault docs (plan + this checklist + `ui-routing`) and the daily log are refreshed.
