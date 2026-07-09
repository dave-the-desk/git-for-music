# Versioning Mental Model

A Demo is the persistent musical idea.

A DemoVersion is a snapshot of the idea at a point in time.

Automatic version saving creates additional DemoVersion nodes from accepted
operations after commit. Those checkpoints represent converged branch head
states, not realtime edit transport events.

Recording and any audio-tool edit that touches timeline content should be
treated as a version boundary, so the resulting DemoVersion appears to every
viewer as soon as the commit lands.

Implemented version nodes also carry a provenance `kind` and `operationSeq`
metadata so the Tree tab can order and label them without replaying the full
operation log.

A Track is a logical lane or role in the demo.

A TrackVersion is the audio state of that track within a specific demo version.

TrackVersion state also includes the ordered plugin insert chain for that track version. Plugin instances are versioned with the track, so branching and reverting carry the chain forward with the rest of the version snapshot.

A Segment is a time-bounded region of a TrackVersion.

## Version Graph

The version graph should support:

- linear history
- branching
- reverting
- comparing
- merging
- conflict forks

The current version is not simply "latest globally."
Each user may have an active version, similar to a Git checkout.

Users can follow the head of a branch, but they should not be forced onto another user's branch unexpectedly.

For commit-producing audio actions, the client should resolve the branch source from the freshest committed version it knows about, not from a stale active-version snapshot that may still be waiting on an async round trip.

Automatic version saving should advance the active head by checkpointing the
accepted state, while preserving the version graph as a durable history of
meaningful checkpoints.

In practice, the current system checkpoints the converged head after accepted
operations, creates non-destructive revert versions as new nodes, and lets safe
concurrent edits converge before the branch fallback is used.

Branch/version copy logic should preserve each track version's plugin chain as part of the copied track state. If a plugin has large opaque state, the version should reference it by key rather than embedding binary data in the snapshot.

## Related Context

- [[40_FEATURES/branching-and-revert-rules]]
- [[40_FEATURES/merge-and-conflict-guide]]
- [[40_FEATURES/offline-sync-model]]
- [docs/architecture/daw-realtime-sync.md](../../docs/architecture/daw-realtime-sync.md)
