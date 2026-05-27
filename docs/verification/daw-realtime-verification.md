# DAW Realtime Verification

## Verification status

The realtime sync model has been verified by code-path tracing and focused tests. The two-browser GUI test still needs to be performed manually because this terminal session could not open two browser windows.

## Verified by code/tests

### Initial load

- `DemoDawClient` calls `projectSyncEngine.bootstrap(...)`
- `ProjectSyncEngine` loads cached state when available
- `ProjectSyncEngine` fetches `/api/daw/projects/[projectId]/bootstrap?demoId=...`
- `LocalProjectState` is created through `createLocalProjectStateFromBootstrap(...)`
- `operationTail` is applied through `applyAcceptedProjectOperations(...)`

### Local edit

- The client creates an optimistic queue/preview entry immediately
- The edit is sent to the server
- The server commits the operation and emits `accepted_operation`
- The client reconciles durable `LocalProjectState` when the accepted op comes back
- The durable reducer is not blindly applied twice before and after commit

### Remote edit

- `accepted_operation` arrives over SSE
- `ProjectSyncEngine` parses it
- `operation-reducer` applies it to `LocalProjectState`
- Timeline and Version Tree render from `LocalProjectState`

### Reconnect

- The client tracks `lastSeenOperationSeq`
- On reconnect, `ProjectSyncEngine` fetches operations after that sequence
- If `rebootstrapRequired` is `true`, it reboots from bootstrap
- Otherwise it applies the operation tail
- Then it reopens SSE and resyncs pending operations

### Non-durable realtime

- Presence is handled separately from `accepted_operation`
- Presence does not write to project history or create Version Tree nodes
- Local-only tempo UI state stays local and does not become durable history

## Operations verified

### Durable timeline/edit operations

- `TRACK_RENAMED`
- `TRACK_OFFSET_UPDATED`
- `SEGMENT_SPLIT`
- `SEGMENT_MOVED`
- `SEGMENT_TRIMMED`
- `SEGMENT_MERGED`
- `CROSSFADE_SET`
- `SEGMENT_DELETED`
- comment/annotation flows where supported

### Version Tree operations

- `VERSION_CREATED`
- `VERSION_BRANCH_CREATED`
- `VERSION_RENAMED`
- `CURRENT_VERSION_CHANGED`
- `VERSION_SELECTED`
- `VERSION_REVERTED_FROM`
- `TRACK_VERSION_CREATED`
- `VERSION_PARENT_SET`
- `VERSION_OPERATION_SUMMARY_SET`
- `VERSION_NODE_ADDED`

## Stale prop check

`VersionHistoryTree` was not found rendering from stale initial props.

`DemoDawClient` passes:

- `versions={liveVersions}`
- `currentVersionId={liveCurrentVersionId}`

Those values come from `projectSyncState.projectState`, with bootstrap props used only as fallback seed data.

## Remaining manual browser verification

1. Open the same demo in Browser A and Browser B.
2. Confirm both clients show the same initial timeline and Version Tree.
3. In Browser A, rename a track.
4. Confirm Browser B updates without refresh.
5. In Browser A, cut/split a segment.
6. Confirm Browser B updates without refresh.
7. In Browser A, move a segment.
8. Confirm Browser B updates without refresh.
9. In Browser A, create or rename a version node.
10. Confirm Browser B's Version Tree updates without refresh.
11. In Browser B, make an edit and confirm Browser A sees it.
12. Disconnect or pause Browser B's realtime connection if possible.
13. Make edits in Browser A.
14. Reconnect Browser B.
15. Confirm Browser B catches up from operations after `lastSeenOperationSeq`.
16. Confirm presence updates do not create Version Tree nodes.
17. Confirm local tempo changes do not appear in durable history.

## Test results

Focused node tests passed:

- 4 tests passed
- 0 failed

## Relationship to architecture note

This verification checks the architecture model described in [`docs/architecture/daw-realtime-sync.md`](/Users/davidriede/PROJECTS/git-for-music/docs/architecture/daw-realtime-sync.md).
