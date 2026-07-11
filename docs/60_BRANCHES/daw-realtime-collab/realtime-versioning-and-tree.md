# Realtime Editing + Git-Like Versioning + Tree Tab Visualization

Branch: `daw-realtime-collab`

This note is the design plan for keeping the git-like version model (automatic
version saving, revert, and branches that exist concurrently with `main`) while
moving the DAW toward real-time collaborative editing, and for visually
representing versions and branches in the **Tree** tab of the DAW page.

The implementation has now landed through phases A-E of the branch checklist:
version nodes carry provenance and operation ordering, accepted operations can
auto-checkpoint the converged head, revert creates a new version node, the Tree
tab renders a commit-graph layout from live state, and safe concurrent timeline
edits replay through transform/rebase logic before the server falls back to a
branching conflict.

It extends, and does not replace, the existing plans:

- [processing-jobs](../../processing-jobs.md)
- [papers README + gap analysis](../../papers/README.md)
- [realtime collaboration plan](../../papers/realtime-collaboration-plan.md)
- [daw realtime sync model](../../architecture/daw-realtime-sync.md)
- [versioning mental model](../../40_FEATURES/versioning-mental-model.md)
- [branching and revert rules](../../40_FEATURES/branching-and-revert-rules.md)

## 1. Goal

Deliver a system where:

- Multiple users edit the same demo in real time with immediate local feedback.
- Versions are saved automatically as work happens, not only on manual save.
- Any saved version can be reverted to without destroying later work.
- Branches can be created off any specific version and live concurrently with
  the `main` branch.
- The **Tree** tab renders the version DAG (versions + branches + merges) as a
  commit-graph, using the row/column layout approach from the DoltHub commit
  graph write-up, with forks centered around their parent node and the graph
  centered in the available rail when there is spare space.

## 2. Source Inputs

### 2.1 Git model (from `docs/papers/git-docs/` and git-scm docs)

- A commit is an immutable snapshot plus a pointer to one or more parents.
- History is a directed acyclic graph (DAG), not a linear undo stack.
- A branch is a movable named pointer to a commit; branches diverge and can be
  merged later.
- Checkout selects which commit/branch the working state reflects.
- Revert produces a new commit that returns content to an earlier state; it does
  not erase history.

Mapping into this repo's domain (see
[versioning mental model](../../40_FEATURES/versioning-mental-model.md)):

| Git concept | DAW concept |
|---|---|
| Repository | `Demo` |
| Commit | `DemoVersion` (snapshot + `parentId`) |
| Tree/blob | `TrackVersion` / `Segment` + immutable audio object |
| Branch pointer | branch head `DemoVersion` (+ optional branch label) |
| HEAD / checkout | per-user `DemoUserActiveVersion` (`activeVersionId`, `isFollowingHead`) |
| Revert | new `DemoVersion` whose content equals an ancestor |

### 2.2 Realtime collaboration model (from `docs/papers/realtime-collab/`)

Per the paper summaries in [papers README](../../papers/README.md):

- Jupiter: central server, replicated widget/list state, optimistic local apply,
  reconcile with operation transformation (OT).
- OT survey: correctness goals are convergence, causality preservation, and
  intention preservation (TP1/TP2 conditions).
- Replicated-list Jupiter: each replica is a path through a shared ordered state
  space; the server is authoritative for ordering but never blocks the UI.

Consequences for us:

- Local edits apply immediately, then propagate asynchronously.
- The server is authoritative for operation order; it rebases/transforms an
  incoming edit against intervening accepted operations before commit.
- Safe concurrent edits should converge without forcing a branch. Branching is
  the escape hatch for semantically unsafe overlap only.
- Audio blobs and processing jobs stay out of the realtime data plane.

### 2.3 Commit-graph drawing (DoltHub blog)

Key algorithm points to reuse for the Tree tab:

- Build a `childrenMap` from each node's `parents` array (edges point
  parent -> child for drawing).
- Sort nodes in topological order; the node index becomes its **row** (y).
- Assign **column** (x) by walking from head to root (children before parents):
  - No children (branch head): place in a new column.
  - Has multiple branch children: center the parent between those branch
    children so the fork stays balanced.
  - Has a single branch child: keep that column so linear history stays
    vertical.
  - No branch children but merge children: search from the leftmost child's
    column rightward for a free column so merge paths point right-to-left.
- Render dots as SVG circles and paths as SVG lines/paths, one color per branch.

## 3. Reconciling Realtime With Git-Like Versioning

The two models are not in conflict if we separate the **live editing plane**
from the **durable version plane**.

- **Live editing plane (OT/Jupiter):** the fast loop. Operations are applied
  optimistically, transformed/rebased on the server, and broadcast as
  `accepted_operation`. This is where convergence and intention preservation
  matter. It corresponds to work happening on a single branch head.
- **Durable version plane (git-like DAG):** the slow loop. Accepted operations
  advance a branch head; periodically the system checkpoints the head into a
  new immutable `DemoVersion` node. Branches, revert, and the Tree tab all read
  from this plane.

Rule of thumb: **OT keeps everyone converged on a branch head; the version DAG
records the meaningful history of that head over time and across branches.**

## 4. Automatic Version Saving (Checkpointing)

Automatic versions should feel like autosave but read like commits.

### 4.1 When to snapshot

Create a new `DemoVersion` on any of:

- **Idle/debounce checkpoint:** after a burst of accepted operations settles
  (for example, no new accepted operation for N seconds).
- **Operation-count checkpoint:** after K accepted operations since the last
  version, to bound replay cost.
- **Semantic checkpoint:** on meaningful boundaries (track added/removed,
  segment split/merge, take committed).
- **Explicit checkpoint:** user names/saves a version, or creates a branch.

These are policy knobs, not hard rules; start with debounce + operation-count
and tune.

### 4.2 What a version stores

- `parentId` (the version it descends from) to form the DAG.
- `operationSeq` at the point of checkpoint (for ordering and replay).
- A snapshot or snapshot-delta of `LocalProjectState` so bootstrap/tree render
  do not need to replay the whole log (see `snapshot-builder`).
- Provenance: whether it was auto, semantic, explicit, or revert.
- Never a copy of audio; audio objects stay immutable and referenced by key
  (see [processing-jobs](../../processing-jobs.md)).

### 4.3 Interaction with OT

- Auto-checkpoints are derived from already-accepted (post-transform)
  operations, so they always capture converged state, never a mid-transform
  state.
- A checkpoint is metadata over the durable log; it must not enter the realtime
  editing transport as an edit. It is announced via a version-tree event so the
  Tree tab refreshes.

> IMPORTANT: For the web app, Automatic Version Saving must follow the
> accepted-operation path, checkpoint the converged branch head after commit,
> and never duplicate audio or introduce a realtime edit branch for the autosave
> itself.

## 5. Reverting To A Version

Revert stays non-destructive (see
[branching and revert rules](../../40_FEATURES/branching-and-revert-rules.md)).

- Revert creates a **new** `DemoVersion` whose content equals a chosen ancestor,
  with `parentId` = current branch head. History is preserved; the DAG only
  grows.
- Because content is restored while the parent pointer moves forward, the graph
  shows a new node, and the reverted-from node remains visible.
- In a live session, revert is committed like any other accepted operation so
  all clients converge on the reverted head; pending local operations are
  rebased on top of the revert result.
- Per-user checkout: reverting on a branch moves that branch head; a user who is
  `isFollowingHead` follows it, a user pinned to a specific version does not get
  yanked.

The Tree tab keeps node details in a pop-up; use that surface for the checkout
action and any other version metadata.

## 6. Branches Concurrent With `main`

- A branch is created off a specific `DemoVersion` (`sourceVersionId`) and gets
  its own head that advances independently of `main`.
- Branch creation is already wired: `VersionHistoryTree` -> `onCreateBranch` ->
  `projectSyncEngine.createVersionBranch(...)`; the server persists a branch
  node and broadcasts a version-tree event.
- Concurrent existence: multiple heads (main + N branches) can be live at once.
  Each user's `DemoUserActiveVersion` decides which head they edit; OT operates
  per active head so two branches do not cross-contaminate.
- Branching remains the fallback for unsafe concurrent overlap that OT cannot
  transform, per the [realtime collaboration plan](../../papers/realtime-collaboration-plan.md).
- Merging branches back is future work; the DAG and layout already allow
  multi-parent nodes so the Tree tab can render merges when merge lands.

## 7. Data Model Deltas

Mostly additive over today's model.

- `DemoVersion`: ensure `parentId`, `operationSeq`, `createdAt`, optional
  `label`, and a `provenance`/`kind` field (`auto` | `semantic` | `explicit` |
  `revert` | `branch` | `merge`). Allow `parentIds` (array) to be ready for
  merges even if only one parent is used initially.
- `Branch` (optional first-class row) or keep branch identity implicit via the
  head version + label; start implicit to match current code, promote to a
  first-class pointer if branch operations grow.
- `DemoUserActiveVersion`: unchanged (`activeVersionId`, `isFollowingHead`).
- Realtime events: keep `accepted_operation` for edits; keep/extend the
  version-tree event for `version_created`, `branch_created`, `head_moved`,
  `reverted`.

## 8. Tree Tab Visualization Plan

The current Tree tab (`VersionHistoryTree.tsx` + `version-tree-layout.ts`) uses
the DoltHub row/column model and should keep forks centered around their parent
while the overall graph stays centered in the available rail when there is
spare space.

### 8.1 Layout algorithm (adapt DoltHub)

1. **Build relations:** from `versions[]` build `childrenMap` keyed by
   `parentId` (extend `buildTree` in `version-tree-layout.ts`). Keep support for
   multiple parents so merges render later.
2. **Rows = topological order:** sort by (`createdAt`, `operationSeq`, `id`) as
   `compareVersions` already does; row index = y position. Newest at top or
   bottom is a display choice; pick one and keep it stable.
3. **Columns via head->root pass:**
   - Branch head (no children): new column.
   - Has multiple branch children: center the parent between those branch
     children so the fork reads symmetrically.
   - Has a single branch child: keep that column so straight history stays
     vertical.
   - Only merge children: search rightward from the leftmost child's column for
     the first free column so merge edges point right-to-left.
4. **Color per branch/column** so `main` and each branch are visually distinct;
   reuse the existing head/active/selected accent colors for state, and add a
   stable per-branch base color.

Current implementation note:

- The tree now keeps sibling branches in parallel columns when that reduces
  width, while still centering each parent above the full span of its children.
- The visual palette is semantic rather than column-based:
  - the user’s current branch is blue
  - the current branch head / current checkout node is a lighter blue
  - nodes on other branches are a lighter yellow
  - heads of other branches are a darker yellow
- The zoom controls live in the rail header and scale only the graph viewport.
- The node selection outline is secondary; it should not replace the branch
  color meaning unless the design explicitly changes.

### 8.2 Rendering

- Keep the current SVG approach: `<circle>`/node cards for versions, `<line>`/
  `<path>` for parent->child edges (the file already draws edges from a
  `nodeById` map).
- Keep the current badges aligned to the semantic palette: **current branch
  head**, **current branch**, **other branch nodes**, **other branch heads**.
- Keep node details in a pop-up with the checkout action at the bottom; the
  node itself stays visually simple with only its title and user.
- Preserve pan/scroll for wide graphs and the expand/minimize toggle.

### 8.3 Live updates

- The tree renders from live `LocalProjectState.versions`, never stale props
  (design rule in [daw realtime sync model](../../architecture/daw-realtime-sync.md)).
- On `version_created` / `branch_created` / `head_moved` / `reverted`, the tree
  recomputes layout and animates the new node in.
- The version-history graph should continue to use this centered commit-graph
  layout and semantic palette unless a future change explicitly replaces it.

## 9. Update To The Processing-Jobs Plan

The [processing-jobs](../../processing-jobs.md) plan stays valid and is the
right home for heavy work. Clarifications for this branch:

- Version checkpointing is **not** a processing job; it is durable log metadata
  in the app/server, produced from already-accepted operations.
- Derived audio (waveforms, analysis, pitch/time edits) stays in the job
  pipeline and is keyed by `demoVersionId` / `trackVersionId`, so each version
  node can reference its derived outputs without entering realtime.
- Original audio remains immutable; versions and branches only add pointers and
  operation history, never new copies of the source upload.

## 10. Phased Rollout

- **Phase A - Version model hardening:** confirm `parentId` + `operationSeq` on
  every `DemoVersion`, add `provenance`/`kind`, allow multi-parent shape. Tests
  for DAG integrity.
- **Phase B - Auto-checkpointing:** debounce + operation-count checkpoints from
  accepted operations; broadcast `version_created`. Tests that checkpoints
  capture converged state.
- **Phase C - Revert as new version:** revert-to-ancestor operation, rebased in
  live sessions, non-destructive. Tests for follow-head vs pinned checkout.
- **Phase D - Tree tab commit-graph:** implement row/column layout in
  `version-tree-layout.ts`, per-branch colors, live refresh. Tests for column
  assignment with branch and merge children.
- **Phase E - OT convergence (from realtime plan):** land transform/rebase on
  the commit path so safe concurrent edits converge without branching; branches
  remain the unsafe-overlap fallback.

## 11. Definition Of Done

- Two clients edit the same branch head concurrently and converge without an
  unwanted branch.
- Versions are created automatically as work happens and appear in the Tree tab
  without reload.
- Any version can be reverted to; the revert appears as a new node and older
  nodes remain visible.
- Branches created off a chosen version live concurrently with `main` and each
  has an independent head.
- The Tree tab renders the DAG with topological rows and column-assigned
  branches/merges, colored per branch, matching the commit-graph model.
- Audio blobs never enter the realtime transport; derived audio stays in the job
  pipeline keyed by version.

## 12. Related Files

- `src/app/pages/groups/demo/components/daw/VersionHistoryTree.tsx`
- `src/app/pages/groups/demo/components/daw/version-tree-layout.ts`
- `src/app/pages/groups/demo/components/daw/DemoDawClient.tsx`
- `src/app/lib/daw/engine/project-sync-engine.ts`
- `src/app/lib/daw/state/local-project-state.ts`
- `packages/server/app/lib/daw/server/command-api.ts`
- `packages/server/app/lib/daw/server/snapshot-builder.ts`
- `packages/server/app/lib/daw/server/realtime-gateway.ts`
- `packages/server/app/lib/daw/server/demo-user-active-version.ts`
