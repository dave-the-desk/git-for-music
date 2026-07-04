# DAW Realtime Collaboration Plan

This plan turns the paper notes into a concrete repo roadmap.

## Goal

Move the DAW toward OT-style collaborative editing for timeline and metadata actions while keeping audio blobs, processing jobs, and transient presence out of the realtime data plane.

## Principles

- Original audio remains immutable.
- Realtime should carry lightweight operations and metadata, not media files.
- Safe concurrent edits should transform or rebase instead of branching.
- Branches remain the escape hatch for edits that cannot be merged safely.
- Per-user checkout stays separate from shared head metadata.

## Phase 1 - Define A Transformable Shared Operation Model

- Normalize the collaborative surface to a small set of replayable timeline and metadata operations.
- Add pure transform helpers for move, trim, split, merge, fade, rename, comment, annotation, and version metadata actions.
- Make the accepted operation shape explicit about what was replayed, what was transformed, and what was preserved from the user intent.
- Add reducer tests that prove two safe concurrent edits converge to the same state.
- Likely files: [src/app/lib/daw/state/operation-reducer.ts](../../src/app/lib/daw/state/operation-reducer.ts), [src/app/lib/daw/state/local-operation-queue.ts](../../src/app/lib/daw/state/local-operation-queue.ts), [src/app/lib/daw/state/selectors.ts](../../src/app/lib/daw/state/selectors.ts).

## Phase 2 - Rework The Server Commit Path

- Rebase an incoming edit against intervening accepted operations before the commit is finalized.
- Keep branch creation as a fallback only when transforms cannot preserve intent.
- Preserve the current durable log and snapshot checkpointing model, but make accepted operations the product of a transform step instead of only a conflict check.
- Keep `accepted_operation` broadcasts and snapshot refreshes, but make them represent the post-transform canonical edit.
- Likely files: [packages/server/app/lib/daw/server/command-api.ts](../../packages/server/app/lib/daw/server/command-api.ts), [packages/server/app/lib/daw/server/conflict-rules.ts](../../packages/server/app/lib/daw/server/conflict-rules.ts), [packages/server/app/lib/daw/server/snapshot-builder.ts](../../packages/server/app/lib/daw/server/snapshot-builder.ts).

## Phase 3 - Rework Client Replay And Reconnect

- Keep the optimistic local queue, but replay it through the same transform logic used by the server.
- Ensure remote accepted operations are applied in a way that preserves pending local intent.
- Preserve the viewer checkout and active branch state across bootstrap, reconnect, and history scrubbing.
- Add tests for reconnect after concurrent local and remote edits.
- Likely files: [src/app/lib/daw/engine/project-sync-engine.ts](../../src/app/lib/daw/engine/project-sync-engine.ts), [src/app/lib/daw/engine/project-sync-engine.test.ts](../../src/app/lib/daw/engine/project-sync-engine.test.ts), [src/app/lib/daw/state/operation-reducer.test.ts](../../src/app/lib/daw/state/operation-reducer.test.ts).

## Phase 4 - Expand The Collaborative Surfaces

- Bring timeline edits, comments, annotations, and version metadata into the same collaboration model.
- Keep presence, transport state, and local-only UI preferences on a separate realtime lane.
- Keep asset uploads, waveform generation, and other processing work in the job pipeline, not in the editor sync loop.
- Likely files: [packages/server/app/lib/daw/server/realtime-gateway.ts](../../packages/server/app/lib/daw/server/realtime-gateway.ts), [packages/server/app/lib/daw/server/presence-service.ts](../../packages/server/app/lib/daw/server/presence-service.ts), [packages/server/app/lib/daw/server/jobs/index.ts](../../packages/server/app/lib/daw/server/jobs/index.ts).

## Phase 5 - Prove The New Model

- Add concurrency tests for non-overlapping edits, overlapping edits, and same-base replay.
- Add offline and reconnect tests that prove the local queue converges after remote activity.
- Add version-tree tests that verify shared head state and per-user checkout stay separate.
- Add a rollout checklist that makes it obvious which operations are still branch-only.
- Likely files: [packages/server/app/lib/daw/server/command-api.test.ts](../../packages/server/app/lib/daw/server/command-api.test.ts), [packages/server/app/lib/daw/server/snapshot-builder.test.ts](../../packages/server/app/lib/daw/server/snapshot-builder.test.ts), [packages/server/app/lib/daw/server/versioning.test.ts](../../packages/server/app/lib/daw/server/versioning.test.ts), [src/app/lib/daw/engine/project-sync-engine.test.ts](../../src/app/lib/daw/engine/project-sync-engine.test.ts), [src/app/lib/daw/state/operation-reducer.test.ts](../../src/app/lib/daw/state/operation-reducer.test.ts).

## Definition Of Done

- Two clients can make safe concurrent timeline edits and converge without an explicit branch.
- Unsafe overlap still branches or conflicts deterministically.
- Reconnect preserves user intent and pending local operations.
- Audio blobs never enter the realtime transport.
- The editor still bootstraps from compact state plus operation history.
