# Merge and Conflict Guide

Merging is timeline-based.

The system compares:

- base version
- local operations
- remote operations
- affected track IDs
- affected segment IDs
- affected time intervals
- structural metadata changes

## Auto-merge Cases

Different tracks:

- User A edits guitar
- User B edits vocals
- Safe to merge

Same track, non-overlapping edits:

- User A trims 0:10-0:20
- User B fades 1:10-1:20
- Usually safe to merge

Metadata changes:

- Comments
- Track names
- Non-conflicting annotations
- Usually safe to merge

## Conflict Cases

Same track, overlapping edits:

- User A trims 0:30-0:45
- User B replaces 0:35-0:50
- Conflict or branch

Structural disagreement:

- User A changes tempo
- User B changes tempo differently
- Conflict, unless tempo is explicitly local-only

Destructive processing conflict:

- User A pitch-shifts a clip
- User B noise-reduces the same clip from the same base
- Create separate TrackVersions or branch

## Related Context

- [[40_FEATURES/versioning-mental-model]]
- [[40_FEATURES/offline-sync-model]]
- [[40_FEATURES/timeline-editing-model]]

