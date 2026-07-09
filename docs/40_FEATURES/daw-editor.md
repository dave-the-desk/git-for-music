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
- `DawTrack` now carries an ordered `plugins: HostedPluginInstanceState[]` insert chain keyed by `trackVersionId`, so plugin state travels with the track version instead of being global UI-only state.
- `src/app/lib/daw/utils/` contains pure timing and segment helpers.
- `src/app/lib/daw/rendering/` contains rendering helpers.

### Plugin Host Status

- `src/app/lib/daw/engine/wam-host.ts` now owns the browser-side WAM host seam: `loadWamModule(...)` caches dynamic ES-module imports by `pluginKey` + `version`, `createInstance(...)` bootstraps one `WamEnv`/`WamGroup` per `AudioContext`, and `applyParams(...)` / `applyState(...)` configure live nodes on the main thread.
- The host layer now fails fast if it is touched from an `AudioWorklet` render context, and it requires module imports to be pre-resolved before graph construction.
- `createWamPlaybackPluginGraphFactory(...)` builds ordered insert chains from track plugin state, skips bypassed instances, and returns the input node unchanged when no live plugins are present.
- Coverage lives in `src/app/lib/daw/engine/wam-host.test.ts` for module caching, per-context bootstrap reuse, guard rails, and chain-building behavior.
- `AudioPlaybackEngine` now accepts the factory, diffs plugin-chain structure inside `setProject()`, reapplies param/state-only changes without rebuilding the graph, and exposes `rebuildTrackPluginChain(...)`, `setPluginParam(...)`, and `setPluginBypass(...)` for live edits.
- `dispose()` and track removal now tear down live WAM nodes through the bus cleanup path so plugin graphs are disconnected and destroyed instead of being orphaned when playback shuts down or a track disappears.
- Coverage lives in `src/app/lib/daw/engine/playback-engine.test.ts` for param-only updates, chain-shape rebuilds, and teardown behavior on removal/disposal.

### Phase 7 Hardening

- `src/app/lib/daw/engine/project-sync-engine.test.ts` now includes a replay-oriented integration test that restores plugin chains and params from the latest snapshot plus operation tail.
- `src/app/lib/daw/utils/json.ts` enforces JSON-only plugin state at the edit boundary; binary or oversized state should go through `stateBlobKey`.
- `src/app/lib/daw/engine/wam-host.ts` now captures per-instance latency for diagnostics, keeps the chain alive if a plugin fails to load, and warns when chains get heavy or exceed the configured cap.
- The engine still does not compensate plugin latency in playback yet; that remains a known gap.
- `src/app/pages/groups/demo/components/daw/DemoDawClient.tsx` surfaces non-blocking plugin-chain warnings/errors so failed nodes do not silently disappear.

## Server Side

- `packages/server/app/lib/daw/protocol/` defines shared command and event contracts.
- `packages/server/app/lib/daw/server/commands/` handles demo, track, segment, and version mutations.
- [packages/server/app/lib/daw/server/snapshot-builder.ts](../../packages/server/app/lib/daw/server/snapshot-builder.ts) prepares bootstrap and replay payloads.
- [packages/server/app/lib/daw/server/realtime-gateway.ts](../../packages/server/app/lib/daw/server/realtime-gateway.ts) broadcasts accepted operations and presence.
- [packages/server/app/lib/daw/server/versioning.ts](../../packages/server/app/lib/daw/server/versioning.ts) manages version branching and checkout behavior.

## Shared Contracts

- [packages/shared/src/protocol/index.ts](../../packages/shared/src/protocol/index.ts) and [packages/shared/src/index.ts](../../packages/shared/src/index.ts) hold the shared payload and enum types.
- [packages/db/prisma/schema.prisma](../../packages/db/prisma/schema.prisma) defines the durable DAW entities and their relationships.
- Plugin instance state is JSON-first: normalized numeric params live inline, opaque plugin state stays JSON-only, and large binary state is referenced by `stateBlobKey` instead of being embedded in the operation log or snapshot.

## Working Rule

The editor should render from live `LocalProjectState`, not stale props. Use the existing DAW sync docs before changing how bootstrap, accepted operations, or reconnect behavior work.
