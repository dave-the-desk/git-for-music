# Audio Worker

This worker is the production-ready shape for future ECS Fargate processing, but it still supports the current local Postgres-backed flow.

## Required Environment Variables

Local and production runs should define:

- `DATABASE_URL`
- `POLL_INTERVAL_SECONDS`
- `WEB_PUBLIC_DIR` for local file-backed development

Future AWS/SQS runs should also define:

- `AWS_REGION`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_S3_BUCKET`
- `AWS_S3_AUDIO_PREFIX`
- `AWS_SQS_AUDIO_QUEUE_URL`

## Local Run

Run the worker directly from this directory:

```bash
python main.py
```

Or use the existing helper scripts if you want the Dockerized local workflow:

```bash
./build-and-run.sh
```

## ECS Fargate Notes

- Build the image from `workers/audio/Dockerfile`.
- Use a task definition with the production environment variables injected.
- Give the task role permission to poll SQS and read/write S3 objects.
- Keep the task small at first and scale on queue depth.
- Send worker logs to CloudWatch.

## SQS Polling Behavior

The future AWS version should poll `AWS_SQS_AUDIO_QUEUE_URL`, claim one message at a time when possible, and acknowledge the message only after the database and S3 updates succeed.

Until that migration is wired up, the worker may continue to poll PostgreSQL directly in local development.

## S3 Input/Output Behavior

- The worker must treat the input audio object as immutable.
- Derived artifacts should be written under a separate job-specific prefix.
- Inputs should be read from the original audio key stored on the track version row.
- Outputs should be stored under `derived/{jobId}/...` so they never overwrite the source file.

## Processing Job Lifecycle

The future queue-backed lifecycle should be:

- `QUEUED`
- `PROCESSING`
- `COMPLETED`
- `FAILED`

The current local implementation still maps closely to the database-backed lifecycle in the app, but the worker should always move jobs forward safely and never mutate the source media in place.
