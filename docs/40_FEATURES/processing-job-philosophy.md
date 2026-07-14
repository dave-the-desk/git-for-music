# Processing Job Philosophy

Audio processing should be asynchronous, traceable, and derived-output based.

## Rules

- Do not block API routes on heavy audio work.
- Keep raw uploads immutable.
- Write derived outputs into separate storage paths.
- Track status explicitly from queued to completed or failed.
- Attach enough payload context so a worker can do the job without extra guesswork.

## What Jobs Should Explain

- What operation ran
- What source it used
- What derived file it created
- What parameters were used
- Who triggered it
- When it happened

## Related Context

- [processing-jobs architecture](../architecture/processing-jobs.md)
- [[40_FEATURES/masteringaudio-inspired-principles]]
- [[40_FEATURES/storage-model]]
