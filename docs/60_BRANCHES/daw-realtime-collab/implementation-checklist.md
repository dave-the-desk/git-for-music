# Implementation Checklist: Realtime + Versioning + Tree Tab

Branch: `daw-realtime-collab`

This checklist turns the design in
[realtime-versioning-and-tree](./realtime-versioning-and-tree.md) into concrete
repo changes. It is grounded in the current implementation (see
[Current State](#0-current-state-snapshot)). Check items off as they land; keep
tests green after each phase.

## 0. Current State Snapshot

What already exists (do not rebuild):

- **Version DAG:** `DemoVersion` now carries `parentId`, `isMerge`,
  `createdAt`, `kind`, and `operationSeq` (`packages/db/prisma/schema.prisma`),
  with the merge parent join table in place for future multi-parent history.
- **Per-user checkout:** `DemoUserActiveVersion` (`activeVersionId`,
  `isFollowingHead`); `activeBranchName` is derived, not a column.
- **Durable log:** `ProjectOperationLog` (`operationSeq`, `baseSnapshotId`,
  `baseOperationSeq`, `idempotencyKey`, `clientOperationId`).
- **Replay checkpoints:** `ProjectSnapshot` are JSON replay snapshots at an
  `operationSeq`, created by `shouldCheckpointDemoDawSnapshot` /
  `checkpointDemoDawSnapshot`. These are NOT user-facing version nodes.
- **Branch creation paths** in `commitDawProjectOperation`
  (`packages/server/app/lib/daw/server/command-api.ts`): stale historical base,
  conflict fallback, and per-edit branch for `BRANCH_CREATING_OPERATION_TYPES`
  (currently only `TRACK_RENAMED`, `SEGMENT_TRIMMED`). Explicit branch via
  `/api/versions` -> `createDemoVersionCommand`.
- **Client sync:** `ProjectSyncEngine` optimistic queue + `accepted_operation`
  replay through `operation-reducer.ts`, with timeline edits replayed through
  the same transform/rebase helpers used on the server.
- **Tree tab:** `VersionHistoryTree.tsx` + `version-tree-layout.ts` render the
  live `LocalProjectState.versions` graph with commit-graph row/column layout.
- **Realtime events:** `accepted_operation`, `version_tree_changed`,
  `version_created`, presence, transport, asset, comment
  (`realtime-gateway.ts`). Semantic `head_moved` / `reverted` events are still
  part of the later sync-event phase.

Key gaps vs the design doc:

- Realtime semantic sync events are still narrower than the final event model.
- Processing-jobs alignment still needs the explicit phase-G audit.

---

## Phase A - Version Model Hardening

Goal: make every `DemoVersion` a well-formed commit node with provenance and
merge-ready shape.

- [x] Add a `kind`/`provenance` enum to `DemoVersion` in `packages/db/prisma/schema.prisma` (`AUTO` | `SEMANTIC` | `EXPLICIT` | `REVERT` | `BRANCH` | `MERGE`); default to `EXPLICIT` for back-compat.
- [x] Record the `operationSeq` at which each version was created on `DemoVersion` (new nullable column) so the Tree tab can order without re-deriving from the log.
- [x] Add a forward-compatible merge storage shape: keep the existing single `parentId` as the canonical parent for now, add a `DemoVersionParent` join table (`versionId`, `parentId`, `order`) so multi-parent history can be represented later, and keep `isMerge` in sync with merge nodes. Do not implement merge behavior yet.
- [x] Create the Prisma migration and update `DEMO_VERSION_FIELDS` / `serializeCreatedDemoVersionTreeNode` in `packages/server/app/lib/daw/server/versioning.ts`.
- [x] Thread `kind` through `createDemoVersionWithCopiedTracks` and every call site (`create-version.ts`, `command-api.ts` branch paths).
- [x] Extend `DawVersion` in `src/app/lib/daw/state/local-project-state.ts` and the version tree node types in `packages/shared` with `kind` + `operationSeq`.
- [x] Tests: DAG integrity (every non-root version resolves its parent; no cycles) in `packages/server/app/lib/daw/server/versioning.test.ts`.

## Phase B - Automatic Version Saving (Checkpointing)

Goal: create `DemoVersion` nodes automatically from accepted operations, without
entering the realtime edit transport.

IMPORTANT: Automatic Version Saving in the web app should be implemented by
committing accepted operations first, then creating a checkpoint from the
converged branch head after commit. Do not fork a realtime edit branch for the
autosave path, do not create the version mid-transform, and do not duplicate
audio.

- [x] Define checkpoint policy constants (debounce window + operation-count K) alongside `DEFAULT_SNAPSHOT_CHECKPOINT_TAIL` in `snapshot-builder.ts`.
- [x] Add `shouldCreateAutoVersion(...)` that fires on: N seconds idle after a burst, K accepted ops since last version, or semantic boundaries (track add/remove, segment split/merge, take committed).
- [x] Add a server helper `createAutoDemoVersion(...)` that snapshots the converged branch head into a new `DemoVersion` (`kind = AUTO`/`SEMANTIC`, `parentId` = current head, `operationSeq` = latest accepted) reusing `createDemoVersionWithCopiedTracks`.
- [x] Call it from the accepted-operation path in `commitDawProjectOperation` AFTER the operation is committed (never mid-transform), guarded by the policy. Keep it distinct from `ProjectSnapshot` replay checkpoints.
- [x] Ensure auto-versions never carry audio; only pointers/metadata (verify against `cloneTrackVersionsToDemoVersion`).
- [x] Emit a `version_created` event (see Phase F) so the Tree tab refreshes.
- [x] Decouple/clarify per-edit branching: the current per-edit branch for `TRACK_RENAMED`/`SEGMENT_TRIMMED` should be reconsidered so ordinary edits advance the head and auto-checkpoint, instead of forking a branch each time. Gate behind a flag to avoid regressing existing behavior.
- [x] Tests: given a burst of accepted ops, exactly one auto-version is created after debounce; op-count threshold triggers a checkpoint; audio is never duplicated.

## Phase C - Non-Destructive Revert

Goal: revert-to-version creates a NEW version equal to an ancestor; history is
preserved.

- [x] Add a server command `revertToVersionCommand(...)` (new `packages/server/app/lib/daw/server/commands/revert-version.ts`) that clones the target ancestor's tracks into a new `DemoVersion` (`kind = REVERT`, `parentId` = current branch head).
- [x] Add an API route (e.g. `POST /api/versions/revert`) mirroring `create-version.ts` auth + validation.
- [x] Record a `VERSION_REVERTED_FROM` operation whose payload carries the new version node (like `VERSION_BRANCH_CREATED` does), and update the reducer case in `src/app/lib/daw/state/operation-reducer.ts` to upsert the new version node instead of only moving `currentVersionId`.
- [x] In a live session, commit the revert like any accepted operation so all clients converge; move the branch head and let followers follow, without yanking pinned checkouts (respect `isFollowingHead`).
- [x] Add `revertToVersion(...)` to `ProjectSyncEngine` and wire a "Revert to this version" action in `VersionHistoryTree.tsx` (reuse the existing history-lane / branch-from-point surface).
- [x] Tests: revert produces a new node whose content equals the ancestor; older nodes remain; follow-head vs pinned checkout behavior is correct.

## Phase D - Tree Tab Commit-Graph (DoltHub layout)

Goal: render the version DAG as a real commit graph with topological rows and
column-assigned branches/merges, colored per branch.

- [x] Rework `src/app/pages/groups/demo/components/daw/version-tree-layout.ts`:
  - [x] Build a `childrenMap` from `parentId` (extend `buildTree`); support multiple parents for future merges.
  - [x] Rows = topological order (reuse `compareVersions`: `createdAt`, `operationSeq`, `id`); row index -> y.
  - [x] Columns via a head->root pass: branch head -> new column; branch children -> leftmost child column; merge-only children -> first free column to the right so merge edges point right-to-left.
  - [x] Assign a stable per-branch/column color.
- [x] Update `VersionHistoryTree.tsx` to consume the new layout:
  - [x] Draw dots + parent->child edges from the new node/column positions.
  - [x] Keep existing badges (branch head, my active version, selected, following/pinned) and the per-version history lane.
  - [x] Add "Revert to this version" (Phase C) and keep branch-from-point.
  - [x] Preserve pan/scroll and expand/minimize.
- [x] Ensure the tree renders from live `LocalProjectState.versions`, never stale props (design rule in `docs/architecture/daw-realtime-sync.md`).
- [x] Tests: column assignment for a chain, a fork (two branch children), and a merge (merge child) matches expected columns; layout is deterministic.

## Phase E - OT Convergence (from realtime plan)

Goal: safe concurrent edits converge without an unwanted branch; branching stays
the unsafe-overlap fallback. (Tracks the phased
[realtime collaboration plan](../../papers/realtime-collaboration-plan.md).)

- [x] Add pure transform helpers for the timeline ops in `TIMELINE_EDIT_OPERATION_TYPES` (move, trim, split, merge, fade,  crossfade, rename) under `src/app/lib/daw/state/`.
- [x] Rebase an incoming edit against intervening accepted operations in `commitDawProjectOperation` before finalizing; only fall back to `analyzeDawOperationConflict` branch/409 when a transform cannot preserve intent.
- [x] Replay the optimistic local queue through the same transform logic in `ProjectSyncEngine` so remote accepted ops preserve pending local intent.
- [x] Tests: two safe concurrent edits converge to identical state (reducer + command-api); unsafe overlap still branches/conflicts deterministically; reconnect after concurrent local+remote edits converges on the queue-replay path.

## Phase F - Realtime Events + Reconnect

Goal: make version/branch/revert changes first-class realtime signals.

- [x] Add semantic events in `packages/server/app/lib/daw/server/realtime-gateway.ts`: `version_created`, `branch_created`, `head_moved`, `reverted` (or extend  `version_tree_changed` with a `reason`). Update `DawRealtimeEventType`.
- [x] Emit them from the create/branch/revert/auto-checkpoint paths.
- [x] Handle them in `ProjectSyncEngine` (refresh version tree, animate new node) and confirm `operation-reducer` upserts nodes for the corresponding accepted operations.
- [x] Confirm reconnect (`lastSeenOperationSeq`, `rebootstrapRequired`) replays new version/revert operations and preserves the viewer checkout.
- [x] Tests: reconnect after a remote auto-version/branch/revert shows the new node and keeps the local checkout.

## Phase G - Processing-Jobs Alignment

Goal: keep heavy/derived work out of realtime and version metadata.

- [ ] Confirm version checkpointing is app/server metadata, NOT a processing job (see `docs/processing-jobs.md`).
- [ ] Ensure derived audio jobs remain keyed by `demoVersionId` / `trackVersionId` so each version node can reference derived outputs without entering realtime.
- [ ] Confirm original audio stays immutable; versions/branches add pointers only (verify `cloneTrackVersionsToDemoVersion` copies keys, not blobs).

---

## Definition of Done (mirrors the design doc)

- [ ] Two clients edit the same branch head concurrently and converge without an unwanted branch.
- [ ] Versions are created automatically as work happens and appear in the Tree
      tab without reload.
- [ ] Any version can be reverted to; the revert appears as a new node and older
      nodes remain visible.
- [ ] Branches created off a chosen version live concurrently with `main`, each
      with an independent head.
- [ ] The Tree tab renders the DAG with topological rows and column-assigned
      branches/merges, colored per branch.
- [ ] Audio blobs never enter the realtime transport; derived audio stays in the
      job pipeline keyed by version.

## Primary Files To Touch

| Area | Path |
|---|---|
| Schema | `packages/db/prisma/schema.prisma` |
| Version helpers | `packages/server/app/lib/daw/server/versioning.ts`, `.../versions.ts` |
| Create/branch | `packages/server/app/lib/daw/server/commands/create-version.ts` |
| Revert (new) | `packages/server/app/lib/daw/server/commands/revert-version.ts` |
| Commit path | `packages/server/app/lib/daw/server/command-api.ts` |
| Checkpointing | `packages/server/app/lib/daw/server/snapshot-builder.ts` |
| Conflict rules | `packages/server/app/lib/daw/server/conflict-rules.ts` |
| Realtime events | `packages/server/app/lib/daw/server/realtime-gateway.ts` |
| Client sync | `src/app/lib/daw/engine/project-sync-engine.ts` |
| Reducer/transform | `src/app/lib/daw/state/operation-reducer.ts`, `.../state/*` |
| Local state types | `src/app/lib/daw/state/local-project-state.ts` |
| Tree layout | `src/app/pages/groups/demo/components/daw/version-tree-layout.ts` |
| Tree UI | `src/app/pages/groups/demo/components/daw/VersionHistoryTree.tsx` |
| Shared protocol | `packages/shared/src/protocol/index.ts` |

## Suggested Verification Commands

Tests in this repo are `node:test` files (`*.test.ts` importing `node:test` and
`node:assert/strict`); there is no configured `test` npm script yet. Run the
relevant suites directly with Node's test runner and a TS loader, for example:

```bash
# from repo root
node --import tsx --test packages/server/app/lib/daw/server/command-api.test.ts
node --import tsx --test src/app/pages/groups/demo/components/daw/version-history-tree.test.ts
node --import tsx --test src/app/lib/daw/state/operation-reducer.test.ts
```

Validation loop:

1. Run the relevant `node --import tsx --test ...` suite for the code you
   touched.
2. If a test fails, fix the implementation or fixture.
3. Rerun the same test until it passes.
4. Record the passing result in the daily log for the work date.

New tests added by this work should follow the same `node:test` pattern and sit
next to the code they cover (for example `versioning.test.ts`,
`version-tree-layout.test.ts`).
