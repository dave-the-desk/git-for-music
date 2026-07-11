# User Plugin Library + Sharing — Implementation Checklist

Actionable, file-referenced build-out of
[user-plugin-library-and-sharing-plan.md](./user-plugin-library-and-sharing-plan.md).

Status as of 2026-07-11: the core upload/library/grant/module-proxy path is
implemented. Remaining unchecked items are follow-up polish or additional
hardening, not source gaps in the data model or API surface.

Legend: `[x]` source-verified shipped · `[ ]` remaining.

---

## Shipped

- [x] `PluginMetadata` has owner, visibility, module object key, bundle metadata,
  checksum, size, and timestamps in `packages/db/prisma/schema.prisma`.
- [x] `PluginGrant` exists with per-demo uniqueness and indexes.
- [x] `PluginVisibility { PRIVATE PUBLIC }` and `PluginBundleKind {
  SINGLE_MODULE ZIP_BUNDLE }` exist.
- [x] User/demo back-relations for owned plugins and grants exist.
- [x] Migration `20260708120000_add_plugin_library_and_grants` exists.
- [x] Plugin storage-key builders exist in
  `packages/server/app/lib/daw/server/storage.ts`.
- [x] Backend plugin service exists in `packages/server/app/lib/plugins/index.ts`
  with upload signing/completion, listing, update, delete, grant, revoke,
  availability, and module-access checks.
- [x] Plugin service tests exist in
  `packages/server/app/lib/plugins/index.test.ts`.
- [x] API routes exist for `/api/plugins`, `/api/plugins/sign-upload`,
  `/api/plugins/complete-upload`, `/api/plugins/[pluginId]`, module proxy, and
  demo plugin grants.
- [x] Module proxy routes are authenticated, access-gated, same-origin, MIME
  pinned, `nosniff`, and no-store.
- [x] Bootstrap plugin definitions include descriptor URL, owner, visibility,
  description, and display name.
- [x] Demo bootstrap uses availability-scoped plugin listing through
  `listPluginsForDemo(...)`.
- [x] `DemoDawClient` preloads WAM modules with `loadWamModule(...)` before
  adding/rebuilding track graphs and reports non-blocking load issues.
- [x] `/account/plugins` exists and renders the private plugin library page.
- [x] Account plugin UI supports upload and delete.
- [x] Demo-side plugin grants exist through API routes and server helpers.
- [x] Route docs include `/account/plugins`.

## Remaining

- [ ] Add account-library edit controls for `displayName`, `description`, and
  `visibility`; the backend PATCH route exists.
- [ ] Add richer demo-side library picker/upload UI if the current Plugins tab
  needs more than availability-scoped plugin listing and add-to-track.
- [ ] Add explicit tests for PATCH UI controls once the UI exists.
- [ ] Continue security review for uploaded JavaScript execution. Existing module
  responses must not use CSP `sandbox`, because that breaks same-origin dynamic
  import.
- [ ] Decide whether/when to support ZIP bundles. The schema models them, but
  `createPluginUploadTarget(...)` currently accepts single-module `.js`/`.mjs`
  uploads.

## Verification Pointers

- `packages/server/app/lib/plugins/index.test.ts`
- `src/app/pages/account/plugins/account-plugins-page-client.interaction.test.tsx`
- `src/app/pages/api/plugins/[pluginId]/module/response-headers.test.ts`
- `src/app/pages/groups/demo/components/daw/DemoDawClient.interaction.test.tsx`
