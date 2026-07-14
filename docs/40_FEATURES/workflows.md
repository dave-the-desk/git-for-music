# Workflows

This note captures the main user- and agent-facing workflows that depend on versioning, merge logic, and audio safety.

## Upload Track Workflow

- User uploads a file into a demo or track.
- The upload should create or update track metadata without overwriting original audio.
- Derived audio and processing status should be tracked separately.
- When naming a newly added track, use the selected checkout the client knows about, not a stale historical view, so collaborators do not generate duplicate `Track N` labels.
- The upload branch source should follow the active checkout. Clicking a version node opens its details pop-up, and the checkout button in that pop-up makes the selected node and the active version stay aligned.
- If the upload lands on a version that already contains a matching track by `trackId` or `trackName`, and one copy is the blank placeholder, silently remove the blank copy. Keep both only when both matching tracks contain real audio.

## Record Track Workflow

- User records new audio into the timeline.
- The recorded material becomes a versioned asset, not a mutable shared blob.
- The recording should land as a new version so every project viewer sees the branch update immediately.
- Recording uses the same source-version resolver as upload: it branches from the active checkout, which is updated when the user chooses the checkout action in a version pop-up, so a second recording after a recent save extends from the node the user actually checked out.
- Once the server copy is live, clear the local recording preview so the committed track replaces the placeholder instead of showing a duplicate lane.
- If recording creates or replays a version with the same track identity or name, remove any blank duplicate track entry on both the client and server so `Track 1` does not appear twice.
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
- Any fade, crossfade, move, split, trim, delete, or offset edit should create a new version boundary.
- These changes should be reversible and visible in history.

## Revert Workflow

- Revert should be represented by choosing the checkout action in a previous version's pop-up.
- Revert should not delete history.
- The tree does not expose a separate revert button inline on the node; the pop-up carries the checkout change.

## Branch Workflow

- Branching should preserve older ideas and let users compare alternatives.
- Branch state should be visible in version history.
- Branch decisions should keep the version graph meaningful rather than flattening it into an undo stack.
- The tree does not expose a separate create-branch button inline on the node; edits from the checked-out version determine whether history stays linear or branches.

## Offline Reconnect Workflow

- Keep local pending operations and audio files while offline.
- Reconnect should upload assets, replay operations, and compare against the latest branch head.
- Safe changes should auto-merge; unsafe changes should branch or conflict.

## Related Context

- [[40_FEATURES/versioning-mental-model]]
- [[40_FEATURES/merge-and-conflict-guide]]
- [[40_FEATURES/offline-sync-model]]
- [[01_PROTOCOLS/non-negotiable-rules]]
