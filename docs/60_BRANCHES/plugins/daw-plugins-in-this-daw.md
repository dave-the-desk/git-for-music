# How Audio Plugins Can Work Inside This DAW

Branch-scoped design note for the `plugins` branch. This document maps the plugin
models surveyed in
[daw-plugins-technical-overview.md](./daw-plugins-technical-overview.md) onto the
**actual architecture** of the `git-for-music` DAW, and explains which models fit,
where they plug in, and what already exists versus what must be built.

Read the overview first for the theory (host↔plugin contract, real-time audio
thread, parameters/automation, state serialization, WAM 2.0, HARP 2.0). This note
is about *this* codebase.

---

## 1. What this DAW actually is

Unlike a native C++ DAW that loads VST 3 / AU / AAX binaries from disk, this is a
**web-native, server-backed, realtime-collaborative DAW**:

- **Audio runs in the browser** through the Web Audio API. Playback is driven by
  `AudioPlaybackEngine` in
  [`src/app/lib/daw/engine/playback-engine.ts`](../../../src/app/lib/daw/engine/playback-engine.ts).
- **Every edit is an operation** in an append-only log (`DawOperationType` in
  [`packages/server/app/lib/daw/protocol/command-api.ts`](../../../packages/server/app/lib/daw/protocol/command-api.ts)),
  broadcast to all viewers and periodically checkpointed into snapshots.
- **Versioning is git-like**: operations fork branches and create versions; the
  full project state must round-trip through snapshots and the operation tail.
- **Heavy processing already goes server-side** as asynchronous jobs
  (`TIME_STRETCH`, `TEMPO_ANALYSIS`, etc. in
  [processing jobs](../../architecture/processing-jobs.md)), writing derived outputs
  as new track versions and never mutating the original.

These four facts decide which plugin models are viable and how they attach.

### Consequence: two, not five, plugin models fit

The native binary formats (VST 3, AU, AAX, LV2, CLAP) **cannot load in a browser**
— there is no dynamic-library loader, no filesystem scan, no native ABI. They
remain useful only as *conceptual references* for the internal interface. The two
models from the overview that map directly onto this stack are:

1. **WAM 2.0** — a browser-native, real-time plugin standard built on
   `AudioWorklet`, discovered by URI/descriptor. This is the analog of a
   VST/AU insert.
2. **HARP-style remote processing** — asynchronous, offline, server-side DSP/AI
   that renders a new result rather than processing the live audio thread.

Everything below builds on those two, unified behind one internal interface (the
adapter pattern from Section 3 of the overview).

---

## 2. The existing scaffolding (what is already here)

The repo already contains the *skeleton* of a plugin system. Nothing runs audio
through it yet, but the seams exist:

### 2.1 A real-time insertion point in the playback graph

`AudioPlaybackEngine` builds a per-track bus and **already reserves a slot for a
plugin graph** between the track input and its gain/pan/master chain:

```@/Users/davidriede/PROJECTS/git-for-music/src/app/lib/daw/engine/playback-engine.ts:123-143
  private ensureTrackBus(trackVersionId: string) {
    const existing = this.trackBuses.get(trackVersionId);
    if (existing) return existing;

    const audioContext = this.ensureAudioContext();
    const input = audioContext.createGain();
    const pluginOutput = this.pluginGraphFactory
      ? this.pluginGraphFactory(trackVersionId, input, audioContext)
      : input;
    const gain = audioContext.createGain();
    const pan = audioContext.createStereoPanner();

    pluginOutput.connect(gain);
    gain.connect(pan);
    pan.connect(this.getMasterGain());

    const bus: TrackBus = { input, gain, pan };
    this.trackBuses.set(trackVersionId, bus);
    this.applyTrackMix(trackVersionId);
    return bus;
  }
```

The factory type is the DAW's *own* normalized entry point — the browser
equivalent of a `PluginHostAdapter`:

```@/Users/davidriede/PROJECTS/git-for-music/src/app/lib/daw/engine/playback-engine.ts:38-42
export type PlaybackEnginePluginGraphFactory = (
  trackVersionId: string,
  inputNode: AudioNode,
  audioContext: AudioContext,
) => AudioNode;
```

Current source wires a `pluginGraphFactory` from
[`DemoDawClient.tsx`](../../../src/app/pages/groups/demo/components/daw/DemoDawClient.tsx)
into `new AudioPlaybackEngine({ pluginGraphFactory })`, so track plugin chains
can build live WAM insert graphs. If no plugins are present, or every plugin in
the chain is bypassed/unavailable, the factory returns the input node and audio
passes through untouched.

### 2.2 Plugin metadata already round-trips end to end

- **Database:** `PluginMetadata` in
  [`packages/db/prisma/schema.prisma`](../../../packages/db/prisma/schema.prisma)
  stores `pluginKey`, `name`, display metadata, owner/visibility fields,
  module storage keys, bundle metadata, and a JSON `parameterSchema`, unique on
  `[pluginKey, version]`.
- **Bootstrap:** `DawProjectBootstrapPluginDefinition` and the
  `pluginDefinitions[]` field are returned by the bootstrap endpoint with
  descriptor URLs filtered by demo/user availability.
- **Offline cache:** the local IndexedDB cache has a dedicated
  `pluginDefinitions` store (`DawLocalCachePluginDefinitionRecord` in
  [`daw-local-cache.ts`](../../../src/app/lib/daw/engine/daw-local-cache.ts)).
- **UI:** `DemoDawClient` fetches `pluginDefinitions`, filters them, lists them
  in the **Plugins** browser tab / toolbar tab, and lets users add, reorder,
  bypass, remove, and edit parameters on a selected track's insert chain.

The catalog and instance halves now both exist for browser-side WAM inserts:
plugins can be discovered, added to tracks, stored with versioned track state,
run during playback, and synced/versioned through the DAW operation path.

---

## 3. The unifying idea: one normalized `HostedPlugin` interface

Section 3 of the overview argues that a host must never talk to plugin formats
directly — each format hides behind an adapter that normalizes it to the host's
own interface. This DAW should do exactly the same, with **one** internal
interface that both the WAM (real-time) and HARP (remote) backends implement:

```ts
type PluginBackend = 'wam' | 'remote';

interface HostedPluginInstance {
  instanceId: string;         // unique per track slot
  pluginKey: string;          // -> PluginMetadata.pluginKey
  version: string;
  backend: PluginBackend;

  // Parameter state is host-owned, serializable, diffable.
  getParameters(): PluginParameter[];               // from parameterSchema
  setParameter(id: string, normalizedValue: number): void;

  getState(): JsonValue;      // opaque-ish, but must be JSON for the op log
  setState(state: JsonValue): void;
}
```

- **`getState`/`setState`** map onto the "state must be serializable" duty every
  standard requires (overview Section 2.5). Here the constraint is stronger: the
  state must be **JSON** so it fits the operation-log payloads and snapshots.
- **Parameters are host-owned** (overview Section 2.3). The DAW records parameter
  values as operations and re-applies them on replay, exactly like it already
  does for gain/pan/fades.
- The `backend` discriminator is where the two implementations diverge: `wam`
  produces a live `AudioNode`; `remote` produces a new rendered track version.

The `parameterSchema` JSON already stored on `PluginMetadata` is the source of
truth for `getParameters()` — it defines each control's id, label, range, unit,
and default (the same metadata VST 3's `IEditController` or WAM's
`WamParameterInfo` expose).

---

## 4. Model A — WAM 2.0 as a real-time insert (browser audio thread)

This is the closest analog to a classic VST insert and the natural fit for
effects (EQ, compressor, reverb, delay).

### 4.1 Where it attaches

WAM plugins live behind the `pluginGraphFactory` seam from Section 2.1. A track's
insert chain becomes:

```
track.input (GainNode)
   -> WamNode #1  (AudioWorklet)
   -> WamNode #2
   -> ...
   -> track.gain -> track.pan -> masterGain -> destination
```

The factory, given a `trackVersionId`, looks up that track's ordered insert chain,
instantiates each WAM (`WebAudioModule` -> `WamNode`), chains them
`input -> wam1 -> wam2 -> ... -> return`, and returns the last node's output as the
node the engine connects to `gain`. If a track has no plugins, it returns `input`
unchanged — identical to today's behavior.

### 4.2 Why WAM specifically

Per the overview (Section 5), WAM is the only surveyed standard that is
*web-native*:

- **`AudioWorklet` is the only route to the browser's high-priority audio
  thread** — the same real-time deadline and no-allocation rules from Section 2.1
  apply, just inside `WamProcessor` instead of `processBlock`.
- **URI + JSON descriptor discovery** maps cleanly onto `PluginMetadata`
  (`pluginKey` -> descriptor URL) and the existing `pluginDefinitions` bootstrap
  list. Loading a plugin is a dynamic `import()` of its ES module — no binary
  scanning.
- **`WamGroup`/`WamEnv`** give per-host isolation, which is a natural match for
  isolating each collaborator's or each project's plugin set in a shared session.
- **`WamEvent` sample-accurate scheduling** aligns with how the engine already
  schedules segment gains/fades against `audioContext.currentTime`.

### 4.3 Parameters, automation, and collaboration

- Parameter *definitions* come from `parameterSchema`; parameter *values* are
  host-owned state.
- A user moving a knob emits a `PLUGIN_PARAM_SET` operation (see Section 6),
  which is broadcast so every collaborator's `WamNode` updates, and replayed on
  reload so state is deterministic.
- Full automation curves are a later phase; the first version stores static
  per-instance parameter values, mirroring how the engine currently treats
  gain/pan as scalar mix state rather than curves.

### 4.4 Hard parts (inherited from the overview)

- **No allocation / no blocking on the audio thread.** The adapter must
  instantiate and configure `WamNode`s on the main thread, never inside the render
  callback.
- **Variable block sizes** and latency reporting — a WAM that adds latency should
  report it so future playhead/scheduling code can compensate (the engine does not
  do latency compensation today, so this is a known gap to track).
- **State size.** Because plugin state must be JSON in the op log, large binary
  WAM states (e.g. sampler buffers) need a by-reference strategy (store a blob,
  reference it by key) rather than inlining bytes into every operation.

---

## 5. Model B — HARP-style remote/async processing (server render)

Some processors cannot meet the real-time deadline at all: neural stem
separation, AI mastering, transcription, heavy offline restoration. The overview
(Section 7) shows HARP's answer: **don't run them on the audio thread** — send the
audio to a remote endpoint, process asynchronously, and bring the result back.

### 5.1 This DAW already works this way

The repo's [processing-job pipeline](../../architecture/processing-jobs.md) is *already* a
HARP-shaped system:

- Jobs like `TIME_STRETCH` take an input storage key, run server-side, and write a
  **derived output** into a separate prefix, never mutating the original.
- The derived output becomes a **new track version** — which is exactly the
  git-like, versioned, non-destructive model this DAW is built around.

A remote "plugin" is therefore just a new processing-job type with a
plugin-defined parameter set. Selecting it, filling in `parameterSchema`-driven
controls, and hitting "Render" enqueues a job; when it completes, the realtime
layer broadcasts a new derived track version, and the timeline updates for
everyone — the HARP "request / wait / receive" loop, versioned.

### 5.2 Why this fits better than forcing everything real-time

- Matches the existing **server-backed** architecture and the immutable-original
  rule.
- Produces a **diffable, revertable** artifact (a version), which is the whole
  point of "git for music" — you can compare pre/post-plugin versions and branch
  from either.
- Sidesteps browser CPU limits for heavy models.

The trade-off, exactly as in HARP: it is **not** a live insert. It is a
"bounce/commit" interaction, so it is wrong for things the user expects to tweak
in real time (that is Model A's job).

---

## 6. Persistence, sync, and versioning of plugin state

This is the part with no scaffolding yet, and it is where the "git for music"
identity makes plugins *more* interesting than in a native DAW.

### 6.1 New operation types

Plugin actions must become first-class `DawOperationType`s so they log, broadcast,
snapshot, and replay like every other edit:

- `PLUGIN_ADDED` — insert a plugin instance on a track slot.
- `PLUGIN_REMOVED` — remove an instance.
- `PLUGIN_REORDERED` — change insert-chain order.
- `PLUGIN_PARAM_SET` — set a normalized parameter value.
- `PLUGIN_BYPASS_SET` — toggle bypass.
- `PLUGIN_STATE_SET` — replace opaque JSON state (preset load).

These extend the union in
[`command-api.ts`](../../../packages/server/app/lib/daw/protocol/command-api.ts)
and get reducer cases in
[`operation-reducer.ts`](../../../src/app/lib/daw/state/operation-reducer.ts),
plus the matching server handling in the snapshot builder / command API.

### 6.2 Where instance state lives

Add a per-track-version **insert chain** to the local project state
([`local-project-state.ts`](../../../src/app/lib/daw/state/local-project-state.ts)),
e.g. `DawTrack.plugins: HostedPluginInstanceState[]`, each carrying `instanceId`,
`pluginKey`, `version`, `backend`, `bypassed`, `params`, and optional opaque
`state`. Because it hangs off `trackVersionId`, plugin chains **fork with branches
and revert with versions for free** — the versioning system already copies track
state when branching.

### 6.3 The snapshot/replay contract

State serialization (overview Section 2.5) is non-negotiable here: the plugin
chain must survive a full reload through the operation tail + latest snapshot.
That means:

- Parameter state must be JSON-serializable (no live `AudioNode`s in state).
- The reducer must reconstruct the chain deterministically from operations.
- Large binary state is stored by reference (asset/blob key), not inlined.

---

## 7. End-to-end flow (real-time WAM insert)

1. User opens the **Plugins** tab (already lists `pluginDefinitions`) and drags an
   effect onto a track.
2. Client emits `PLUGIN_ADDED { trackVersionId, pluginKey, version, instanceId }`.
3. Reducer appends the instance to that track's insert chain; the op is
   broadcast + queued for the server; a snapshot checkpoint eventually captures it.
4. The playback engine's `pluginGraphFactory` (now wired in `DemoDawClient`) sees
   the new chain, dynamically imports the WAM module, builds the `WamNode`, and
   rebuilds that track's bus so the node is inserted before `gain`.
5. User moves a knob -> `PLUGIN_PARAM_SET` -> broadcast -> every client's
   `WamNode.setParameterValues(...)` updates -> deterministic on replay.
6. On branch/revert, the chain travels with the version like any other track
   state.

## 8. End-to-end flow (remote/async render)

1. User selects a remote processor, fills `parameterSchema`-driven controls, and
   clicks **Render**.
2. Client enqueues a processing job (new job type) with the track's input storage
   key + parameters.
3. Server processes asynchronously, writes a derived output to a new prefix, and
   commits a new **track version** (`TRACK_VERSION_CREATED`-style flow).
4. Realtime broadcast updates every viewer's timeline; the original is untouched
   and both versions are diffable/branchable.

---

## 9. Summary: fit assessment

| Overview model | Fits this DAW? | How it attaches |
|---|---|---|
| **VST 3 / AU / AAX** | No (native binaries, no browser loader) | Conceptual reference only for the internal interface |
| **LV2 / CLAP** | No (native ABI) | Conceptual reference (extension/negotiation ideas) |
| **JUCE** | N/A (authoring framework, not a host target here) | Informs the adapter/one-abstraction pattern |
| **WAM 2.0** | **Yes** — real-time inserts | `pluginGraphFactory` seam in `AudioPlaybackEngine` |
| **Kronos-style programmable** | Later (could compile FAUST -> WASM WAM) | A special WAM subtype |
| **HARP 2.0 (remote/AI)** | **Yes** — offline/async | New processing-job type -> derived track version |

The DAW's realtime-collaboration + git-like versioning turns the overview's
universal "state must be serializable" duty into the *central* design constraint:
plugin state is just another kind of diffable, broadcastable, branchable project
data.

See the companion
[capability status](./daw-plugins-capability-status.md) for the
concrete, phased build-out.
