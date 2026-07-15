# Bug: "Add track" duplicates Track 1 after recording

Status: resolved; automatic checkpoints now preserve tracks and are durable in the version graph (2026-07-15)

## Symptom

1. Arm the blank **Track 1** and record a clip into it.
2. Stop the recording so it is committed to Track 1.
3. Immediately click **+ Add track**.

Expected: a single new **Track 2** is appended.

Actual: **Track 2** is added *and* a second **Track 1** appears (a blank
Track 1 without the recording). The recorded audio effectively disappears from
the visible checkout.

## Root cause

This was a **stale `sourceVersionId` race** in the older implementation. The
"Add track" upload forked from the version that was active *before* the
recording was saved, because the active version was updated asynchronously and
was not awaited.

The current implementation fixes the behavior in three layers:

- The client resolves the source version for both upload and recording from the
  selected checkout, which is the authoritative source for edit-producing
  actions.
- The client reducer normalizes version state and removes blank duplicate track
  entries for the same stable `trackId` whenever a version is created or
  bootstrap state is replayed.
- The server upload flows do the same identity-based cleanup after
  `TRACK_VERSION_CREATED` is committed, so a branch cannot keep both the blank
  and materialized versions of one logical track.

That means the old duplicate-track symptom is a historical bug note, not the
current behavior. The rendered branch now stays anchored to the latest
committed state after back-to-back record and add-track actions.

Cleanup rule:

- Only entries with the same `trackId` are duplicates. A matching name is not
  identity evidence because track names are mutable and intentionally reusable.
- If versions of the same logical track include audio and a blank placeholder,
  delete the blank one silently.
- If same-ID duplicates are entirely blank, keep one placeholder.
- Tracks with different IDs are always preserved, even when their names match.

## Rename and add-track identity correction

The earlier name-based fallback was too broad. It could collapse a legitimately
new track after a rename because `trackName` was used as if it were a stable
key. The correct boundary is:

- rename changes `Track.name` only and preserves `trackId`
- a new-track request receives a new UUID and is appended to the branch
- an upload targeting an explicit existing `trackId` replaces that logical
  track's copied `TrackVersion`
- cleanup reconciles only multiple versions of the same `trackId`

Default `Track N` labels now also consider `trackPosition`, so renaming the
first lane to a custom name makes the next default label `Track 2` rather than
reusing `Track 1`.

## Empty automatic checkpoint follow-up

The identity cleanup and label correction exposed a deeper failure: after the
fix, the new lane was correctly called `Track 2`, but it still replaced the
renamed lane and its version-history node appeared disconnected.

Database evidence from repeated reproductions showed the same chain:

1. an add-track branch contained the existing track
2. its automatic checkpoint child contained zero `TrackVersion` rows
3. the next add-track branch used that empty child as its source and therefore
   copied no existing track

The verified implementation cause was `createAutoDemoVersion` passing
`copyTracks: false`. Because that empty checkpoint became the active version,
the later branch correctly cloned its source—but the source was already empty.
The node also existed only in `DemoVersion` plus an ephemeral `version_created`
notification, not as a durable operation in the snapshot tail, which allowed
the UI graph to omit the parent.

The correct fix is to treat an automatic checkpoint as a full immutable version
boundary:

- clone every source `TrackVersion` into the checkpoint while preserving its
  stable logical `trackId`
- allocate new immutable `trackVersionId` and segment IDs for those copies
- retain `parentId = sourceVersionId`
- record the checkpoint as `VERSION_NODE_ADDED` with its complete version
  payload, then emit that accepted operation before the tree refresh event
- let the next add-track branch clone the populated checkpoint and append its
  new, distinct `trackId`
- reconcile current bootstrap against durable `DemoVersion` rows so parent
  nodes created by the older event-only code become connected again; do not run
  this reconciliation for historical operation-sequence snapshots

## Regression tests

The implemented coverage now lives in:

- [`src/app/lib/daw/utils/track-duplicate-cleanup.test.ts`](../../src/app/lib/daw/utils/track-duplicate-cleanup.test.ts)
- [`src/app/lib/daw/state/operation-reducer.test.ts`](../../src/app/lib/daw/state/operation-reducer.test.ts)
- [`packages/server/app/lib/daw/server/track-duplicate-cleanup.test.ts`](../../packages/server/app/lib/daw/server/track-duplicate-cleanup.test.ts)
- [`packages/server/app/lib/daw/server/versioning.test.ts`](../../packages/server/app/lib/daw/server/versioning.test.ts)
- [`packages/server/app/lib/daw/server/command-api.test.ts`](../../packages/server/app/lib/daw/server/command-api.test.ts)
- [`packages/server/app/lib/daw/server/snapshot-builder.test.ts`](../../packages/server/app/lib/daw/server/snapshot-builder.test.ts)

They verify that:

- blank duplicates are removed when the same logical track is added twice by
  `trackId`
- same-name tracks are preserved whenever their IDs differ, including blank
  and audio combinations
- replay/bootstrap normalization does not resurrect a blank `Track 1`
- rename preserves the logical track ID and a later create operation appends a
  distinct ID
- an automatic checkpoint keeps the renamed logical track, creates a new
  immutable track-version ID, and remains the connected source of the next
  add-track branch
- the automatic node and its parent/tracks are durable in operation replay
- current bootstrap restores legacy durable parent nodes omitted from old
  operation tails without altering historical snapshot reads

## Related context

- [[40_FEATURES/versioning-mental-model]]
- [[40_FEATURES/branching-and-revert-rules]]
- [[40_FEATURES/active-problems]]
