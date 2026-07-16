UPDATE "TrackVersion"
SET "mimeType" = 'application/x-git-for-music-empty-track'
WHERE "mimeType" = 'audio/wav'
  AND "durationMs" IS NULL
  AND "sizeBytes" IS NOT NULL
  AND "sizeBytes" <= 256
  AND NOT EXISTS (
    SELECT 1
    FROM "Segment"
    WHERE "Segment"."trackVersionId" = "TrackVersion".id
  );
