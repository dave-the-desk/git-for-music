# Architecture Decision Log

## ADR-001: Audio is immutable

Decision:
Original audio files are never overwritten.

Reason:
Audio cannot be safely merged like text, and destructive edits would break version history.

Consequence:
All edits must be metadata, operations, derived files, TrackVersions, or DemoVersions.

## ADR-002: Realtime is lightweight

Decision:
Realtime sync sends state changes, not large audio files.

Reason:
Audio belongs in object storage. Realtime should remain fast and reliable.

Consequence:
Clients receive metadata updates and fetch audio through signed URLs.

## ADR-003: Merge by timeline overlap

Decision:
Conflicts are detected by track identity and time range overlap.

Reason:
Waveform-level merge is unrealistic for collaborative audio editing.

Consequence:
The app can auto-merge safe edits and branch conflicting edits.

## Related Context

- [[01_PROTOCOLS/non-negotiable-rules]]
- [[40_FEATURES/merge-and-conflict-guide]]
- [docs/architecture/daw-realtime-sync.md](../../docs/architecture/daw-realtime-sync.md)

