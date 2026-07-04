# Audio Editing Philosophy

The editor should follow a mastering-inspired philosophy:

- Preserve source quality
- Avoid unnecessary processing
- Prefer reversible edits
- Track what happened
- Make changes intentionally
- Respect musical context
- Use objective metadata where possible
- Do not assume louder means better
- Do not hide quality loss from the user

Editing tools should operate on timeline regions and metadata first.

## Examples

- Trim = segment boundary metadata or derived TrackVersion
- Fade = `fadeInMs` / `fadeOutMs` metadata
- Crossfade = relationship between adjacent or overlapping segments
- Merge = new segment representation that preserves source traceability
- Pitch shift = derived TrackVersion, never overwrite source
- Noise reduction = derived TrackVersion with operation metadata

## Related Context

- [[40_FEATURES/masteringaudio-inspired-principles]]
- [[40_FEATURES/timeline-editing-model]]
- [[40_FEATURES/merge-and-conflict-guide]]
- [[40_FEATURES/storage-model]]

