import type {
  DawOperationCommitRequest,
  DawOperationPayloadPluginAdded,
  DawOperationPayloadPluginBypassSet,
  DawOperationPayloadPluginParamSet,
  DawOperationPayloadPluginRemoved,
  DawOperationPayloadPluginReordered,
  DawOperationPayloadPluginStateSet,
  DawOperationPayloadCrossfadeSet,
  DawOperationPayloadSegmentFadeSet,
  DawOperationPayloadSegmentDeleted,
  DawOperationPayloadSegmentMerged,
  DawOperationPayloadSegmentMoved,
  DawOperationPayloadSegmentSplit,
  DawOperationPayloadTrackOffsetUpdated,
  DawOperationPayloadTrackRenamed,
  DawOperationPayloadTrackRemoved,
  DawSegmentSnapshot,
} from '@git-for-music/server/app/lib/daw/protocol';
import type { HostedPluginInstanceState, TrackTimelineSegment } from '@/app/lib/daw/state/local-project-state';
import { MIN_SPLIT_DISTANCE_MS, splitSegment } from '@/app/lib/daw/utils/segments';
import { assertJsonValue } from '@/app/lib/daw/utils/json';

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

export type PluginOperationState = Pick<HostedPluginInstanceState, 'instanceId' | 'pluginKey' | 'version' | 'backend' | 'position' | 'bypassed' | 'params' | 'state' | 'stateBlobKey'>;

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

  moveSegment(input: {
    segmentId: string;
    fromTrackVersionId: string;
    toTrackVersionId: string;
    fromTimelineStartMs: number;
    fromTimelineEndMs: number;
    toTimelineStartMs: number;
    toTimelineEndMs: number;
  }): DawOperationCommitRequest {
    return {
      demoId: this.context.demoId,
      operationType: 'SEGMENT_MOVED',
      payload: input satisfies DawOperationPayloadSegmentMoved,
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

  setSegmentFade(input: {
    trackVersionId: string;
    segmentId: string;
    fadeInMs: number;
    fadeOutMs: number;
    previousFadeInMs?: number | null;
    previousFadeOutMs?: number | null;
  }): DawOperationCommitRequest {
    return {
      demoId: this.context.demoId,
      operationType: 'SEGMENT_FADE_SET',
      payload: input satisfies DawOperationPayloadSegmentFadeSet,
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

  addPlugin(input: {
    trackVersionId: string;
    plugin: PluginOperationState;
  }): DawOperationCommitRequest {
    return {
      demoId: this.context.demoId,
      operationType: 'PLUGIN_ADDED',
      payload: {
        trackVersionId: input.trackVersionId,
        ...input.plugin,
      } satisfies DawOperationPayloadPluginAdded,
    };
  }

  removePlugin(input: {
    trackVersionId: string;
    instanceId: string;
  }): DawOperationCommitRequest {
    return {
      demoId: this.context.demoId,
      operationType: 'PLUGIN_REMOVED',
      payload: input satisfies DawOperationPayloadPluginRemoved,
    };
  }

  reorderPlugin(input: {
    trackVersionId: string;
    instanceId: string;
    position: number;
  }): DawOperationCommitRequest {
    return {
      demoId: this.context.demoId,
      operationType: 'PLUGIN_REORDERED',
      payload: input satisfies DawOperationPayloadPluginReordered,
    };
  }

  setPluginParam(input: {
    trackVersionId: string;
    instanceId: string;
    paramId: string;
    value: number;
  }): DawOperationCommitRequest {
    return {
      demoId: this.context.demoId,
      operationType: 'PLUGIN_PARAM_SET',
      payload: input satisfies DawOperationPayloadPluginParamSet,
    };
  }

  setPluginBypass(input: {
    trackVersionId: string;
    instanceId: string;
    bypassed: boolean;
  }): DawOperationCommitRequest {
    return {
      demoId: this.context.demoId,
      operationType: 'PLUGIN_BYPASS_SET',
      payload: input satisfies DawOperationPayloadPluginBypassSet,
    };
  }

  setPluginState(input: {
    trackVersionId: string;
    instanceId: string;
    state: unknown;
    stateBlobKey?: string | null;
  }): DawOperationCommitRequest {
    assertJsonValue(input.state, 'plugin state');
    return {
      demoId: this.context.demoId,
      operationType: 'PLUGIN_STATE_SET',
      payload: input satisfies DawOperationPayloadPluginStateSet,
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

  deleteTrack(trackId: string): DawOperationCommitRequest {
    return {
      demoId: this.context.demoId,
      operationType: 'TRACK_REMOVED',
      payload: {
        trackId,
      } satisfies DawOperationPayloadTrackRemoved,
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
