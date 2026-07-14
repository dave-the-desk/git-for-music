# Project Context Router

This workspace is a monorepo centered on a Next.js web app in `src/` with supporting packages in `packages/db`, `packages/server`, and `packages/shared`.

Use this router to decide what to read first:

| Task type | Read first |
|---|---|
| Core product context | [docs/00_MAPS/git-for-music-context-index.md](docs/00_MAPS/git-for-music-context-index.md), [docs/40_FEATURES/product-thesis.md](docs/40_FEATURES/product-thesis.md), [docs/01_PROTOCOLS/ai-start-here.md](docs/01_PROTOCOLS/ai-start-here.md) |
| Implementation guardrails | [docs/01_PROTOCOLS/non-negotiable-rules.md](docs/01_PROTOCOLS/non-negotiable-rules.md), [docs/01_PROTOCOLS/agent-implementation-guide.md](docs/01_PROTOCOLS/agent-implementation-guide.md), [docs/01_PROTOCOLS/architecture-decision-log.md](docs/01_PROTOCOLS/architecture-decision-log.md) |
| Workspace orientation | [docs/00_HOME.md](docs/00_HOME.md), [docs/00_MAPS/workspace-map.md](docs/00_MAPS/workspace-map.md), [docs/20_GENERATED_INVENTORIES/workspace-inventory.md](docs/20_GENERATED_INVENTORIES/workspace-inventory.md) |
| Web app or UI routes | [docs/10_REPOS/web-app.md](docs/10_REPOS/web-app.md), [docs/30_UI/ui-routing.md](docs/30_UI/ui-routing.md), [docs/20_GENERATED_INVENTORIES/src-app-inventory.md](docs/20_GENERATED_INVENTORIES/src-app-inventory.md) |
| DAW editor or realtime sync | [docs/40_FEATURES/daw-editor.md](docs/40_FEATURES/daw-editor.md), [docs/40_FEATURES/workspace-refresh.md](docs/40_FEATURES/workspace-refresh.md), [docs/architecture/codebase-architecture.md](docs/architecture/codebase-architecture.md), [docs/architecture/daw-realtime-sync.md](docs/architecture/daw-realtime-sync.md), [docs/60_BRANCHES/daw-realtime-collab/session-problems-and-solutions.md](docs/60_BRANCHES/daw-realtime-collab/session-problems-and-solutions.md), [src/app/lib/daw/README.md](src/app/lib/daw/README.md) |
| Server or backend logic | [docs/10_REPOS/server.md](docs/10_REPOS/server.md), [docs/20_GENERATED_INVENTORIES/packages-server-inventory.md](docs/20_GENERATED_INVENTORIES/packages-server-inventory.md) |
| Database or schema work | [docs/10_REPOS/db.md](docs/10_REPOS/db.md), [docs/20_GENERATED_INVENTORIES/packages-db-inventory.md](docs/20_GENERATED_INVENTORIES/packages-db-inventory.md), [packages/db/prisma/schema.prisma](packages/db/prisma/schema.prisma) |
| Shared contracts or helpers | [docs/10_REPOS/shared.md](docs/10_REPOS/shared.md), [docs/20_GENERATED_INVENTORIES/packages-shared-inventory.md](docs/20_GENERATED_INVENTORIES/packages-shared-inventory.md) |
| Processing jobs | [docs/40_FEATURES/processing-jobs.md](docs/40_FEATURES/processing-jobs.md), [docs/architecture/processing-jobs.md](docs/architecture/processing-jobs.md), [packages/server/app/lib/processing/index.ts](packages/server/app/lib/processing/index.ts), [packages/server/app/lib/daw/server/jobs/index.ts](packages/server/app/lib/daw/server/jobs/index.ts) |
| Branch-specific context | `docs/60_BRANCHES/` if a task is attached to a branch note |
| Chronological implementation history | `docs/daily-logging/` and the daily log for the work date |

Implementation loop:

1. Read the vault context that matches the task.
2. Make the repo change.
3. Run the relevant Jest tests for the touched area.
4. If tests fail, fix the implementation and rerun Jest until it passes.
5. Update the vault docs and the daily log after the change is complete.

Operational rules:

- Prefer source and repo-local docs over vault notes when they disagree.
- Use generated inventories to locate files quickly, then open the source file or authoritative doc.
- Keep the vault updated when the workspace shape changes.
- Avoid changing repo-local docs unless the human explicitly requests that doc change.
