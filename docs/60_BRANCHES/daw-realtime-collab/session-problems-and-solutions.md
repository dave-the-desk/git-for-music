# Session Problems and Solutions

This note records the concrete failures encountered while fixing realtime DAW collaboration, along with the corrective changes that resolved them.

## Maintenance Rule

Agents working on realtime sessions, reconnect, accepted operations,
collaborator updates, upload source selection, or version-tree payloads must
update this note when they discover or resolve a related problem. Each new
record must preserve:

- the user-visible or system-visible failure
- the source-verified root cause
- the corrective behavior and affected source paths
- the regression test or other verification that prevents recurrence
- any remaining limitation when the resolution is incomplete

Do not wait for a later documentation pass. Record the problem and solution in
the same task that establishes them, and distinguish confirmed behavior from an
unverified hypothesis.

## 1. First open did not live-update

Problem:

- A client that opened a demo could sit on a stale snapshot until the user manually refreshed.
- Realtime traffic could stall silently, so the page never pulled newer accepted operations.

Solution:

- Added a realtime silence watchdog to `ProjectSyncEngine`.
- Added a periodic catch-up loop so the client re-pulls accepted operations even when the stream stays quiet.
- Triggered an immediate catch-up when the realtime connection opens.
- Added a regression test that verifies the engine catches up on open and reconnects after silence.

## 2. Track cut changes did not sync for other users

Problem:

- Cutting an audio track updated the editor for the local user, but other collaborators did not see the new state until refresh.

Solution:

- Ensured accepted realtime operations are applied through the shared project sync state.
- Reused the same catch-up and reconnect path so quiet or stalled realtime sessions eventually recover without manual refresh.
- Kept a regression test covering the cut/split path in the sync engine.

## 3. Track creation on a blank demo lagged for collaborators

Problem:

- When one user added the first track to a blank demo, other connected users did not see the new track immediately.
- The UI could remain anchored to the old branch head because it waited on the wrong sync state instead of the selected checkout.

Solution:

- Extended the `TRACK_VERSION_CREATED` payload so the server sends the created version node together with the track.
- Updated the reducer so a follow-head client advances to the new branch head as soon as that version lands.
- Changed the demo DAW client to follow `currentVersionId` changes directly.
- Added regression coverage for:
  - a single client receiving a collaborator-created blank-demo track
  - two simultaneous clients staying aligned when one adds a track

## 4. New uploads briefly used stale source state

Problem:

- After a recording or upload, follow-up add-track actions could sometimes source from stale state if the active version sync had not fully caught up yet.

Solution:

- Introduced `resolveUploadSourceVersionId` so uploads and recording source from the selected checkout.
- Kept the selected checkout authoritative for add-track and recording flows while still tracking the latest committed version for fallback cases.
- Added a regression test for the upload source selection helper and the add-track flow.

## 5. Server payload shape did not fully support version-tree updates

Problem:

- The realtime operation payload for track creation was missing the created version snapshot, which limited the client’s ability to update its tree immediately.

Solution:

- Added the version snapshot to the `TRACK_VERSION_CREATED` payload in both upload entry points.
- Updated the shared command API types to match.
- Verified the server package typecheck did not report new errors for those paths.

## Validation Used

- `pnpm --filter @git-for-music/web test -- src/app/lib/daw/engine/project-sync-engine.test.ts`
- `pnpm --filter @git-for-music/web test -- src/app/lib/daw/state/operation-reducer.test.ts`
- `pnpm --filter @git-for-music/web test -- src/app/pages/groups/demo/components/daw/DemoDawClient.interaction.test.tsx`
- `git diff --check`

## Outcome

- Collaborator edits now propagate through the live DAW without requiring refresh for the cases covered above.
- The session left behind direct regression coverage for first open recovery, blank-demo track creation, and two-client alignment.
