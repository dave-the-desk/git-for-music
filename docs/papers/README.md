# Sync Papers and DAW Gap Analysis

This folder contains three papers that are directly relevant to real-time collaborative editing in the DAW.

## Papers

- [High-Latency, Low-Bandwidth Windowing in the Jupiter Collaboration System](./215585.215706.pdf)
  - Central server, shared widgets, and optimistic concurrency control.
  - Client and server keep copies of widget state and exchange high-level widget events.
  - Conflicting messages are reconciled with operation transformations.
- [Operational Transformation in Real-Time Group Editors: Issues, Algorithms, and Achievements](./289444.289469.pdf)
  - Survey of the OT literature and the core correctness goals.
  - Focuses on convergence, causality preservation, and intention preservation.
  - Discusses control algorithms and the TP1/TP2 style conditions used to reason about transforms.
- [Specification and Implementation of Replicated List: The Jupiter Protocol Revisited](./1708.04754v4.pdf)
  - Recasts Jupiter as a replicated list system with a compact state-space model.
  - Proves the Jupiter protocol satisfies the weak list specification.
  - Shows each replica behavior can be understood as a path through a shared ordered state space.

## What The Papers Have In Common

- The system is collaborative first, not CRUD first.
- Local actions are applied immediately, then propagated asynchronously.
- Shared state is replicated and reconciled by transform or rebase logic.
- Correctness is measured by convergence plus preservation of user intent and causal order.
- The server is authoritative for ordering, but not for blocking the user interface.

## Current Repo Model

- [src/app/lib/daw/engine/project-sync-engine.ts](../../src/app/lib/daw/engine/project-sync-engine.ts) bootstraps from snapshots plus an operation tail, then replays accepted operations into `LocalProjectState`.
- [packages/server/app/lib/daw/server/command-api.ts](../../packages/server/app/lib/daw/server/command-api.ts) commits operations into the durable log, checks for conflicts, and branches or rejects unsafe edits.
- [packages/server/app/lib/daw/server/conflict-rules.ts](../../packages/server/app/lib/daw/server/conflict-rules.ts) compares track IDs, segment IDs, and timeline ranges to decide whether an edit conflicts.
- [packages/server/app/lib/daw/server/snapshot-builder.ts](../../packages/server/app/lib/daw/server/snapshot-builder.ts) rebuilds canonical state from snapshots and later operations.
- [packages/server/app/lib/daw/server/realtime-gateway.ts](../../packages/server/app/lib/daw/server/realtime-gateway.ts) broadcasts accepted operations, presence, asset status, and version-tree events.
- [packages/server/app/lib/daw/server/demo-user-active-version.ts](../../packages/server/app/lib/daw/server/demo-user-active-version.ts) keeps checkout state per user, separate from shared head metadata.

## Gap Analysis

- The repo does not currently have an OT or rebase layer for DAW timeline edits.
- Accepted payloads are applied directly to canonical state rather than transformed against concurrent remote edits.
- Concurrent overlap is usually handled by conflict detection, branching, or a 409 response.
- The current architecture is closer to versioned event sourcing with optimistic local replay than to a Jupiter-style shared editing model.
- Transport, presence, and local UI settings are intentionally separate from durable collaboration state, which is correct and should stay that way.
- Audio payloads stay out of realtime, which also matches the paper guidance.

## What Should Move Toward The Paper Model

- Timeline edits should become transformable and replayable collaborative operations.
- Safe concurrent edits should converge without forcing a branch.
- Branches should remain a fallback for semantically unsafe overlap, not the default reconciliation path.
- Shared editor state should stay compact enough to bootstrap and reconnect without stale props.
- The DAW should keep immutable audio storage and lightweight realtime messages.

## Next Reading

- [Realtime collaboration plan](./realtime-collaboration-plan.md)
- [DAW realtime sync model](../architecture/daw-realtime-sync.md)
- [Merge and conflict guide](../40_FEATURES/merge-and-conflict-guide.md)
