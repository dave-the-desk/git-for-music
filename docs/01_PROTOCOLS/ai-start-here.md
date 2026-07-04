# AI Start Here

This repository is Git for Music.

Before coding, read:

1. [[40_FEATURES/product-thesis]]
2. [[01_PROTOCOLS/non-negotiable-rules]]
3. [[40_FEATURES/versioning-mental-model]]
4. [[40_FEATURES/merge-and-conflict-guide]]
5. [[40_FEATURES/audio-editing-philosophy]]
6. [[40_FEATURES/domain-glossary]]
7. The latest daily log in `docs/daily-logging/`
8. Any branch note in `docs/60_BRANCHES/`
9. [[01_PROTOCOLS/architecture-decision-log]]

Do not treat the app as a normal CRUD app.

The core challenge is preserving musical intent across collaboration, version history, offline changes, and async audio processing.
For browser-style React interaction tests, prefer the lightweight Vitest harness in `src/` (`pnpm --filter @git-for-music/web test` or `pnpm test:web`) with `jsdom` and Testing Library.

## Related Context

- [[00_MAPS/git-for-music-context-index]]
- [[01_PROTOCOLS/agent-implementation-guide]]
- [[40_FEATURES/what-good-looks-like]]
