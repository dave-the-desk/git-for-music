ALTER TABLE "TrackVersion"
ADD COLUMN "segmentsInitialized" BOOLEAN NOT NULL DEFAULT false;

UPDATE "TrackVersion" AS track_version
SET "segmentsInitialized" = true
WHERE EXISTS (
  SELECT 1
  FROM "Segment" AS segment
  WHERE segment."trackVersionId" = track_version.id
);
