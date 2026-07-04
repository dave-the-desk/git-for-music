# DAW Editor

This note covers the DAW editor feature across the browser app and server package.

## Read First

- [docs/architecture/codebase-architecture.md](../architecture/codebase-architecture.md)
- [docs/architecture/daw-realtime-sync.md](../architecture/daw-realtime-sync.md)
- [src/app/lib/daw/README.md](../../src/app/lib/daw/README.md)

## Browser Side

- `src/app/pages/groups/demo/components/daw/` holds the UI composition for the editor.
- `src/app/lib/daw/engine/` contains playback, ingest, project sync, local cache, and waveform cache engines.
- `src/app/lib/daw/state/` contains local project state, reducers, selectors, and queue state.
- `src/app/lib/daw/utils/` contains pure timing and segment helpers.
- `src/app/lib/daw/rendering/` contains rendering helpers.

## Server Side

- `packages/server/app/lib/daw/protocol/` defines shared command and event contracts.
- `packages/server/app/lib/daw/server/commands/` handles demo, track, segment, and version mutations.
- [packages/server/app/lib/daw/server/snapshot-builder.ts](../../packages/server/app/lib/daw/server/snapshot-builder.ts) prepares bootstrap and replay payloads.
- [packages/server/app/lib/daw/server/realtime-gateway.ts](../../packages/server/app/lib/daw/server/realtime-gateway.ts) broadcasts accepted operations and presence.
- [packages/server/app/lib/daw/server/versioning.ts](../../packages/server/app/lib/daw/server/versioning.ts) manages version branching and checkout behavior.

## Shared Contracts

- [packages/shared/src/protocol/index.ts](../../packages/shared/src/protocol/index.ts) and [packages/shared/src/index.ts](../../packages/shared/src/index.ts) hold the shared payload and enum types.
- [packages/db/prisma/schema.prisma](../../packages/db/prisma/schema.prisma) defines the durable DAW entities and their relationships.

## Working Rule

The editor should render from live `LocalProjectState`, not stale props. Use the existing DAW sync docs before changing how bootstrap, accepted operations, or reconnect behavior work.
