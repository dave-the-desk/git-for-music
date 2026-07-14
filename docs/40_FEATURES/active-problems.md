# Active Problems

This is a living file for confirmed implementation issues and investigation notes.

Use it for problems that future agents should know about immediately.

## Current Status

The following sync gaps are visible in source as of 2026-07-14:

| Area | Evidence | Current interpretation |
|---|---|---|
| Reconnect after a remote trim with a queued local trim | Skipped test `ProjectSyncEngine converges on reconnect after a remote accepted trim and a queued local trim` in `src/app/lib/daw/engine/project-sync-engine.test.ts`; the 2026-07-14 daily log records that the bootstrap variant still reflects current engine behavior | Confirmed behavior and coverage gap in the end-to-end bootstrap reconnect path; the lower-level queue-rebase coverage passes |
| Persisting pending segment moves into bootstrap state | Skipped test `ProjectSyncEngine replays pending segment moves into bootstrap state and persists them` in the same file | Unverified behavior; keep distinct from reducer-level segment-move identity coverage |
| Replaying accepted segment moves after a new branch/version | Skipped test `ProjectSyncEngine branches and replays accepted segment moves into the new version` in the same file | Unverified branch-transition behavior |

These entries do not invalidate the passing reducer convergence and reconnect
queue-rebase suites. They identify broader engine paths that are not currently
guaranteed by an enabled regression test.

Previously listed product issues have source-backed fixes:

- Segment moves preserve track/source identity through `applySegmentMove(...)`, with reducer coverage in `src/app/lib/daw/state/operation-reducer.test.ts`.
- Follow-head checkout behavior is covered by `DemoUserActiveVersion` and reducer tests for branch/head advancement.
- The blank duplicate-track-after-recording issue is resolved and documented in [[40_FEATURES/daw-add-track-duplicate-after-recording]].

When adding a new entry, include the expected behavior, observed behavior, likely source area, and a verification path.

## Related Context

- [[40_FEATURES/versioning-mental-model]]
- [[40_FEATURES/merge-and-conflict-guide]]
- [[01_PROTOCOLS/agent-implementation-guide]]
