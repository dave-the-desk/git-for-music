'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  DemoTimingMetadata,
  JobStatusResponse,
  SnapResolution,
  UploadTimingChoice,
} from '@git-for-music/shared';
import type {
  DawOperationAffectedTimeRange,
  DawCommandPayload,
  DawOperationCommitMetadata,
  DawOperationCommitRequest,
  DawOperationType,
  DawProjectOperationRecord,
} from '@/features/daw/protocol';
import { AddTrackButton } from '@/features/daw/components/AddTrackButton';
import { DawToolbarTabs, type DawToolbarTab } from '@/features/daw/components/DawToolbarTabs';
import { ProjectTimingControls } from '@/features/daw/components/ProjectTimingControls';
import { TransportControls } from '@/features/daw/components/TransportControls';
import { TimelineRuler, getTimelineTicks, getTimelineWidthPx } from '@/features/daw/components/TimelineRuler';
import { RecordingControls } from '@/features/daw/components/RecordingControls';
import type { RecordingControlsHandle } from '@/features/daw/components/RecordingControls';
import { RecordingTrackLane } from '@/features/daw/components/RecordingTrackLane';
import { TrackSegmentClip } from '@/features/daw/components/TrackSegmentClip';
import { VersionHistoryTree } from '@/features/daw/components/VersionHistoryTree';
import { AudioInputSelector } from '@/features/daw/components/AudioInputSelector';
import { AudioEditingEngine } from '@/features/daw/engine/audio-editing-engine';
import { AudioIngestEngine } from '@/features/daw/engine/ingest-engine';
import { ProjectSyncEngine } from '@/features/daw/engine/project-sync-engine';
import { AudioPlaybackEngine } from '@/features/daw/engine/playback-engine';
import {
  buildDawVisualProjection,
  PX_PER_SECOND,
  type TrackLaneRecordingTakeProjection,
  type WaveformCache,
} from '@/features/daw/rendering/visual-renderer';
import { EMPTY_TRACK_MIME_TYPE, isValidSplitTime } from '@/features/daw/utils/segments';
import {
  formatBarBeatLabel,
  isValidTempoBpm,
  normalizeTempoBpm,
  snapMsToGrid,
  DEFAULT_DEMO_TEMPO_BPM,
} from '@/features/daw/utils/timing';
import {
  DEFAULT_SNAP,
  TICK_INTERVAL_MS,
  TRACK_HEIGHT,
  TRACK_LABEL_WIDTH,
  localTempoStateFromTempo,
  type RenameState,
  type TempoAnalysisPromptState,
  type TemporaryRecordingTrack,
  type UploadModalState,
  formatTimeMs,
} from '@/features/daw/state/ui-state';
import { buildRecordedTakeBounds, type RecordingTakeBounds } from '@/features/daw/utils/recording-bounds';
import type {
  DawTrack,
  DawVersion,
  TrackRecordingTake,
  TrackTimelineSegment,
} from '@/features/daw/state/local-project-state';
import type { TimelineHistoryEntry } from '@/features/daw/state/operation-reducer';
import {
  getDisplayedTrackSegments as selectDisplayedTrackSegments,
  getRenderableTrackSegments as selectRenderableTrackSegments,
  getTrackDurationMs as selectTrackDurationMs,
  getTrackStartOffsetMs as selectTrackStartOffsetMs,
  isTrackAudioOccupied,
  groupCommentsByTrackId,
  selectTracks,
  selectVersionById,
  selectTotalDurationMs,
} from '@/features/daw/state/selectors';

const DEMO_PAGE_TRACK_HEIGHT = TRACK_HEIGHT;

function createBlankTrackBytes(sampleRate = 44100, durationMs = 1, channels = 1) {
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const sampleCount = Math.max(1, Math.round((sampleRate * durationMs) / 1000));
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = sampleCount * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  let offset = 0;

  function writeString(value: string) {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
    offset += value.length;
  }

  writeString('RIFF');
  view.setUint32(offset, 36 + dataSize, true);
  offset += 4;
  writeString('WAVE');
  writeString('fmt ');
  view.setUint32(offset, 16, true);
  offset += 4;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint16(offset, channels, true);
  offset += 2;
  view.setUint32(offset, sampleRate, true);
  offset += 4;
  view.setUint32(offset, byteRate, true);
  offset += 4;
  view.setUint16(offset, blockAlign, true);
  offset += 2;
  view.setUint16(offset, bitsPerSample, true);
  offset += 2;
  writeString('data');
  view.setUint32(offset, dataSize, true);
  offset += 4;

  return new Uint8Array(buffer);
}

function createBlankTrackFile() {
  return new File([createBlankTrackBytes()], `empty-track-${Date.now()}.wav`, {
    type: EMPTY_TRACK_MIME_TYPE,
  });
}

function getNextEmptyTrackName(tracks: DawTrack[]) {
  const highestTrackNumber = tracks.reduce((maxTrackNumber, track) => {
    const match = /^Track (\d+)$/.exec(track.trackName.trim());
    if (!match) return maxTrackNumber;

    const trackNumber = Number(match[1]);
    return Number.isFinite(trackNumber) ? Math.max(maxTrackNumber, trackNumber) : maxTrackNumber;
  }, 0);

  return `Track ${highestTrackNumber + 1}`;
}

function hasLocalBlankTrackOverride(
  trackVersionId: string,
  segmentLayoutOverrides: Record<string, TrackTimelineSegment[]>,
) {
  return (
    Object.prototype.hasOwnProperty.call(segmentLayoutOverrides, trackVersionId) &&
    (segmentLayoutOverrides[trackVersionId]?.length ?? 0) === 0
  );
}

function getEffectiveTrackMimeType(
  track: DawTrack,
  segmentLayoutOverrides: Record<string, TrackTimelineSegment[]>,
) {
  return hasLocalBlankTrackOverride(track.trackVersionId, segmentLayoutOverrides)
    ? EMPTY_TRACK_MIME_TYPE
    : track.mimeType;
}

type TimelineDragState =
  | {
      kind: 'track';
      trackVersionId: string;
      originalStartOffsetMs: number;
      startX: number;
    }
  | {
      kind: 'segment';
      trackVersionId: string;
      segmentId: string;
      originalTimelineStartMs: number;
      startX: number;
    }
  | {
      kind: 'recording-take';
      trackId: string;
      trackVersionId: string;
      takeId: string;
      originalTakes: TrackRecordingTake[];
      originalTake: TrackRecordingTake;
      startX: number;
    };

type SplitHoverState = {
  trackVersionId: string;
  timeMs: number;
} | null;

type DemoDawClientProps = {
  groupSlug: string;
  projectSlug: string;
  projectId: string;
  demoId: string;
  currentUserId: string;
  demoName: string;
  demoDescription: string | null;
  initialCurrentVersionId: string;
  initialVersions: DawVersion[];
};

type ProjectPresenceRecord = {
  presenceId: string;
  projectId: string;
  demoId: string;
  actorUserId: string;
  presenceSeed: string;
  status: 'online' | 'idle' | 'away' | 'offline';
  cursorTimeMs: number | null;
  selectedTrackId: string | null;
  currentTool: 'select' | 'split';
  recordingState: 'idle' | 'recording' | 'preview' | 'uploading' | 'error';
  playbackFollowState: boolean;
  updatedAt: string;
};

type ResolvedRecordingTarget = {
  trackId: string;
  trackVersionId: string;
  trackName: string;
};

type RecordingSession = {
  id: string;
  targetTrackId: string;
  targetTrackVersionId: string;
  targetTrackName: string;
  timelineStartMs: number;
  startedAtPlayheadMs: number;
  recordedTempoBpm: number;
  sourceTempoBpm: number;
};

function resolveArmedRecordingTarget(
  recordArmedTrackVersionId: string | null,
  selectedTracks: DawTrack[],
): ResolvedRecordingTarget | null {
  if (!recordArmedTrackVersionId) return null;
  const armedTrack = selectedTracks.find((track) => track.trackVersionId === recordArmedTrackVersionId);
  if (!armedTrack) return null;
  return {
    trackId: armedTrack.trackId,
    trackVersionId: armedTrack.trackVersionId,
    trackName: armedTrack.trackName,
  };
}

export function DemoDawClient({
  groupSlug,
  projectSlug,
  projectId,
  demoId,
  currentUserId,
  demoName,
  demoDescription,
  initialCurrentVersionId,
  initialVersions,
}: DemoDawClientProps) {
  const router = useRouter();

  const [selectedVersionId, setSelectedVersionId] = useState(initialCurrentVersionId);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [durationByTrackVersionId, setDurationByTrackVersionId] = useState<Record<string, number>>({});
  const [mutedTrackVersionIds, setMutedTrackVersionIds] = useState<Set<string>>(() => new Set());

  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadName, setUploadName] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [snapResolution, setSnapResolution] = useState<SnapResolution>(DEFAULT_SNAP);
  const [metronomeEnabled, setMetronomeEnabled] = useState(false);
  const [uploadModalState, setUploadModalState] = useState<UploadModalState>({
    open: false,
    file: null,
    name: '',
    choice: 'keepProjectTempo',
  });
  const [processingJobIds, setProcessingJobIds] = useState<string[]>([]);
  const [processingJobs, setProcessingJobs] = useState<Record<string, JobStatusResponse>>({});
  const [processingMessage, setProcessingMessage] = useState<string | null>(null);
  const [processingStartedAt, setProcessingStartedAt] = useState<number | null>(null);
  const [tempoAnalysisPrompt, setTempoAnalysisPrompt] = useState<TempoAnalysisPromptState | null>(null);

  const [temporaryRecordingTrack, setTemporaryRecordingTrack] = useState<TemporaryRecordingTrack | null>(null);
  const [recordingStream, setRecordingStream] = useState<MediaStream | null>(null);
  const [selectedAudioInputDeviceId, setSelectedAudioInputDeviceId] = useState<string | null>(null);
  const [audioInputReady, setAudioInputReady] = useState(false);
  const [toolbarTab, setToolbarTab] = useState<DawToolbarTab>('edit');
  const [selectedTrackVersionId, setSelectedTrackVersionId] = useState<string | null>(null);
  const [presenceRecords, setPresenceRecords] = useState<ProjectPresenceRecord[]>([]);
  const [pluginDefinitions, setPluginDefinitions] = useState<
    Array<{
      id: string;
      pluginKey: string;
      name: string;
      version: string;
      manufacturer: string | null;
      parameterSchema: unknown;
      createdAt: string;
    }>
  >([]);
  const [gainByTrackVersionId, setGainByTrackVersionId] = useState<Record<string, number>>({});
  const [soloTrackVersionIds, setSoloTrackVersionIds] = useState<Set<string>>(() => new Set());
  const [recordArmedTrackVersionId, setRecordArmedTrackVersionId] = useState<string | null>(null);
  const [recordedTempoByTrackVersionId, setRecordedTempoByTrackVersionId] = useState<
    Record<string, { recordedTempoBpm: number | null; sourceTempoBpm: number | null }>
  >({});
  const recordArmInitializedRef = useRef(false);
  const [addCommentModalOpen, setAddCommentModalOpen] = useState(false);
  const [addCommentBody, setAddCommentBody] = useState('');
  const [addCommentTrackId, setAddCommentTrackId] = useState<string | null>(null);
  const [addCommentTimestampMs, setAddCommentTimestampMs] = useState<number>(0);
  const [addCommentSubmitting, setAddCommentSubmitting] = useState(false);
  const [addCommentError, setAddCommentError] = useState<string | null>(null);
  const [timelineCommentOpenId, setTimelineCommentOpenId] = useState<string | null>(null);
  const recordingPreviewUrlRef = useRef<string | null>(null);
  const isLiveRecordingRef = useRef(false);
  const recordingSessionRef = useRef<RecordingSession | null>(null);
  const recordingControlsRef = useRef<RecordingControlsHandle | null>(null);

  const [offsetOverrides, setOffsetOverrides] = useState<Record<string, number>>({});
  const [segmentLayoutOverrides, setSegmentLayoutOverrides] = useState<Record<string, TrackTimelineSegment[]>>({});
  const [timelineHistory, setTimelineHistory] = useState<TimelineHistoryEntry[]>([]);
  const [dragError, setDragError] = useState<string | null>(null);
  const dragRef = useRef<TimelineDragState | null>(null);
  const [timelineTool, setTimelineTool] = useState<'select' | 'split'>('select');
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [splitHover, setSplitHover] = useState<SplitHoverState>(null);
  const [splitError, setSplitError] = useState<string | null>(null);

  const [renameState, setRenameState] = useState<RenameState | null>(null);
  const clockRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startWallTimeRef = useRef<number>(0);
  const startPlayheadMsRef = useRef<number>(0);
  const lastAppliedTempoBpmRef = useRef<number>(0);
  const tracksScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const metronomeAudioRef = useRef<AudioContext | null>(null);
  const metronomeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const metronomeScheduledBeatRef = useRef<number | null>(null);
  const undoLatestTimelineEditRef = useRef<() => Promise<boolean>>(async () => false);
  const undoTimelineEditInFlightRef = useRef(false);
  const deleteSelectedClipRef = useRef<() => Promise<boolean>>(async () => false);
  const cancelTimelineDragRef = useRef<() => void>(() => {});
  const timelineToolRef = useRef<'select' | 'split'>('select');
  const presenceIdRef = useRef(crypto.randomUUID());
  const currentTimeMsRef = useRef(0);
  const selectedTrackIdRef = useRef<string | null>(null);
  const currentRecordingStateRef = useRef<'idle' | 'recording' | 'preview' | 'uploading' | 'error'>('idle');
  const playbackFollowStateRef = useRef(false);
  const lastPresencePayloadRef = useRef<string | null>(null);

  const publishPresence = useCallback(async (statusOverride?: 'online' | 'idle' | 'away') => {
    const status =
      statusOverride ??
      (typeof document !== 'undefined' && document.visibilityState === 'hidden' ? 'away' : 'online');

    const payload = {
      presenceId: presenceIdRef.current,
      status,
      cursorTimeMs: currentTimeMsRef.current,
      selectedTrackId: selectedTrackIdRef.current,
      currentTool: timelineToolRef.current,
      recordingState: currentRecordingStateRef.current,
      playbackFollowState: playbackFollowStateRef.current,
    };

    const serialized = JSON.stringify(payload);
    if (serialized === lastPresencePayloadRef.current) return;
    lastPresencePayloadRef.current = serialized;

    try {
      await fetch(`/api/daw/projects/${projectId}/presence?demoId=${demoId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: serialized,
        keepalive: true,
      });
    } catch {
      // Presence is best-effort and should never block editing.
    }
  }, [demoId, projectId]);

  const clearPresence = useCallback(async () => {
    try {
      await fetch(
        `/api/daw/projects/${projectId}/presence?demoId=${demoId}&presenceId=${presenceIdRef.current}`,
        {
          method: 'DELETE',
          keepalive: true,
        },
      );
    } catch {
      // Best effort cleanup on tab close.
    }
  }, [demoId, projectId]);

  const audioEditingEngine = useMemo(() => new AudioEditingEngine({ demoId }), [demoId]);
  const ingestEngine = useMemo(() => new AudioIngestEngine(), []);
  const playbackEngine = useMemo(() => new AudioPlaybackEngine(), []);
  const projectSyncEngine = useMemo(() => new ProjectSyncEngine(), []);
  const [projectSyncState, setProjectSyncState] = useState(() => projectSyncEngine.getState());
  const recordingTakesByTrackId = useMemo(
    () => projectSyncState.projectState?.recordingTakesByTrackId ?? {},
    [projectSyncState.projectState?.recordingTakesByTrackId],
  );
  const liveProjectState = projectSyncState.projectState;
  const liveVersions = liveProjectState?.versions ?? initialVersions;
  const liveCurrentVersionId = liveProjectState?.currentVersionId ?? initialCurrentVersionId;

  const selectedVersion = useMemo(
    () => selectVersionById(liveVersions, selectedVersionId),
    [liveVersions, selectedVersionId],
  );
  const sharedDemoTempoBpm = useMemo(
    () => normalizeTempoBpm(selectedVersion?.tempoBpm, DEFAULT_DEMO_TEMPO_BPM),
    [selectedVersion?.tempoBpm],
  );
  const [localTempoBpmInput, setLocalTempoBpmInput] = useState(() =>
    localTempoStateFromTempo(selectedVersion?.tempoBpm).localTempoBpm,
  );
  const resolvedLocalTempoBpm = useMemo(
    () => normalizeTempoBpm(Number(localTempoBpmInput), sharedDemoTempoBpm),
    [localTempoBpmInput, sharedDemoTempoBpm],
  );

  const selectedTracks = useMemo(() => selectTracks(selectedVersion), [selectedVersion]);
  const selectedTrack = useMemo(
    () => selectedTracks.find((track) => track.trackVersionId === selectedTrackVersionId) ?? selectedTracks[0] ?? null,
    [selectedTrackVersionId, selectedTracks],
  );
  useEffect(() => {
    if (recordArmedTrackVersionId && selectedTracks.some((track) => track.trackVersionId === recordArmedTrackVersionId)) {
      recordArmInitializedRef.current = true;
      return;
    }
    if (recordArmedTrackVersionId) {
      setRecordArmedTrackVersionId(null);
      return;
    }
    if (recordArmInitializedRef.current || selectedTracks.length === 0) return;
    recordArmInitializedRef.current = true;
    setRecordArmedTrackVersionId(selectedTracks[0]?.trackVersionId ?? null);
    // Seed a single armed track once, then let the user change or clear it.
  }, [recordArmedTrackVersionId, selectedTracks]);
  const activeRecordingTarget = useMemo(
    () => resolveArmedRecordingTarget(recordArmedTrackVersionId, selectedTracks),
    [recordArmedTrackVersionId, selectedTracks],
  );

  useEffect(() => {
    return projectSyncEngine.subscribe((state) => {
      setProjectSyncState(state);
    });
  }, [projectSyncEngine]);

  const tempoMetadataByTrackVersionId = projectSyncState.projectState?.tempoMetadataByTrackVersionId;
  useEffect(() => {
    setRecordedTempoByTrackVersionId(tempoMetadataByTrackVersionId ?? {});
  }, [tempoMetadataByTrackVersionId]);

  useEffect(() => {
    return projectSyncEngine.subscribeAssetStatus((event) => {
      setProcessingMessage(
        event.message ??
          (event.status === 'processing'
            ? 'Processing asset...'
            : event.status === 'complete'
              ? 'Processing complete.'
              : event.status === 'failed'
                ? 'Processing failed.'
                : 'Processing queued.'),
      );

      if (event.status === 'complete' || event.status === 'failed') {
        router.refresh();
      }
    });
  }, [projectSyncEngine, router]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadBootstrapData() {
      try {
        const response = await fetch(`/api/daw/projects/${projectId}/bootstrap?demoId=${demoId}`, {
          signal: controller.signal,
        });
        if (!response.ok) return;
        const data = (await response.json()) as {
          pluginDefinitions?: Array<{
            id: string;
            pluginKey: string;
            name: string;
            version: string;
            manufacturer: string | null;
            parameterSchema: unknown;
            createdAt: string;
          }>;
        };
        setPluginDefinitions(data.pluginDefinitions ?? []);
      } catch {
        // Best effort only.
      }
    }

    void loadBootstrapData();
    return () => controller.abort();
  }, [demoId, projectId]);

  useEffect(() => {
    return projectSyncEngine.subscribePresence((presence) => {
      setPresenceRecords((previous) => {
        const nextRecord = {
          presenceId: presence.presenceId,
          projectId: presence.projectId,
          demoId: presence.demoId,
          actorUserId: presence.actorUserId,
          presenceSeed: presence.presenceSeed,
          status: presence.status,
          cursorTimeMs: presence.cursorTimeMs,
          selectedTrackId: presence.selectedTrackId,
          currentTool: presence.currentTool,
          recordingState: presence.recordingState,
          playbackFollowState: presence.playbackFollowState,
          updatedAt: presence.createdAt,
        } satisfies ProjectPresenceRecord;

        const existingIndex = previous.findIndex((record) => record.presenceId === nextRecord.presenceId);
        if (existingIndex === -1) {
          return [...previous, nextRecord];
        }

        return previous.map((record) =>
          record.presenceId === nextRecord.presenceId ? { ...record, ...nextRecord } : record,
        );
      });
    });
  }, [projectSyncEngine]);

  useEffect(() => {
    let cancelled = false;

    async function loadPresence() {
      try {
        const response = await fetch(`/api/daw/projects/${projectId}/presence?demoId=${demoId}`);
        if (!response.ok) return;
        const data = (await response.json()) as { presences?: ProjectPresenceRecord[] };
        if (!cancelled) {
          setPresenceRecords(data.presences ?? []);
        }
      } catch {
        // Presence is best effort.
      }
    }

    void loadPresence();
    if (toolbarTab !== 'members') return () => {
      cancelled = true;
    };

    const timer = setInterval(() => void loadPresence(), 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [demoId, projectId, toolbarTab]);

  const activeProcessingJobs = useMemo(
    () => processingJobIds.map((id) => processingJobs[id]).filter(Boolean),
    [processingJobIds, processingJobs],
  );

  const activeTempoAnalysisJob = useMemo(() => {
    if (!tempoAnalysisPrompt) return null;
    return processingJobs[tempoAnalysisPrompt.jobId] ?? null;
  }, [processingJobs, tempoAnalysisPrompt]);
  const currentRecordingState = temporaryRecordingTrack?.status ?? 'idle';
  const microphoneStatus = useMemo(() => {
    if (currentRecordingState === 'recording') {
      return 'Recording on selected mic';
    }

    if (selectedAudioInputDeviceId && audioInputReady) {
      return 'Mic ready';
    }

    if (selectedAudioInputDeviceId && !audioInputReady) {
      return 'Mic needs permission';
    }

    return 'Choose a microphone';
  }, [audioInputReady, currentRecordingState, selectedAudioInputDeviceId]);

  const selectedTiming = useMemo<DemoTimingMetadata | null>(() => {
    if (!selectedVersion) return null;
    return {
      tempoBpm: sharedDemoTempoBpm,
      timeSignature: { num: 4, den: 4 },
      musicalKey: null,
      tempoSource: 'MANUAL',
      keySource: 'MANUAL',
    };
  }, [sharedDemoTempoBpm, selectedVersion]);

  const comments = projectSyncState.projectState?.comments ?? [];

  const commentsByTrackId = useMemo(() => {
    const grouped = groupCommentsByTrackId(comments);

    for (const trackComments of Object.values(grouped)) {
      trackComments.sort((a, b) => {
        const aPoint = a.startTimeMs ?? Number.POSITIVE_INFINITY;
        const bPoint = b.startTimeMs ?? Number.POSITIVE_INFINITY;
        if (aPoint !== bPoint) return aPoint - bPoint;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });
    }

    return grouped;
  }, [comments]);
  const projectTimelineComments = useMemo(
    () =>
      [...comments]
        .filter((comment) => comment.trackId === null)
        .sort((a, b) => {
          const aPoint = a.startTimeMs ?? Number.POSITIVE_INFINITY;
          const bPoint = b.startTimeMs ?? Number.POSITIVE_INFINITY;
          if (aPoint !== bPoint) return aPoint - bPoint;
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        }),
    [comments],
  );
  const allComments = useMemo(
    () =>
      [...comments].sort((a, b) => {
        const aPoint = a.startTimeMs ?? Number.POSITIVE_INFINITY;
        const bPoint = b.startTimeMs ?? Number.POSITIVE_INFINITY;
        if (aPoint !== bPoint) return aPoint - bPoint;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }),
    [comments],
  );
  const processingElapsedSeconds =
    processingStartedAt !== null ? Math.max(0, Math.floor((Date.now() - processingStartedAt) / 1000)) : null;

  const waveformCache = useMemo<WaveformCache>(() => {
    const cache = new Map<string, { peaks: { timeMs: number; min: number; max: number }[]; durationMs: number }>();
    if (temporaryRecordingTrack?.peaks?.length) {
      cache.set(temporaryRecordingTrack.id, {
        peaks: temporaryRecordingTrack.peaks,
        durationMs: temporaryRecordingTrack.durationMs,
      });
    }
    return cache;
  }, [temporaryRecordingTrack]);

  const playbackTracks = useMemo(
    () =>
      selectedTracks.map((track) => ({
        ...track,
        mimeType: getEffectiveTrackMimeType(track, segmentLayoutOverrides),
        startOffsetMs: selectTrackStartOffsetMs(track, offsetOverrides),
        durationMs: durationByTrackVersionId[track.trackVersionId] ?? track.durationMs,
        isMuted: mutedTrackVersionIds.has(track.trackVersionId),
        segments: selectDisplayedTrackSegments(track, segmentLayoutOverrides),
        recordedTempoBpm:
          recordedTempoByTrackVersionId[track.trackVersionId]?.recordedTempoBpm ??
          track.recordedTempoBpm ??
          sharedDemoTempoBpm,
        sourceTempoBpm:
          recordedTempoByTrackVersionId[track.trackVersionId]?.sourceTempoBpm ??
          track.sourceTempoBpm ??
          sharedDemoTempoBpm,
      })),
    [
      durationByTrackVersionId,
      mutedTrackVersionIds,
      offsetOverrides,
      recordedTempoByTrackVersionId,
      selectedTracks,
      segmentLayoutOverrides,
      sharedDemoTempoBpm,
    ],
  );

  const playbackEngineProjection = useMemo(() => {
    const tracks = playbackTracks.map((track) => ({
      trackId: track.trackId,
      trackName: track.trackName,
      trackVersionId: track.trackVersionId,
      storageKey: track.storageKey,
      mimeType: track.mimeType ?? null,
      startOffsetMs: track.startOffsetMs,
      durationMs: track.durationMs,
      segments: track.segments,
      recordedTempoBpm: track.recordedTempoBpm,
      sourceTempoBpm: track.sourceTempoBpm,
      isMuted: track.isMuted,
    }));
    const projectedMutedTrackVersionIds = new Set(mutedTrackVersionIds);
    const projectedSoloTrackVersionIds = new Set(soloTrackVersionIds);
    const projectedGainByTrackVersionId = { ...gainByTrackVersionId };

    const previewTrackHost = temporaryRecordingTrack
      ? selectedTracks.find((track) => track.trackId === temporaryRecordingTrack.targetTrackId) ??
        selectedTracks.find((track) => track.trackVersionId === temporaryRecordingTrack.serverTrackVersionId) ??
        selectedTracks.find((track) => track.trackVersionId === temporaryRecordingTrack.targetTrackVersionId) ??
        null
      : null;
    const previewTrackMaterialized =
      temporaryRecordingTrack?.serverTrackVersionId
        ? selectedTracks.some((track) => track.trackVersionId === temporaryRecordingTrack.serverTrackVersionId)
        : false;

    if (
      temporaryRecordingTrack?.blob &&
      temporaryRecordingTrack.previewUrl &&
      temporaryRecordingTrack.status !== 'recording' &&
      (!temporaryRecordingTrack.serverTrackVersionId || !previewTrackMaterialized) &&
      previewTrackHost
    ) {
      const previewTrackVersionId = `temporary-recording:${temporaryRecordingTrack.id}`;
      const previewMuted = mutedTrackVersionIds.has(previewTrackHost.trackVersionId);
      const previewSolo = soloTrackVersionIds.has(previewTrackHost.trackVersionId);
      const previewGain = gainByTrackVersionId[previewTrackHost.trackVersionId] ?? 1;
      tracks.push({
        trackId: `temporary-recording:${temporaryRecordingTrack.id}`,
        trackName: temporaryRecordingTrack.name,
        trackVersionId: previewTrackVersionId,
        storageKey: temporaryRecordingTrack.previewUrl,
        mimeType: null,
        startOffsetMs: temporaryRecordingTrack.startOffsetMs,
        durationMs: temporaryRecordingTrack.durationMs,
        isMuted: previewMuted,
        segments: [
          {
            id: `temporary-recording-segment:${temporaryRecordingTrack.id}`,
            trackVersionId: previewTrackVersionId,
            sourceStartMs: 0,
            sourceEndMs: temporaryRecordingTrack.durationMs,
            timelineStartMs: temporaryRecordingTrack.startOffsetMs,
            timelineEndMs: temporaryRecordingTrack.startOffsetMs + temporaryRecordingTrack.durationMs,
            durationMs: temporaryRecordingTrack.durationMs,
            startMs: 0,
            endMs: temporaryRecordingTrack.durationMs,
            gainDb: 0,
            fadeInMs: 0,
            fadeOutMs: 0,
            isMuted: false,
            position: 0,
            isImplicit: false,
          },
        ],
        recordedTempoBpm:
          temporaryRecordingTrack.recordedTempoBpm ??
          previewTrackHost.recordedTempoBpm ??
          sharedDemoTempoBpm,
        sourceTempoBpm:
          temporaryRecordingTrack.sourceTempoBpm ?? previewTrackHost.sourceTempoBpm ?? sharedDemoTempoBpm,
      });
      if (previewMuted) {
        projectedMutedTrackVersionIds.add(previewTrackVersionId);
      }
      if (previewSolo) {
        projectedSoloTrackVersionIds.add(previewTrackVersionId);
      }
      projectedGainByTrackVersionId[previewTrackVersionId] = previewGain;
    }

    for (const [trackId, takes] of Object.entries(recordingTakesByTrackId)) {
      const hostTrack = selectedTracks.find((track) => track.trackId === trackId);
      if (!hostTrack) continue;

      const hostMuted = mutedTrackVersionIds.has(hostTrack.trackVersionId);
      const hostSolo = soloTrackVersionIds.has(hostTrack.trackVersionId);
      const hostGain = gainByTrackVersionId[hostTrack.trackVersionId] ?? 1;

      for (const take of takes) {
        if (take.status !== 'complete' || !take.storageKey) continue;

        const syntheticTrackVersionId = `recording:${take.id}`;
        const sourceStartMs = Math.max(0, take.sourceStartMs ?? 0);
        const sourceEndMs = Math.max(sourceStartMs, take.sourceEndMs ?? sourceStartMs + Math.max(0, take.durationMs));
        const timelineStartMs = Math.max(0, take.timelineStartMs ?? take.startOffsetMs);
        const timelineEndMs = Math.max(
          timelineStartMs,
          take.timelineEndMs ?? timelineStartMs + Math.max(0, take.durationMs),
        );
        const durationMs = Math.max(0, timelineEndMs - timelineStartMs);
        tracks.push({
          trackId: `recording:${take.id}`,
          trackName: take.name || hostTrack.trackName,
          trackVersionId: syntheticTrackVersionId,
          storageKey: take.storageKey,
          mimeType: null,
          startOffsetMs: timelineStartMs,
          durationMs,
          isMuted: hostMuted,
          segments: [
            {
              id: `recording-segment:${take.id}`,
              trackVersionId: syntheticTrackVersionId,
              sourceStartMs,
              sourceEndMs,
              timelineStartMs,
              timelineEndMs,
              durationMs,
              startMs: sourceStartMs,
              endMs: sourceEndMs,
              gainDb: take.gainDb ?? 0,
              fadeInMs: take.fadeInMs ?? 0,
              fadeOutMs: take.fadeOutMs ?? 0,
              isMuted: take.isMuted ?? false,
              position: take.position,
              isImplicit: false,
            },
          ],
          recordedTempoBpm:
            take.recordedTempoBpm ?? hostTrack.recordedTempoBpm ?? sharedDemoTempoBpm,
          sourceTempoBpm: take.sourceTempoBpm ?? hostTrack.sourceTempoBpm ?? sharedDemoTempoBpm,
        });

        if (hostMuted) {
          projectedMutedTrackVersionIds.add(syntheticTrackVersionId);
        }
        if (hostSolo) {
          projectedSoloTrackVersionIds.add(syntheticTrackVersionId);
        }
        projectedGainByTrackVersionId[syntheticTrackVersionId] = hostGain;
      }
    }

    return {
      tracks,
      mutedTrackVersionIds: projectedMutedTrackVersionIds,
      soloTrackVersionIds: projectedSoloTrackVersionIds,
      gainByTrackVersionId: projectedGainByTrackVersionId,
    };
  }, [
    gainByTrackVersionId,
    mutedTrackVersionIds,
    playbackTracks,
    recordingTakesByTrackId,
    temporaryRecordingTrack,
    selectedTracks,
    sharedDemoTempoBpm,
    soloTrackVersionIds,
  ]);

  const visualTemporaryRecordingTrack = useMemo(() => {
    if (!temporaryRecordingTrack) return null;

    if (
      temporaryRecordingTrack.syncStatus === 'complete' &&
      temporaryRecordingTrack.serverTrackVersionId &&
      temporaryRecordingTrack.serverDemoVersionId
    ) {
      return null;
    }

    return temporaryRecordingTrack;
  }, [temporaryRecordingTrack]);

  const visualProjection = useMemo(
    () =>
      buildDawVisualProjection({
        tracks: playbackTracks,
        currentTimeMs,
        splitHover,
        durationByTrackVersionId,
        offsetOverrides,
        segmentLayoutOverrides,
        temporaryRecordingTrack: visualTemporaryRecordingTrack,
        recordingTakesByTrackId,
        waveformCache,
        minimumWidthPx: 400,
      }),
    [
      currentTimeMs,
      durationByTrackVersionId,
      offsetOverrides,
      playbackTracks,
      segmentLayoutOverrides,
      splitHover,
      recordingTakesByTrackId,
      visualTemporaryRecordingTrack,
      waveformCache,
    ],
  );

  const totalDurationMs = useMemo(
    () => {
      const recordingTakeEndsMs = Object.values(recordingTakesByTrackId).flatMap((takes) =>
        takes.map((take) => take.startOffsetMs + take.durationMs),
      );

      if (temporaryRecordingTrack) {
        recordingTakeEndsMs.push(temporaryRecordingTrack.startOffsetMs + temporaryRecordingTrack.durationMs);
      }

      return Math.max(
        selectTotalDurationMs({
          tracks: selectedTracks,
          durationByTrackVersionId,
          offsetOverrides,
          segmentLayoutOverrides,
          temporaryRecordingTrack: visualTemporaryRecordingTrack,
        }),
        ...recordingTakeEndsMs,
      );
    },
    [
      durationByTrackVersionId,
      offsetOverrides,
      recordingTakesByTrackId,
      segmentLayoutOverrides,
      selectedTracks,
      temporaryRecordingTrack,
      visualTemporaryRecordingTrack,
    ],
  );

  const timelineRulerWidthPx = getTimelineWidthPx(totalDurationMs);
  const totalTimelineWidth = visualProjection.totalTimelineWidthPx;

  useEffect(() => {
    if (!temporaryRecordingTrack) return;
    if (temporaryRecordingTrack.syncStatus !== 'complete') return;
    if (!temporaryRecordingTrack.serverTrackVersionId) return;

    if (recordingPreviewUrlRef.current) {
      ingestEngine.revokeObjectUrl(recordingPreviewUrlRef.current);
      recordingPreviewUrlRef.current = null;
    }

    recordingSessionRef.current = null;
    setTemporaryRecordingTrack(null);
  }, [ingestEngine, temporaryRecordingTrack]);

  useEffect(() => {
    setOffsetOverrides({});
    setSegmentLayoutOverrides({});
    setTimelineHistory([]);
    setDragError(null);
    setSelectedSegmentId(null);
    setSelectedTrackVersionId(selectedTracks[0]?.trackVersionId ?? null);
    setSplitHover(null);
    setSplitError(null);
    setTimelineTool('select');
  }, [selectedTracks, selectedVersionId]);

  useEffect(() => {
    playbackEngine.setProject({
      tracks: playbackEngineProjection.tracks,
      mutedTrackVersionIds: playbackEngineProjection.mutedTrackVersionIds,
      soloTrackVersionIds: playbackEngineProjection.soloTrackVersionIds,
      gainByTrackVersionId: playbackEngineProjection.gainByTrackVersionId,
      localTempoBpm: resolvedLocalTempoBpm,
      sharedDemoTempoBpm,
    });
  }, [
    playbackEngine,
    playbackEngineProjection,
    resolvedLocalTempoBpm,
    sharedDemoTempoBpm,
  ]);

  useEffect(() => {
    if (!isPlaying) {
      lastAppliedTempoBpmRef.current = resolvedLocalTempoBpm;
      return;
    }
    if (lastAppliedTempoBpmRef.current === resolvedLocalTempoBpm) return;
    lastAppliedTempoBpmRef.current = resolvedLocalTempoBpm;
    const playhead = currentTimeMsRef.current;
    startPlayheadMsRef.current = playhead;
    startWallTimeRef.current = performance.now();
    seekAllTracks(playhead);
    void playbackEngine.play(playhead);
  }, [isPlaying, playbackEngine, resolvedLocalTempoBpm]);

  useEffect(() => {
    void projectSyncEngine.bootstrap({
      projectId,
      demoId,
      initialProjectState: {
        versions: initialVersions,
        currentVersionId: initialCurrentVersionId,
        versionTreeUpdatedAt: null,
        lastVersionOperationSeq: 0,
        comments: [],
        annotations: [],
        tempoMetadataByTrackVersionId: {},
        recordingTakesByTrackId: {},
      },
    });
  }, [demoId, initialCurrentVersionId, initialVersions, projectId, projectSyncEngine]);

  useEffect(() => {
    function handleOnline() {
      void projectSyncEngine.handleReconnect();
    }

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [projectSyncEngine]);

  useEffect(() => {
    void playbackEngine.preloadTracks(playbackEngineProjection.tracks);
  }, [playbackEngine, playbackEngineProjection.tracks]);

  useEffect(() => {
    return () => {
      playbackEngine.dispose();
    };
  }, [playbackEngine]);

  useEffect(() => {
    return () => {
      projectSyncEngine.dispose();
    };
  }, [projectSyncEngine]);

  useEffect(() => {
    if (processingJobIds.length === 0) return;

    let cancelled = false;

    async function pollJobs() {
      try {
        const statuses = await Promise.all(
          processingJobIds.map(async (id) => {
            const response = await fetch(`/api/jobs/${id}`);
            const data = (await response.json()) as JobStatusResponse | { error?: string };
            if (!response.ok) {
              throw new Error(data && 'error' in data ? data.error ?? 'Could not load job status' : 'Could not load job status');
            }
            return data as JobStatusResponse;
          }),
        );

        if (cancelled) return;
        setProcessingJobs((previous) => {
          const next = { ...previous };
          for (const status of statuses) {
            next[status.id] = status;
          }
          return next;
        });
        setProcessingStartedAt(Date.now());

        const stillPending = statuses.some((status) => status.status === 'PENDING' || status.status === 'PROCESSING');
        if (stillPending) {
          return;
        }

        const failed = statuses.find((status) => status.status === 'FAILED');
        if (failed) {
          setProcessingMessage(failed.error ?? 'A processing job failed');
          setProcessingJobIds([]);
          setProcessingStartedAt(null);
        } else {
          const finishedTempoAnalysis = statuses.find((status) => {
            if (status.type !== 'TEMPO_ANALYSIS' || status.status !== 'COMPLETE') return false;
            const result = status.result as { tempoBpm?: number; confidence?: number; beatTimes?: number[] } | undefined;
            return typeof result?.tempoBpm === 'number';
          });

          if (finishedTempoAnalysis && tempoAnalysisPrompt?.jobId === finishedTempoAnalysis.id) {
            const result = finishedTempoAnalysis.result as {
              tempoBpm?: number;
              confidence?: number;
              beatTimes?: number[];
            };
            setTempoAnalysisPrompt((prev) =>
              prev
                ? {
                    ...prev,
                    open: true,
                    tempoBpm: result.tempoBpm ?? prev.tempoBpm,
                    confidence: result.confidence ?? prev.confidence,
                    beatTimes: Array.isArray(result.beatTimes) ? result.beatTimes : prev.beatTimes,
                    applying: false,
                    error: null,
                  }
                : prev,
            );
            setProcessingMessage('Tempo analysis ready.');
            setProcessingJobIds([]);
            setProcessingStartedAt(null);
            return;
          }

          const suggestion = statuses.find((status) => {
            const result = status.result as { appliedToDemoVersion?: boolean; tempoBpm?: number } | undefined;
            return result && result.appliedToDemoVersion === false && typeof result.tempoBpm === 'number';
          });
          if (suggestion) {
            const result = suggestion.result as { tempoBpm?: number };
            setProcessingMessage(
              typeof result.tempoBpm === 'number'
                ? `Tempo analysis finished. Suggested tempo: ${result.tempoBpm.toFixed(1)} BPM`
                : 'Processing finished with a low-confidence tempo suggestion.',
            );
          } else {
            setProcessingMessage('Processing finished.');
          }
          router.refresh();
        }

        setProcessingJobIds([]);
        setProcessingStartedAt(null);
      } catch (error) {
        if (cancelled) return;
        setProcessingMessage(error instanceof Error ? error.message : 'Could not load processing status');
      }
    }

    void pollJobs();
    const timer = setInterval(() => void pollJobs(), 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [processingJobIds, router, tempoAnalysisPrompt]);

  useEffect(() => {
    return () => {
      if (metronomeTimerRef.current) {
        clearInterval(metronomeTimerRef.current);
        metronomeTimerRef.current = null;
      }
      if (metronomeAudioRef.current) {
        void metronomeAudioRef.current.close();
        metronomeAudioRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (recordingPreviewUrlRef.current) ingestEngine.revokeObjectUrl(recordingPreviewUrlRef.current);
    };
  }, [ingestEngine]);

  useEffect(() => {
    timelineToolRef.current = timelineTool;
  }, [timelineTool]);

  useEffect(() => {
    currentTimeMsRef.current = currentTimeMs;
  }, [currentTimeMs]);

  useEffect(() => {
    selectedTrackIdRef.current = selectedTrack?.trackId ?? null;
  }, [selectedTrack]);

  useEffect(() => {
    currentRecordingStateRef.current = currentRecordingState;
  }, [currentRecordingState]);

  useEffect(() => {
    playbackFollowStateRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void publishPresence();
    }, 150);

    return () => clearTimeout(timer);
  }, [currentRecordingState, isPlaying, publishPresence, selectedTrack?.trackId, timelineTool]);

  useEffect(() => {
    if (!isPlaying && currentRecordingState === 'idle') return;

    const timer = setInterval(() => {
      void publishPresence();
    }, 1000);

    return () => clearInterval(timer);
  }, [currentRecordingState, isPlaying, publishPresence]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void projectSyncEngine.handleReconnect();
      }
      void publishPresence();
    };

    const handleOnline = () => {
      void publishPresence('online');
    };

    const handleOffline = () => {
      void publishPresence('away');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [publishPresence]);

  useEffect(() => {
    void publishPresence();
  }, [publishPresence]);

  useEffect(() => {
    return () => {
      void clearPresence();
    };
  }, [clearPresence]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) return;

      const isUndo = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z';
      if (isUndo) {
        event.preventDefault();
        if (event.shiftKey) {
          return;
        }
        void undoLatestTimelineEditRef.current();
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        void deleteSelectedClipRef.current();
        return;
      }

      if (event.key === 'Escape') {
        if (dragRef.current) {
          cancelTimelineDragRef.current();
        } else if (timelineToolRef.current === 'split') {
          setSplitHover(null);
          setTimelineTool('select');
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  function getActiveTiming() {
    if (!selectedTiming || !isValidTempoBpm(selectedTiming.tempoBpm)) return null;
    return selectedTiming;
  }

  function isTypingTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return false;
    return target.matches('input, textarea, select, [contenteditable="true"]');
  }

  function getTrackStartOffsetMs(track: DawTrack) {
    return selectTrackStartOffsetMs(track, offsetOverrides);
  }

  function getDisplayedTrackSegments(track: DawTrack) {
    return selectDisplayedTrackSegments(track, segmentLayoutOverrides);
  }

  function getRenderableTrackSegments(track: DawTrack) {
    return selectRenderableTrackSegments({
      track: {
        ...track,
        mimeType: getEffectiveTrackMimeType(track, segmentLayoutOverrides),
      },
      offsetOverrides,
      segmentLayoutOverrides,
      durationByTrackVersionId,
    });
  }

  function setTrackSegmentLayout(trackVersionId: string, segments: TrackTimelineSegment[]) {
    setSegmentLayoutOverrides((prev) => ({
      ...prev,
      [trackVersionId]: segments,
    }));
  }

  function getTrackRecordingTakes(trackId: string) {
    return [...(recordingTakesByTrackId[trackId] ?? [])].sort(
      (a, b) => (a.position ?? 0) - (b.position ?? 0),
    );
  }

  function getTrackRecordingTake(trackId: string, takeId: string) {
    return recordingTakesByTrackId[trackId]?.find((take) => take.id === takeId) ?? null;
  }

  function normalizeRecordingTakeOrder(takes: TrackRecordingTake[]) {
    return takes.map((take, index) => ({
      ...take,
      position: index,
    }));
  }

  async function replaceTrackRecordingTakes(trackId: string, takes: TrackRecordingTake[]) {
    await projectSyncEngine.setTrackRecordingTakes(trackId, normalizeRecordingTakeOrder(takes));
  }

  function buildTakeRestorePayload(take: TrackRecordingTake) {
    if (!take.assetId) {
      throw new Error('Cannot restore a take without an assetId');
    }

    return {
      trackId: take.trackId,
      takeId: take.id,
      assetId: take.assetId,
      storageKey: take.storageKey,
      name: take.name,
      trackVersionId: take.trackVersionId,
      startOffsetMs: take.startOffsetMs,
      durationMs: take.durationMs,
      sourceStartMs: take.sourceStartMs,
      sourceEndMs: take.sourceEndMs,
      timelineStartMs: take.timelineStartMs,
      timelineEndMs: take.timelineEndMs,
      gainDb: take.gainDb,
      fadeInMs: take.fadeInMs,
      fadeOutMs: take.fadeOutMs,
      isMuted: take.isMuted,
      position: take.position,
      recordedTempoBpm: take.recordedTempoBpm,
      sourceTempoBpm: take.sourceTempoBpm,
      createdAt: take.createdAt,
      restoredAt: new Date().toISOString(),
      restoredBy: currentUserId,
      operationSummary: 'Restored recording',
    } satisfies Extract<
      DawCommandPayload,
      {
        trackId: string;
        takeId: string;
        restoredAt: string;
        restoredBy: string;
        operationSummary: string;
      }
    >;
  }

  function pushTimelineHistory(entry: TimelineHistoryEntry) {
    setTimelineHistory((prev) => [...prev, entry]);
  }

  async function undoLatestTimelineEdit() {
    if (undoTimelineEditInFlightRef.current) return false;
    const lastEntry = timelineHistory[timelineHistory.length - 1];
    if (!lastEntry) return false;
    undoTimelineEditInFlightRef.current = true;

    try {
      if (lastEntry.kind === 'move-track') {
        setOffsetOverrides((prev) => ({
          ...prev,
          [lastEntry.trackVersionId]: lastEntry.previousStartOffsetMs,
        }));
        await commitEditingOperation(
          audioEditingEngine.moveTrack(lastEntry.trackVersionId, lastEntry.previousStartOffsetMs),
        );
      } else if (lastEntry.kind === 'move-segment') {
        const currentTrack = selectedTracks.find((track) => track.trackVersionId === lastEntry.trackVersionId);
        const currentSegments = currentTrack
          ? getDisplayedTrackSegments(currentTrack)
          : segmentLayoutOverrides[lastEntry.trackVersionId] ?? [];
        const nextSegments = currentSegments.map((segment) =>
          segment.id === lastEntry.segmentId
            ? {
                ...segment,
                timelineStartMs: lastEntry.previousTimelineStartMs,
                timelineEndMs: lastEntry.previousTimelineStartMs + segment.durationMs,
              }
            : segment,
        );
        setTrackSegmentLayout(lastEntry.trackVersionId, nextSegments);
        await commitEditingOperation(
          audioEditingEngine.moveSegment(
            lastEntry.trackVersionId,
            lastEntry.segmentId,
            lastEntry.previousTimelineStartMs,
          ),
        );
      } else if (lastEntry.kind === 'move-segment-track') {
        setTrackSegmentLayout(lastEntry.sourceTrackVersionId, lastEntry.previousSourceSegments);
        setTrackSegmentLayout(lastEntry.targetTrackVersionId, lastEntry.previousTargetSegments);
        setSelectedTrackVersionId(lastEntry.previousSelectedTrackVersionId);
        setSelectedSegmentId(lastEntry.previousSelectedSegmentId);
      } else if (lastEntry.kind === 'cut') {
        setTrackSegmentLayout(lastEntry.trackVersionId, lastEntry.previousSegments);
        setSelectedSegmentId(lastEntry.previousSelectedSegmentId);
      } else if (lastEntry.kind === 'delete-segment') {
        setTrackSegmentLayout(lastEntry.trackVersionId, lastEntry.previousSegments);
        setSelectedSegmentId(lastEntry.previousSelectedSegmentId);
      } else if (lastEntry.kind === 'recording-takes' && lastEntry.deletedTake) {
        await commitEditingOperation({
          demoId,
          operationType: 'TAKE_RESTORED',
          payload: buildTakeRestorePayload(lastEntry.deletedTake),
          targetTrackId: lastEntry.deletedTake.trackId,
          affectedTimeRange: {
            startMs: lastEntry.deletedTake.timelineStartMs,
            endMs: lastEntry.deletedTake.timelineEndMs,
          },
        });
        setSelectedTrackVersionId(lastEntry.previousSelectedTrackVersionId);
        setSelectedSegmentId(lastEntry.deletedTake.id);
      } else if (lastEntry.kind === 'recording-takes') {
        await replaceTrackRecordingTakes(lastEntry.trackId, lastEntry.previousTakes);
        if (lastEntry.targetTrackId && lastEntry.targetPreviousTakes) {
          await replaceTrackRecordingTakes(lastEntry.targetTrackId, lastEntry.targetPreviousTakes);
        }
        setSelectedTrackVersionId(lastEntry.previousSelectedTrackVersionId);
        setSelectedSegmentId(lastEntry.previousSelectedSegmentId);
      }

      setTimelineHistory((prev) => prev.slice(0, -1));
      return true;
    } catch (error) {
      setDragError(error instanceof Error ? error.message : 'Could not undo timeline edit');
      return false;
    } finally {
      undoTimelineEditInFlightRef.current = false;
    }
  }

  async function deleteSelectedClip() {
    if (!selectedSegmentId) return false;

    const selectedTrack = selectedTracks.find((track) =>
      getRenderableTrackSegments(track).some((segment) => segment.id === selectedSegmentId) ||
      getTrackRecordingTakes(track.trackId).some((take) => take.id === selectedSegmentId),
    );
    if (!selectedTrack) return false;

    const renderedSegments = getRenderableTrackSegments(selectedTrack);
    const currentSegments = getDisplayedTrackSegments(selectedTrack);
    const currentRecordingTakes = getTrackRecordingTakes(selectedTrack.trackId);
    const selectedSegment =
      currentSegments.find((segment) => segment.id === selectedSegmentId) ??
      renderedSegments.find((segment) => segment.id === selectedSegmentId);
    const selectedRecordingTake = currentRecordingTakes.find((take) => take.id === selectedSegmentId);
    if (!selectedSegment && !selectedRecordingTake) return false;

    if (selectedRecordingTake) {
      const selectedRecordingTakeIndex = currentRecordingTakes.findIndex((take) => take.id === selectedRecordingTake.id);
      const nextRecordingTakes = currentRecordingTakes
        .filter((take) => take.id !== selectedRecordingTake.id)
        .map((take, index) => ({ ...take, position: index }));
      const deletedAt = new Date().toISOString();
      const operationSummary = `Removed recording from ${selectedTrack.trackName}`;
      await replaceTrackRecordingTakes(selectedTrack.trackId, nextRecordingTakes);
      setSelectedSegmentId(
        nextRecordingTakes[selectedRecordingTakeIndex]?.id ??
          nextRecordingTakes[selectedRecordingTakeIndex - 1]?.id ??
          nextRecordingTakes[0]?.id ??
          null,
      );
      try {
        await commitEditingOperation({
          demoId,
          operationType: 'TAKE_DELETED',
          payload: {
            trackId: selectedTrack.trackId,
            takeId: selectedRecordingTake.id,
            deletedAt,
            deletedBy: currentUserId,
            operationSummary,
          },
          targetTrackId: selectedTrack.trackId,
          affectedTimeRange: {
            startMs: selectedRecordingTake.timelineStartMs,
            endMs: selectedRecordingTake.timelineEndMs,
          },
        });
        setSplitError(null);
        setDragError(null);
        pushTimelineHistory({
          kind: 'recording-takes',
          trackId: selectedTrack.trackId,
          previousTakes: currentRecordingTakes,
          nextTakes: nextRecordingTakes,
          previousSelectedTrackVersionId: selectedTrackVersionId,
          previousSelectedSegmentId: selectedSegmentId,
          deletedTake: { ...selectedRecordingTake },
        });
        return true;
      } catch (error) {
        await replaceTrackRecordingTakes(selectedTrack.trackId, currentRecordingTakes);
        setSelectedSegmentId(selectedSegmentId);
        setDragError(error instanceof Error ? error.message : 'Could not delete take');
        return false;
      }
    }

    if (!selectedSegment) return false;

    const nextSegments = currentSegments
      .filter((segment) => segment.id !== selectedSegment.id)
      .map((segment, index) => ({
        ...segment,
        position: index,
      }));
    const previousSegmentsForHistory = selectedSegment.isImplicit ? renderedSegments : currentSegments;

    if (!selectedSegment.isImplicit) {
      try {
        await commitEditingOperation(audioEditingEngine.deleteSegment(selectedTrack.trackVersionId, selectedSegment.id));
      } catch (error) {
        setDragError(error instanceof Error ? error.message : 'Could not delete clip');
        return false;
      }
    }

    setTrackSegmentLayout(selectedTrack.trackVersionId, nextSegments.length > 0 ? nextSegments : []);
    setSelectedSegmentId(nextSegments.find((segment) => segment.position === selectedSegment.position)?.id ?? null);
    setSplitError(null);
    setDragError(null);
    pushTimelineHistory({
      kind: 'delete-segment',
      trackVersionId: selectedTrack.trackVersionId,
      previousSegments: previousSegmentsForHistory,
      nextSegments,
      previousSelectedSegmentId: selectedSegmentId,
    });
    return true;
  }

  function ensureMetronomeContext() {
    if (!metronomeAudioRef.current) {
      metronomeAudioRef.current = new AudioContext();
    }
    return metronomeAudioRef.current;
  }

  function scheduleMetronomeClick(whenSeconds: number, isAccent: boolean) {
    const ctx = ensureMetronomeContext();
    const gainNode = ctx.createGain();
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = isAccent ? 1320 : 880;
    gainNode.gain.value = isAccent ? 0.12 : 0.07;
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    osc.start(whenSeconds);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, whenSeconds + 0.06);
    osc.stop(whenSeconds + 0.07);
  }

  function restartMetronomeSchedule() {
    stopMetronomeSchedule();
    if (!metronomeEnabled) return;

    const ctx = ensureMetronomeContext();
    const beatDurationMs = 60000 / resolvedLocalTempoBpm;

    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    metronomeScheduledBeatRef.current = 0;
    const scheduleBeat = () => {
      const beatIndex = metronomeScheduledBeatRef.current ?? 0;
      scheduleMetronomeClick(ctx.currentTime + 0.01, beatIndex % 4 === 0);
      metronomeScheduledBeatRef.current = beatIndex + 1;
    };

    scheduleBeat();
    metronomeTimerRef.current = setInterval(scheduleBeat, beatDurationMs);
  }

  const stopMetronomeSchedule = useCallback(() => {
    if (metronomeTimerRef.current) {
      clearInterval(metronomeTimerRef.current);
      metronomeTimerRef.current = null;
    }
    metronomeScheduledBeatRef.current = null;
    if (metronomeAudioRef.current) {
      void metronomeAudioRef.current.close();
      metronomeAudioRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isPlaying) {
      stopMetronomeSchedule();
      return;
    }

    if (metronomeEnabled) {
      restartMetronomeSchedule();
      return;
    }

    stopMetronomeSchedule();
  }, [isPlaying, metronomeEnabled, resolvedLocalTempoBpm, stopMetronomeSchedule]);

  const stopTransport = useCallback(() => {
    if (clockRef.current) {
      clearInterval(clockRef.current);
      clockRef.current = null;
    }
    setIsPlaying(false);
    setCurrentTimeMs(0);
    playbackEngine.stop();
    stopMetronomeSchedule();
    void publishPresence('idle');
  }, [playbackEngine, publishPresence, stopMetronomeSchedule]);

  useEffect(() => {
    setSelectedVersionId(liveCurrentVersionId);
    stopTransport();
  }, [liveCurrentVersionId, stopTransport]);

  function pauseTransport() {
    if (clockRef.current) {
      clearInterval(clockRef.current);
      clockRef.current = null;
    }
    setCurrentTimeMs(playbackEngine.getCurrentTimeMs());
    setIsPlaying(false);
    playbackEngine.pause();
    stopMetronomeSchedule();
    void publishPresence('idle');
  }

  function handleTransportStop() {
    if (isLiveRecordingRef.current || currentRecordingState === 'recording') {
      recordingControlsRef.current?.stopRecording();
      return;
    }

    stopTransport();
  }

  function seekAllTracks(timeMs: number) {
    playbackEngine.seek(timeMs);
  }

  function seekTransport(timeMs: number) {
    setCurrentTimeMs(timeMs);
    seekAllTracks(timeMs);
    void publishPresence();
  }

  function playTransport(fromMs?: number) {
    const startMs = fromMs ?? currentTimeMs;
    startPlayheadMsRef.current = startMs;
    startWallTimeRef.current = performance.now();

    seekAllTracks(startMs);
    void playbackEngine.play(startMs);

    clockRef.current = setInterval(() => {
      const newTimeMs = playbackEngine.getCurrentTimeMs();

      // While a take is actively recording, the transport must keep running even if
      // the timeline length is being inferred from the live recording itself.
      if (totalDurationMs > 0 && newTimeMs >= totalDurationMs && !isLiveRecordingRef.current) {
        setCurrentTimeMs(totalDurationMs);
        stopTransport();
        return;
      }

      setCurrentTimeMs(newTimeMs);
    }, TICK_INTERVAL_MS);

    setIsPlaying(true);
    void publishPresence('online');
  }

  function handleSeek(timeMs: number) {
    const wasPlaying = isPlaying;
    if (wasPlaying) pauseTransport();
    setCurrentTimeMs(timeMs);
    seekAllTracks(timeMs);
    if (wasPlaying) playTransport(timeMs);
    void publishPresence();
  }

  const handleDurationReady = useCallback((trackVersionId: string, durationMs: number) => {
    setDurationByTrackVersionId((prev) => ({ ...prev, [trackVersionId]: durationMs }));
  }, []);

  function getTrackDurationMs(track: DawTrack) {
    return selectTrackDurationMs(track, durationByTrackVersionId);
  }

  function findTrackByVersionId(trackVersionId: string) {
    return selectedTracks.find((track) => track.trackVersionId === trackVersionId) ?? null;
  }

  function findSegmentById(trackVersionId: string, segmentId: string) {
    return (
      findTrackByVersionId(trackVersionId)?.segments.find((segment) => segment.id === segmentId) ?? null
    );
  }

  function resolveCommitTargetTrackId(
    operationType: Exclude<DawOperationType, 'ASSET_ADDED'>,
    payload: DawCommandPayload,
  ) {
    switch (operationType) {
      case 'TRACK_RENAMED':
        return (payload as Extract<DawCommandPayload, { trackId: string }>).trackId;
      case 'TRACK_OFFSET_UPDATED':
        return findTrackByVersionId(
          (payload as Extract<DawCommandPayload, { trackVersionId: string }>).trackVersionId,
        )?.trackId ?? null;
      case 'SEGMENT_SPLIT':
        return findTrackByVersionId(
          (payload as Extract<DawCommandPayload, { trackVersionId: string }>).trackVersionId,
        )?.trackId ?? null;
      case 'SEGMENT_MOVED':
      case 'SEGMENT_DELETED':
      case 'SEGMENT_TRIMMED':
      case 'SEGMENT_MERGED':
      case 'CROSSFADE_SET':
        return findTrackByVersionId(
          (payload as Extract<DawCommandPayload, { trackVersionId: string }>).trackVersionId,
        )?.trackId ?? null;
      case 'TAKE_DELETED':
      case 'TAKE_RESTORED':
        return (payload as Extract<DawCommandPayload, { trackId: string }>).trackId;
      case 'VERSION_TIMING_UPDATED':
        return null;
      case 'COMMENT_ADDED':
      case 'COMMENT_UPDATED':
      case 'COMMENT_DELETED':
      case 'ANNOTATION_ADDED':
      case 'ANNOTATION_UPDATED':
      case 'ANNOTATION_DELETED':
        return (payload as Extract<DawCommandPayload, { trackId: string | null }>).trackId ?? null;
      default:
        return null;
    }
  }

  function resolveCommitTargetSegmentId(
    operationType: Exclude<DawOperationType, 'ASSET_ADDED'>,
    payload: DawCommandPayload,
  ) {
    switch (operationType) {
      case 'SEGMENT_SPLIT':
        return (payload as Extract<DawCommandPayload, { segmentId?: string }>).segmentId ?? null;
      case 'SEGMENT_MOVED':
      case 'SEGMENT_DELETED':
      case 'SEGMENT_TRIMMED':
        return (payload as Extract<DawCommandPayload, { segmentId: string }>).segmentId ?? null;
      case 'SEGMENT_MERGED':
        return (payload as Extract<DawCommandPayload, { segmentIds: string[] }>).segmentIds[0] ?? null;
      case 'CROSSFADE_SET':
        {
          const crossfade = payload as Extract<
            DawCommandPayload,
            { leftSegmentId: string; rightSegmentId: string }
          >;
          return crossfade.leftSegmentId ?? crossfade.rightSegmentId ?? null;
        }
      case 'TAKE_DELETED':
      case 'TAKE_RESTORED':
        return null;
      case 'COMMENT_ADDED':
      case 'COMMENT_UPDATED':
      case 'COMMENT_DELETED':
      case 'ANNOTATION_ADDED':
      case 'ANNOTATION_UPDATED':
      case 'ANNOTATION_DELETED':
        return (payload as Extract<DawCommandPayload, { segmentId?: string | null }>).segmentId ?? null;
      default:
        return null;
    }
  }

  function resolveCommitAffectedTimeRange(
    operationType: Exclude<DawOperationType, 'ASSET_ADDED'>,
    payload: DawCommandPayload,
  ): DawOperationAffectedTimeRange | null {
    switch (operationType) {
      case 'TRACK_OFFSET_UPDATED':
        return null;
      case 'SEGMENT_SPLIT':
        {
          const split = payload as Extract<
            DawCommandPayload,
            { segmentStartMs: number; segmentEndMs: number }
          >;
          return { startMs: split.segmentStartMs, endMs: split.segmentEndMs };
        }
      case 'SEGMENT_MOVED': {
        const moved = payload as Extract<DawCommandPayload, { trackVersionId: string; segmentId: string }>;
        const segment = findSegmentById(moved.trackVersionId, moved.segmentId);
        return segment ? { startMs: segment.timelineStartMs, endMs: segment.timelineEndMs } : null;
      }
      case 'SEGMENT_DELETED': {
        const deleted = payload as Extract<DawCommandPayload, { trackVersionId: string; segmentId: string }>;
        const segment = findSegmentById(deleted.trackVersionId, deleted.segmentId);
        return segment ? { startMs: segment.timelineStartMs, endMs: segment.timelineEndMs } : null;
      }
      case 'TAKE_DELETED': {
        const deleted = payload as Extract<DawCommandPayload, { trackId: string; takeId: string }>;
        const take = getTrackRecordingTake(deleted.trackId, deleted.takeId);
        return take ? { startMs: take.timelineStartMs, endMs: take.timelineEndMs } : null;
      }
      case 'TAKE_RESTORED': {
        const restored = payload as Extract<
          DawCommandPayload,
          { trackId: string; takeId: string; timelineStartMs: number; timelineEndMs: number }
        >;
        const take = getTrackRecordingTake(restored.trackId, restored.takeId);
        if (take) {
          return { startMs: take.timelineStartMs, endMs: take.timelineEndMs };
        }
        return { startMs: restored.timelineStartMs, endMs: restored.timelineEndMs };
      }
      case 'SEGMENT_TRIMMED':
        {
          const trimmed = payload as Extract<DawCommandPayload, { to: { startMs: number; endMs: number } }>;
          return { startMs: trimmed.to.startMs, endMs: trimmed.to.endMs };
        }
      case 'SEGMENT_MERGED':
        {
          const merged = payload as Extract<
            DawCommandPayload,
            { mergedSegment: { timelineStartMs?: number | null; startMs: number; endMs: number } }
          >;
          return {
            startMs: merged.mergedSegment.timelineStartMs ?? merged.mergedSegment.startMs,
            endMs:
              (merged.mergedSegment.timelineStartMs ?? merged.mergedSegment.startMs) +
              (merged.mergedSegment.endMs - merged.mergedSegment.startMs),
          };
        }
      case 'CROSSFADE_SET': {
        const crossfade = payload as Extract<
          DawCommandPayload,
          { trackVersionId: string; leftSegmentId: string; rightSegmentId: string }
        >;
        const left = findSegmentById(crossfade.trackVersionId, crossfade.leftSegmentId);
        const right = findSegmentById(crossfade.trackVersionId, crossfade.rightSegmentId);
        if (!left && !right) return null;
        const startMs = Math.min(left?.timelineStartMs ?? Number.POSITIVE_INFINITY, right?.timelineStartMs ?? Number.POSITIVE_INFINITY);
        const endMs = Math.max(left?.timelineEndMs ?? Number.NEGATIVE_INFINITY, right?.timelineEndMs ?? Number.NEGATIVE_INFINITY);
        return Number.isFinite(startMs) && Number.isFinite(endMs) ? { startMs, endMs } : null;
      }
      case 'COMMENT_ADDED':
      case 'COMMENT_UPDATED':
      case 'COMMENT_DELETED':
      case 'ANNOTATION_ADDED':
      case 'ANNOTATION_UPDATED':
      case 'ANNOTATION_DELETED': {
        const note = payload as Extract<DawCommandPayload, { startTimeMs: number | null; endTimeMs: number | null }>;
        if (note.startTimeMs === null && note.endTimeMs === null) return null;
        const startMs = note.startTimeMs ?? note.endTimeMs ?? 0;
        const endMs = note.endTimeMs ?? note.startTimeMs ?? startMs;
        return { startMs, endMs };
      }
      default:
        return null;
    }
  }

  function buildCommitRequest(
    operationType: Exclude<DawOperationType, 'ASSET_ADDED'>,
    payload: DawCommandPayload,
    overrides: Partial<DawOperationCommitMetadata> = {},
  ): DawOperationCommitRequest {
    const idempotencyKey = overrides.idempotencyKey ?? crypto.randomUUID();
    const clientOperationId = overrides.clientOperationId ?? crypto.randomUUID();

    return {
      demoId,
      operationType,
      payload,
      baseSnapshotId: overrides.baseSnapshotId ?? selectedVersionId,
      baseOperationSeq: overrides.baseOperationSeq ?? projectSyncState.lastSyncedOperationSeq,
      targetTrackId: overrides.targetTrackId ?? resolveCommitTargetTrackId(operationType, payload),
      targetSegmentId: overrides.targetSegmentId ?? resolveCommitTargetSegmentId(operationType, payload),
      affectedTimeRange: overrides.affectedTimeRange ?? resolveCommitAffectedTimeRange(operationType, payload),
      idempotencyKey,
      clientOperationId,
      checkpointTailOperations: overrides.checkpointTailOperations,
    } as DawOperationCommitRequest;
  }

  async function commitProjectOperation(
    operationType: Exclude<DawOperationType, 'ASSET_ADDED'>,
    payload: DawCommandPayload,
  ): Promise<DawProjectOperationRecord> {
    return projectSyncEngine.commitOperation(buildCommitRequest(operationType, payload));
  }

  async function commitEditingOperation(
    request: DawOperationCommitRequest,
  ) {
    return projectSyncEngine.commitOperation(
      buildCommitRequest(request.operationType, request.payload, request),
    );
  }

  function getTimelineTimeFromPointer(element: HTMLElement, clientX: number, timelineBaseMs = 0) {
    const rect = element.getBoundingClientRect();
    const x = Math.max(0, clientX - rect.left);
    return Math.max(0, timelineBaseMs + (x / PX_PER_SECOND) * 1000);
  }

  function getSnappedSplitTimeFromPointer(element: HTMLElement, clientX: number, timelineBaseMs = 0) {
    const rawMs = getTimelineTimeFromPointer(element, clientX, timelineBaseMs);
    return Math.max(0, snapMsToGrid(rawMs, getActiveTiming(), snapResolution));
  }

  function findSegmentAtTime(track: DawTrack, timeMs: number) {
    return getRenderableTrackSegments(track).find(
      (segment) => timeMs >= segment.timelineStartMs && timeMs <= segment.timelineEndMs,
    ) ?? null;
  }

  async function splitSegmentOnTrack(track: DawTrack, segment: TrackTimelineSegment, splitTimeMs: number) {
    const splitOperation = audioEditingEngine.splitSegment(track.trackVersionId, segment, splitTimeMs);
    const result = await commitEditingOperation(splitOperation.request);

    const payload = result.payload as Partial<{
      trackVersionId: string;
      sourceSegmentId: string | null;
      leftSegment: {
        id: string;
        trackVersionId: string;
        startMs: number;
        endMs: number;
        timelineStartMs: number;
        gainDb: number;
        fadeInMs: number;
        fadeOutMs: number;
        isMuted: boolean;
        position: number;
      };
      rightSegment: {
        id: string;
        trackVersionId: string;
        startMs: number;
        endMs: number;
        timelineStartMs: number;
        gainDb: number;
        fadeInMs: number;
        fadeOutMs: number;
        isMuted: boolean;
        position: number;
      };
    }>;

    const currentSegments = getDisplayedTrackSegments(track);
    const splitResult = splitOperation.split;
    const leftId = payload.leftSegment?.id ?? crypto.randomUUID();
    const rightId = payload.rightSegment?.id ?? crypto.randomUUID();
    const leftTimelineStartMs = payload.leftSegment?.timelineStartMs ?? segment.timelineStartMs;
    const rightTimelineStartMs = payload.rightSegment?.timelineStartMs ?? segment.timelineStartMs;
    const nextSegments = currentSegments
      .filter((current) => current.id !== segment.id)
      .concat([
        {
          id: leftId,
          trackVersionId: track.trackVersionId,
          isImplicit: false,
          sourceStartMs: splitResult.leftSegment.startMs,
          sourceEndMs: splitResult.leftSegment.endMs,
          durationMs: splitResult.leftSegment.endMs - splitResult.leftSegment.startMs,
          startMs: splitResult.leftSegment.startMs,
          endMs: splitResult.leftSegment.endMs,
          timelineStartMs: leftTimelineStartMs,
          timelineEndMs:
            leftTimelineStartMs +
            (splitResult.leftSegment.endMs - splitResult.leftSegment.startMs),
          gainDb: payload.leftSegment?.gainDb ?? segment.gainDb,
          fadeInMs: payload.leftSegment?.fadeInMs ?? segment.fadeInMs,
          fadeOutMs: payload.leftSegment?.fadeOutMs ?? segment.fadeOutMs,
          isMuted: payload.leftSegment?.isMuted ?? segment.isMuted,
          position: payload.leftSegment?.position ?? segment.position,
        },
        {
          id: rightId,
          trackVersionId: track.trackVersionId,
          isImplicit: false,
          sourceStartMs: splitResult.rightSegment.startMs,
          sourceEndMs: splitResult.rightSegment.endMs,
          durationMs: splitResult.rightSegment.endMs - splitResult.rightSegment.startMs,
          startMs: splitResult.rightSegment.startMs,
          endMs: splitResult.rightSegment.endMs,
          timelineStartMs: rightTimelineStartMs,
          timelineEndMs:
            rightTimelineStartMs +
            (splitResult.rightSegment.endMs - splitResult.rightSegment.startMs),
          gainDb: payload.rightSegment?.gainDb ?? segment.gainDb,
          fadeInMs: payload.rightSegment?.fadeInMs ?? segment.fadeInMs,
          fadeOutMs: payload.rightSegment?.fadeOutMs ?? segment.fadeOutMs,
          isMuted: payload.rightSegment?.isMuted ?? segment.isMuted,
          position: payload.rightSegment?.position ?? segment.position + 1,
        },
      ])
      .sort((a, b) => a.position - b.position);

    setTrackSegmentLayout(track.trackVersionId, nextSegments);
    setSelectedSegmentId(leftId);
    setSplitError(null);
    pushTimelineHistory({
      kind: 'cut',
      trackVersionId: track.trackVersionId,
      previousSegments: currentSegments,
      nextSegments,
      previousSelectedSegmentId: selectedSegmentId,
    });
  }

  async function moveRecordingTakeWithinTrack(track: DawTrack, take: TrackRecordingTake, nextTimelineStartMs: number) {
    const currentTakes = getTrackRecordingTakes(track.trackId);
    const nextTakes = currentTakes.map((entry) =>
      entry.id === take.id
        ? {
            ...entry,
            startOffsetMs: nextTimelineStartMs,
            timelineStartMs: nextTimelineStartMs,
            timelineEndMs: nextTimelineStartMs + entry.durationMs,
          }
        : entry,
    );

    await replaceTrackRecordingTakes(track.trackId, nextTakes);
  }

  async function moveRecordingTakeAcrossTracks(
    sourceTrack: DawTrack,
    targetTrack: DawTrack,
    take: TrackRecordingTake,
    nextTimelineStartMs: number,
  ) {
    const sourceTakes = getTrackRecordingTakes(sourceTrack.trackId).filter((entry) => entry.id !== take.id);
    const targetTakes = getTrackRecordingTakes(targetTrack.trackId).filter((entry) => entry.id !== take.id);
    const movedTake: TrackRecordingTake = {
      ...take,
      trackId: targetTrack.trackId,
      startOffsetMs: nextTimelineStartMs,
      timelineStartMs: nextTimelineStartMs,
      timelineEndMs: nextTimelineStartMs + take.durationMs,
    };

    await replaceTrackRecordingTakes(sourceTrack.trackId, sourceTakes);
    await replaceTrackRecordingTakes(targetTrack.trackId, [...targetTakes, movedTake]);
  }

  async function splitRecordingTakeOnTrack(
    track: DawTrack,
    take: TrackRecordingTake,
    splitTimeWithinSegmentMs: number,
  ) {
    const sourceStartMs = Math.max(0, take.sourceStartMs);
    const sourceEndMs = Math.max(sourceStartMs, take.sourceEndMs);
    if (!isValidSplitTime({ startMs: sourceStartMs, endMs: sourceEndMs }, splitTimeWithinSegmentMs)) {
      setSplitError('Split point is too close to the clip boundary');
      return;
    }

    const currentTakes = getTrackRecordingTakes(track.trackId);
    const currentIndex = currentTakes.findIndex((entry) => entry.id === take.id);
    if (currentIndex < 0) return;

    const leftDurationMs = splitTimeWithinSegmentMs - sourceStartMs;
    const rightDurationMs = sourceEndMs - splitTimeWithinSegmentMs;
    const baseTimelineStartMs = take.timelineStartMs;

    const leftTake: TrackRecordingTake = {
      ...take,
      durationMs: leftDurationMs,
      sourceStartMs,
      sourceEndMs: splitTimeWithinSegmentMs,
      startOffsetMs: baseTimelineStartMs,
      timelineStartMs: baseTimelineStartMs,
      timelineEndMs: baseTimelineStartMs + leftDurationMs,
    };
    const rightTake: TrackRecordingTake = {
      ...take,
      id: crypto.randomUUID(),
      durationMs: rightDurationMs,
      sourceStartMs: splitTimeWithinSegmentMs,
      sourceEndMs,
      startOffsetMs: baseTimelineStartMs + leftDurationMs,
      timelineStartMs: baseTimelineStartMs + leftDurationMs,
      timelineEndMs: baseTimelineStartMs + leftDurationMs + rightDurationMs,
      position: take.position + 1,
    };

    const nextTakes = currentTakes
      .filter((entry) => entry.id !== take.id)
      .flatMap((entry) => (entry.position > take.position ? [{ ...entry, position: entry.position + 1 }] : [entry]))
      .concat([leftTake, rightTake])
      .sort((a, b) => a.position - b.position)
      .map((entry, index) => ({ ...entry, position: index }));

    await replaceTrackRecordingTakes(track.trackId, nextTakes);
    setSelectedSegmentId(leftTake.id);
    setSplitError(null);
    setDragError(null);
    pushTimelineHistory({
      kind: 'recording-takes',
      trackId: track.trackId,
      previousTakes: currentTakes,
      nextTakes,
      previousSelectedTrackVersionId: selectedTrackVersionId,
      previousSelectedSegmentId: selectedSegmentId,
    });
  }

  function toggleMute(trackVersionId: string) {
    const willMute = !mutedTrackVersionIds.has(trackVersionId);
    playbackEngine.setTrackMuted(trackVersionId, willMute);
    setMutedTrackVersionIds((prev) => {
      const next = new Set(prev);
      if (willMute) next.add(trackVersionId);
      else next.delete(trackVersionId);
      return next;
    });
  }

  function toggleSolo(trackVersionId: string) {
    const willSolo = !soloTrackVersionIds.has(trackVersionId);
    playbackEngine.setTrackSolo(trackVersionId, willSolo);
    setSoloTrackVersionIds((prev) => {
      const next = new Set(prev);
      if (willSolo) next.add(trackVersionId);
      else next.delete(trackVersionId);
      return next;
    });
  }

  function setTrackGain(trackVersionId: string, gain: number) {
    const normalizedGain = Math.max(0, Math.min(2, gain));
    playbackEngine.setTrackGain(trackVersionId, normalizedGain);
    setGainByTrackVersionId((prev) => ({
      ...prev,
      [trackVersionId]: normalizedGain,
    }));
  }

  function beginTrackDrag(track: DawTrack, startX: number) {
    setSelectedTrackVersionId(track.trackVersionId);
    dragRef.current = {
      kind: 'track',
      trackVersionId: track.trackVersionId,
      originalStartOffsetMs: getTrackStartOffsetMs(track),
      startX,
    };
  }

  function beginSegmentDrag(track: DawTrack, segment: TrackTimelineSegment, startX: number) {
    setSelectedTrackVersionId(track.trackVersionId);
    dragRef.current = {
      kind: 'segment',
      trackVersionId: track.trackVersionId,
      segmentId: segment.id,
      originalTimelineStartMs: segment.timelineStartMs,
      startX,
    };
  }

  function updateTrackDrag(trackVersionId: string, nextStartOffsetMs: number) {
    setOffsetOverrides((prev) => ({ ...prev, [trackVersionId]: nextStartOffsetMs }));
  }

  function updateSegmentDrag(trackVersionId: string, segmentId: string, nextTimelineStartMs: number) {
    const currentTrack = selectedTracks.find((track) => track.trackVersionId === trackVersionId);
    if (!currentTrack) return;
    const currentSegments = getDisplayedTrackSegments(currentTrack);
    const nextSegments = currentSegments.map((segment) =>
      segment.id === segmentId
        ? {
            ...segment,
            timelineStartMs: nextTimelineStartMs,
            timelineEndMs: nextTimelineStartMs + segment.durationMs,
          }
        : segment,
    );
    setTrackSegmentLayout(trackVersionId, nextSegments);
  }

  function moveSegmentAcrossTracksLocally(
    sourceTrack: DawTrack,
    targetTrack: DawTrack,
    segment: TrackTimelineSegment,
    timelineStartMs: number,
  ) {
    const sourceSegments = getDisplayedTrackSegments(sourceTrack);
    const targetSegments = getDisplayedTrackSegments(targetTrack);
    const nextSourceSegments = sourceSegments
      .filter((current) => current.id !== segment.id)
      .map((current, index) => ({
        ...current,
        position: index,
      }));
    const nextTargetSegments = [
      ...targetSegments.filter((current) => current.id !== segment.id),
      {
        ...segment,
        trackVersionId: targetTrack.trackVersionId,
        timelineStartMs,
        timelineEndMs: timelineStartMs + segment.durationMs,
        position: targetSegments.length,
      },
    ].map((current, index) => ({
      ...current,
      position: index,
    }));

    setTrackSegmentLayout(sourceTrack.trackVersionId, nextSourceSegments.length > 0 ? nextSourceSegments : []);
    setTrackSegmentLayout(targetTrack.trackVersionId, nextTargetSegments);
    setSelectedTrackVersionId(targetTrack.trackVersionId);
    setSelectedSegmentId(segment.id);
    setDragError(null);
    setSplitError(null);
    pushTimelineHistory({
      kind: 'move-segment-track',
      sourceTrackVersionId: sourceTrack.trackVersionId,
      targetTrackVersionId: targetTrack.trackVersionId,
      segmentId: segment.id,
      previousSourceSegments: sourceSegments,
      previousTargetSegments: targetSegments,
      nextSourceSegments,
      nextTargetSegments,
      previousSelectedTrackVersionId: selectedTrackVersionId,
      previousSelectedSegmentId: selectedSegmentId,
    });
  }

  function getTrackVersionIdFromPoint(clientX: number, clientY: number) {
    const element = document.elementFromPoint(clientX, clientY);
    const trackRow = element?.closest<HTMLElement>('[data-track-version-id]');
    return trackRow?.dataset.trackVersionId ?? null;
  }

  async function commitTrackDrag(track: DawTrack) {
    const drag = dragRef.current;
    if (!drag || drag.kind !== 'track' || drag.trackVersionId !== track.trackVersionId) return;

    dragRef.current = null;
    const finalOffset = getTrackStartOffsetMs(track);

    if (finalOffset === drag.originalStartOffsetMs) return;

    try {
      await commitEditingOperation(audioEditingEngine.moveTrack(track.trackVersionId, finalOffset));

      pushTimelineHistory({
        kind: 'move-track',
        trackVersionId: track.trackVersionId,
        previousStartOffsetMs: drag.originalStartOffsetMs,
        nextStartOffsetMs: finalOffset,
      });
    } catch (error) {
      updateTrackDrag(track.trackVersionId, drag.originalStartOffsetMs);
      setDragError(error instanceof Error ? error.message : 'Something went wrong saving track position');
    }
  }

  async function commitSegmentDrag(track: DawTrack) {
    const drag = dragRef.current;
    if (!drag || drag.trackVersionId !== track.trackVersionId || drag.kind !== 'segment') return;

    dragRef.current = null;
    const currentSegments = getDisplayedTrackSegments(track);
    const currentSegment = currentSegments.find((segment) => segment.id === drag.segmentId);
    const finalTimelineStartMs = currentSegment?.timelineStartMs ?? drag.originalTimelineStartMs;

    if (finalTimelineStartMs === drag.originalTimelineStartMs) return;

    if (currentSegment?.isImplicit) {
      try {
        await commitEditingOperation(audioEditingEngine.moveTrack(track.trackVersionId, finalTimelineStartMs));
        pushTimelineHistory({
          kind: 'move-track',
          trackVersionId: track.trackVersionId,
          previousStartOffsetMs: drag.originalTimelineStartMs,
          nextStartOffsetMs: finalTimelineStartMs,
        });
      } catch (error) {
        updateTrackDrag(track.trackVersionId, drag.originalTimelineStartMs);
        setDragError(error instanceof Error ? error.message : 'Something went wrong saving track position');
      }
      return;
    }

    try {
      await commitEditingOperation(
        audioEditingEngine.moveSegment(track.trackVersionId, drag.segmentId, finalTimelineStartMs),
      );
      pushTimelineHistory({
        kind: 'move-segment',
        trackVersionId: track.trackVersionId,
        segmentId: drag.segmentId,
        previousTimelineStartMs: drag.originalTimelineStartMs,
        nextTimelineStartMs: finalTimelineStartMs,
      });
    } catch (error) {
      updateSegmentDrag(track.trackVersionId, drag.segmentId, drag.originalTimelineStartMs);
      setDragError(error instanceof Error ? error.message : 'Something went wrong saving segment position');
    }
  }

  function cancelTimelineDrag() {
    const drag = dragRef.current;
    if (!drag) return;

    if (drag.kind === 'track') {
      updateTrackDrag(drag.trackVersionId, drag.originalStartOffsetMs);
    } else if (drag.kind === 'recording-take') {
      void replaceTrackRecordingTakes(drag.trackId, drag.originalTakes);
    } else {
      updateSegmentDrag(drag.trackVersionId, drag.segmentId, drag.originalTimelineStartMs);
    }

    dragRef.current = null;
  }

  undoLatestTimelineEditRef.current = undoLatestTimelineEdit;
  deleteSelectedClipRef.current = deleteSelectedClip;
  cancelTimelineDragRef.current = cancelTimelineDrag;

  function handleTrackPointerDown(e: React.PointerEvent<HTMLDivElement>, track: DawTrack) {
    setSelectedTrackVersionId(track.trackVersionId);
    if (timelineTool !== 'select') return;

    const visibleSegments = getRenderableTrackSegments(track);
    if (visibleSegments.length !== 1 || !visibleSegments[0]?.isImplicit) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const currentOffset = getTrackStartOffsetMs(track);
    const dur = durationByTrackVersionId[track.trackVersionId] ?? track.durationMs ?? 0;
    const leftPx = (currentOffset / 1000) * PX_PER_SECOND;
    const widthPx = dur > 0 ? (dur / 1000) * PX_PER_SECOND : 200;

    if (x < leftPx || x > leftPx + widthPx) return;

    e.currentTarget.setPointerCapture(e.pointerId);
    beginTrackDrag(track, e.clientX);
    setSelectedSegmentId(visibleSegments[0].id);
    setDragError(null);
  }

  function handleTrackPointerMove(e: React.PointerEvent<HTMLDivElement>, track: DawTrack) {
    if (timelineTool !== 'select') return;
    const drag = dragRef.current;
    if (!drag || drag.trackVersionId !== track.trackVersionId || drag.kind !== 'track') return;

    const deltaX = e.clientX - drag.startX;
    const deltaMs = (deltaX / PX_PER_SECOND) * 1000;
    const rawMs = drag.originalStartOffsetMs + deltaMs;
    const snapped = Math.max(0, snapMsToGrid(rawMs, getActiveTiming(), snapResolution));

    updateTrackDrag(track.trackVersionId, snapped);
  }

  async function handleTrackPointerUp(e: React.PointerEvent<HTMLDivElement>, track: DawTrack) {
    if (timelineTool !== 'select') return;
    const drag = dragRef.current;
    if (!drag || drag.trackVersionId !== track.trackVersionId || drag.kind !== 'track') return;

    e.currentTarget.releasePointerCapture?.(e.pointerId);
    await commitTrackDrag(track);
  }

  function handleTrackPointerCancel(track: DawTrack) {
    const drag = dragRef.current;
    if (!drag || drag.trackVersionId !== track.trackVersionId || drag.kind !== 'track') return;
    cancelTimelineDrag();
  }

  function handleSegmentPointerDown(
    e: React.PointerEvent<HTMLButtonElement>,
    track: DawTrack,
    segment: TrackTimelineSegment,
  ) {
    setSelectedTrackVersionId(track.trackVersionId);
    if (timelineTool !== 'select') return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelectedSegmentId(segment.id);
    setSplitError(null);
    if (segment.isImplicit) {
      beginTrackDrag(track, e.clientX);
    } else {
      beginSegmentDrag(track, segment, e.clientX);
    }
    setDragError(null);
  }

  function handleSegmentPointerMove(
    e: React.PointerEvent<HTMLButtonElement>,
    track: DawTrack,
    segment: TrackTimelineSegment,
  ) {
    if (timelineTool !== 'select') return;
    const drag = dragRef.current;
    if (!drag || drag.trackVersionId !== track.trackVersionId) return;

    const deltaX = e.clientX - drag.startX;
    const deltaMs = (deltaX / PX_PER_SECOND) * 1000;

    if (drag.kind === 'track') {
      const rawMs = drag.originalStartOffsetMs + deltaMs;
      const snapped = Math.max(0, snapMsToGrid(rawMs, getActiveTiming(), snapResolution));
      updateTrackDrag(track.trackVersionId, snapped);
      return;
    }

    if (drag.kind !== 'segment') return;
    if (drag.segmentId !== segment.id) return;
    const rawMs = drag.originalTimelineStartMs + deltaMs;
    const snapped = Math.max(0, snapMsToGrid(rawMs, getActiveTiming(), snapResolution));
    updateSegmentDrag(track.trackVersionId, segment.id, snapped);
  }

  async function handleSegmentPointerUp(
    e: React.PointerEvent<HTMLButtonElement>,
    track: DawTrack,
    segment: TrackTimelineSegment,
  ) {
    if (timelineTool !== 'select') return;
    const drag = dragRef.current;
    if (!drag || drag.trackVersionId !== track.trackVersionId) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);

    if (drag.kind === 'track') {
      await commitTrackDrag(track);
      return;
    }

    if (drag.kind !== 'segment') return;
    if (drag.segmentId !== segment.id) return;

    const currentSegments = getDisplayedTrackSegments(track);
    const currentSegment = currentSegments.find((current) => current.id === drag.segmentId) ?? segment;
    const finalTimelineStartMs = currentSegment?.timelineStartMs ?? drag.originalTimelineStartMs;
    const dropTrackVersionId = getTrackVersionIdFromPoint(e.clientX, e.clientY) ?? track.trackVersionId;

    if (dropTrackVersionId !== track.trackVersionId) {
      const targetTrack = selectedTracks.find((candidate) => candidate.trackVersionId === dropTrackVersionId);
      if (targetTrack) {
        moveSegmentAcrossTracksLocally(track, targetTrack, currentSegment, finalTimelineStartMs);
      }
      dragRef.current = null;
      return;
    }

    await commitSegmentDrag(track);
  }

  function handleSegmentPointerCancel(track: DawTrack, segment: TrackTimelineSegment) {
    const drag = dragRef.current;
    if (!drag || drag.trackVersionId !== track.trackVersionId) return;
    if (drag.kind === 'segment' && drag.segmentId !== segment.id) return;
    cancelTimelineDrag();
  }

  function handleRecordingTakePointerDown(
    e: React.PointerEvent<HTMLButtonElement>,
    track: DawTrack,
    take: TrackLaneRecordingTakeProjection,
  ) {
    setSelectedTrackVersionId(track.trackVersionId);
    if (timelineTool !== 'select') return;

    const rawTake = getTrackRecordingTake(track.trackId, take.id);
    if (!rawTake) return;

    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelectedSegmentId(take.id);
    setSplitError(null);
    setDragError(null);
    dragRef.current = {
      kind: 'recording-take',
      trackId: track.trackId,
      trackVersionId: track.trackVersionId,
      takeId: take.id,
      originalTakes: getTrackRecordingTakes(track.trackId),
      originalTake: rawTake,
      startX: e.clientX,
    };
  }

  function handleRecordingTakePointerMove(
    e: React.PointerEvent<HTMLButtonElement>,
    track: DawTrack,
    take: TrackLaneRecordingTakeProjection,
  ) {
    if (timelineTool !== 'select') return;
    const drag = dragRef.current;
    if (!drag || drag.kind !== 'recording-take' || drag.takeId !== take.id) return;

    const deltaX = e.clientX - drag.startX;
    const deltaMs = (deltaX / PX_PER_SECOND) * 1000;
    const rawMs = drag.originalTake.startOffsetMs + deltaMs;
    const snapped = Math.max(0, snapMsToGrid(rawMs, getActiveTiming(), snapResolution));
    void moveRecordingTakeWithinTrack(track, drag.originalTake, snapped);
  }

  async function handleRecordingTakePointerUp(
    e: React.PointerEvent<HTMLButtonElement>,
    track: DawTrack,
    take: TrackLaneRecordingTakeProjection,
  ) {
    if (timelineTool !== 'select') return;
    const drag = dragRef.current;
    if (!drag || drag.kind !== 'recording-take' || drag.takeId !== take.id) return;

    e.currentTarget.releasePointerCapture?.(e.pointerId);
    dragRef.current = null;

    const currentTakes = getTrackRecordingTakes(track.trackId);
    const currentTake = currentTakes.find((entry) => entry.id === take.id) ?? drag.originalTake;
    const dropTrackVersionId = getTrackVersionIdFromPoint(e.clientX, e.clientY) ?? track.trackVersionId;
    const targetTrack = selectedTracks.find((candidate) => candidate.trackVersionId === dropTrackVersionId);
    const finalTimelineStartMs = currentTake.timelineStartMs ?? currentTake.startOffsetMs;

    if (targetTrack && targetTrack.trackId !== track.trackId) {
      const targetPreviousTakes = getTrackRecordingTakes(targetTrack.trackId);
      await moveRecordingTakeAcrossTracks(track, targetTrack, currentTake, finalTimelineStartMs);
      pushTimelineHistory({
        kind: 'recording-takes',
        trackId: track.trackId,
        previousTakes: drag.originalTakes,
        nextTakes: currentTakes.filter((entry) => entry.id !== take.id),
        previousSelectedTrackVersionId: selectedTrackVersionId,
        previousSelectedSegmentId: selectedSegmentId,
        targetTrackId: targetTrack.trackId,
        targetPreviousTakes,
        targetNextTakes: getTrackRecordingTakes(targetTrack.trackId),
      });
      setSelectedTrackVersionId(targetTrack.trackVersionId);
      setSelectedSegmentId(currentTake.id);
      return;
    }

    const normalizedTakes = normalizeRecordingTakeOrder(currentTakes);
    await replaceTrackRecordingTakes(track.trackId, normalizedTakes);
    if (finalTimelineStartMs !== drag.originalTake.startOffsetMs) {
      pushTimelineHistory({
        kind: 'recording-takes',
        trackId: track.trackId,
        previousTakes: drag.originalTakes,
        nextTakes: normalizedTakes,
        previousSelectedTrackVersionId: selectedTrackVersionId,
        previousSelectedSegmentId: selectedSegmentId,
      });
    }
  }

  function handleRecordingTakePointerCancel(track: DawTrack, take: TrackLaneRecordingTakeProjection) {
    const drag = dragRef.current;
    if (!drag || drag.kind !== 'recording-take' || drag.takeId !== take.id) return;
    void replaceTrackRecordingTakes(track.trackId, drag.originalTakes);
    dragRef.current = null;
  }

  async function handleRecordingTakeClick(
    e: React.MouseEvent<HTMLButtonElement>,
    track: DawTrack,
    take: TrackLaneRecordingTakeProjection,
  ) {
    if (timelineTool === 'split') {
      e.stopPropagation();
      const rawTake = getTrackRecordingTake(track.trackId, take.id);
      if (!rawTake) return;
      const clickedTimelineMs = getTimelineTimeFromPointer(e.currentTarget, e.clientX, take.segment.timelineStartMs);
      const splitTimeWithinSegmentMs =
        take.segment.sourceStartMs + Math.max(0, clickedTimelineMs - take.segment.timelineStartMs);

      await splitRecordingTakeOnTrack(track, rawTake, splitTimeWithinSegmentMs);
      return;
    }

    e.stopPropagation();
    setSelectedSegmentId(take.id);
    setSplitError(null);
  }

  function handleSplitHoverMove(
    event: React.PointerEvent<HTMLElement>,
    track: DawTrack,
    timelineBaseMs = 0,
  ) {
    if (timelineTool !== 'split') return;
    setSplitHover({
      trackVersionId: track.trackVersionId,
      timeMs: getSnappedSplitTimeFromPointer(event.currentTarget, event.clientX, timelineBaseMs),
    });
  }

  function handleSplitHoverLeave(track: DawTrack) {
    setSplitHover((previous) =>
      previous?.trackVersionId === track.trackVersionId ? null : previous,
    );
  }

  async function handleSplitClick(
    currentTarget: HTMLElement,
    clientX: number,
    track: DawTrack,
    timelineBaseMs = 0,
  ) {
    if (timelineTool !== 'split') return;

    const clickedTimeMs = getSnappedSplitTimeFromPointer(currentTarget, clientX, timelineBaseMs);
    const clickedSegment = findSegmentAtTime(track, clickedTimeMs);

    if (!clickedSegment) {
      setSplitError('No clip at that position');
      return;
    }

    const splitTimeWithinSegmentMs =
      clickedTimeMs - clickedSegment.timelineStartMs + clickedSegment.sourceStartMs;

    if (!isValidSplitTime(clickedSegment, splitTimeWithinSegmentMs)) {
      setSplitError('Split point is too close to the clip boundary');
      return;
    }

    setSplitError(null);

    try {
      await splitSegmentOnTrack(track, clickedSegment, splitTimeWithinSegmentMs);
    } catch (error) {
      setSplitError(error instanceof Error ? error.message : 'Could not split clip');
    }
  }

  function startRename(track: DawTrack) {
    setRenameState({ trackId: track.trackId, value: track.trackName, saving: false, error: null });
  }

  async function commitRename() {
    if (!renameState) return;
    const trimmed = renameState.value.trim();
    if (!trimmed) {
      setRenameState(null);
      return;
    }
    setRenameState((prev) => (prev ? { ...prev, saving: true, error: null } : null));
    try {
      await commitEditingOperation(audioEditingEngine.renameTrack(renameState.trackId, trimmed));
      setRenameState(null);
      router.refresh();
    } catch (error) {
      setRenameState((prev) =>
        prev ? { ...prev, saving: false, error: error instanceof Error ? error.message : 'Something went wrong' } : null,
      );
    }
  }

  function cancelRename() {
    setRenameState(null);
  }

  function buildCommentOperationPayload(input: {
    trackId: string | null;
    body: string;
    startTimeMs: number;
    endTimeMs?: number | null;
    segmentId?: string | null;
    resolved?: boolean;
  }) {
    return {
      commentId: crypto.randomUUID(),
      demoId,
      trackId: input.trackId,
      segmentId: input.segmentId ?? null,
      startTimeMs: input.startTimeMs,
      endTimeMs: input.endTimeMs ?? null,
      body: input.body,
      createdBy: currentUserId,
      resolved: input.resolved ?? false,
    } as const;
  }

  function getActiveTrackForSelection() {
    return (
      selectedTracks.find((track) => track.trackVersionId === selectedTrackVersionId) ?? selectedTrack ?? null
    );
  }

  function openAddCommentModal() {
    const activeTrack = getActiveTrackForSelection();
    setAddCommentTrackId(activeTrack?.trackId ?? null);
    setAddCommentTimestampMs(currentTimeMs);
    setAddCommentBody('');
    setAddCommentError(null);
    setAddCommentModalOpen(true);
  }

  function closeAddCommentModal() {
    setAddCommentModalOpen(false);
    setAddCommentBody('');
    setAddCommentError(null);
    setAddCommentSubmitting(false);
  }

  async function submitAddComment() {
    const body = addCommentBody.trim();
    if (!body) {
      setAddCommentError('Comment body cannot be empty.');
      return;
    }

    setAddCommentSubmitting(true);
    setAddCommentError(null);

    try {
      await commitEditingOperation({
        demoId,
        operationType: 'COMMENT_ADDED',
        payload: buildCommentOperationPayload({
          trackId: addCommentTrackId,
          segmentId: null,
          startTimeMs: addCommentTimestampMs,
          endTimeMs: null,
          body,
          resolved: false,
        }),
      });
      closeAddCommentModal();
    } catch (error) {
      setAddCommentError(error instanceof Error ? error.message : 'Could not add comment');
    } finally {
      setAddCommentSubmitting(false);
    }
  }

  function getSelectedSegment(track = getActiveTrackForSelection()) {
    if (!track || !selectedSegmentId) return null;
    return getDisplayedTrackSegments(track).find((segment) => segment.id === selectedSegmentId) ?? null;
  }

  async function handleTrimSelectedSegment() {
    const track = getActiveTrackForSelection();
    if (!track) return;
    const segment = getSelectedSegment(track);
    if (!segment || segment.isImplicit) return;

    const targetEndMs = Math.max(segment.timelineStartMs + 10, currentTimeMs);
    if (targetEndMs <= segment.timelineStartMs || targetEndMs >= segment.timelineEndMs) {
      setDragError('Move the playhead inside the clip to trim it.');
      return;
    }

    try {
      await commitEditingOperation(
        audioEditingEngine.trimSegment({
          trackVersionId: track.trackVersionId,
          segmentId: segment.id,
          from: {
            startMs: segment.sourceStartMs,
            endMs: segment.sourceEndMs,
          },
          to: {
            startMs: segment.sourceStartMs,
            endMs: segment.sourceStartMs + (targetEndMs - segment.timelineStartMs),
          },
        }),
      );
    } catch (error) {
      setDragError(error instanceof Error ? error.message : 'Could not trim clip');
    }
  }

  async function handleMergeSelectedSegments() {
    const track = getActiveTrackForSelection();
    if (!track) return;
    const segments = getDisplayedTrackSegments(track).filter((segment) => !segment.isImplicit);
    const selectedIndex = segments.findIndex((segment) => segment.id === selectedSegmentId);
    if (selectedIndex < 0 || segments.length < 2) return;

    const left = segments[Math.max(0, selectedIndex - 1)];
    const right = segments[selectedIndex + 1] ?? segments[selectedIndex];
    if (!left || !right || left.id === right.id) return;

    const mergedStartMs = Math.min(left.timelineStartMs, right.timelineStartMs);
    const mergedEndMs = Math.max(left.timelineEndMs, right.timelineEndMs);
    const mergedSegment = {
      id: crypto.randomUUID(),
      trackVersionId: track.trackVersionId,
      startMs: Math.min(left.startMs, right.startMs),
      endMs: Math.max(left.endMs, right.endMs),
      timelineStartMs: mergedStartMs,
      timelineEndMs: mergedEndMs,
      gainDb: Math.max(left.gainDb, right.gainDb),
      fadeInMs: left.fadeInMs,
      fadeOutMs: right.fadeOutMs,
      isMuted: left.isMuted || right.isMuted,
      position: left.position,
      crossfadeInMs: left.crossfadeInMs ?? null,
      crossfadeOutMs: right.crossfadeOutMs ?? null,
      crossfadeCurve: left.crossfadeCurve ?? right.crossfadeCurve ?? null,
    };

    try {
      await commitEditingOperation(
        audioEditingEngine.mergeSegments({
          trackVersionId: track.trackVersionId,
          segmentIds: [left.id, right.id],
          mergedSegment,
        }),
      );
    } catch (error) {
      setDragError(error instanceof Error ? error.message : 'Could not merge clips');
    }
  }

  async function handleCrossfadeSelectedSegments() {
    const track = getActiveTrackForSelection();
    if (!track) return;
    const segments = getDisplayedTrackSegments(track).filter((segment) => !segment.isImplicit);
    const selectedIndex = segments.findIndex((segment) => segment.id === selectedSegmentId);
    if (selectedIndex < 0 || segments.length < 2) return;
    const left = segments[selectedIndex];
    const right = segments[selectedIndex + 1];
    if (!left || !right) return;

    try {
      await commitEditingOperation(
        audioEditingEngine.setCrossfade({
          trackVersionId: track.trackVersionId,
          leftSegmentId: left.id,
          rightSegmentId: right.id,
          crossfadeInMs: 250,
          crossfadeOutMs: 250,
          curve: 'linear',
        }),
      );
    } catch (error) {
      setDragError(error instanceof Error ? error.message : 'Could not set crossfade');
    }
  }

  function toggleRecordArm(trackVersionId: string) {
    setRecordArmedTrackVersionId((prev) => (prev === trackVersionId ? null : trackVersionId));
  }

  async function handleAddTrack() {
    await performUpload(createBlankTrackFile(), getNextEmptyTrackName(selectedTracks), 'uploadUnchanged');
  }

  function handleRecordingStreamReady(
    stream: MediaStream,
    startOffsetMs: number,
    target: ResolvedRecordingTarget,
    recordedTempoBpm: number,
  ) {
    const recordingSession: RecordingSession = {
      id: `rec-${Date.now()}`,
      targetTrackId: target.trackId,
      targetTrackVersionId: target.trackVersionId,
      targetTrackName: target.trackName,
      timelineStartMs: startOffsetMs,
      startedAtPlayheadMs: startOffsetMs,
      recordedTempoBpm,
      sourceTempoBpm: recordedTempoBpm,
    };
    recordingSessionRef.current = recordingSession;
    isLiveRecordingRef.current = true;
    setRecordingStream(stream);
    setTemporaryRecordingTrack({
      id: recordingSession.id,
      name: recordingSession.targetTrackName,
      targetTrackId: recordingSession.targetTrackId,
      targetTrackVersionId: recordingSession.targetTrackVersionId,
      targetTrackName: recordingSession.targetTrackName,
      startOffsetMs: recordingSession.timelineStartMs,
      startedAtPlayheadMs: recordingSession.startedAtPlayheadMs,
      durationMs: 0,
      recordedTempoBpm: recordingSession.recordedTempoBpm,
      sourceTempoBpm: recordingSession.sourceTempoBpm,
      status: 'recording',
      syncStatus: 'idle',
      peaks: [],
    });
    if (clockRef.current) {
      clearInterval(clockRef.current);
      clockRef.current = null;
    }
    playTransport(startOffsetMs);
    void publishPresence('online');
  }

  function handleRecordingDurationUpdate(durationMs: number) {
    setTemporaryRecordingTrack((prev) => (prev ? { ...prev, durationMs } : prev));
  }

  async function handleRecordingStopped(blob: Blob, wallClockDurationMs: number) {
    const recordingSession = recordingSessionRef.current;
    isLiveRecordingRef.current = false;
    setRecordingStream(null);
    if (!recordingSession) {
      setTemporaryRecordingTrack((prev) =>
        prev
          ? {
              ...prev,
              status: 'error',
              syncStatus: 'error',
              error: 'Recording session was lost before saving. Please record again.',
            }
          : prev,
      );
      return;
    }

    let measuredDurationMs: number | null = null;
    let durationDecodeError: unknown = null;
    try {
      measuredDurationMs = await ingestEngine.getRecordedBlobDurationMs(blob);
    } catch (error) {
      durationDecodeError = error;
      measuredDurationMs = null;
    }
    if (measuredDurationMs === null) {
      console.warn(
        durationDecodeError
          ? '[daw] Could not inspect recorded blob duration; falling back to wall-clock duration'
          : '[daw] Could not decode recorded blob duration; falling back to wall-clock duration',
        recordingSession.id,
        durationDecodeError,
      );
    }
    const recordingBounds = buildRecordedTakeBounds({
      timelineStartMs: recordingSession.timelineStartMs,
      measuredDurationMs,
      fallbackDurationMs: wallClockDurationMs,
    });
    const previewUrl = ingestEngine.createObjectUrl(blob);
    recordingPreviewUrlRef.current = previewUrl;
    pauseTransport();
    seekTransport(recordingBounds.startOffsetMs);
    tracksScrollContainerRef.current?.scrollTo({
      left: Math.max(0, (recordingBounds.startOffsetMs / 1000) * PX_PER_SECOND - 48),
      behavior: 'auto',
    });
    const previewRecording = {
      ...(temporaryRecordingTrack ?? {
        id: recordingSession.id,
        name: recordingSession.targetTrackName,
        targetTrackId: recordingSession.targetTrackId,
        targetTrackVersionId: recordingSession.targetTrackVersionId,
        targetTrackName: recordingSession.targetTrackName,
        startOffsetMs: recordingBounds.startOffsetMs,
        startedAtPlayheadMs: recordingSession.startedAtPlayheadMs,
        durationMs: recordingBounds.durationMs,
        recordedTempoBpm: recordingSession.recordedTempoBpm,
        sourceTempoBpm: recordingSession.sourceTempoBpm,
        status: 'preview' as const,
        syncStatus: 'idle' as const,
      }),
      status: 'preview' as const,
      syncStatus: 'idle' as const,
      blob,
      previewUrl,
      startOffsetMs: recordingBounds.startOffsetMs,
      startedAtPlayheadMs: recordingSession.startedAtPlayheadMs,
      durationMs: recordingBounds.durationMs,
      recordedTempoBpm: recordingSession.recordedTempoBpm,
      sourceTempoBpm: recordingSession.sourceTempoBpm,
      peaks: [],
    };
    setTemporaryRecordingTrack(previewRecording);
    void publishPresence('online');

    void handleSaveRecording(previewRecording, recordingBounds);

    try {
      const peaks = await ingestEngine.generateLocalPeaks(blob);
      setTemporaryRecordingTrack((prev) =>
        prev && prev.previewUrl === previewUrl ? { ...prev, peaks } : prev,
      );
    } catch {
      // Peak generation is best effort; playback still works via the preview URL.
    }
  }

  function handleRecordingNameChange(name: string) {
    setTemporaryRecordingTrack((prev) => (prev ? { ...prev, name } : prev));
  }

  useEffect(() => {
    if (timelineTool !== 'split') {
      setSplitHover(null);
    }
  }, [timelineTool]);

  async function handleSaveRecording(
    recording: TemporaryRecordingTrack | null = temporaryRecordingTrack,
    bounds: RecordingTakeBounds | null = null,
  ) {
    const track = recording ?? temporaryRecordingTrack;
    if (!track?.blob || !track.targetTrackId) {
      setTemporaryRecordingTrack((prev) =>
        prev ? { ...prev, status: 'error', syncStatus: 'error', error: 'Arm a track before saving.' } : prev,
      );
      return;
    }

    const recordingSession = recordingSessionRef.current;
    if (!recordingSession) {
      setTemporaryRecordingTrack((prev) =>
        prev
          ? {
              ...prev,
              status: 'error',
              syncStatus: 'error',
              error: 'Recording session was lost before saving. Please record again.',
            }
          : prev,
      );
      return;
    }

    const effectiveBounds =
      bounds ??
      buildRecordedTakeBounds({
        timelineStartMs: recordingSession.timelineStartMs,
        measuredDurationMs: track.durationMs,
        fallbackDurationMs: track.durationMs,
      });

    isLiveRecordingRef.current = false;
    setTemporaryRecordingTrack((prev) =>
      prev ? { ...prev, status: 'uploading', syncStatus: 'uploading', error: undefined } : prev,
    );
    void publishPresence('online');

    try {
      const armedTrack = selectedTracks.find((candidate) => candidate.trackVersionId === track.targetTrackVersionId);
      const shouldCreateNewTrack = !isTrackAudioOccupied(armedTrack);

      if (!shouldCreateNewTrack) {
        const data = await ingestEngine.uploadRecordedClipBlob({
          demoId,
          projectId,
          name: track.name,
          sourceVersionId: selectedVersionId,
          trackId: track.targetTrackId,
          trackVersionId: track.targetTrackVersionId,
          takeId: track.id,
          startOffsetMs: effectiveBounds.startOffsetMs,
          sourceStartMs: effectiveBounds.sourceStartMs,
          sourceEndMs: effectiveBounds.sourceEndMs,
          timelineStartMs: effectiveBounds.timelineStartMs,
          timelineEndMs: effectiveBounds.timelineEndMs,
          gainDb: 0,
          fadeInMs: 0,
          fadeOutMs: 0,
          isMuted: false,
          position: getTrackRecordingTakes(track.targetTrackId).length,
          recordedTempoBpm: track.recordedTempoBpm,
          sourceTempoBpm: track.sourceTempoBpm,
          timingChoice: 'uploadUnchanged',
          blob: track.blob,
        });

        await projectSyncEngine.upsertTrackRecordingTake(track.targetTrackId, {
          id: track.id,
          trackId: track.targetTrackId,
          trackVersionId: null,
          name: track.name,
          startOffsetMs: effectiveBounds.startOffsetMs,
          durationMs: effectiveBounds.durationMs,
          sourceStartMs: effectiveBounds.sourceStartMs,
          sourceEndMs: effectiveBounds.sourceEndMs,
          timelineStartMs: effectiveBounds.timelineStartMs,
          timelineEndMs: effectiveBounds.timelineEndMs,
          gainDb: 0,
          fadeInMs: 0,
          fadeOutMs: 0,
          isMuted: false,
          position: getTrackRecordingTakes(track.targetTrackId).length,
          storageKey: `/${data.objectKey}`,
          assetId: data.assetId,
          previewUrl: null,
          recordedTempoBpm: track.recordedTempoBpm,
          sourceTempoBpm: track.sourceTempoBpm,
          status: 'complete',
          syncStatus: 'complete',
          createdAt: new Date().toISOString(),
        });

        if (recordingPreviewUrlRef.current) {
          ingestEngine.revokeObjectUrl(recordingPreviewUrlRef.current);
          recordingPreviewUrlRef.current = null;
        }

        recordingSessionRef.current = null;
        setTemporaryRecordingTrack(null);
        return;
      }

      const data = await ingestEngine.uploadRecordedBlob({
        demoId,
        projectId,
        name: track.name,
        sourceVersionId: selectedVersionId,
        trackId: shouldCreateNewTrack ? undefined : track.targetTrackId,
        startOffsetMs: effectiveBounds.startOffsetMs,
        recordedTempoBpm: track.recordedTempoBpm,
        sourceTempoBpm: track.sourceTempoBpm,
        timingChoice: 'uploadUnchanged',
        blob: track.blob,
      });
      await projectSyncEngine.setTrackTempoMetadata(data.trackVersionId, {
        recordedTempoBpm: track.recordedTempoBpm,
        sourceTempoBpm: track.sourceTempoBpm,
      });
      setRecordedTempoByTrackVersionId((prev) => ({
        ...prev,
        [data.trackVersionId]: {
          recordedTempoBpm: track.recordedTempoBpm,
          sourceTempoBpm: track.sourceTempoBpm,
        },
      }));

      setTemporaryRecordingTrack((prev) =>
        prev
          ? {
              ...prev,
              status: 'preview',
              syncStatus: 'complete',
              serverAssetId: data.assetId,
              serverTrackVersionId: data.trackVersionId,
              serverDemoVersionId: data.demoVersionId,
            }
          : prev,
      );
      setSelectedVersionId(data.demoVersionId);
      if ('processingJobIds' in data && data.processingJobIds.length > 0) {
        setProcessingStartedAt(Date.now());
        setProcessingJobIds(data.processingJobIds);
        setProcessingMessage('Processing recording in the background...');
      } else {
        router.refresh();
      }
    } catch (error) {
      setTemporaryRecordingTrack((prev) =>
        prev
          ? {
              ...prev,
              status: 'error',
              syncStatus: 'error',
              error: error instanceof Error ? error.message : 'Something went wrong while saving.',
            }
          : prev,
      );
    }
  }

  async function performUpload(file: File, name: string, timingChoice: UploadTimingChoice) {
    setIsUploading(true);
    setUploadError(null);
    setProcessingMessage(null);
    const uploadTempoBpm = resolvedLocalTempoBpm;
    try {
      const data = (await ingestEngine.uploadAudioFile({
        demoId,
        projectId,
        name,
        sourceVersionId: selectedVersionId,
        recordedTempoBpm: uploadTempoBpm,
        sourceTempoBpm: uploadTempoBpm,
        timingChoice,
        file,
      })) as Awaited<ReturnType<typeof ingestEngine.uploadRecordedBlob>>;
      await projectSyncEngine.setTrackTempoMetadata(data.trackVersionId, {
        recordedTempoBpm: uploadTempoBpm,
        sourceTempoBpm: uploadTempoBpm,
      });
      setRecordedTempoByTrackVersionId((prev) => ({
        ...prev,
        [data.trackVersionId]: {
          recordedTempoBpm: uploadTempoBpm,
          sourceTempoBpm: uploadTempoBpm,
        },
      }));
      setUploadName('');
      setUploadFile(null);
      setSelectedVersionId(data.demoVersionId);
      if ('processingJobIds' in data && data.processingJobIds.length > 0) {
        setProcessingStartedAt(Date.now());
        setProcessingJobIds(data.processingJobIds);
        setProcessingMessage('Processing upload in the background...');
      } else {
        router.refresh();
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Something went wrong while uploading. Please try again.');
    } finally {
      setIsUploading(false);
    }
  }

  async function requestTempoAnalysis(track: DawTrack) {
    setProcessingMessage(null);
    setUploadError(null);
    try {
      const response = await fetch('/api/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'TEMPO_ANALYSIS',
          trackVersionId: track.trackVersionId,
          payload: {
            demoId,
            demoVersionId: selectedVersionId,
            trackVersionId: track.trackVersionId,
            updateDemoTiming: false,
          },
        }),
      });
      const data = (await response.json()) as { id?: string; error?: string };
      if (!response.ok) {
        setUploadError(data.error ?? 'Could not start tempo analysis');
        return;
      }
      const jobId = data.id;
      if (!jobId) {
        setUploadError('Could not start tempo analysis');
        return;
      }
      setTempoAnalysisPrompt({
        open: false,
        jobId,
        trackVersionId: track.trackVersionId,
        trackName: track.trackName,
        tempoBpm: 0,
        confidence: 0,
        beatTimes: [],
        applying: false,
        error: null,
      });
      setProcessingStartedAt(Date.now());
      setProcessingJobIds((previous) => (previous.includes(jobId) ? previous : [...previous, jobId]));
      setProcessingMessage(`Analyzing tempo for ${track.trackName}…`);
    } catch {
      setUploadError('Something went wrong while starting tempo analysis.');
    }
  }

  async function onUploadTrack(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUploadError(null);
    if (!uploadFile) {
      setUploadError('Please choose an audio file to upload.');
      return;
    }
    await performUpload(uploadFile, uploadName, 'uploadUnchanged');
  }

  async function confirmUploadChoice(choice: UploadTimingChoice) {
    const file = uploadModalState.file;
    if (!file) return;
    const name = uploadModalState.name;
    setUploadModalState((prev) => ({ ...prev, open: false }));
    await performUpload(file, name, choice);
  }

  function cancelUploadChoice() {
    setUploadModalState({ open: false, file: null, name: '', choice: 'keepProjectTempo' });
  }

  function handleUploadFilePicked(file: File | null) {
    setUploadFile(file);
    if (file && !uploadName.trim()) {
      setUploadName(file.name.replace(/\.[^.]+$/, ''));
    }
  }

  const hasTimelineContent = selectedTracks.length > 0 || temporaryRecordingTrack !== null;
  const selectedTrackSegments = selectedTrack
    ? getDisplayedTrackSegments(selectedTrack).filter((segment) => !segment.isImplicit)
    : [];
  const selectedTrackSegmentIndex = selectedTrackSegments.findIndex((segment) => segment.id === selectedSegmentId);
  const canMergeSelectedSegments = selectedTrackSegmentIndex >= 0 && selectedTrackSegments.length > 1;
  const canCrossfadeSelectedSegments =
    selectedTrackSegmentIndex >= 0 && selectedTrackSegmentIndex < selectedTrackSegments.length - 1;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-[1760px] flex-col gap-4 px-4 py-4">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <button
              type="button"
              onClick={() => {
                if (typeof window !== 'undefined' && window.history.length > 1) {
                  router.back();
                } else {
                  router.push(`/groups/${groupSlug}/projects/${projectSlug}`);
                }
              }}
              className="mt-1 inline-flex h-10 items-center justify-center rounded-full border border-slate-700 bg-slate-950 px-4 text-sm font-semibold text-slate-100 hover:bg-slate-900"
            >
              Back
            </button>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-white">{demoName}</h1>
              {demoDescription ? <p className="mt-1 max-w-3xl text-sm text-slate-300">{demoDescription}</p> : null}
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Microphone</p>
              <p className="mt-1 max-w-[220px] truncate text-xs text-slate-300" title={microphoneStatus}>
                {microphoneStatus}
              </p>
            </div>
            <AudioInputSelector
              selectedAudioInputDeviceId={selectedAudioInputDeviceId}
              onSelectedAudioInputDeviceIdChange={setSelectedAudioInputDeviceId}
              isAudioInputReady={audioInputReady}
              onAudioInputReadyChange={setAudioInputReady}
            />
          </div>
        </header>

        <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-950/80 shadow-sm shadow-black/20 xl:col-start-1 xl:row-start-1 xl:self-stretch">
            <DawToolbarTabs activeTab={toolbarTab} onTabChange={setToolbarTab} />
            <section className="flex-1 border-t border-slate-800 bg-transparent p-4">
              {toolbarTab === 'edit' ? (
                <div className="space-y-4">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">Tools</p>
                      <p className="text-xs text-slate-400">Edit and timeline actions live here.</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setTimelineTool('select');
                        setSplitHover(null);
                        setSplitError(null);
                      }}
                      className={`rounded-md px-3 py-2 text-sm font-medium ${
                        timelineTool === 'select'
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      Select
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setTimelineTool('split');
                        setSplitHover(null);
                        setSplitError(null);
                      }}
                      className={`rounded-md px-3 py-2 text-sm font-medium ${
                        timelineTool === 'split'
                          ? 'bg-amber-600 text-white'
                          : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      Cut
                    </button>
                    <button
                      type="button"
                      onClick={() => setTimelineTool('select')}
                      className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800"
                    >
                      Move
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleTrimSelectedSegment()}
                      disabled={!selectedTrack || !selectedSegmentId}
                      title={!selectedTrack || !selectedSegmentId ? 'Select a clip to trim it' : 'Trim the selected clip to the playhead'}
                      className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Trim
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleMergeSelectedSegments()}
                      disabled={!canMergeSelectedSegments}
                      title={!canMergeSelectedSegments ? 'Select a clip with a neighbor to merge' : 'Merge the selected clip with a neighbor'}
                      className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Merge
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleCrossfadeSelectedSegments()}
                      disabled={!canCrossfadeSelectedSegments}
                      title={!canCrossfadeSelectedSegments ? 'Select a clip with a next segment to crossfade' : 'Apply a simple crossfade to the next segment'}
                      className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Crossfade
                    </button>
                    <button
                      type="button"
                      onClick={() => void undoLatestTimelineEditRef.current()}
                      className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800"
                    >
                      Undo
                    </button>
                    <button
                      type="button"
                      disabled
                      title="Redo is not implemented in this demo yet"
                      className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-slate-500 opacity-60"
                    >
                      Redo
                    </button>
                    <label className="ml-auto flex items-center gap-2 text-sm text-slate-300">
                      <span className="uppercase tracking-[0.18em] text-slate-500">Snap</span>
                      <select
                        value={snapResolution}
                        onChange={(e) => setSnapResolution(e.currentTarget.value as SnapResolution)}
                        className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-white outline-none ring-indigo-500 focus:ring"
                      >
                        <option value="off">Off</option>
                        <option value="bar">Bar</option>
                        <option value="beat">Beat</option>
                        <option value="halfBeat">Half beat</option>
                        <option value="quarterBeat">Quarter beat</option>
                      </select>
                    </label>
                  </div>
                  <p className="text-xs text-slate-400">
                    Select is the main cursor mode. Cut splits clips at the playhead. Trim, merge, and crossfade use the current selection.
                  </p>
                </div>
              ) : null}

              {toolbarTab === 'upload' ? (
                <form onSubmit={onUploadTrack} className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">Upload</p>
                      <p className="text-xs text-slate-400">Uploads and recordings create new assets through the signed ingest flow.</p>
                    </div>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-2">
                    <label className="space-y-1">
                      <span className="block text-[10px] uppercase tracking-[0.18em] text-slate-400">Track name</span>
                      <input
                        type="text"
                        value={uploadName}
                        onChange={(e) => setUploadName(e.currentTarget.value)}
                        className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-indigo-500 focus:ring"
                        placeholder="Lead Vocal"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="block text-[10px] uppercase tracking-[0.18em] text-slate-400">Audio file</span>
                      <input
                        type="file"
                        accept="audio/*"
                        onChange={(e) => handleUploadFilePicked(e.currentTarget.files?.[0] ?? null)}
                        className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white hover:file:bg-indigo-500"
                      />
                    </label>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="submit"
                      disabled={isUploading}
                      className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isUploading ? 'Uploading…' : 'Upload audio'}
                    </button>
                  </div>

                  {processingJobIds.length > 0 ? (
                    <div className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-100">
                      <p className="font-medium">
                        Processing {processingJobIds.length} job{processingJobIds.length === 1 ? '' : 's'}…
                      </p>
                      {processingMessage ? <p className="mt-1 text-indigo-200">{processingMessage}</p> : null}
                      {processingElapsedSeconds !== null ? (
                        <p className="mt-1 text-indigo-200/80">Started {processingElapsedSeconds}s ago</p>
                      ) : null}
                      {activeProcessingJobs.length > 0 ? (
                        <ul className="mt-1 space-y-0.5 text-indigo-200/90">
                          {activeProcessingJobs.map((job) => (
                            <li key={job.id}>
                              {job.type} · {job.status} · {job.progress}%
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : processingMessage ? (
                    <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                      {processingMessage}
                    </p>
                  ) : null}
                  {uploadError ? <p className="text-sm text-red-400">{uploadError}</p> : null}
                </form>
              ) : null}

              {toolbarTab === 'plugins' ? (
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-semibold text-white">Plugins</p>
                    <p className="text-xs text-slate-400">Built-in plugin host support is not wired yet, so this tab stays read-only.</p>
                  </div>
                  {pluginDefinitions.length > 0 ? (
                    <ul className="grid gap-2 md:grid-cols-2">
                      {pluginDefinitions.map((plugin) => (
                        <li key={plugin.id} className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2">
                          <p className="text-sm font-medium text-white">{plugin.name}</p>
                          <p className="text-xs text-slate-400">
                            {plugin.manufacturer ?? 'Unknown maker'} · {plugin.version}
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="rounded-md border border-slate-700 bg-slate-950 px-4 py-5 text-sm text-slate-400">
                      Plugins not available yet.
                    </div>
                  )}
                </div>
              ) : null}

              {toolbarTab === 'tree' ? (
                <div>
                  <VersionHistoryTree
                    projectId={projectId}
                    demoId={demoId}
                    baseOperationSeq={projectSyncState.lastSyncedOperationSeq}
                    versions={liveVersions}
                    operationHistory={projectSyncState.projectState?.operationHistory ?? []}
                    currentVersionId={liveCurrentVersionId}
                    selectedVersionId={selectedVersionId}
                    onSelectVersion={(id) => {
                      setSelectedVersionId(id);
                      stopTransport();
                    }}
                  />
                </div>
              ) : null}

              {toolbarTab === 'comments' ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-white">Comments</p>
                    {allComments.length > 0 ? (
                      <div className="space-y-2">
                        {allComments.map((comment, index) => {
                          const track = comment.trackId
                            ? selectedTracks.find((entry) => entry.trackId === comment.trackId) ?? null
                            : null;
                          const timestampLabel =
                            comment.startTimeMs != null
                              ? selectedTiming?.tempoBpm
                                ? formatBarBeatLabel(comment.startTimeMs / 1000, selectedTiming) ??
                                  formatTimeMs(comment.startTimeMs)
                                : formatTimeMs(comment.startTimeMs)
                              : 'Timestamp not set';

                          return (
                            <button
                              key={`${comment.id ?? 'comment'}:${comment.createdAt}:${index}`}
                              type="button"
                              onClick={() => {
                                if (track) {
                                  setSelectedTrackVersionId(track.trackVersionId);
                                }
                                if (comment.startTimeMs != null) {
                                  handleSeek(comment.startTimeMs);
                                }
                              }}
                              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-left transition-colors hover:border-indigo-500/50 hover:bg-slate-900/70"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-xs font-medium text-slate-300">
                                  {comment.author.name ?? comment.createdBy ?? 'Unknown'}
                                </p>
                                <p className="text-[10px] text-slate-500">{timestampLabel}</p>
                              </div>
                              <p className="mt-1 break-words text-sm text-slate-100">{comment.body}</p>
                              <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-slate-400">
                                <span className="rounded bg-slate-800 px-2 py-0.5">
                                  {track ? track.trackName : 'Project / all tracks'}
                                </span>
                                {comment.resolved ? (
                                  <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-emerald-200">
                                    Resolved
                                  </span>
                                ) : null}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="rounded-md border border-slate-700 bg-slate-950 px-4 py-5 text-sm text-slate-400">
                        No comments yet. Use Add Comment near the timeline to add one.
                      </div>
                    )}
                  </div>
                </div>
              ) : null}

              {toolbarTab === 'members' ? (
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-semibold text-white">Members and Presence</p>
                    <p className="text-xs text-slate-400">Live collaborators appear here when presence is available.</p>
                  </div>
                  {presenceRecords.length > 0 ? (
                    <div className="grid gap-2 md:grid-cols-2">
                      {presenceRecords.map((presence) => (
                        <div key={presence.presenceId} className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2">
                          <p className="text-sm font-medium text-white">{presence.actorUserId}</p>
                          <p className="text-xs text-slate-400">
                            {presence.status} · {presence.currentTool} · {presence.recordingState}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {presence.selectedTrackId ? `Track ${presence.selectedTrackId}` : 'No track selected'}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-md border border-slate-700 bg-slate-950 px-4 py-5 text-sm text-slate-400">
                      No collaborators are currently visible.
                    </div>
                  )}
                </div>
              ) : null}
            </section>
          </div>
          <div className="flex h-full min-h-0 flex-col gap-4 xl:col-start-2 xl:row-start-1 xl:self-stretch">
            <ProjectTimingControls
              sharedDemoTempoBpm={sharedDemoTempoBpm}
              localTempoBpm={localTempoBpmInput}
              onLocalTempoChange={setLocalTempoBpmInput}
            />
            <TransportControls
              isPlaying={isPlaying}
              currentTimeMs={currentTimeMs}
              onPlay={() => playTransport()}
              onPause={pauseTransport}
              onStop={handleTransportStop}
              leadingSlot={
                <RecordingControls
                  ref={recordingControlsRef}
                  currentTimeMs={currentTimeMs}
                  recordedTempoBpm={resolvedLocalTempoBpm}
                  isDisabled={temporaryRecordingTrack !== null || !audioInputReady || !selectedAudioInputDeviceId}
                  recordingTarget={activeRecordingTarget}
                  selectedAudioInputDeviceId={selectedAudioInputDeviceId}
                  isAudioInputReady={audioInputReady}
                  onNeedsAudioInput={() => {}}
                  onStreamReady={handleRecordingStreamReady}
                  onDurationUpdate={handleRecordingDurationUpdate}
                  onStopped={handleRecordingStopped}
                />
              }
              trailingSlot={
                <button
                  type="button"
                  onClick={() => setMetronomeEnabled((prev) => !prev)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    metronomeEnabled
                      ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40'
                      : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  Metronome {metronomeEnabled ? 'On' : 'Off'}
                </button>
              }
            />
          </div>
        </div>

      {addCommentModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-950 p-5 shadow-2xl shadow-black/40">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-white">Add Comment</h3>
                <p className="mt-1 text-sm text-slate-400">Attach a note to the current playhead or a specific track.</p>
              </div>
              <button
                type="button"
                onClick={closeAddCommentModal}
                className="text-sm text-slate-400 hover:text-slate-200"
              >
                Close
              </button>
            </div>

            <div className="mt-4 rounded-md border border-slate-800 bg-slate-900/80 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Timestamp</p>
                  <p className="mt-1 text-sm font-medium text-slate-100">
                    {selectedTiming?.tempoBpm
                      ? formatBarBeatLabel(addCommentTimestampMs / 1000, selectedTiming) ?? formatTimeMs(addCommentTimestampMs)
                      : formatTimeMs(addCommentTimestampMs)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setAddCommentTimestampMs(currentTimeMs)}
                  className="rounded-md bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
                >
                  Use playhead
                </button>
              </div>
            </div>

            <label className="mt-4 block space-y-1">
              <span className="block text-[10px] uppercase tracking-[0.18em] text-slate-400">Scope</span>
              <select
                value={addCommentTrackId ?? ''}
                onChange={(e) => setAddCommentTrackId(e.currentTarget.value || null)}
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-indigo-500 focus:ring"
              >
                <option value="">Project / all tracks</option>
                {selectedTracks.map((track) => (
                  <option key={track.trackId} value={track.trackId}>
                    {track.trackName}
                  </option>
                ))}
              </select>
            </label>

            <label className="mt-4 block space-y-1">
              <span className="block text-[10px] uppercase tracking-[0.18em] text-slate-400">Comment</span>
              <textarea
                rows={4}
                value={addCommentBody}
                onChange={(e) => setAddCommentBody(e.currentTarget.value)}
                placeholder="Leave a note for this moment..."
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-indigo-500 focus:ring"
              />
            </label>

            {addCommentError ? <p className="mt-2 text-xs text-red-400">{addCommentError}</p> : null}

            <div className="mt-4 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={closeAddCommentModal}
                className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitAddComment()}
                disabled={addCommentSubmitting}
                className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {addCommentSubmitting ? 'Saving…' : 'Add comment'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {uploadModalState.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-lg border border-gray-700 bg-gray-950 p-5 shadow-2xl">
            <h3 className="text-base font-semibold text-white">Choose upload timing</h3>
            <p className="mt-2 text-sm text-gray-300">
              This project already has tempo metadata. Pick how the new upload should behave.
            </p>
            <div className="mt-4 space-y-2">
              <button
                type="button"
                onClick={() => void confirmUploadChoice('keepProjectTempo')}
                disabled={isUploading}
                className="w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-left text-sm text-white hover:bg-gray-800 disabled:opacity-60"
              >
                Keep current project tempo and fit this upload to it
              </button>
              <button
                type="button"
                onClick={() => void confirmUploadChoice('updateProjectTempoFromUpload')}
                disabled={isUploading}
                className="w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-left text-sm text-white hover:bg-gray-800 disabled:opacity-60"
              >
                Analyze this upload and update the project tempo
              </button>
              <button
                type="button"
                onClick={() => void confirmUploadChoice('uploadUnchanged')}
                disabled={isUploading}
                className="w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-left text-sm text-white hover:bg-gray-800 disabled:opacity-60"
              >
                Upload unchanged
              </button>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={cancelUploadChoice}
                className="text-sm text-gray-400 hover:text-gray-200"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {tempoAnalysisPrompt?.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-lg border border-gray-700 bg-gray-950 p-5 shadow-2xl">
            <h3 className="text-base font-semibold text-white">Tempo analysis</h3>
            <p className="mt-2 text-sm text-gray-300">
              {tempoAnalysisPrompt.trackName} was analyzed locally.
            </p>
            <div className="mt-4 rounded-md border border-gray-800 bg-gray-900 px-3 py-2">
              <p className="text-xs uppercase tracking-wide text-gray-500">Detected tempo</p>
              <p className="text-2xl font-semibold text-white">{tempoAnalysisPrompt.tempoBpm.toFixed(1)} BPM</p>
              <p className="mt-1 text-xs text-gray-400">
                Confidence {Math.round(tempoAnalysisPrompt.confidence * 100)}%
              </p>
              {tempoAnalysisPrompt.confidence < 0.35 ? (
                <p className="mt-2 text-xs text-amber-300">
                  Low confidence, so this is only a suggestion until you choose to apply it.
                </p>
              ) : null}
            </div>
            {tempoAnalysisPrompt.error ? (
              <p className="mt-3 text-sm text-red-400">{tempoAnalysisPrompt.error}</p>
            ) : null}
            {activeTempoAnalysisJob?.status === 'COMPLETE' ? (
              <p className="mt-3 text-xs text-emerald-300">Analysis is complete.</p>
            ) : null}
            <div className="mt-4 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setTempoAnalysisPrompt(null)}
                className="text-sm text-gray-400 hover:text-gray-200"
              >
                Dismiss
              </button>
              <p className="text-xs text-slate-400">Project tempo edits are disabled in this version.</p>
            </div>
          </div>
        </div>
      ) : null}

      {dragError ? (
        <p className="text-sm text-red-400">{dragError}</p>
      ) : null}

      <div className="space-y-4">
        <section className="min-w-0 space-y-3 rounded-lg border border-gray-800 bg-gray-950 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Timeline</h2>
            <button
              type="button"
              onClick={openAddCommentModal}
              className="rounded-md bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500"
            >
              Add Comment
            </button>
          </div>
          <div className="flex items-center gap-3 text-xs">{splitError ? <p className="text-amber-300">{splitError}</p> : null}</div>
          <p className="text-[11px] text-gray-500">Comments can be anchored to the playhead or scoped to a specific track.</p>

          {hasTimelineContent ? (
            <div ref={tracksScrollContainerRef} className="overflow-x-auto rounded-md border border-gray-800">
              <div className="flex" style={{ minWidth: TRACK_LABEL_WIDTH + totalTimelineWidth }}>
                <div
                  className="shrink-0 border-b border-r border-gray-800 bg-gray-900"
                  style={{ width: TRACK_LABEL_WIDTH }}
                />
                <div
                  className="shrink-0 overflow-hidden border-b border-gray-800"
                  style={{ width: totalTimelineWidth }}
                >
                  <TimelineRuler
                    totalDurationMs={totalDurationMs}
                    currentTimeMs={currentTimeMs}
                    onSeek={handleSeek}
                    timing={selectedTiming}
                  />
                </div>
              </div>

              {projectTimelineComments.length > 0 ? (
                <div className="relative border-b border-gray-800 bg-gray-950" style={{ minWidth: TRACK_LABEL_WIDTH + totalTimelineWidth, height: 28 }}>
                  <div className="absolute inset-y-0 left-0" style={{ width: TRACK_LABEL_WIDTH }} />
                  <div className="absolute inset-y-0 left-0 overflow-visible" style={{ left: TRACK_LABEL_WIDTH, width: totalTimelineWidth }}>
                    {projectTimelineComments.map((comment, index) => {
                      const leftPx = Math.max(0, ((comment.startTimeMs ?? 0) / 1000) * PX_PER_SECOND);
                      const commentKey = `project:${comment.id ?? 'comment'}:${comment.createdAt}:${index}`;
                      const isOpen = timelineCommentOpenId === commentKey;
                      return (
                        <div
                          key={commentKey}
                          className="absolute top-0 h-full pointer-events-none"
                          style={{ left: leftPx }}
                        >
                          <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-indigo-400/60" />
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setTimelineCommentOpenId((prev) => (prev === commentKey ? null : commentKey));
                            }}
                            className="pointer-events-auto absolute left-1/2 top-0 flex h-4 w-4 -translate-x-1/2 items-center justify-center rounded-full border border-indigo-300 bg-slate-950 text-[8px] text-indigo-200 shadow-sm shadow-black/30 hover:bg-indigo-500 hover:text-white"
                            title="Show comment"
                          >
                            •
                          </button>
                          {isOpen ? (
                            <div className="pointer-events-auto absolute left-3 top-5 z-40 w-72 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 shadow-xl shadow-black/40">
                              <div className="flex items-center justify-between gap-2">
                                <p className="truncate font-medium text-slate-300">
                                  {comment.author.name ?? comment.createdBy ?? 'Unknown'}
                                </p>
                                {comment.resolved ? (
                                  <span className="shrink-0 rounded bg-emerald-900/60 px-1 py-0.5 text-[9px] text-emerald-200">
                                    Resolved
                                  </span>
                                ) : null}
                              </div>
                              <p className="mt-1 break-words leading-snug text-slate-100">{comment.body}</p>
                              <div className="mt-2 flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleSeek(comment.startTimeMs ?? 0)}
                                  className="text-[10px] font-medium text-indigo-400 hover:text-indigo-300"
                                >
                                  Jump to time
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setTimelineCommentOpenId(null)}
                                  className="text-[10px] font-medium text-slate-400 hover:text-slate-200"
                                >
                                  Close
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {selectedTracks.map((track) => {
                const isMuted = mutedTrackVersionIds.has(track.trackVersionId);
                const trackLane = visualProjection.trackLanesByTrackVersionId[track.trackVersionId];
                const trackRecording = trackLane?.recording ?? null;
                const trackSegments = trackLane?.segments ?? [];
                const selectedTrackSegment = trackSegments.find((segment) => segment.id === selectedSegmentId) ?? null;
                const splitHoverTimeMs =
                  timelineTool === 'split' && splitHover?.trackVersionId === track.trackVersionId
                    ? splitHover.timeMs
                    : null;
                const splitHoverLeftPx =
                  splitHoverTimeMs !== null
                    ? visualProjection.splitHoverLeftPxByTrackVersionId[track.trackVersionId] ?? null
                    : null;
                const hoveredTrackSegment =
                  timelineTool === 'split' && splitHoverTimeMs !== null
                    ? trackSegments.find(
                        (segment) =>
                          splitHoverTimeMs >= segment.timelineStartMs && splitHoverTimeMs <= segment.timelineEndMs,
                      ) ?? null
                    : null;
                const isRenaming = renameState?.trackId === track.trackId;
                const trackComments = commentsByTrackId[track.trackId] ?? [];
                const isBlankTrack = trackSegments.length === 0 && trackRecording === null;
                const blankTrackTicks = isBlankTrack ? getTimelineTicks(totalDurationMs, selectedTiming) : [];

                return (
                  <div
                    key={track.trackVersionId}
                    className={`flex border-b border-gray-800 last:border-b-0 ${
                      selectedTrack?.trackVersionId === track.trackVersionId ? 'bg-slate-950/40' : ''
                    }`}
                    data-track-version-id={track.trackVersionId}
                    style={{ minWidth: TRACK_LABEL_WIDTH + totalTimelineWidth }}
                  >
                    <div
                      className="flex shrink-0 flex-col gap-2 border-r border-gray-800 bg-gray-900 px-2 py-2"
                      style={{ width: TRACK_LABEL_WIDTH, minHeight: DEMO_PAGE_TRACK_HEIGHT }}
                    >
                      {isRenaming ? (
                        <div className="flex flex-col gap-1">
                          <input
                            autoFocus
                            type="text"
                            value={renameState.value}
                            onChange={(e) => {
                              const value = e.currentTarget.value;
                              setRenameState((prev) => (prev ? { ...prev, value } : null));
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void commitRename();
                              if (e.key === 'Escape') cancelRename();
                            }}
                            disabled={renameState.saving}
                            className="w-full rounded border border-indigo-500 bg-gray-950 px-1.5 py-0.5 text-xs text-white outline-none"
                          />
                          {renameState.error ? (
                            <p className="text-[10px] text-red-400">{renameState.error}</p>
                          ) : null}
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => void commitRename()}
                              disabled={renameState.saving}
                              className="text-[10px] text-indigo-400 hover:text-indigo-300 disabled:opacity-60"
                            >
                              {renameState.saving ? 'Saving…' : 'Save'}
                            </button>
                            <button
                              type="button"
                              onClick={cancelRename}
                              className="text-[10px] text-gray-500 hover:text-gray-300"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-start justify-between gap-2">
                            <p
                              className={`min-w-0 flex-1 truncate text-sm font-medium ${isMuted ? 'text-gray-500 line-through' : 'text-white'}`}
                              onDoubleClick={() => startRename(track)}
                              title="Double-click to rename"
                            >
                              {track.trackName}
                            </p>
                            <div className="flex shrink-0 flex-col items-end gap-1">
                              <div className="flex items-center gap-1">
                                {track.isDerived ? (
                                  <span className="shrink-0 rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-medium text-indigo-200">
                                    Derived
                                  </span>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() => startRename(track)}
                                  title="Rename track"
                                  className="shrink-0 text-gray-600 hover:text-gray-300"
                                >
                                  <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                                    <path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207zm-7.468 7.468A.5.5 0 0 1 6 13.5V13h-.5a.5.5 0 0 1-.5-.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.5-.5V10h-.5a.499.499 0 0 1-.175-.032l-.179.178a.5.5 0 0 0-.11.168l-2 5a.5.5 0 0 0 .65.65l5-2a.5.5 0 0 0 .168-.11z" />
                                  </svg>
                                </button>
                              </div>
                              <button
                                type="button"
                                onClick={() => toggleRecordArm(track.trackVersionId)}
                                title={
                                  recordArmedTrackVersionId === track.trackVersionId
                                    ? 'Disarm track for recording'
                                    : 'Arm track for recording'
                                }
                                aria-pressed={recordArmedTrackVersionId === track.trackVersionId}
                                className={`flex h-5 min-w-5 items-center justify-center rounded px-1 text-[11px] font-bold transition-colors ${
                                  recordArmedTrackVersionId === track.trackVersionId
                                    ? 'bg-red-500/20 text-red-300 ring-1 ring-red-500/40'
                                    : 'text-gray-600 hover:bg-gray-800 hover:text-gray-400'
                                }`}
                              >
                                R
                              </button>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => toggleMute(track.trackVersionId)}
                                  title={isMuted ? 'Unmute track' : 'Mute track'}
                                  className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold transition-colors ${
                                    isMuted
                                      ? 'bg-yellow-500/20 text-yellow-400 ring-1 ring-yellow-500/40'
                                      : 'text-gray-600 hover:bg-gray-800 hover:text-gray-400'
                                  }`}
                                >
                                  M
                                </button>
                                <button
                                  type="button"
                                  onClick={() => toggleSolo(track.trackVersionId)}
                                  title={soloTrackVersionIds.has(track.trackVersionId) ? 'Unsolo track' : 'Solo track'}
                                  className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold transition-colors ${
                                    soloTrackVersionIds.has(track.trackVersionId)
                                      ? 'bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-500/40'
                                      : 'text-gray-600 hover:bg-gray-800 hover:text-gray-400'
                                  }`}
                                >
                                  S
                                </button>
                              </div>
                            </div>
                          </div>

                          <div className="space-y-1">
                            <label className="flex items-center gap-2 text-[10px] text-slate-400">
                              <span className="w-10 uppercase tracking-wide">Vol</span>
                              <input
                                type="range"
                                min={0}
                                max={2}
                                step={0.01}
                                value={gainByTrackVersionId[track.trackVersionId] ?? 1}
                                onChange={(e) => setTrackGain(track.trackVersionId, Number(e.currentTarget.value))}
                                className="h-1 w-full accent-indigo-500"
                              />
                            </label>
                          </div>
                        </>
                      )}
                    </div>

                    <div
                      className={`relative shrink-0 select-none bg-gray-950 transition-opacity ${
                        isMuted ? 'opacity-40' : ''
                      } ${timelineTool === 'split' ? 'cursor-crosshair' : 'cursor-default'}`}
                      style={{ width: totalTimelineWidth, minHeight: DEMO_PAGE_TRACK_HEIGHT }}
                      onPointerDown={(e) => handleTrackPointerDown(e, track)}
                      onPointerMove={(e) => {
                        if (timelineTool === 'split') {
                          handleSplitHoverMove(e, track);
                          return;
                        }
                        handleTrackPointerMove(e, track);
                      }}
                      onPointerUp={(e) => void handleTrackPointerUp(e, track)}
                      onPointerCancel={() => handleTrackPointerCancel(track)}
                      onPointerEnter={(e) => {
                        if (timelineTool !== 'split') return;
                        handleSplitHoverMove(e, track);
                      }}
                      onPointerLeave={() => handleSplitHoverLeave(track)}
                      onClick={(e) => {
                        if (timelineTool !== 'split') return;
                        void handleSplitClick(e.currentTarget, e.clientX, track);
                      }}
                    >
                      <div
                        className="pointer-events-none absolute top-0 z-20 h-full w-px bg-yellow-400/80"
                        style={{ left: visualProjection.currentTimeLeftPx }}
                      />

                      {isBlankTrack && blankTrackTicks.length > 0 ? (
                        <div
                          className="pointer-events-none absolute left-0 top-0 z-0 overflow-hidden opacity-60"
                          style={{ width: timelineRulerWidthPx, height: '100%' }}
                          aria-hidden
                        >
                          {blankTrackTicks.map((tick) => {
                            const tickLeftPx = Math.round(tick.leftPx);
                            return (
                              <div key={tick.leftPx} className="absolute inset-y-0" style={{ left: tickLeftPx }}>
                                <div
                                  className="absolute top-0 left-0 w-px"
                                  style={{
                                    height: 12,
                                    backgroundColor: '#475569',
                                  }}
                                />
                              </div>
                            );
                          })}
                        </div>
                      ) : null}

                      {trackRecording ? (
                        <RecordingTrackLane
                          recording={trackRecording}
                          stream={recordingStream}
                          currentTimeMs={currentTimeMs}
                          scrollContainerRef={tracksScrollContainerRef}
                          onNameChange={handleRecordingNameChange}
                        />
                      ) : null}

                      {trackLane?.recordingTakes?.map((take) => {
                        const isSelected = selectedSegmentId === take.id;
                        const isDraggingRecordingTake =
                          dragRef.current?.kind === 'recording-take' && dragRef.current.takeId === take.id;

                        return (
                          <TrackSegmentClip
                            key={take.id}
                            trackVersionId={track.trackVersionId}
                            segment={take.segment}
                            storageKey={take.storageKey}
                            isSelected={isSelected}
                            isMuted={isMuted}
                            isDragging={isDraggingRecordingTake}
                            timelineTool={timelineTool}
                            currentTimeMs={currentTimeMs}
                            onPointerDown={(event) => handleRecordingTakePointerDown(event, track, take)}
                            onPointerMove={(event) => handleRecordingTakePointerMove(event, track, take)}
                            onPointerUp={(event) => void handleRecordingTakePointerUp(event, track, take)}
                            onPointerCancel={() => handleRecordingTakePointerCancel(track, take)}
                            onClick={(event) => void handleRecordingTakeClick(event, track, take)}
                          />
                        );
                      })}

                      {trackComments.length > 0 ? (
                        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 h-10 overflow-visible">
                          {trackComments.map((comment, index) => {
                            const leftPx = Math.max(0, ((comment.startTimeMs ?? 0) / 1000) * PX_PER_SECOND);
                            const commentKey = `track:${track.trackVersionId}:${comment.id ?? 'comment'}:${comment.createdAt}:${index}`;
                            const isOpen = timelineCommentOpenId === commentKey;
                            return (
                              <div
                                key={commentKey}
                                className="absolute top-0 h-full pointer-events-none"
                                style={{ left: leftPx }}
                              >
                                <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-indigo-400/60" />
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setTimelineCommentOpenId((prev) => (prev === commentKey ? null : commentKey));
                                  }}
                                  className="pointer-events-auto absolute left-1/2 top-0 flex h-4 w-4 -translate-x-1/2 items-center justify-center rounded-full border border-indigo-300 bg-slate-950 text-[8px] text-indigo-200 shadow-sm shadow-black/30 hover:bg-indigo-500 hover:text-white"
                                  title="Show comment"
                                >
                                  •
                                </button>
                                {isOpen ? (
                                  <div className="pointer-events-auto absolute left-3 top-5 z-40 w-72 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 shadow-xl shadow-black/40">
                                    <div className="flex items-center justify-between gap-2">
                                      <p className="truncate font-medium text-slate-300">
                                        {comment.author.name ?? comment.createdBy ?? 'Unknown'}
                                      </p>
                                      {comment.resolved ? (
                                        <span className="shrink-0 rounded bg-emerald-900/60 px-1 py-0.5 text-[9px] text-emerald-200">
                                          Resolved
                                        </span>
                                      ) : null}
                                    </div>
                                    <p className="mt-1 break-words leading-snug text-slate-100">{comment.body}</p>
                                    <div className="mt-2 flex items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => handleSeek(comment.startTimeMs ?? 0)}
                                        className="text-[10px] font-medium text-indigo-400 hover:text-indigo-300"
                                      >
                                        Jump to time
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setTimelineCommentOpenId(null)}
                                        className="text-[10px] font-medium text-slate-400 hover:text-slate-200"
                                      >
                                        Close
                                      </button>
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      ) : null}

                      {timelineTool === 'split' && splitHoverTimeMs !== null && hoveredTrackSegment ? (
                        <div
                          className="pointer-events-none absolute top-0 z-30 h-full w-px bg-amber-300/90"
                          style={{ left: splitHoverLeftPx ?? 0 }}
                        >
                          <div className="absolute -top-2 left-1/2 -translate-x-1/2 rounded bg-amber-300 px-1 py-0.5 text-[9px] font-semibold text-gray-950 shadow">
                            cut
                          </div>
                        </div>
                      ) : null}

                      {trackSegments.map((segment) => {
                        const isSelected = selectedTrackSegment?.id === segment.id;
                        const isDraggingSegment =
                          dragRef.current?.kind === 'segment' && dragRef.current.segmentId === segment.id;
                        const isDraggingImplicitTrack =
                          dragRef.current?.kind === 'track' && dragRef.current.trackVersionId === track.trackVersionId;

                        return (
                          <TrackSegmentClip
                            key={segment.id}
                            trackVersionId={track.trackVersionId}
                            segment={segment}
                            storageKey={track.storageKey}
                            isSelected={isSelected}
                            isMuted={isMuted}
                            isDragging={isDraggingSegment || isDraggingImplicitTrack}
                            timelineTool={timelineTool}
                            currentTimeMs={currentTimeMs}
                            onDurationReady={handleDurationReady}
                            onPointerDown={(event) => handleSegmentPointerDown(event, track, segment)}
                            onPointerMove={(event) => {
                              if (timelineTool === 'split') {
                                event.stopPropagation();
                                handleSplitHoverMove(event, track, segment.timelineStartMs);
                                return;
                              }
                              handleSegmentPointerMove(event, track, segment);
                            }}
                            onPointerUp={(event) => void handleSegmentPointerUp(event, track, segment)}
                            onPointerCancel={() => handleSegmentPointerCancel(track, segment)}
                            onClick={(event) => {
                              if (timelineTool === 'split') {
                                event.stopPropagation();
                                void handleSplitClick(event.currentTarget, event.clientX, track, segment.timelineStartMs);
                                return;
                              }
                              event.stopPropagation();
                              setSelectedSegmentId(segment.id);
                              setSplitError(null);
                            }}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              <div className="flex justify-start px-2 py-4">
                <AddTrackButton onClick={() => void handleAddTrack()} disabled={isUploading} />
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-gray-800 bg-gray-900 px-4 py-8 text-sm text-gray-400">
              This version has no tracks yet. Upload, record, or add a track to get started.
              <div className="mt-4">
                <AddTrackButton onClick={() => void handleAddTrack()} disabled={isUploading} />
              </div>
            </div>
          )}
        </section>
      </div>
      </div>
      </div>
  );
}
