# Agent Protocol

Start here when you enter this workspace:

1. Read [PROJECT_CONTEXT_ROUTER.md](PROJECT_CONTEXT_ROUTER.md).
2. Read [docs/00_HOME.md](docs/00_HOME.md).
3. Read [docs/00_MAPS/git-for-music-context-index.md](docs/00_MAPS/git-for-music-context-index.md) and [docs/01_PROTOCOLS/ai-start-here.md](docs/01_PROTOCOLS/ai-start-here.md).
4. For the current task, open the matching repo note, feature note, or generated inventory.

Workspace rules:

- Treat repo-local docs as the source of truth when they exist.
- Do not modify repo-local docs unless the human explicitly asks.
- Keep the documentation vault as navigation and context support, not as a replacement for source code or source docs.
- Use generated inventories for file lookup and subtree ownership, then confirm details in source.
- Default execution loop: get context from the vault, implement the change in the repo, run the relevant Jest tests, fix failures until they pass, then refresh the vault docs.
- Read [docs/01_PROTOCOLS/non-negotiable-rules.md](docs/01_PROTOCOLS/non-negotiable-rules.md) and [docs/01_PROTOCOLS/agent-implementation-guide.md](docs/01_PROTOCOLS/agent-implementation-guide.md) before making product or implementation changes.
- Update [docs/daily-logging/2026-06-28.md](docs/daily-logging/2026-06-28.md) after implementation work on this date. Create a new daily log first if the date changes.
- If branch-specific context exists, record it in `docs/60_BRANCHES/` and link it from the daily log.
- When code changes are made, add or update tests, run the relevant checks, refresh any affected inventories, and summarize what changed.

Trust order:

1. Source code.
2. Repo-local docs such as [README.md](README.md), [docs/architecture/codebase-architecture.md](docs/architecture/codebase-architecture.md), [docs/architecture/daw-realtime-sync.md](docs/architecture/daw-realtime-sync.md), [docs/processing-jobs.md](docs/processing-jobs.md), and [src/app/lib/daw/README.md](src/app/lib/daw/README.md).
3. Vault notes under `docs/`.
