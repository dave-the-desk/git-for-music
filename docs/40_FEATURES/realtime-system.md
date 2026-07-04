# Realtime System

Realtime should move lightweight state, not audio payloads.

## Shared Realtime State

- Presence
- Comments
- Timeline edits
- Processing status
- Version updates
- Metadata changes

## Separate Workspace Refresh

The group and project shells use workspace refresh streams for list and shell data.

That path is separate from DAW `accepted_operation` sync and should stay lightweight.

## Storage Boundary

Large audio files should live in object storage and be fetched through signed URLs or same-origin audio routes.

## Related Context

- [docs/architecture/daw-realtime-sync.md](../../docs/architecture/daw-realtime-sync.md)
- [[40_FEATURES/storage-model]]
- [[40_FEATURES/offline-sync-model]]

