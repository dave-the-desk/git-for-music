# Server Repository

Package: `@git-for-music/server`

This package owns the server-side domain layer: auth, DAW commands, snapshotting, realtime, processing, and workspace refresh.

## Read First

- [docs/architecture/codebase-architecture.md](../architecture/codebase-architecture.md)
- [docs/architecture/daw-realtime-sync.md](../architecture/daw-realtime-sync.md)
- [packages/server/index.ts](../../packages/server/index.ts)
- [packages/server/package.json](../../packages/server/package.json)

## Important Paths

| Path | Role |
|---|---|
| `packages/server/app/lib/auth/` | Session, password, and user helpers |
| `packages/server/app/lib/daw/protocol/` | Shared DAW command and event contracts |
| `packages/server/app/lib/daw/server/commands/` | Command handlers for demos, tracks, segments, and versions |
| `packages/server/app/lib/daw/server/snapshot-builder.ts` | Bootstrap and replay payload assembly |
| `packages/server/app/lib/daw/server/versioning.ts` | Version branching and checkout helpers |
| `packages/server/app/lib/daw/server/realtime-gateway.ts` | DAW realtime pub/sub |
| `packages/server/app/lib/workspace-realtime.ts` | Workspace refresh pub/sub |
| `packages/server/app/lib/processing/` | Processing queue abstractions |
| `packages/server/app/lib/daw/server/jobs/` | DAW-related processing job orchestration |

## Practical Notes

- `packages/server/index.ts` re-exports auth, DAW protocol, DAW server, and processing modules.
- Test files live next to implementation files in the same package.
- This package is the domain boundary between the web app and durable state.

## Inventory

Use [docs/20_GENERATED_INVENTORIES/packages-server-inventory.md](../20_GENERATED_INVENTORIES/packages-server-inventory.md) for the current source-file map.

