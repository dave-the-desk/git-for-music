UPDATE "TrackVersion" AS track_version
SET "mimeType" = 'application/x-git-for-music-empty-track'
FROM "Track" AS track
WHERE track.id = track_version."trackId"
  AND track.name = 'Empty Track'
  AND track_version."mimeType" = 'audio/wav'
  AND track_version."durationMs" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "Segment"
    WHERE "Segment"."trackVersionId" = track_version.id
  );
