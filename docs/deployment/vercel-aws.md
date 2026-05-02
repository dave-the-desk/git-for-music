# Vercel + AWS Deployment Plan

This repository is being prepared for a future production deployment that splits responsibilities across Vercel and AWS:

`Browser -> Vercel Next.js app/API -> RDS PostgreSQL -> S3 audio storage -> SQS queue -> ECS Fargate Python worker -> S3/RDS updates`

The goal is to keep the Next.js app lightweight on Vercel, move durable state to AWS, and reserve long-running audio processing for workers that can scale independently.

## Target Architecture

- The browser talks to the Next.js app on Vercel for UI, API routes, and lightweight request validation.
- The app stores relational data in RDS PostgreSQL.
- Audio files live in S3, not in the web app filesystem.
- The app enqueues audio work to SQS.
- ECS Fargate runs Python workers that poll SQS, download input audio from S3, process it, write derived artifacts back to S3, and update PostgreSQL.
- Cognito is reserved as a future auth provider so the auth boundary can move off the current local/session approach later without reworking the deployment layout.

## Required Environment Variables

Use `.env.production.example` as the starting point for production secrets and URLs.

- `DATABASE_URL`
- `DIRECT_URL`
- `AWS_REGION`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_S3_BUCKET`
- `AWS_S3_AUDIO_PREFIX`
- `AWS_S3_PUBLIC_BASE_URL`
- `AWS_SQS_AUDIO_QUEUE_URL`
- `NEXT_PUBLIC_COGNITO_USER_POOL_ID`
- `NEXT_PUBLIC_COGNITO_CLIENT_ID`
- `NEXT_PUBLIC_COGNITO_REGION`
- `NEXT_PUBLIC_APP_URL`
- `NODE_ENV=production`

## Local vs Production Differences

- Local development can keep using Docker Postgres and the current public-file-based audio flow.
- Production should use RDS for the database and S3 for audio objects.
- Local workers currently poll Postgres directly; the future production worker should poll SQS.
- Local audio paths may still resolve through `apps/web/public/uploads`, while production should treat the storage key as an S3 object key.
- Cognito is not required for the current local workflow and should not be forced into the app yet.

## Vercel Deployment Settings

- Point the Vercel project at `apps/web`.
- Set the production environment variables listed above.
- Keep the Next.js app/API routes lightweight.
- Avoid putting long-running audio work into Vercel serverless functions.
- Use runtime-appropriate route handlers for simple validation, authentication checks, and job enqueueing only.
- Make sure any database access from Vercel uses the RDS `DATABASE_URL`.
- Keep a `NEXT_PUBLIC_APP_URL` value that matches the deployed Vercel domain.

## AWS Service Checklist

- RDS PostgreSQL
  - Create a production database and security group.
  - Allow access only from Vercel serverless egress ranges if applicable and from ECS worker tasks.
  - Keep backups and point-in-time recovery enabled.
- S3
  - Create one bucket for audio artifacts.
  - Use a predictable prefix layout for original and derived files.
  - Block public writes.
  - Prefer private objects with presigned access.
- SQS
  - Create a queue for audio processing jobs.
  - Configure a dead-letter queue for failed messages.
  - Set a visibility timeout that comfortably exceeds expected processing time.
- IAM
  - Give the Vercel app only the minimum AWS permissions it needs, ideally through presigned URL generation only.
  - Give the worker task role permission to read/write S3 objects, poll SQS, and update RDS.
- Cognito
  - Prepare a user pool and app client only when the auth migration is ready.
  - Keep it out of the critical path until the app is ready to consume it.

## Worker Deployment Checklist

- Build the Python worker into a Docker image suitable for ECS Fargate.
- Install ffmpeg and any native audio dependencies the worker needs.
- Inject the production environment variables at task definition time.
- Give the task an IAM role that can poll SQS and access S3.
- Run enough worker tasks to handle the expected queue depth, but start small.
- Make sure workers can fail fast and requeue or dead-letter jobs when something is unrecoverable.
- Keep worker logs structured enough for CloudWatch troubleshooting.

## Database Migration Workflow

- Keep Prisma migrations as the source of truth for schema changes.
- Apply migrations in staging first, then production.
- Validate that any new storage or queue fields still support the current local workflow before flipping the production path over.
- Back up RDS before destructive schema changes.
- Prefer additive migrations when introducing AWS-facing fields such as queue message IDs, storage prefixes, or auth provider metadata.
- Use `DIRECT_URL` for migration tooling that should bypass pooled or proxied connections if needed.

## Security Notes

- Never store raw AWS secrets in source control.
- Use presigned S3 URLs rather than making audio buckets public.
- Keep the worker task role narrow and separate from the web app role.
- Restrict RDS access to trusted service networks only.
- Treat audio object keys as opaque identifiers, not user input for filesystem paths.
- Do not move the app to Cognito until the sign-in and session flow is explicitly designed for it.

## Cost-Control Notes

- Start with small ECS Fargate task sizes and scale only if queue depth demands it.
- Set SQS retention and dead-letter policies intentionally so failed jobs do not churn forever.
- Use lifecycle policies on S3 for temporary or intermediate artifacts if they are not needed long term.
- Choose an RDS instance size that matches current load, then watch CPU, memory, and connection counts closely.
- Avoid overprovisioning workers when the queue is mostly idle.
- Prefer short-lived presigned access over persistent public storage where possible.
