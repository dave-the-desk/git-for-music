# Storage Model

Audio storage and metadata storage are separate concerns.

## Storage Rules

- Original audio should be immutable.
- Derived assets should live under separate storage prefixes.
- Object storage should store large media.
- The app should fetch audio through signed URLs or the same-origin audio proxy route.

## Why This Matters

- Preserves version history
- Makes reprocessing safe
- Keeps realtime messages lightweight
- Avoids coupling metadata updates to audio blobs

## Related Context

- [packages/shared/src/storage.ts](../../packages/shared/src/storage.ts)
- [packages/server/app/lib/daw/server/storage.ts](../../packages/server/app/lib/daw/server/storage.ts)
- [src/app/api/daw/track-versions/[trackVersionId]/audio/route.ts](../../src/app/api/daw/track-versions/[trackVersionId]/audio/route.ts)
- [[01_PROTOCOLS/non-negotiable-rules]]

