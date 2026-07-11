# DAW Realtime Sync Model

This note describes the current DAW realtime sync model as it is implemented in the repo today.
It covers the DAW editor itself. The surrounding groups and project pages use a separate workspace refresh stream so demo lists and other shell data can refresh without a full reload.

## 1. Initial load

- `DemoDawClient` calls `projectSyncEngine.bootstrap(...)`
- `ProjectSyncEngine` loads cached state if available
- `ProjectSyncEngine` fetches `/api/daw/projects/[projectId]/bootstrap?demoId=...`
- `LocalProjectState` is created through `createLocalProjectStateFromBootstrap(...)`
- `operationTail` is applied through `applyAcceptedProjectOperations(...)`

## Workspace-level refresh

- `GroupsClient` listens to `/api/groups/realtime`
- `GroupPageClient` listens to `/api/groups/[groupSlug]/realtime`
- `ProjectPageClient` listens to `/api/groups/[groupSlug]/projects/[projectSlug]/realtime`
- The server emits `workspace_changed` after successful group, project, demo, and member mutations
- The client hook debounces the signal and calls `router.refresh()` so server-rendered lists stay current
- Demo creation from a separate session updates the project page demo list through this path, not through `accepted_operation`

## Shared graph vs per-user checkout

- The version DAG, tracks, takes, operations, and branch nodes are shared durable project data.
- Each viewer also has a per-user active checkout in `DemoUserActiveVersion` with `activeVersionId` and `isFollowingHead`.
- `selectedVersionId` in the client is the selected version node and the checkout source for edit actions, while the durable checkout state also lives in `DemoUserActiveVersion`.
- `Demo.currentVersionId` is now a fallback/default seed for legacy demos and bootstrap gaps, not the live checkout pointer.
- `snapshot.currentVersionId` and operation-history `currentVersionId` are shared-head metadata for replay and tree rendering only; they do not define the viewer checkout.
- `VERSION_SELECTED` and `CURRENT_VERSION_CHANGED` are legacy compatibility operations only; new checkout changes go through the per-user active-version API.
- Clicking a version node opens its details pop-up, and the checkout action in that pop-up updates the active checkout so the user can move back to any historical node from the tree.
- Recording and audio-tool commits branch from the active checkout into a new `DemoVersion`, and the version tree refreshes so the new node appears immediately for every subscribed viewer.
- UI actions that create new tracks should name them from the selected checkout, not from a stale history snapshot, or collaborators can generate duplicate `Track N` names.
- Recording previews should be cleared once the uploaded track is materialized so the preview lane does not linger beside the committed track.
- The version tree does not expose separate branch or revert buttons inline on the node; the pop-up checkout action is the user-facing history action, and branch creation is an implementation detail of edits from that checkout.
- Stale-base/conflict recovery still uses the server-side branch creation paths when needed.

## 2. Local edit

- The client creates an optimistic queue/preview entry immediately
- The UI may show immediate feedback through optimistic state
- The operation is sent to the server
- The server commits the operation and emits `accepted_operation`
- The client reconciles durable `LocalProjectState` when `accepted_operation` returns
- Nuance: the durable reducer is not blindly applied twice before and after server commit

## 3. Remote edit

- `accepted_operation` arrives over realtime SSE
- `ProjectSyncEngine` parses it
- `operation-reducer` applies it to `LocalProjectState`
- The Timeline and Version Tree render from `LocalProjectState`

## 4. Reconnect

- The client tracks `lastSeenOperationSeq`
- On reconnect, `ProjectSyncEngine` fetches operations after `lastSeenOperationSeq`
- If `rebootstrapRequired` is `true`, `ProjectSyncEngine` reboots from bootstrap
- Otherwise, it applies the operation tail
- Then it reopens SSE and resyncs pending operations
- Rebootstrap should preserve the viewer's active checkout when bootstrap omits a replacement value

## 5. Design rule

- Timeline and Version Tree should render from live `LocalProjectState`, not stale server props
- Presence and transport are realtime but non-durable
- Local-only settings such as local tempo should not enter durable operation history
- Workspace refresh events should be emitted for list and detail pages, but not for low-level timeline edits already covered by DAW SSE

## 6. Upload and derived audio boundary

- Realtime transport stays metadata-only. It carries accepted operations, presence, transport state, version-tree changes, and asset-processing status, but not raw audio blobs.
- Audio uploads are finalized into versioned storage rows and `trackVersion` records, then derived work is queued separately.
- Derived audio jobs are keyed by `demoVersionId` and `trackVersionId` so each version can reference its outputs without the blobs entering realtime.
- Any recording or audio-tool action that changes the timeline should be treated as a version boundary, not as a silent in-place edit.

## Before adding new DAW features

- Does the feature create an operation?
- Does the server commit and broadcast `accepted_operation`?
- Does the reducer apply the operation?
- Does `LocalProjectState` contain the data needed for rendering?
- Does reconnect replay the operation?
- Is this durable state, presence state, or local-only state?
- Does the change affect group/project/demo lists and therefore need a `workspace_changed` event?
