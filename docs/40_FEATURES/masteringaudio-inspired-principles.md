# MasteringAudio-Inspired Principles

## 1. Art and science must both be represented

The app should expose technical information without making the product feel clinical.

Good:

- waveform
- loudness metadata
- tempo/key detection
- processing history
- version comparison
- clear before/after states

Bad:

- hiding all technical details
- making irreversible changes
- presenting processing as magic

## 2. Every project is unique

Do not force one mastering or editing workflow onto every demo.

A raw acoustic demo, electronic loop, vocal idea, and full band session may need different editing assumptions.

## 3. Tools are only useful when used intentionally

Avoid one-click destructive processing.

Processing jobs should explain:

- what operation was run
- what source it used
- what derived file it created
- what parameters were used
- who triggered it
- when it happened

## 4. Logging matters

Every meaningful audio operation should be reconstructable later.

The system should be able to answer:

- What changed?
- Who changed it?
- From what source?
- In what version?
- With what parameters?
- Can we compare or revert it?

## 5. Quality control is part of the workflow

The app should eventually support validation states:

- waveform generated
- loudness analyzed
- clipping detected
- silence detected
- processing completed
- processing failed
- asset missing

## Related Context

- [[40_FEATURES/audio-editing-philosophy]]
- [[40_FEATURES/processing-job-philosophy]]
- [docs/processing-jobs.md](../../docs/processing-jobs.md)

