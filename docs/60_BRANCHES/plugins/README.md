# Branch: `plugins`

Branch-scoped context for audio-plugin research and design.

## Notes

- [DAW Audio Plugins: A Technical Overview](./daw-plugins-technical-overview.md) — how plugins work at a technical level, and a survey of VST 3 / VST-MA, LV2, JUCE, WAM 2.0, Kronos VST, and HARP 2.0, grounded in `docs/papers/daw-plugins/` and the linked specifications.
- [How Audio Plugins Can Work Inside This DAW](./daw-plugins-in-this-daw.md) — maps those models onto this repo's actual architecture (browser playback engine, versioning, realtime sync); WAM 2.0 as real-time inserts and HARP-style remote/async processing as versioned server renders.
- [Plugin Feature — Implementation Checklist](./daw-plugins-implementation-checklist.md) — phased, file-referenced build-out for shipping the feature.

## Scope

- Understand the host↔plugin contract (real-time audio thread, parameters, MIDI, state).
- Compare native, web, programmable, and networked/AI plugin models.
- Identify which models fit a web-native, collaborative, server-backed DAW.
