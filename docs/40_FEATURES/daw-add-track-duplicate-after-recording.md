# Bug: "Add track" duplicates Track 1 after recording

Status: resolved with client/server blank-track cleanup (2026-07-05)

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
  freshest committed version it knows about, instead of relying on an async
  active-version update.
- The client reducer normalizes version state and removes blank duplicate track
  entries whenever a version is created or bootstrap state is replayed.
- The server upload flows do the same cleanup after `TRACK_VERSION_CREATED` is
  committed, so the branch state sent back to clients cannot keep a blank copy
  around.

That means the old duplicate-track symptom is a historical bug note, not the
current behavior. The rendered branch now stays anchored to the latest
committed state after back-to-back record and add-track actions.

Cleanup rule:

- If two track entries share the same `trackId`, or the same normalized
  `trackName`, and one of them is the empty placeholder track, delete the blank
  one silently.
- If both tracks contain audio, keep both and do not delete anything.
- If the duplicate set is entirely blank, keep only one blank placeholder.

## Regression tests

The implemented coverage now lives in:

- [`src/app/lib/daw/utils/track-duplicate-cleanup.test.ts`](../../src/app/lib/daw/utils/track-duplicate-cleanup.test.ts)
- [`src/app/lib/daw/state/operation-reducer.test.ts`](../../src/app/lib/daw/state/operation-reducer.test.ts)
- [`packages/server/app/lib/daw/server/track-duplicate-cleanup.test.ts`](../../packages/server/app/lib/daw/server/track-duplicate-cleanup.test.ts)

They verify that:

- blank duplicates are removed when the same track is added twice by `trackId`
  or `trackName`
- same-name audio tracks are preserved when both have real audio
- replay/bootstrap normalization does not resurrect a blank `Track 1`

## Related context

- [[40_FEATURES/versioning-mental-model]]
- [[40_FEATURES/branching-and-revert-rules]]
- [[40_FEATURES/active-problems]]
</CodeContent>
<parameter name="EmptyFile">false
