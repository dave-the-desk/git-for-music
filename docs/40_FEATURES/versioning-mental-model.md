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

Clicking a version node should open a details pop-up for that node.
The pop-up includes the checkout action, so the viewer can make that node the
active checkout from the node details surface.
If the checkout is following head, it should advance with the branch head.
If the checkout is pinned, it should stay on the selected node until the user changes it.
The tree does not expose separate branch or revert buttons inline on the node;
subsequent edits from that checkout branch when the history graph requires it.

When a user edits from a checked-out version:

- if that version is still the only child of its parent, history stays linear
- if another child already exists from that node, the new edit creates another child and the history branches there

Users can follow the head of a branch, but they should not be forced onto another user's branch unexpectedly.

For commit-producing audio actions, the client should resolve the branch source from the selected checkout, which is the authoritative source for edit-producing actions.

Automatic version saving should advance the active head by checkpointing the
accepted state, while preserving the version graph as a durable history of
meaningful checkpoints.

In practice, the current system checkpoints the converged head after accepted
operations, creates non-destructive revert versions as new nodes, and lets safe
concurrent edits converge while the checked-out version remains the source for
subsequent edits.

Branch/version copy logic should preserve each track version's plugin chain as part of the copied track state. If a plugin has large opaque state, the version should reference it by key rather than embedding binary data in the snapshot.

## Version History UI Baseline

The version-history rail is rendered as a commit graph and should be treated as
the stable default unless a change is explicitly requested.

- The graph uses a centered row/column layout: sibling branches can sit in
  parallel columns, and a parent is centered above the full span of its
  children.
- The rail header exposes zoom controls in the standard web-app pattern:
  zoom out, zoom percentage/reset, and zoom in.
- Zoom is visual only. It scales the graph viewport without changing the
  underlying layout or version relationships.
- Branch color is semantic, not column-based:
  - nodes on the user’s current branch are blue
  - the current branch head / current checkout node is a lighter blue
  - nodes on other branches are a lighter yellow
  - heads of other branches are a darker yellow
- The legend mirrors those same states so the graph and key always match.
- Selection is a secondary state. It can add emphasis, but it does not replace
  the branch-color meaning of the node.

## Related Context

- [[40_FEATURES/branching-and-revert-rules]]
- [[40_FEATURES/merge-and-conflict-guide]]
- [[40_FEATURES/offline-sync-model]]
- [docs/architecture/daw-realtime-sync.md](../../docs/architecture/daw-realtime-sync.md)
