# DAW Library Area

This is the active home for DAW work in `src/app/lib/daw`.

New DAW logic should go here first.

- DAW UI components live alongside the demo page under `src/app/pages/groups/demo/components/daw`.
- `engine/` for browser-side engines such as playback, editing, ingest, and sync.
- `hooks/` for React hooks that bridge DAW state into the UI.
- `rendering/` for visual projection helpers used by the DAW UI.
- `state/` for feature state, reducers, and state helpers.
- `utils/` for pure timing, segment, recording, and label helpers.
- `server/` for server-side feature helpers used by routes and loaders.
- `protocol/` for message and type definitions shared across browser and server code.
- Browser audio should use the same-origin audio route and shared URL helpers, not raw storage keys.
