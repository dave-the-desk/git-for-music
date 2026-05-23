import type {
  DawOperationCommitRequest,
  DawOperationPayloadCrossfadeSet,
  DawOperationPayloadSegmentDeleted,
  DawOperationPayloadSegmentMerged,
  DawOperationPayloadSegmentMoved,
  DawOperationPayloadSegmentSplit,
  DawOperationPayloadSegmentTrimmed,
  DawOperationPayloadTrackOffsetUpdated,
  DawOperationPayloadTrackRenamed,
  DawSegmentSnapshot,
} from '@/features/daw/protocol';
import type { DawTrack, TrackTimelineSegment } from '@/features/daw/state/local-project-state';
import { MIN_SPLIT_DISTANCE_MS, splitSegment } from '@/features/daw/utils/segments';

type SplitSegmentLike = {
  startMs: number;
  endMs: number;
  timelineStartMs?: number | null;
  gainDb: number;
  fadeInMs: number;
  fadeOutMs: number;
  isMuted: boolean;
  position: number;
};

export type AudioEditingEngineContext = {
  demoId: string;
};

export type SplitSegmentOperation = {
  request: Extract<DawOperationCommitRequest, { operationType: 'SEGMENT_SPLIT' }>;
  split: {
    leftSegment: SplitSegmentLike;
    rightSegment: SplitSegmentLike;
  };
};

export class AudioEditingEngine {
  constructor(private readonly context: AudioEditingEngineContext) {}

  splitSegment(trackVersionId: string, segment: TrackTimelineSegment, splitTimeMs: number): SplitSegmentOperation {
    const split = splitSegment(segment, splitTimeMs, MIN_SPLIT_DISTANCE_MS);

    return {
      request: {
        demoId: this.context.demoId,
        operationType: 'SEGMENT_SPLIT',
        payload: {
          trackVersionId,
          segmentId: segment.isImplicit ? undefined : segment.id,
          segmentStartMs: segment.startMs,
          segmentEndMs: segment.endMs,
          splitTimeMs,
        } satisfies DawOperationPayloadSegmentSplit,
      },
      split: {
        leftSegment: split.leftSegment,
        rightSegment: split.rightSegment,
      },
    };
  }

  moveSegment(trackVersionId: string, segmentId: string, timelineStartMs: number): DawOperationCommitRequest {
    return {
      demoId: this.context.demoId,
      operationType: 'SEGMENT_MOVED',
      payload: {
        trackVersionId,
        segmentId,
        timelineStartMs,
      } satisfies DawOperationPayloadSegmentMoved,
    };
  }

  trimSegment(input: {
    trackVersionId: string;
    segmentId: string;
    from: {
      startMs: number;
      endMs: number;
    };
    to: {
      startMs: number;
      endMs: number;
    };
  }): DawOperationCommitRequest {
    return {
      demoId: this.context.demoId,
      operationType: 'SEGMENT_TRIMMED',
      payload: input satisfies DawOperationPayloadSegmentTrimmed,
    };
  }

  mergeSegments(input: {
    trackVersionId: string;
    segmentIds: string[];
    mergedSegment: DawSegmentSnapshot;
  }): DawOperationCommitRequest {
    return {
      demoId: this.context.demoId,
      operationType: 'SEGMENT_MERGED',
      payload: input satisfies DawOperationPayloadSegmentMerged,
    };
  }

  setCrossfade(input: {
    trackVersionId: string;
    leftSegmentId: string;
    rightSegmentId: string;
    crossfadeInMs: number;
    crossfadeOutMs: number;
    curve: string | null;
  }): DawOperationCommitRequest {
    return {
      demoId: this.context.demoId,
      operationType: 'CROSSFADE_SET',
      payload: input satisfies DawOperationPayloadCrossfadeSet,
    };
  }

  removeCrossfade(input: {
    trackVersionId: string;
    leftSegmentId: string;
    rightSegmentId: string;
  }): DawOperationCommitRequest {
    return this.setCrossfade({
      ...input,
      crossfadeInMs: 0,
      crossfadeOutMs: 0,
      curve: null,
    });
  }

  renameTrack(trackId: string, trackName: string): DawOperationCommitRequest {
    return {
      demoId: this.context.demoId,
      operationType: 'TRACK_RENAMED',
      payload: {
        trackId,
        trackName,
      } satisfies DawOperationPayloadTrackRenamed,
    };
  }

  deleteSegment(trackVersionId: string, segmentId: string): DawOperationCommitRequest {
    return {
      demoId: this.context.demoId,
      operationType: 'SEGMENT_DELETED',
      payload: {
        trackVersionId,
        segmentId,
      } satisfies DawOperationPayloadSegmentDeleted,
    };
  }

  moveTrack(trackVersionId: string, startOffsetMs: number): DawOperationCommitRequest {
    return {
      demoId: this.context.demoId,
      operationType: 'TRACK_OFFSET_UPDATED',
      payload: {
        trackVersionId,
        startOffsetMs,
      } satisfies DawOperationPayloadTrackOffsetUpdated,
    };
  }
}
