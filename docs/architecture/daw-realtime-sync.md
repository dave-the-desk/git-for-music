# DAW Realtime Sync Model

This note describes the current DAW realtime sync model as it is implemented in the repo today.

## 1. Initial load

- `DemoDawClient` calls `projectSyncEngine.bootstrap(...)`
- `ProjectSyncEngine` loads cached state if available
- `ProjectSyncEngine` fetches `/api/daw/projects/[projectId]/bootstrap?demoId=...`
- `LocalProjectState` is created through `createLocalProjectStateFromBootstrap(...)`
- `operationTail` is applied through `applyAcceptedProjectOperations(...)`

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

## 5. Design rule

- Timeline and Version Tree should render from live `LocalProjectState`, not stale server props
- Presence and transport are realtime but non-durable
- Local-only settings such as local tempo should not enter durable operation history

## Before adding new DAW features

- Does the feature create an operation?
- Does the server commit and broadcast `accepted_operation`?
- Does the reducer apply the operation?
- Does `LocalProjectState` contain the data needed for rendering?
- Does reconnect replay the operation?
- Is this durable state, presence state, or local-only state?
