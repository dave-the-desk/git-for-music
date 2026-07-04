# Domain Glossary

Definitions are written in product language, not just database language.

## Demo

A persistent musical idea.

A demo may have many versions, branches, tracks, comments, annotations, and processing jobs.

## DemoVersion

A snapshot of a demo's musical state.

Contains shared timeline assumptions:

- tempo
- time signature
- key
- structure
- branch
- parent version

## Track

A logical musical lane.

Examples:

- lead vocal
- rhythm guitar
- bass
- drums
- reference track
- scratch vocal

## TrackVersion

The actual audio state of a track in a specific DemoVersion.

A TrackVersion may point to:

- original uploaded audio
- recorded audio
- processed derived audio
- edited audio state

## Segment

A time range of a TrackVersion on the shared timeline.

Used for:

- trimming
- splitting
- fading
- moving
- conflict detection
- annotation targeting

## ProcessingJob

An async task that analyzes or transforms audio.

Examples:

- waveform generation
- tempo detection
- key detection
- transcription
- pitch shifting
- noise reduction
- vocal detection

## Related Context

- [[40_FEATURES/versioning-mental-model]]
- [[40_FEATURES/processing-job-philosophy]]
- [packages/db/prisma/schema.prisma](../../packages/db/prisma/schema.prisma)

