# Agent Implementation Guide

When modifying the codebase:

1. Preserve the versioning model.
2. Do not overwrite original audio.
3. Prefer operation-based changes over direct mutation.
4. Keep realtime events lightweight.
5. Keep object storage separate from metadata.
6. Add processing work through jobs, not blocking API routes.
7. Update documentation in touched areas.
8. Add tests for reducer, merge, and sync logic when behavior changes.
9. Treat offline sync as a first-class path, not an edge case.
10. Avoid adding UI that cannot be represented in the version graph.
11. For browser-style React interaction coverage, use the web Vitest harness in `src/` (`pnpm --filter @git-for-music/web test` or `pnpm test:web`) with `jsdom` and Testing Library.
12. For recording or any audio-tool action, ensure the change creates a new version and broadcasts the tree update to all project viewers.

Before implementing a feature, answer:

- What entity owns this state?
- Is this local-only or shared?
- Does this create a new DemoVersion?
- Does this create a new TrackVersion?
- Is the original audio preserved?
- Does this audio change create a new version boundary for everyone in the project?
- Can this operation be replayed?
- Can it conflict with another operation?
- How does it behave offline?
- What realtime event, if any, should other users see?

## Related Context

- [[01_PROTOCOLS/non-negotiable-rules]]
- [[40_FEATURES/versioning-mental-model]]
- [[40_FEATURES/merge-and-conflict-guide]]
- [[40_FEATURES/offline-sync-model]]
