# Timeline Editing Model

Timeline editing is segment-based and version-aware.

## Core Model

- Tracks are logical lanes.
- TrackVersions hold the audio state for a specific version.
- Segments are time-bounded regions on the shared timeline.
- Editing actions should preserve source traceability.

## Practical Rules

- Prefer time-range edits over destructive file mutation.
- Keep track identity stable unless the user explicitly creates or moves to another track.
- Treat `trackId` as logical identity and `trackName` as mutable display metadata; renaming must not change identity, and creation must allocate a distinct ID.
- Version boundaries, including automatic checkpoints, create new immutable `TrackVersion` rows but preserve each lane's logical `trackId`; a later new lane receives a different logical ID.
- Represent trims, fades, moves, and overlaps as operations or metadata changes.
- Use timeline overlap and track identity for conflict detection.

## Related Context

- [[40_FEATURES/audio-editing-philosophy]]
- [[40_FEATURES/merge-and-conflict-guide]]
- [[40_FEATURES/versioning-mental-model]]
