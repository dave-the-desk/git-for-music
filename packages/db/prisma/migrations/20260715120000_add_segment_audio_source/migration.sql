ALTER TABLE "Segment" ADD COLUMN "sourceTrackVersionId" TEXT;

CREATE INDEX "Segment_sourceTrackVersionId_idx" ON "Segment"("sourceTrackVersionId");

ALTER TABLE "Segment"
ADD CONSTRAINT "Segment_sourceTrackVersionId_fkey"
FOREIGN KEY ("sourceTrackVersionId") REFERENCES "TrackVersion"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
