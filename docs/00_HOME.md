# Home

This is the navigation entrypoint for the documentation vault.

## Core Context

These are the first reads for product and implementation sessions:

- [[00_MAPS/git-for-music-context-index]]
- [[01_PROTOCOLS/ai-start-here]]
- [[40_FEATURES/product-thesis]]
- [[01_PROTOCOLS/non-negotiable-rules]]
- [[40_FEATURES/versioning-mental-model]]

## Read First

| If you need... | Read... |
|---|---|
| Workspace orientation | [[00_MAPS/workspace-map]] |
| Operating rules | [[01_PROTOCOLS/operating-protocol]] |
| Web app context | [[10_REPOS/web-app]] |
| Server context | [[10_REPOS/server]] |
| Database context | [[10_REPOS/db]] |
| Shared contracts | [[10_REPOS/shared]] |
| UI routing | [[30_UI/ui-routing]] |
| DAW UI layout | [[30_UI/daw-ui-layout-guide]] |
| DAW editor context | [[40_FEATURES/daw-editor]] |
| Realtime shell refresh | [[40_FEATURES/workspace-refresh]] |
| Processing jobs | [[40_FEATURES/processing-jobs]] |
| Source inventories | [[20_GENERATED_INVENTORIES/README]] |
| Daily progress | `daily-logging/` |

## Authoritative Docs

These repo-local docs are the first things to trust for implementation context:

- [README.md](../README.md)
- [docs/architecture/codebase-architecture.md](architecture/codebase-architecture.md)
- [docs/architecture/daw-realtime-sync.md](architecture/daw-realtime-sync.md)
- [docs/processing-jobs.md](processing-jobs.md)
- [src/app/lib/daw/README.md](../src/app/lib/daw/README.md)

## Workspace Shape

This repo is a monorepo with:

- `src/` for the Next.js app and route-local UI
- `packages/db/` for Prisma schema and the shared Prisma client
- `packages/server/` for auth, DAW domain logic, realtime, and processing
- `packages/shared/` for shared contracts, helpers, and payload shapes
- `docs/` for the context vault and repo-local architecture notes

## When In Doubt

1. Open the matching repo note.
2. Open the generated inventory for the package or subtree.
3. Confirm behavior in source before editing anything.
