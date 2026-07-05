# Non-Negotiable Rules

These are system rules, not aspirations.

## Audio Safety

Original audio is never overwritten.

Every destructive-looking action must be represented as:

- metadata
- a new TrackVersion
- a new DemoVersion
- a derived asset
- or a reversible operation

Recording and any audio-tool action that changes audio state must create a new version
boundary instead of mutating shared audio in place.

## Versioning

Revert is not destructive.
Revert creates a new version based on a previous version.

Branches are first-class.
The version model is a graph, not a linear undo stack.

## Collaboration

Realtime should be used for lightweight state:

- presence
- comments
- timeline edits
- processing status
- version updates
- metadata changes

Audio-tool commits should also broadcast the version-tree change immediately so everyone
in the project sees the new version as soon as it lands.

Large audio files should live in object storage and be fetched via signed URLs.

## Merging

Audio is not merged like text.

Merge decisions are based on:

- shared base version
- track identity
- segment time ranges
- operation type
- timeline overlap

Different tracks can usually merge.
Same track, non-overlapping time ranges can usually merge.
Same track, overlapping time ranges should create a conflict or branch.

## Offline Mode

Offline edits must keep:

- baseVersionId
- pending operations
- local audio files
- local metadata
- sync state

On reconnect:

- upload assets
- replay operations
- compare against latest branch head
- auto-merge safe changes
- branch or conflict unsafe changes

## Related Context

- [[40_FEATURES/versioning-mental-model]]
- [[40_FEATURES/merge-and-conflict-guide]]
- [[40_FEATURES/offline-sync-model]]
- [[40_FEATURES/storage-model]]
