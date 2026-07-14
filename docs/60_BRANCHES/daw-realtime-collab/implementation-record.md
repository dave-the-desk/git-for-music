# Implementation Record: Realtime + Versioning + Tree Tab

Branch: `daw-realtime-collab`

This record maps the design in
[realtime-versioning-and-tree](./realtime-versioning-and-tree.md) to the changes
that landed in source. The opening snapshot and source map are the useful
entrypoints for current implementation work; the phase sections preserve why
the system has its present shape.

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
  live `LocalProjectState.versions` graph with a centered commit-graph layout.
- **Realtime events:** `accepted_operation`, `version_tree_changed`,
  `version_created`, `branch_created`, `head_moved`, `reverted`, presence,
  transport, asset, and comment (`realtime-gateway.ts`).

Key gaps vs the design doc:

- Merge behavior is still future work; storage/layout are merge-ready but no branch merge command has shipped.

---

## Phase A - Version Model Hardening

Goal: make every `DemoVersion` a well-formed commit node with provenance and
merge-ready shape.

- **Completed:** Add a `kind`/`provenance` enum to `DemoVersion` in `packages/db/prisma/schema.prisma` (`AUTO` | `SEMANTIC` | `EXPLICIT` | `REVERT` | `BRANCH` | `MERGE`); default to `EXPLICIT` for back-compat.
- **Completed:** Record the `operationSeq` at which each version was created on `DemoVersion` (new nullable column) so the Tree tab can order without re-deriving from the log.
- **Completed:** Add a forward-compatible merge storage shape: keep the existing single `parentId` as the canonical parent for now, add a `DemoVersionParent` join table (`versionId`, `parentId`, `order`) so multi-parent history can be represented later, and keep `isMerge` in sync with merge nodes. Do not implement merge behavior yet.
- **Completed:** Create the Prisma migration and update `DEMO_VERSION_FIELDS` / `serializeCreatedDemoVersionTreeNode` in `packages/server/app/lib/daw/server/versioning.ts`.
- **Completed:** Thread `kind` through `createDemoVersionWithCopiedTracks` and every call site (`create-version.ts`, `command-api.ts` branch paths).
- **Completed:** Extend `DawVersion` in `src/app/lib/daw/state/local-project-state.ts` and the version tree node types in `packages/shared` with `kind` + `operationSeq`.
- **Completed:** Tests: DAG integrity (every non-root version resolves its parent; no cycles) in `packages/server/app/lib/daw/server/versioning.test.ts`.

Migration-history note: the dated migrations used while this work was landing
were later consolidated into the schema-complete
`packages/db/prisma/migrations/00000000000000_init/migration.sql` before
deployment. The schema and initial migration now contain the version model.

## Phase B - Automatic Version Saving (Checkpointing)

Goal: create `DemoVersion` nodes automatically from accepted operations, without
entering the realtime edit transport.

IMPORTANT: Automatic Version Saving in the web app should be implemented by
committing accepted operations first, then creating a checkpoint from the
converged branch head after commit. Do not fork a realtime edit branch for the
autosave path, do not create the version mid-transform, and do not duplicate
audio.

- **Completed:** Define checkpoint policy constants (debounce window + operation-count K) alongside `DEFAULT_SNAPSHOT_CHECKPOINT_TAIL` in `snapshot-builder.ts`.
- **Completed:** Add `shouldCreateAutoVersion(...)` that fires on: N seconds idle after a burst, K accepted ops since last version, or semantic boundaries (track add/remove, segment split/merge, track offset, segment move/delete/fade/crossfade, take committed).
- **Completed:** Add a server helper `createAutoDemoVersion(...)` that snapshots the converged branch head into a new `DemoVersion` (`kind = AUTO`/`SEMANTIC`, `parentId` = current head, `operationSeq` = latest accepted) reusing `createDemoVersionWithCopiedTracks`.
- **Completed:** Call it from the accepted-operation path in `commitDawProjectOperation` AFTER the operation is committed (never mid-transform), guarded by the policy. Keep it distinct from `ProjectSnapshot` replay checkpoints.
- **Completed:** Ensure auto-versions never carry audio; only pointers/metadata (verify against `cloneTrackVersionsToDemoVersion`).
- **Completed:** Emit a `version_created` event (see Phase F) so the Tree tab refreshes.
- **Completed:** Decouple/clarify per-edit branching: the current per-edit branch for `TRACK_RENAMED`/`SEGMENT_TRIMMED` should be reconsidered so ordinary edits advance the head and auto-checkpoint, instead of forking a branch each time. Gate behind a flag to avoid regressing existing behavior.
- **Completed:** Tests: given a burst of accepted ops, exactly one auto-version is created after debounce; op-count threshold triggers a checkpoint; audio is never duplicated.

## Phase C - Non-Destructive Revert

Goal: revert-to-version creates a NEW version equal to an ancestor; history is
preserved.

- **Completed:** Add a server command `revertToVersionCommand(...)` (new `packages/server/app/lib/daw/server/commands/revert-version.ts`) that clones the target ancestor's tracks into a new `DemoVersion` (`kind = REVERT`, `parentId` = current branch head).
- **Completed:** Add an API route (e.g. `POST /api/versions/revert`) mirroring `create-version.ts` auth + validation.
- **Completed:** Record a `VERSION_REVERTED_FROM` operation whose payload carries the new version node (like `VERSION_BRANCH_CREATED` does), and update the reducer case in `src/app/lib/daw/state/operation-reducer.ts` to upsert the new version node instead of only moving `currentVersionId`.
- **Completed:** In a live session, commit the revert like any accepted operation so all clients converge; move the branch head and let followers follow, without yanking pinned checkouts (respect `isFollowingHead`).
- **Completed:** Add `revertToVersion(...)` to `ProjectSyncEngine`; the tree no longer exposes a separate revert control and now relies on checkout selection.
- **Completed:** Tests: revert produces a new node whose content equals the ancestor; older nodes remain; follow-head vs pinned checkout behavior is correct.

## Phase D - Tree Tab Commit-Graph (DoltHub layout)

Goal: render the version DAG as a real commit graph with topological rows,
centered forks, column-assigned branches/merges, colored per branch.

- **Completed:** Rework `src/app/pages/groups/demo/components/daw/version-tree-layout.ts`:
  - Build a `childrenMap` from `parentId` (extend `buildTree`); support multiple parents for future merges.
  - Rows = topological order (reuse `compareVersions`: `createdAt`, `operationSeq`, `id`); row index -> y.
  - Columns via a head->root pass: branch head -> new column; multiple branch children -> center the parent between those branch children; a single branch child -> keep that column; merge-only children -> first free column to the right so merge edges point right-to-left.
  - Assign a stable per-branch/column color.
- **Completed:** Update `VersionHistoryTree.tsx` to consume the new layout:
  - Draw dots + parent->child edges from the new node/column positions.
  - Keep the semantic badge set aligned to the graph palette (current branch head, current branch, other branch nodes, other branch heads) and the simplified node details pop-up.
  - Keep the rail-header zoom controls as the standard zoom affordance for the graph.
  - Keep branch color semantic: current branch blue, current branch head lighter blue, other-branch nodes lighter yellow, other-branch heads darker yellow.
  - Keep node details in a pop-up with the checkout action at the bottom; branch/revert controls are not exposed inline on the node.
  - Preserve pan/scroll and expand/minimize.
- **Completed:** Ensure the tree renders from live `LocalProjectState.versions`, never stale props (design rule in `docs/architecture/daw-realtime-sync.md`).
- **Completed:** Tests: column assignment for a chain, a fork (two branch children), and a merge (merge child) matches expected columns; layout is deterministic.

## Phase E - OT Convergence (from realtime plan)

Goal: safe concurrent edits converge without an unwanted branch; branching stays
the unsafe-overlap fallback. This is grounded in the realtime-collaboration
papers summarized in [docs/papers/README.md](../../papers/README.md).

- **Completed:** Add pure transform helpers for the timeline ops in `TIMELINE_EDIT_OPERATION_TYPES` (move, trim, split, merge, fade,  crossfade, rename) under `src/app/lib/daw/state/`.
- **Completed:** Rebase an incoming edit against intervening accepted operations in `commitDawProjectOperation` before finalizing; only fall back to `analyzeDawOperationConflict` branch/409 when a transform cannot preserve intent.
- **Completed:** Replay the optimistic local queue through the same transform logic in `ProjectSyncEngine` so remote accepted ops preserve pending local intent.
- **Completed:** Tests: two safe concurrent edits converge to identical state (reducer + command-api); unsafe overlap still branches/conflicts deterministically; reconnect after concurrent local+remote edits converges on the queue-replay path.

## Phase F - Realtime Events + Reconnect

Goal: make version/branch/revert changes first-class realtime signals.

- **Completed:** Add semantic events in `packages/server/app/lib/daw/server/realtime-gateway.ts`: `version_created`, `branch_created`, `head_moved`, `reverted` (or extend  `version_tree_changed` with a `reason`). Update `DawRealtimeEventType`.
- **Completed:** Emit them from the create/branch/revert/auto-checkpoint paths.
- **Completed:** Handle them in `ProjectSyncEngine` (refresh version tree, animate new node) and confirm `operation-reducer` upserts nodes for the corresponding accepted operations.
- **Completed:** Confirm reconnect (`lastSeenOperationSeq`, `rebootstrapRequired`) replays new version/revert operations and preserves the viewer checkout.
- **Completed:** Tests: reconnect after a remote auto-version/branch/revert shows the new node and keeps the local checkout.

## Phase G - Processing-Jobs Alignment

Goal: keep heavy/derived work out of realtime and version metadata.

- **Completed:** Confirm version checkpointing is app/server metadata, not a processing job (see [processing jobs](../../architecture/processing-jobs.md)).
- **Completed:** Ensure derived audio jobs remain keyed by `demoVersionId` / `trackVersionId` so each version node can reference derived outputs without entering realtime.
- **Completed:** Confirm original audio stays immutable; versions/branches add pointers only (verify `cloneTrackVersionsToDemoVersion` copies keys, not blobs).

---

## Verified Outcomes

Testing and confirmation of real-time sync

The following items are now verified by repo regression tests and should be treated as current behavior:

- **Completed:** Two clients edit the same branch head concurrently and converge without an unwanted branch.
- **Completed:** Versions are created automatically as work happens and appear in the Tree tab without reload.
- **Completed:** Any version can be reverted to; the revert appears as a new node and older nodes remain visible.
- **Completed:** Branches created off a chosen version live concurrently with `main`, each with an independent head.
- **Completed:** The Tree tab renders the DAG with topological rows and column-assigned branches/merges, colored per branch.
- **Completed:** Audio blobs never enter the realtime transport; derived audio stays in the job pipeline keyed by version.

## Source Map

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

## Verification Commands

Browser interaction tests use the Vitest harness from `src/package.json`.
Server and non-interaction web tests use Node's runner with the `tsx` import
hook. Current entrypoints are:

```bash
# from the repository root
pnpm test:server
pnpm test:unit
pnpm test:web

# targeted Node test
node --import tsx --test packages/server/app/lib/daw/server/command-api.test.ts
```

New tests live next to the source they cover and use the harness already
established in that subtree.
