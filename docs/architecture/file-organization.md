# File Organization

The web app keeps DAW-specific code under `apps/web/src/features/daw`.

## UI Code

- Reusable UI primitives live in `apps/web/src/components/ui`.
- Shared layout pieces live in `apps/web/src/components/layout`.
- DAW-specific UI lives in `apps/web/src/features/daw/components`.
- Notification-only UI stays in `apps/web/src/features/notifications` unless it is truly global.

## Domain Logic

- DAW state shapes, constants, and state helpers live in `apps/web/src/features/daw/state`.
- Pure DAW utilities such as timing, segment math, and version-label helpers live in `apps/web/src/features/daw/utils`.
- DAW API and server-side data helpers live in `apps/web/src/features/daw/api`.
- Route files and page files should stay thin and delegate to these feature modules.

## Audio Storage

- Generated user media should not live in source control.
- Original uploads, derived audio, waveform artifacts, and analysis artifacts should each use separate storage prefixes under the same TrackVersion root.
- TrackVersion storage should be organized by IDs, not names, so paths remain stable even if a user renames a group, project, demo, or track.
- A stable TrackVersion path should look like `groups/{groupId}/projects/{projectId}/demos/{demoId}/tracks/{trackId}/versions/{trackVersionId}/...`.

## Why `TrackVersion.storageKey` Matters

- `TrackVersion.storageKey` is the source of truth for the audio object to load.
- The database row should point at the exact object key that the UI and workers read.
- Derived files should be created as new objects instead of mutating the original upload in place.
- Keeping the storage key stable per TrackVersion makes version history, undo flows, and processing jobs safer over time.
