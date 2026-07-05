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

This is a **stale `sourceVersionId` race**. The "Add track" upload forks from
the version that was active *before* the recording was saved, because the active
version is updated asynchronously and is not awaited.

Sequence:

- Saving a recording runs `handleSaveRecording` in
  `@/Users/davidriede/PROJECTS/git-for-music/src/app/pages/groups/demo/components/daw/DemoDawClient.tsx:2939-3047`.
  It uploads the blob, then sets the new branch as the view:
  ```@/Users/davidriede/PROJECTS/git-for-music/src/app/pages/groups/demo/components/daw/DemoDawClient.tsx:3020-3021
      setSelectedVersionId(data.demoVersionId);
      void projectSyncEngine.setActiveVersion(data.demoVersionId, { isFollowingHead: true });
  ```
  `setActiveVersion` is fired with `void` (not awaited).

- `ProjectSyncEngine.setActiveVersion` only updates
  `projectState.activeVersionId` **after** its server round-trip resolves:
  ```@/Users/davidriede/PROJECTS/git-for-music/src/app/lib/daw/engine/project-sync-engine.ts:409-417
        this.setState({
          projectState: {
            ...this.state.projectState,
            activeVersionId: nextActiveVersionId,
            isFollowingHead: nextIsFollowingHead,
          },
  ```
  Until that resolves, `liveActiveVersionId` still points at the **pre-recording**
  version:
  ```@/Users/davidriede/PROJECTS/git-for-music/src/app/pages/groups/demo/components/daw/DemoDawClient.tsx:418-419
    const liveActiveVersionId =
      liveProjectState?.activeVersionId ?? initialActiveVersionId ?? liveBranchHeadVersionId;
  ```

- Clicking Add track runs `handleAddTrack` → `performUpload`, which always forks
  from `liveActiveVersionId`:
  ```@/Users/davidriede/PROJECTS/git-for-music/src/app/pages/groups/demo/components/daw/DemoDawClient.tsx:2781-2792
    async function handleAddTrack() {
      await performUpload(
        createBlankTrackFile(),
        getNextUploadTrackName({ ... }),
        'uploadUnchanged',
      );
    }
  ```
  ```@/Users/davidriede/PROJECTS/git-for-music/src/app/pages/groups/demo/components/daw/DemoDawClient.tsx:3055-3064
        const data = (await ingestEngine.uploadAudioFile({
          demoId,
          projectId,
          name,
          sourceVersionId: liveActiveVersionId,
          ...
  ```

- On the server, `uploadTrackCommand` forks a new branch **by copying the tracks
  of `sourceVersionId`** and then appends the new blank track:
  ```@/Users/davidriede/PROJECTS/git-for-music/packages/server/app/lib/daw/server/commands/upload-track.ts:166-173
      const branchVersion = await createDemoVersionWithCopiedTracks(tx, {
        demoId: demo.id,
        sourceVersionId: sourceVersion.id,
        parentId: sourceVersion.id,
        kind: 'BRANCH',
        ...
  ```
  Because `sourceVersionId` is the stale pre-recording version, the copied tracks
  contain the **blank Track 1** (no recording). The command then adds Track 2.
  The result is a branch with `[blank Track 1, Track 2]`, which is set as the new
  active version — orphaning the recording branch. Visually: an extra blank
  Track 1 plus Track 2.

The naming path is not the cause: `getNextUploadTrackName`
(`@/Users/davidriede/PROJECTS/git-for-music/src/app/lib/daw/utils/track-names.ts:19-27`)
still returns `Track 2`. The duplication comes from forking off the wrong
(stale) base version.

### Why it is intermittent

If the async `setActiveVersion` round-trip finishes before the user clicks
Add track, `liveActiveVersionId` already points at the recording branch, the
fork copies `Track 1` *with* the recording, and only `Track 2` is added. The bug
only reproduces when Add track is clicked during the window before the active
version update resolves.

## Resolution

The fix is now applied in two layers:

- The client reducer normalizes version state and removes blank duplicate track
  entries whenever a version is created or bootstrap state is replayed.
- The server upload flows do the same cleanup after `TRACK_VERSION_CREATED` is
  committed, so the branch state sent back to clients cannot keep a blank copy
  around.

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
