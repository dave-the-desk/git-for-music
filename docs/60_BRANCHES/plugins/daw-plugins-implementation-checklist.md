# Plugin Feature — Implementation Checklist

Branch-scoped, actionable checklist for building audio plugins into the
`git-for-music` DAW. This is the concrete build-out of the design in
[daw-plugins-in-this-daw.md](./daw-plugins-in-this-daw.md); read that first for
the "why". Theory lives in
[daw-plugins-technical-overview.md](./daw-plugins-technical-overview.md).

**Scope of v1:** real-time **WAM 2.0** effect inserts on tracks (Model A), with
host-owned, serializable, collaborative parameter state. Remote/async (HARP-style)
processing is Phase 6 and can be built independently.

**Ground rules (from `AGENTS.md`):** implement in the repo, add/adjust Jest/Vitest
tests, run the relevant checks until green, then refresh the vault docs. Never
weaken existing tests. Keep edits minimal and upstream.

Legend: `[ ]` todo · files are linked relative to this note.

---

## Phase 0 — Confirm the seams (no code)

- [ ] Confirm the unused `pluginGraphFactory` hook still exists and is
  bare-constructed:
  - [`playback-engine.ts`](../../../src/app/lib/daw/engine/playback-engine.ts)
    (`PlaybackEnginePluginGraphFactory`, `ensureTrackBus`).
  - `new AudioPlaybackEngine()` in
    [`DemoDawClient.tsx`](../../../src/app/pages/groups/demo/components/daw/DemoDawClient.tsx)
    (no factory passed today).
- [ ] Confirm the plugin catalog path still round-trips end to end:
  - `PluginMetadata` in
    [`schema.prisma`](../../../packages/db/prisma/schema.prisma).
  - `DawProjectBootstrapPluginDefinition` + `pluginDefinitions[]` in
    [`command-api.ts`](../../../packages/server/app/lib/daw/protocol/command-api.ts).
  - `pluginDefinitions` store in
    [`daw-local-cache.ts`](../../../src/app/lib/daw/engine/daw-local-cache.ts).
  - Read-only **Plugins** tab in `DemoDawClient`.
- [ ] Decide the initial WAM SDK dependency (host runtime + a couple of reference
  effect plugins) and record the decision in
  [`docs/01_PROTOCOLS/architecture-decision-log.md`](../../01_PROTOCOLS/architecture-decision-log.md).

---

## Phase 1 — Data model: plugin instances on a track

Goal: represent an ordered insert chain per `trackVersionId` in state.

- [x] Add a `HostedPluginInstanceState` type and `plugins: HostedPluginInstanceState[]`to `DawTrack` in [`local-project-state.ts`](../../../src/app/lib/daw/state/local-project-state.ts). Fields: `instanceId`, `pluginKey`, `version`, `backend: 'wam' | 'remote'`,`position`, `bypassed`, `params: Record<string, number>` (normalized),optional `state?: JsonValue` (opaque, JSON-only), optional `stateBlobKey?`.
- [x] Mirror the type on the server protocol ([`command-api.ts`](../../../packages/server/app/lib/daw/protocol/command-api.ts)) and in the snapshot/bootstrap shapes so it survives reload.
- [x] Ensure branch/version copy logic carries the plugin chain with the track (verify in the branch-creation path; add a test that a forked version keeps its plugin chain).
- [x] Tests: extend [`operation-reducer.test.ts`](../../../src/app/lib/daw/state/operation-reducer.test.ts)  fixtures to include tracks with plugin chains and assert they survive replay.

---

## Phase 2 — Operations: log, broadcast, replay

Goal: plugin actions become first-class, versioned operations.

- [ ] Extend the `DawOperationType` union in
  [`command-api.ts`](../../../packages/server/app/lib/daw/protocol/command-api.ts)
  with: `PLUGIN_ADDED`, `PLUGIN_REMOVED`, `PLUGIN_REORDERED`,
  `PLUGIN_PARAM_SET`, `PLUGIN_BYPASS_SET`, `PLUGIN_STATE_SET`.
- [ ] Define matching payload interfaces (each carries `trackVersionId` +
  `instanceId`; param op carries `paramId` + normalized `value`).
- [ ] Add reducer cases in
  [`operation-reducer.ts`](../../../src/app/lib/daw/state/operation-reducer.ts)
  for each op (add/remove/reorder/param/bypass/state), keeping the chain ordered
  by `position`.
- [ ] Mirror the same operation types in the server
  [`snapshot-builder.ts`](../../../packages/server/app/lib/daw/server/snapshot-builder.ts)
  `DemoDawOperationType` union and command-API classification sets in
  [`command-api.ts`](../../../packages/server/app/lib/daw/server/command-api.ts):
  - [ ] Add them where timeline-edit / broadcast / auto-version behavior is
    decided (decide: do plugin edits advance head, branch, or auto-version?).
    Default: treat like ordinary edits (broadcast, no forced branch), but
    `PLUGIN_ADDED`/`PLUGIN_REMOVED` may qualify for auto-versioning like
    `TRACK_ADDED`/`TRACK_REMOVED`.
- [ ] Client emit helpers: add methods on the sync/command layer used by
  `DemoDawClient` to emit each op (follow the existing pattern used for
  gain/pan/fade edits).
- [ ] Tests:
  - [ ] Reducer unit tests for every new op (add, param, reorder, remove,
    bypass, state, replay determinism).
  - [ ] Server command/classification tests (broadcast + snapshot inclusion +
    auto-version decision).

---

## Phase 3 — Real-time WAM host adapter (browser)

Goal: turn a `HostedPluginInstanceState` into a live `AudioNode` chain.

- [ ] Create a `wam-host` module under
  [`src/app/lib/daw/engine/`](../../../src/app/lib/daw/engine) (or
  `src/app/lib/daw/plugins/`) with:
  - [ ] `loadWamModule(pluginKey, version, descriptorUrl)` — dynamic `import()` of
    the plugin ES module, cached per key+version (mirror the `bufferCache`
    pattern in `playback-engine.ts`).
  - [ ] `createInstance(audioContext, pluginKey, version)` -> `WamNode`.
  - [ ] `applyParams(node, params)` and `applyState(node, state)`.
  - [ ] A `WamGroup`/`WamEnv` bootstrap once per `AudioContext`.
- [ ] Implement a `PlaybackEnginePluginGraphFactory` that, for a `trackVersionId`:
  - [ ] reads the ordered insert chain from current project state,
  - [ ] builds `input -> wam1 -> wam2 -> ... -> return`,
  - [ ] returns the tail node (or `input` if the chain is empty or all bypassed),
  - [ ] respects `bypassed` (route around the node).
- [ ] Guard rails from the overview Section 2.1 / 3.3:
  - [ ] Instantiate/configure nodes on the main thread only — never in the render
    callback.
  - [ ] Pre-resolve module imports before building the graph.
- [ ] Tests: unit-test the factory's chain-building with a mocked WAM node
  (ordering, bypass, empty chain returns input unchanged).

---

## Phase 4 — Wire the engine + live updates

Goal: connect the adapter to the running engine and keep it in sync.

- [ ] Pass the factory when constructing the engine in
  [`DemoDawClient.tsx`](../../../src/app/pages/groups/demo/components/daw/DemoDawClient.tsx):
  `new AudioPlaybackEngine({ pluginGraphFactory })`.
- [ ] Add engine methods to react to chain changes without a full restart where
  possible:
  - [ ] `rebuildTrackPluginChain(trackVersionId)` — tear down + rebuild that
    track's bus (chain add/remove/reorder).
  - [ ] `setPluginParam(trackVersionId, instanceId, paramId, value)` — live knob
    update via `WamNode.setParameterValues` (no graph rebuild).
  - [ ] `setPluginBypass(...)`.
- [ ] Ensure `setProject` diffs plugin chains and applies the minimal update
  (param-only changes must not glitch playback by rebuilding the graph).
- [ ] Handle disposal: disconnect/`destroy` WAM nodes in `dispose()` and when a
  track bus is removed.
- [ ] Tests: engine tests asserting param updates don't rebuild the graph, and
  chain edits do.

---

## Phase 5 — UI: from read-only list to a working insert chain

Goal: let users add, order, tweak, and bypass plugins.

- [ ] Extend the existing **Plugins** browser tab in `DemoDawClient` so a listed
  plugin can be **added to the selected track** (button or drag), emitting
  `PLUGIN_ADDED`.
- [ ] Add a per-track **insert-chain panel** (rack) showing ordered instances with:
  - [ ] reorder (drag) -> `PLUGIN_REORDERED`,
  - [ ] remove -> `PLUGIN_REMOVED`,
  - [ ] bypass toggle -> `PLUGIN_BYPASS_SET`.
- [ ] Render a **generic parameter editor** driven by `parameterSchema`
  (sliders/toggles from id/label/range/unit/default) that emits `PLUGIN_PARAM_SET`
  on change. (Custom per-plugin GUIs are out of scope for v1 — overview Section
  3.3 point 4: UI and DSP are separable, so a generic editor is sufficient first.)
- [ ] Reflect remote collaborators' plugin edits live (they arrive as broadcast
  operations and flow through the reducer -> engine).
- [ ] Tests: extend
  [`DemoDawClient.interaction.test.tsx`](../../../src/app/pages/groups/demo/components/daw/DemoDawClient.interaction.test.tsx)
  to add a plugin, change a param, reorder, remove, and assert the emitted ops.

---

## Phase 6 — Remote / async processing (HARP-style, optional/independent)

Goal: heavy/AI processors as versioned server renders (Model B). Can ship
separately from Phases 1–5.

- [ ] Add a remote job type to the processing pipeline
  ([`docs/processing-jobs.md`](../../processing-jobs.md)) carrying `pluginKey`,
  `version`, params, `inputStorageKey`, `outputStoragePrefix`.
- [ ] Server: run the model (local worker now; SQS/Fargate later), write derived
  output to a new prefix (never mutate the original), and commit a new **track
  version** via the existing derived-version flow.
- [ ] Broadcast the new version so all viewers' timelines update.
- [ ] UI: a "Render with…" action using the same `parameterSchema` editor, showing
  job status (reuse the existing processing-job status UI).
- [ ] Tests: server render enqueues a job, produces a new version, leaves the
  original intact.

---

## Phase 7 — State durability, latency, and hardening

- [ ] Verify a full **reload** reconstructs plugin chains + params from the
  operation tail + latest snapshot (add an integration/replay test).
- [ ] Enforce **JSON-only** plugin state in the op log; route large binary state
  through an asset/blob key (`stateBlobKey`) instead of inlining bytes.
- [ ] Latency: capture WAM-reported latency per instance; document that the engine
  does **not** yet do plugin-latency compensation and track it as a known gap.
- [ ] Failure handling: a plugin that fails to load must not break playback —
  fall back to `input` passthrough and surface a non-blocking error.
- [ ] Performance: cap concurrent WAM instances / warn on heavy chains.

---

## Cross-cutting: tests to keep green

- [ ] `pnpm` Vitest suites touching:
  - [`operation-reducer.test.ts`](../../../src/app/lib/daw/state/operation-reducer.test.ts)
  - [`project-sync-engine.test.ts`](../../../src/app/lib/daw/engine/project-sync-engine.test.ts)
  - [`DemoDawClient.interaction.test.tsx`](../../../src/app/pages/groups/demo/components/daw/DemoDawClient.interaction.test.tsx)
  - new `wam-host` / factory tests
- [ ] Server command / snapshot-builder tests for the new operation types.

## Definition of done (v1)

- [ ] A user can add a WAM effect to a track, tweak its parameters, reorder,
  bypass, and remove it — and **hear** the effect during playback.
- [ ] Every action is broadcast to collaborators in realtime and applies to their
  playback graph.
- [ ] Plugin chains + parameters survive reload and travel correctly across
  branches/versions.
- [ ] All existing and new tests pass; vault docs (this note + the design note)
  are refreshed to match what shipped.
