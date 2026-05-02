# Processing Jobs

This repo currently has a local, database-backed processing flow. The future AWS pipeline should use the same job concepts, but move the queue boundary to SQS and the processor boundary to ECS Fargate.

## Job Lifecycle

The future production lifecycle should use these states:

- `QUEUED`
- `PROCESSING`
- `COMPLETED`
- `FAILED`

Current local development still uses the legacy database values:

- `PENDING`
- `PROCESSING`
- `COMPLETE`
- `FAILED`

The migration path should map the queue-facing lifecycle onto the database-backed implementation without forcing a full rewrite of the current app.

## Safe First Jobs

These job types are good early candidates because they are read-heavy and have limited side effects:

- `WAVEFORM_GENERATION`
- `DURATION_ANALYSIS`
- `BASIC_AUDIO_METADATA`

## Later Jobs

These jobs can be added after the storage, queue, and worker path is stable:

- `TEMPO_ANALYSIS`
- `KEY_ANALYSIS`
- `VOCAL_DETECTION`
- `TRANSCRIPTION`
- `PITCH_SHIFT`
- `TIME_STRETCH`

## Payload Shape

Future queue messages should carry enough data for a worker to run without extra lookups beyond the database row and object storage:

- `processingJobId`
- `demoId`
- `demoVersionId`
- `trackId`
- `trackVersionId`
- `operationType`
- `inputStorageKey`
- `outputStoragePrefix`

The worker should treat the original audio object as immutable and write derived outputs into a separate prefix.

## Operational Notes

- Queue messages should be idempotent when possible.
- Workers should mark jobs `PROCESSING` as soon as they start, then move them to `COMPLETED` or `FAILED`.
- Derived outputs should never overwrite the original upload.
- If a job needs multiple derived files, keep them grouped under the same job-specific output prefix.
