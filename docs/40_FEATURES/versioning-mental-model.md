# Versioning Mental Model

A Demo is the persistent musical idea.

A DemoVersion is a snapshot of the idea at a point in time.

A Track is a logical lane or role in the demo.

A TrackVersion is the audio state of that track within a specific demo version.

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

## Related Context

- [[40_FEATURES/branching-and-revert-rules]]
- [[40_FEATURES/merge-and-conflict-guide]]
- [[40_FEATURES/offline-sync-model]]
- [docs/architecture/daw-realtime-sync.md](../../docs/architecture/daw-realtime-sync.md)

