# User Plugin Uploads, Personal Library, and Per-Demo Sharing — Plan

Branch-scoped design note for the `plugins` branch. This extends the existing
plugin work (real-time WAM inserts, catalog, operations) with **user-uploaded
WAM plugins**, a **personal plugin library**, and **per-demo sharing/grants**.

Read first for context:

- [daw-plugins-in-this-daw.md](./daw-plugins-in-this-daw.md) — how WAM inserts map onto this DAW.
- [daw-plugins-capability-status.md](./daw-plugins-capability-status.md) - the source-linked record of the built v1 (instances, operations, host adapter, and UI).
- [user-plugin-library-capability-status.md](./user-plugin-library-capability-status.md) records shipped library behavior and current limitations.

---

## 1. What the user asked for

Three capabilities, reconciled into one system:

1. **A page inside the DAW to upload WAM plugins that everyone in the project/demo can use.**
2. **An account page (private to the user) — a personal plugin library** where the user can upload plugins, rename them, and add descriptions.
3. **From a DAW/demo page, the user can grant specific personal-library plugins to the other collaborators of that demo.**

So there are two ways a plugin becomes usable in a demo:

- **Demo-shared upload:** uploaded directly in the DAW; immediately usable by every member of that project/demo.
- **Library grant:** owned privately in the account library, then explicitly granted to a specific demo.

## 2. What already exists (verified in source)

| Capability | Status | Evidence |
|---|---|---|
| Plugin catalog model | Exists with owner, visibility, module storage fields, and grants | `PluginMetadata`, `PluginGrant`, `PluginVisibility`, and `PluginBundleKind` in `packages/db/prisma/schema.prisma` |
| Catalog in bootstrap payload | Exists with `descriptorUrl`, owner, visibility, description, and display name | `pluginDefinitions[]` + `DawProjectBootstrapPluginDefinition` in `packages/server/app/lib/daw/protocol/command-api.ts` |
| Catalog served to client | Exists with demo/user availability filtering | `listPluginsForDemo(...)` in `packages/server/app/lib/plugins/index.ts` |
| Real-time WAM host / graph factory | Exists | `@/Users/davidriede/PROJECTS/git-for-music/src/app/lib/daw/engine/wam-host.ts` |
| Plugin instances on tracks + ops (add/remove/param/bypass/state) | Exists | `local-project-state.ts`, `operation-reducer.ts`, protocol `command-api.ts` |
| Plugins tab + add-to-track + param editor + insert-chain controls | Exists | `src/app/pages/groups/demo/components/daw/DemoDawClient.tsx` |
| Signed upload + same-origin module proxy | Exists for plugins | `createPluginUploadTarget(...)`, `completePluginUpload(...)`, and `/api/plugins/[pluginId]/module` |
| Auth + group-membership access checks | Exists | `getAuthenticatedUserFromRequest` in `@git-for-music/server/app/lib/auth/current-user` |

### 2.1 Current remaining gaps

The original module-source, descriptor URL, production `loadWamModule(...)`
wiring, account route, upload, grant, revoke, and module-proxy gaps are now
implemented. Remaining follow-up work is mostly product polish and hardening:

- Account plugin UI supports upload and delete; backend PATCH support exists,
  but richer edit/toggle controls need UI polish.
- The security model still needs continued review as plugin execution remains
  trusted JavaScript in the browser.
- ZIP bundles are modeled but single-module JavaScript plugins are the supported
  upload path today.

## 3. Security — read before building

This is the single most important constraint. **A WAM plugin is an ES module that runs on the main browser thread.** Importing a plugin uploaded by another user is **arbitrary remote code execution in every collaborator's session** (full access to cookies, DOM, the DAW's authenticated fetches).

Non-negotiables for this feature:

- **Same-origin serving only.** Serve uploaded modules through an authenticated same-origin proxy route (mirroring the audio proxy), never a public bucket URL. This keeps auth/access checks server-side and avoids leaking signed URLs.
- **Access-gated `import()`.** The module proxy must verify the requesting user is a member of a group that has access to the plugin (public/system, demo-shared for a demo they belong to, or granted to such a demo).
- **Explicit trust boundary.** A private-library plugin becomes runnable in a demo **only** after an explicit grant by the owner; demo members implicitly trust project-shared uploads by being in the project. Surface this in the UI ("Plugins run code in your browser").
- **Content-Type pinned to `text/javascript`** and `X-Content-Type-Options: nosniff` on the proxy; no HTML/execution ambiguity. Do not add a response CSP `sandbox` directive to module responses, because it breaks same-origin dynamic import.
- **Size/type validation** on upload (allow a bundled `.js`/`.mjs` entry + a `descriptor.json`, or a `.zip` we control the extraction of). Reject anything else.
- Record this decision in [architecture-decision-log.md](../../01_PROTOCOLS/architecture-decision-log.md).

If we cannot meet the same-origin + access-gated bar, this feature should not ship. Consider a future hardening step: sandbox execution in a cross-origin iframe/worker.

## 4. Data model

Extend the existing `PluginMetadata` and add two models. `pluginKey` must be **namespaced per owner** to avoid collisions (e.g. `user:{ownerId}:{slug}`); system/global plugins keep `ownerId = null`.

```prisma
// Extend PluginMetadata
model PluginMetadata {
  id              String   @id @default(cuid())
  pluginKey       String
  name            String              // bundle-declared name
  displayName     String?             // user-editable label (account library)
  description     String?             // user-editable
  version         String
  manufacturer    String?
  parameterSchema Json

  ownerId    String?                  // null => system/global; set => user-owned
  owner      User?    @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  visibility PluginVisibility @default(PRIVATE) // PRIVATE | PUBLIC

  // Module source (uploaded bundle)
  moduleObjectKey String?             // storage key of the ESM entry to import()
  bundlePrefix    String?             // storage prefix for multi-file bundles
  bundleKind      PluginBundleKind?   // SINGLE_MODULE | ZIP_BUNDLE
  sizeBytes       BigInt?
  checksum        String?

  grants     PluginGrant[]
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@unique([pluginKey, version])
  @@index([pluginKey])
  @@index([ownerId])
}

enum PluginVisibility { PRIVATE PUBLIC }
enum PluginBundleKind { SINGLE_MODULE ZIP_BUNDLE }

// Per-demo grant: "this plugin may be used in this demo".
// Covers BOTH library grants and demo-shared uploads (an upload auto-creates a grant).
model PluginGrant {
  id        String   @id @default(cuid())
  plugin    PluginMetadata @relation(fields: [pluginId], references: [id], onDelete: Cascade)
  pluginId  String
  demo      Demo     @relation(fields: [demoId], references: [id], onDelete: Cascade)
  demoId    String
  grantedBy User     @relation(fields: [grantedById], references: [id])
  grantedById String
  createdAt DateTime @default(now())

  @@unique([pluginId, demoId])
  @@index([demoId])
}
```

Add the back-relations on `User` (`ownedPlugins`, `pluginGrants`) and `Demo` (`pluginGrants`).

**Availability resolution for a demo** = `visibility = PUBLIC` OR `ownerId = null` (system) OR a `PluginGrant` exists for `(pluginId, demoId)`. A "demo-shared upload" is just an upload that immediately creates its own `PluginGrant` for that demo.

**Storage keys** (new prefix, parallel to audio):
`plugins/{ownerId}/{pluginId}/{version}/{entry}` — reuse the S3-compatible signer in `storage-provider.ts`; add plugin key builders alongside the track-version builders.

## 5. Backend

### 5.1 New shared/server module: `packages/server/app/lib/plugins/`
- `createPluginUploadTarget()` / `completePluginUpload()` — sign upload + persist `PluginMetadata` (mirrors `assets/` upload flow, new storage prefix).
- `listUserPlugins(userId)`, `updatePlugin()`, `deletePlugin()` (owner-only).
- `grantPluginToDemo()` / `revokePluginFromDemo()` (owner of plugin + member of demo's project).
- `listPluginsForDemo(demoId)` — the availability query above; returns the shape below.
- `assertPluginModuleAccess(userId, pluginId)` — used by the module proxy.

### 5.2 Bootstrap change
Replace the "return all `pluginMetadata`" query in `command-api.ts:2390-2403` with `listPluginsForDemo(demoId)`. Extend `DawProjectBootstrapPluginDefinition` (`command-api.ts:537-545`) with:
- `descriptorUrl: string` — same-origin proxy URL `/api/plugins/{id}/module`.
- `ownerId`, `visibility`, `description`, `displayName`.

### 5.3 API routes (thin re-exports under `src/app/api`, logic under `src/app/pages/api`)
- `GET/POST /api/plugins` — list my library / create metadata.
- `POST /api/plugins/sign-upload`, `POST /api/plugins/complete-upload`.
- `PATCH/DELETE /api/plugins/[pluginId]` — rename/describe/delete (owner-only).
- `GET /api/plugins/[pluginId]/module/[...path]` — **access-gated same-origin module proxy** (Section 3), modeled on the audio proxy route.
- `POST /api/daw/projects/[projectId]/demos/[demoId]/plugin-grants` — grant (library plugin or new demo-shared upload).
- `DELETE /api/daw/projects/[projectId]/demos/[demoId]/plugin-grants/[pluginId]` — revoke.

## 6. Frontend

### 6.1 Account library page (private)
- New route `/account/plugins` → `src/app/account/plugins/page.tsx` re-exporting `src/app/pages/account/plugins/account-plugins-page.tsx`.
- Upload (drag/drop bundle), list owned plugins, edit `displayName`/`description`, delete, toggle visibility. Session-guarded; only shows the current user's plugins.

### 6.2 Demo plugins page (inside the DAW)
- Extend the existing **Plugins** tab in `DemoDawClient.tsx`:
  - **Upload here** → uploads + auto-grants to this demo (usable by all members).
  - **Add from my library** → picker of the user's owned plugins → creates a `PluginGrant` for this demo.
  - Show grant provenance and a revoke control for owners.
- The existing add-to-track / param-editor / rack UI is unchanged; it now consumes the richer `pluginDefinitions`.

### 6.3 Close the load-wiring gap
In `DemoDawClient.tsx`, before building/rebuilding a track's graph, **pre-resolve** every referenced plugin via `loadWamModule(pluginKey, version, descriptorUrl)` using the new `descriptorUrl`, then let `createWamPlaybackPluginGraphFactory` build the chain. Handle load failure with the existing non-blocking issue channel (`setPluginGraphIssue`).

## 7. Versioning / realtime fit

- **Grants and library metadata are catalog state, not project timeline state.** They do **not** create `DemoVersion`/`TrackVersion` and are **not** operation-log entries. Plugin *instances on tracks* remain the versioned artifacts (already built).
- Granting/revoking/uploading should refresh collaborators via the existing **workspace SSE lane** (`workspace-realtime.ts` `workspace_changed`) so the demo's Plugins tab updates without reload — not via the DAW operation stream.
- Revoking a grant does not rewrite history: existing track instances referencing that plugin keep their state, but the module proxy will deny loading for members who lost access (fall back to passthrough + issue). Document this explicitly.

## 8. Feasibility verdict

Verified against source: every required seam exists (upload signer, same-origin proxy pattern, catalog→bootstrap→client path, WAM host, membership auth). The work is **additive**:

- Schema: extend `PluginMetadata` + add `PluginGrant` (+ enums).
- Backend: one new `plugins/` lib, ~6 routes, one bootstrap query swap.
- Frontend: one new account route, Plugins-tab extensions, and the `loadWamModule` wiring that also fixes the current can't-actually-load gap.

The only true risk is **security** (Section 3), which is a design requirement, not a blocker.

## 9. Open decisions (default chosen)

- **Sharing granularity:** per-demo grant (matches "for the demo"). *Default: per-demo.* A future project-wide grant is a superset and easy to add.
- **Bundle format:** single ESM entry + `descriptor.json`, or a controlled `.zip`. *Default: support both via `bundleKind`.*
- **Public marketplace:** `visibility = PUBLIC` is modeled but the UI can defer a public browse experience to later.
