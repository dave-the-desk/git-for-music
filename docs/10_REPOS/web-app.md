# Web App Repository

Package: `@git-for-music/web`

This is the Next.js app in `src/`. It contains the browser UI, route handlers, and route-local composition modules.

## Read First

- [docs/architecture/codebase-architecture.md](../architecture/codebase-architecture.md)
- [docs/architecture/daw-realtime-sync.md](../architecture/daw-realtime-sync.md)
- [src/app/lib/daw/README.md](../../src/app/lib/daw/README.md)
- [src/package.json](../../src/package.json)

## Important Paths

| Path | Role |
|---|---|
| `src/app/api/` | Thin Next.js route handlers |
| `src/app/pages/api/` | Route implementation modules that many route files re-export |
| `src/app/pages/` | Route-local UI, layouts, and feature composition |
| `src/app/lib/daw/` | Client-side DAW engines, state, rendering, and utilities |
| `src/app/groups/` | Route entrypoints for the groups area |
| `src/app/home/` | Home route entrypoint |
| `src/app/account/` | Account and private plugin-library route entrypoints |
| `src/app/login/` and `src/app/signup/` | Auth route entrypoints |

## Practical Notes

- Keep route files thin.
- Put actual feature logic in `src/app/pages/` or `src/app/lib/daw/`.
- The DAW UI lives under `src/app/pages/groups/demo/components/daw/`.
- Realtime refresh for group and project shells is separate from DAW operation sync.

## Inventory

Use [docs/20_GENERATED_INVENTORIES/src-app-inventory.md](../20_GENERATED_INVENTORIES/src-app-inventory.md) for the current source-file map.
