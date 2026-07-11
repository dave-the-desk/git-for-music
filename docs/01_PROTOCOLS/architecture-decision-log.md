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

## ADR-004: Uploaded plugin modules are access-gated same-origin code

Decision:
User-uploaded plugin modules are served through authenticated same-origin proxy routes, not public object-storage URLs.

Reason:
WAM plugins are JavaScript modules that run in the collaborator's browser context. Access checks must stay server-side, and module responses must keep same-origin identity so dynamic `import()` can load them.

Consequence:
Plugin module responses use JavaScript content type, `X-Content-Type-Options: nosniff`, and no-store caching. Do not add a CSP `sandbox` directive to the module response, because that makes the module an opaque/null-origin resource and breaks same-origin dynamic import.

## Related Context

- [[01_PROTOCOLS/non-negotiable-rules]]
- [[40_FEATURES/merge-and-conflict-guide]]
- [docs/architecture/daw-realtime-sync.md](../../docs/architecture/daw-realtime-sync.md)
