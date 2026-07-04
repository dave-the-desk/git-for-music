# Offline Sync Model

Offline editing should be a normal workflow, not an error path.

## Offline State

Offline edits must keep:

- baseVersionId
- pending operations
- local audio files
- local metadata
- sync state

## Reconnect Flow

On reconnect:

- upload assets
- replay operations
- compare against the latest branch head
- auto-merge safe changes
- branch or conflict unsafe changes

## Related Context

- [[40_FEATURES/versioning-mental-model]]
- [[40_FEATURES/merge-and-conflict-guide]]
- [[01_PROTOCOLS/non-negotiable-rules]]
- [docs/architecture/daw-realtime-sync.md](../../docs/architecture/daw-realtime-sync.md)

