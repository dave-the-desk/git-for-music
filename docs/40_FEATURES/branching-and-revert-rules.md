# Branching and Revert Rules

Branches are first-class.
The version model is a graph, not a linear undo stack.

## Revert

- Revert is not destructive.
- Revert creates a new version based on a previous version.
- The reverted state should still be represented in history.
- In the current implementation, revert is committed as a new accepted version
  node so history keeps the old state and the new head.
- The version tree does not expose a separate revert button inline on the node;
  the node details pop-up provides the action to go back to that version.

## Branching

- Branching preserves prior ideas instead of erasing them.
- Older ideas can be revisited without losing current work.
- Branches should be visible in version history and comparison views.
- Selecting a version node opens the node details pop-up for that version.
- The pop-up includes the checkout action for that version.
- Edits from a checked-out version extend the linear chain when that node is still a leaf, and create a new child branch when another child already exists from the same node.
- Ordinary accepted edits should checkpoint the current head after commit
  instead of forking a new realtime edit branch for every mutation.
- Upload and recording commits should branch from the viewer's active checkout, which is kept in sync with the selected version node.
- Safe concurrent timeline edits should rebase and converge on the same branch
  head; branch/409 fallback is reserved for overlap the transform layer cannot
  preserve.

## Checkout

- The current version is not simply the global latest version.
- Each user may have an active version.
- Users can follow the head of a branch, but they should not be forced onto another branch unexpectedly.
- There is no separate branch button inline in the tree; branch selection still
  happens from the checked-out version after the pop-up checkout action.

## Related Context

- [[40_FEATURES/versioning-mental-model]]
- [[40_FEATURES/merge-and-conflict-guide]]
- [[01_PROTOCOLS/non-negotiable-rules]]
