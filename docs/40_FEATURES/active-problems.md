# Active Problems

This is a living file for confirmed implementation issues and investigation notes.

Use it for problems that future agents should know about immediately.

## Current Status

No confirmed active problems are recorded here as of 2026-07-11.

Previously listed items have source-backed fixes:

- Segment moves preserve track/source identity through `applySegmentMove(...)`, with reducer coverage in `src/app/lib/daw/state/operation-reducer.test.ts`.
- Follow-head checkout behavior is covered by `DemoUserActiveVersion` and reducer tests for branch/head advancement.
- The blank duplicate-track-after-recording issue is resolved and documented in [[40_FEATURES/daw-add-track-duplicate-after-recording]].

When adding a new entry, include the expected behavior, observed behavior, likely source area, and a verification path.

## Related Context

- [[40_FEATURES/versioning-mental-model]]
- [[40_FEATURES/merge-and-conflict-guide]]
- [[01_PROTOCOLS/agent-implementation-guide]]
