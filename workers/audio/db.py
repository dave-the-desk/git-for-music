from __future__ import annotations

import os
from typing import Any
from uuid import uuid4

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

DATABASE_URL = os.environ.get('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/git_for_music')


def connect():
    return psycopg.connect(DATABASE_URL, row_factory=dict_row)


def claim_next_job(conn):
    with conn.cursor() as cur:
        cur.execute(
            """
            WITH next_job AS (
              SELECT id
              FROM "ProcessingJob"
              WHERE status = 'PENDING'
              ORDER BY "createdAt" ASC
              LIMIT 1
              FOR UPDATE SKIP LOCKED
            )
            UPDATE "ProcessingJob" AS job
            SET status = 'PROCESSING',
                progress = 0,
                "updatedAt" = NOW()
            FROM next_job
            WHERE job.id = next_job.id
            RETURNING job.id, job.type, job.status, job.progress, job.payload, job.error, job.result,
                      job."trackVersionId" AS "trackVersionId",
                      job."createdById" AS "createdById";
            """
        )
        row = cur.fetchone()
    conn.commit()
    return row


def get_track_version(conn, track_version_id: str):
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              tv.id,
              tv."storageKey" AS "storageKey",
              tv."sourceFileUrl" AS "sourceFileUrl",
              tv."startOffsetMs" AS "startOffsetMs",
              tv."durationMs" AS "durationMs",
              tv."sampleRate" AS "sampleRate",
              tv."channels" AS "channels",
              tv."mimeType" AS "mimeType",
              tv."sizeBytes" AS "sizeBytes",
              tv.checksum,
              tv."isDerived" AS "isDerived",
              tv."operationType" AS "operationType",
              tv."parentTrackVersionId" AS "parentTrackVersionId",
              tv."trackId" AS "trackId",
              tv."demoVersionId" AS "demoVersionId",
              d."demoId" AS "demoId",
              p.id AS "projectId",
              g.id AS "groupId",
              d."tempoBpm" AS "tempoBpm",
              d."timeSignatureNum" AS "timeSignatureNum",
              d."timeSignatureDen" AS "timeSignatureDen",
              d."musicalKey" AS "musicalKey",
              d."tempoSource" AS "tempoSource",
              d."keySource" AS "keySource"
            FROM "TrackVersion" tv
            JOIN "DemoVersion" d ON d.id = tv."demoVersionId"
            JOIN "Demo" demo ON demo.id = d."demoId"
            JOIN "Project" p ON p.id = demo."projectId"
            JOIN "Group" g ON g.id = p."groupId"
            WHERE tv.id = %s
            """,
            (track_version_id,),
        )
        return cur.fetchone()


def get_demo_version(conn, demo_version_id: str):
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              id,
              "demoId" AS "demoId",
              label,
              description,
              "tempoBpm" AS "tempoBpm",
              "timeSignatureNum" AS "timeSignatureNum",
              "timeSignatureDen" AS "timeSignatureDen",
              "musicalKey" AS "musicalKey",
              "tempoSource" AS "tempoSource",
              "keySource" AS "keySource"
            FROM "DemoVersion"
            WHERE id = %s
            """,
            (demo_version_id,),
        )
        return cur.fetchone()


def update_job(conn, job_id: str, *, status: str, progress: int | None = None, error: str | None = None, result: Any | None = None):
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE "ProcessingJob"
            SET status = %s,
                progress = COALESCE(%s, progress),
                error = %s,
                result = %s,
                "updatedAt" = NOW()
            WHERE id = %s
            """,
            (status, progress, error, Jsonb(result) if result is not None else None, job_id),
        )
    conn.commit()


def update_demo_version_timing(
    conn,
    demo_version_id: str,
    *,
    tempo_bpm: float | None = None,
    musical_key: str | None = None,
    tempo_source: str | None = None,
    key_source: str | None = None,
):
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE "DemoVersion"
            SET "tempoBpm" = COALESCE(%s, "tempoBpm"),
                "musicalKey" = COALESCE(%s, "musicalKey"),
                "tempoSource" = COALESCE(%s, "tempoSource"),
                "keySource" = COALESCE(%s, "keySource")
            WHERE id = %s
            """,
            (tempo_bpm, musical_key, tempo_source, key_source, demo_version_id),
        )
    conn.commit()


def create_derived_track_version(
    conn,
    *,
    source_track_version: dict,
    demo_version_id: str,
    storage_key: str,
    processing_job_id: str | None,
    duration_ms: int | None,
    sample_rate: int | None,
    channels: int | None,
    mime_type: str | None,
    size_bytes: int | None,
    checksum: str | None,
):
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO "TrackVersion" (
              id,
              "storageKey",
              "sourceFileUrl",
              "startOffsetMs",
              "durationMs",
              "sampleRate",
              channels,
              "mimeType",
              "sizeBytes",
              checksum,
              "isDerived",
              "operationType",
              "parentTrackVersionId",
              "processingJobId",
              "trackId",
              "demoVersionId"
            )
            VALUES (
              %s,
              %s,
              %s,
              %s,
              %s,
              %s,
              %s,
              %s,
              %s,
              %s,
              TRUE,
              'TIME_STRETCH',
              %s,
              %s,
              %s,
              %s
            )
            RETURNING id
            """,
            (
                uuid4().hex,
                storage_key,
                storage_key,
                source_track_version['startOffsetMs'],
                duration_ms,
                sample_rate,
                channels,
                mime_type,
                size_bytes,
                checksum,
                source_track_version['id'],
                processing_job_id,
                source_track_version['trackId'],
                demo_version_id,
            ),
        )
        row = cur.fetchone()
        derived_track_version_id = row['id']

        cur.execute(
            """
            INSERT INTO "Segment" (
              id,
              "startMs",
              "endMs",
              "gainDb",
              "fadeInMs",
              "fadeOutMs",
              "isMuted",
              position,
              "trackVersionId"
            )
            SELECT
              %s,
              "startMs",
              "endMs",
              "gainDb",
              "fadeInMs",
              "fadeOutMs",
              "isMuted",
              position,
              %s
            FROM "Segment"
            WHERE "trackVersionId" = %s
            ORDER BY position ASC
            """,
            (uuid4().hex, derived_track_version_id, source_track_version['id']),
        )

    conn.commit()
    return derived_track_version_id
