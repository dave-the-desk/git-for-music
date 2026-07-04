# Workspace Map

This map is a high-level view of the monorepo. It is meant for fast navigation, not as a replacement for source or repo-local docs.

## Major Areas

| Path | Role | Notes |
|---|---|---|
| `src/` | Next.js web app | UI routes, route handlers, and route-local feature modules live here. |
| `src/app/api/` | Thin route handlers | These files are the Next.js route entrypoints. |
| `src/app/pages/` | Route-local UI and request logic | This is where most page composition and API implementation code lives. |
| `src/app/lib/daw/` | Browser-side DAW code | Engines, state, reducers, hooks, rendering helpers, and pure utilities. |
| `packages/server/` | Server domain layer | Auth, DAW command handling, snapshotting, realtime, storage, and jobs. |
| `packages/db/` | Prisma package | Schema, migrations, client singleton, and Prisma config. |
| `packages/shared/` | Shared contracts | Enums, request and response shapes, storage helpers, and queue helpers. |
| `docs/` | Documentation vault | Navigation notes, inventories, and the existing repo-local docs. |

## Read Path

- Start with [docs/00_MAPS/git-for-music-context-index.md](git-for-music-context-index.md) and [docs/01_PROTOCOLS/ai-start-here.md](../01_PROTOCOLS/ai-start-here.md) for product and agent guardrails.
- Start with [docs/architecture/codebase-architecture.md](../architecture/codebase-architecture.md) for system boundaries.
- Use [docs/architecture/daw-realtime-sync.md](../architecture/daw-realtime-sync.md) for DAW sync behavior.
- Use [docs/processing-jobs.md](../processing-jobs.md) for the current job model.
- Use `docs/20_GENERATED_INVENTORIES/` when you need a quick file location map.

## Main Flows

1. The browser renders the Next.js app in `src/`.
2. UI pages use route-local modules in `src/app/pages/`.
3. DAW client code in `src/app/lib/daw/` drives local state and sync.
4. Server logic in `packages/server/` commits work, emits realtime, and handles jobs.
5. Database state lives in `packages/db/prisma/schema.prisma`.
6. Shared payloads and enums live in `packages/shared/src/`.
