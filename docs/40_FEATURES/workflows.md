# Workflows

This note captures the main user- and agent-facing workflows that depend on versioning, merge logic, and audio safety.

## Upload Track Workflow

- User uploads a file into a demo or track.
- The upload should create or update track metadata without overwriting original audio.
- Derived audio and processing status should be tracked separately.

## Record Track Workflow

- User records new audio into the timeline.
- The recorded material becomes a versioned asset, not a mutable shared blob.
- The resulting state should remain branchable and reversible.

## Move Segment Workflow

- Moving a segment should preserve track identity unless the user explicitly moves it to another track.
- The operation should be represented in the version graph.
- Move conflicts should be judged by track identity and time overlap.

## Split Segment Workflow

- Splitting a segment creates two versioned timeline regions from one source region.
- The split should preserve traceability back to the original audio.
- The editor should keep the shared timeline model consistent after the split.

## Fade and Crossfade Workflow

- Fades should be represented as metadata first, not destructive edits.
- Crossfades should describe the relationship between adjacent or overlapping regions.
- These changes should be reversible and visible in history.

## Revert Workflow

- Revert should create a new version from a previous version.
- Revert should not delete history.
- Revert should keep collaborators oriented about which branch they are on.

## Branch Workflow

- Branching should preserve older ideas and let users compare alternatives.
- Branch state should be visible in version history.
- Branch decisions should keep the version graph meaningful rather than flattening it into an undo stack.

## Offline Reconnect Workflow

- Keep local pending operations and audio files while offline.
- Reconnect should upload assets, replay operations, and compare against the latest branch head.
- Safe changes should auto-merge; unsafe changes should branch or conflict.

## Related Context

- [[40_FEATURES/versioning-mental-model]]
- [[40_FEATURES/merge-and-conflict-guide]]
- [[40_FEATURES/offline-sync-model]]
- [[01_PROTOCOLS/non-negotiable-rules]]

