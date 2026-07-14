# User Plugin Library and Sharing Capability Status

Source-linked capability record for
[user-plugin-library-and-sharing-plan.md](./user-plugin-library-and-sharing-plan.md).

Status as of 2026-07-14: the core upload, library, grant, and module-proxy path
is implemented. The limitations section distinguishes unimplemented UI and
security work from the shipped data model and API surface.

---

## Shipped

- **Implemented:** `PluginMetadata` has owner, visibility, module object key, bundle metadata,
  checksum, size, and timestamps in `packages/db/prisma/schema.prisma`.
- **Implemented:** `PluginGrant` exists with per-demo uniqueness and indexes.
- **Implemented:** `PluginVisibility { PRIVATE PUBLIC }` and `PluginBundleKind {
  SINGLE_MODULE ZIP_BUNDLE }` exist.
- **Implemented:** User/demo back-relations for owned plugins and grants exist.
- **Implemented:** The plugin-library schema is included in the schema-complete
  `00000000000000_init` migration. The earlier dated migration was intentionally
  superseded when the pre-deployment migration history was repaired.
- **Implemented:** Plugin storage-key builders exist in
  `packages/server/app/lib/daw/server/storage.ts`.
- **Implemented:** Backend plugin service exists in `packages/server/app/lib/plugins/index.ts`
  with upload signing/completion, listing, update, delete, grant, revoke,
  availability, and module-access checks.
- **Implemented:** Plugin service tests exist in
  `packages/server/app/lib/plugins/index.test.ts`.
- **Implemented:** API routes exist for `/api/plugins`, `/api/plugins/sign-upload`,
  `/api/plugins/complete-upload`, `/api/plugins/[pluginId]`, module proxy, and
  demo plugin grants.
- **Implemented:** Module proxy routes are authenticated, access-gated, same-origin, MIME
  pinned, `nosniff`, and no-store.
- **Implemented:** Bootstrap plugin definitions include descriptor URL, owner, visibility,
  description, and display name.
- **Implemented:** Demo bootstrap uses availability-scoped plugin listing through
  `listPluginsForDemo(...)`.
- **Implemented:** `DemoDawClient` preloads WAM modules with `loadWamModule(...)` before
  adding/rebuilding track graphs and reports non-blocking load issues.
- **Implemented:** `/account/plugins` exists and renders the private plugin library page.
- **Implemented:** Account plugin UI supports upload and delete.
- **Implemented:** Demo-side plugin grants exist through API routes and server helpers.
- **Implemented:** Route docs include `/account/plugins`.

## Current Limitations

- **Not implemented:** Account-library edit controls for `displayName`,
  `description`, and `visibility`; the backend PATCH route exists.
- **Not implemented:** A richer demo-side library picker or upload UI beyond
  availability-scoped listing and add-to-track.
- **Not implemented:** PATCH UI coverage because the controls do not yet exist.
- **Not implemented:** A completed security review for uploaded JavaScript execution. Existing module
  responses must not use CSP `sandbox`, because that breaks same-origin dynamic
  import.
- **Not implemented:** ZIP bundle uploads. The schema models them, but
  `createPluginUploadTarget(...)` currently accepts single-module `.js`/`.mjs`
  uploads.

## Verification Pointers

- `packages/server/app/lib/plugins/index.test.ts`
- `src/app/pages/account/plugins/account-plugins-page-client.interaction.test.tsx`
- `src/app/pages/api/plugins/[pluginId]/module/response-headers.test.ts`
- `src/app/pages/groups/demo/components/daw/DemoDawClient.interaction.test.tsx`
