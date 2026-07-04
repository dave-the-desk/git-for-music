# Branching and Revert Rules

Branches are first-class.
The version model is a graph, not a linear undo stack.

## Revert

- Revert is not destructive.
- Revert creates a new version based on a previous version.
- The reverted state should still be represented in history.

## Branching

- Branching preserves prior ideas instead of erasing them.
- Older ideas can be revisited without losing current work.
- Branches should be visible in version history and comparison views.
- Ordinary accepted edits should checkpoint the current head after commit
  instead of forking a new realtime edit branch for every mutation.
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
