# Branching and Revert Rules

Branches are first-class.
The version model is a graph, not a linear undo stack.

## Revert

- Revert is not destructive.
- Revert creates a new version based on a previous version.
- The reverted state should still be represented in history.
- In the current implementation, revert is committed as a new accepted version
  node so history keeps the old state and the new head.

## Branching

- Branching preserves prior ideas instead of erasing them.
- Older ideas can be revisited without losing current work.
- Branches should be visible in version history and comparison views.
- Ordinary accepted edits should checkpoint the current head after commit
  instead of forking a new realtime edit branch for every mutation.
- Upload and recording commits should branch from the freshest committed version the client knows about, not from an in-flight active-version update.
- Safe concurrent timeline edits should rebase and converge on the same branch
  head; branch/409 fallback is reserved for overlap the transform layer cannot
  preserve.
- Use a separate explicit branch flow when the user intentionally asks to fork,
  or when legacy behavior is required behind a rollout flag.

## Checkout

- The current version is not simply the global latest version.
- Each user may have an active version.
- Users can follow the head of a branch, but they should not be forced onto another branch unexpectedly.

## Related Context

- [[40_FEATURES/versioning-mental-model]]
- [[40_FEATURES/merge-and-conflict-guide]]
- [[01_PROTOCOLS/non-negotiable-rules]]
