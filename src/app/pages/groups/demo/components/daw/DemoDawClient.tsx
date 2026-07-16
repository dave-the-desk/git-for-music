'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
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
} from '@git-for-music/server/app/lib/daw/protocol';
import { AddTrackButton } from './AddTrackButton';
import type { DawToolbarTab } from './DawToolbarTabs';
import { CommentInput } from './CommentInput';
import { ProjectTimingControls } from './ProjectTimingControls';
import { TransportControls } from './TransportControls';
import { TimelineRuler, getTimelineTicks, getTimelineWidthPx } from './TimelineRuler';
import { RecordingControls } from './RecordingControls';
import type { RecordingControlsHandle } from './RecordingControls';
import { RecordingTrackLane } from './RecordingTrackLane';
import { TrackSegmentClip } from './TrackSegmentClip';
import { VersionHistoryTree } from './VersionHistoryTree';
import { AudioInputSelector } from './AudioInputSelector';
import { AudioEditingEngine } from '@/app/lib/daw/engine/audio-editing-engine';
import {
  renderDawProjectAsMp3Blob,
  renderDawTrackStemsAsMp3Blobs,
} from '@/app/lib/daw/engine/export-engine';
import { AudioIngestEngine } from '@/app/lib/daw/engine/ingest-engine';
import { ProjectSyncEngine } from '@/app/lib/daw/engine/project-sync-engine';
import { AudioPlaybackEngine } from '@/app/lib/daw/engine/playback-engine';
import {
  createWamPlaybackPluginGraphFactory,
  loadWamModule,
  type PlaybackPluginGraphIssue,
} from '@/app/lib/daw/engine/wam-host';
import {
  buildDawVisualProjection,
  PX_PER_SECOND,
  type WaveformCache,
} from '@/app/lib/daw/rendering/visual-renderer';
import {
  buildMergedSegmentFromPair,
  EMPTY_TRACK_MIME_TYPE,
  getMergeCandidateError,
  isFadeSelectableSegment,
  isMergeSelectableSegment,
  isSameMergeSelection,
  isValidSplitTime,
  sortSegmentsForMerge,
  type MergeSelection,
} from '@/app/lib/daw/utils/segments';
import {
  formatBarBeatLabel,
  isValidTempoBpm,
  normalizeTempoBpm,
  snapMsToGrid,
  DEFAULT_DEMO_TEMPO_BPM,
} from '@/app/lib/daw/utils/timing';
import {
  DEFAULT_SNAP,
  TRACK_HEIGHT,
  TRACK_LABEL_WIDTH,
  localTempoStateFromTempo,
  type RenameState,
  type TempoAnalysisPromptState,
  type TemporaryRecordingTrack,
  type UploadModalState,
  formatTimeMs,
} from '@/app/lib/daw/state/ui-state';
import { buildRecordingBounds, type RecordingBounds } from '@/app/lib/daw/utils/recording-bounds';
import { getNextUploadTrackName } from '@/app/lib/daw/utils/track-names';
import { resolveUploadSourceVersionId } from '@/app/lib/daw/utils/upload-source-version';
import { shouldShowTemporaryRecordingTrack } from '@/app/lib/daw/utils/recording-preview';
import type {
  DawTrack,
  DawVersion,
  HostedPluginInstanceState,
  LocalProjectState,
  TrackTimelineSegment,
} from '@/app/lib/daw/state/local-project-state';
import type { TimelineHistoryEntry } from '@/app/lib/daw/state/operation-reducer';
import {
  buildSameTrackSegmentMoveUndoInput,
  getSegmentDragCommitTimelineStartMs,
  getSegmentDragOriginalSegments,
  getTrackDragCommitOffset,
  type TimelineDragState,
  updateSegmentDragState,
  updateTrackDragState,
} from '@/app/lib/daw/state/timeline-drag';
import {
  getDisplayedTrackSegments as selectDisplayedTrackSegments,
  getRenderableTrackSegments as selectRenderableTrackSegments,
  getTrackDurationMs as selectTrackDurationMs,
  getTrackStartOffsetMs as selectTrackStartOffsetMs,
  isBlankTrack,
  groupCommentsByTrackId,
  selectTracks,
  selectSegmentAudioSource,
  selectVersionById,
  selectTotalDurationMs,
} from '@/app/lib/daw/state/selectors';

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
  initialActiveVersionId: string | null;
  initialIsFollowingHead: boolean;
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
  currentTool: 'select' | 'split' | 'merge' | 'fade';
  recordingState: 'idle' | 'recording' | 'preview' | 'uploading' | 'error';
  playbackFollowState: boolean;
  updatedAt: string;
};

type BrowserTab = 'upload' | 'plugins' | 'members';

type ResolvedRecordingTarget = {
  trackId: string;
  trackVersionId: string;
  trackName: string;
};

type PluginParameterSchemaDefinition = {
  id: string;
  label?: string | null;
  name?: string | null;
  type?: 'number' | 'integer' | 'boolean' | 'toggle' | string;
  min?: number | null;
  max?: number | null;
  step?: number | null;
  unit?: string | null;
  default?: number | boolean | null;
  range?: {
    min?: number | null;
    max?: number | null;
    step?: number | null;
  } | null;
};

type PluginDefinition = {
  id: string;
  pluginKey: string;
  name: string;
  displayName: string | null;
  description: string | null;
  version: string;
  manufacturer: string | null;
  parameterSchema: unknown;
  ownerId: string | null;
  visibility: 'PRIVATE' | 'PUBLIC';
  descriptorUrl: string;
  createdAt: string;
};

type ResolvedPluginParameter = {
  id: string;
  label: string;
  type: 'slider' | 'toggle';
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  defaultValue: number | boolean;
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

function getVersionTreeRailStorageKey(projectId: string, currentUserId: string) {
  return `git-for-music:daw:version-tree-rail:${projectId}:${currentUserId}`;
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
  initialActiveVersionId,
  initialIsFollowingHead,
  initialVersions,
}: DemoDawClientProps) {
  const router = useRouter();

  const [selectedVersionId, setSelectedVersionId] = useState(initialActiveVersionId ?? initialCurrentVersionId);
  const previousActiveVersionIdRef = useRef(initialActiveVersionId ?? initialCurrentVersionId);
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
  const [browserTab, setBrowserTab] = useState<BrowserTab>('upload');
  const [browserQuery, setBrowserQuery] = useState('');
  const [isVersionTreeRailExpanded, setIsVersionTreeRailExpanded] = useState(true);
  const [versionHistoryZoomLevel, setVersionHistoryZoomLevel] = useState(1);
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1440,
  );
  const [selectedTrackVersionId, setSelectedTrackVersionId] = useState<string | null>(null);
  const [presenceRecords, setPresenceRecords] = useState<ProjectPresenceRecord[]>([]);
  const [pluginDefinitions, setPluginDefinitions] = useState<PluginDefinition[]>([]);
  const [gainByTrackVersionId, setGainByTrackVersionId] = useState<Record<string, number>>({});
  const [soloTrackVersionIds, setSoloTrackVersionIds] = useState<Set<string>>(() => new Set());
  const [recordArmedTrackVersionId, setRecordArmedTrackVersionId] = useState<string | null>(null);
  const [expandedPluginTrackVersionIds, setExpandedPluginTrackVersionIds] = useState<Set<string>>(() => new Set());
  const [pluginModuleReloadTick, setPluginModuleReloadTick] = useState(0);
  const [pluginRackDropTarget, setPluginRackDropTarget] = useState<{ trackVersionId: string; position: number } | null>(
    null,
  );
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
  const inspectorScrollRef = useRef<HTMLDivElement | null>(null);
  const recordingPreviewUrlRef = useRef<string | null>(null);
  const isLiveRecordingRef = useRef(false);
  const recordingSessionRef = useRef<RecordingSession | null>(null);
  const recordingControlsRef = useRef<RecordingControlsHandle | null>(null);
  const selectedTracksRef = useRef<DawTrack[]>([]);
  const topShellRef = useRef<HTMLDivElement | null>(null);
  const toolsStickySentinelRef = useRef<HTMLDivElement | null>(null);
  const toolsBarRef = useRef<HTMLDivElement | null>(null);
  const [toolsStickyTop, setToolsStickyTop] = useState(0);
  const [toolsBarHeight, setToolsBarHeight] = useState(0);
  const [isToolsBarStuck, setIsToolsBarStuck] = useState(false);
  const [isTopControlRowCollapsed, setIsTopControlRowCollapsed] = useState(false);
  const freshestCommittedVersionIdRef = useRef(initialActiveVersionId ?? initialCurrentVersionId);
  const versionHistoryScrollResetSignal = `${demoId}:${isVersionTreeRailExpanded ? 'expanded' : 'collapsed'}`;

  const [offsetOverrides, setOffsetOverrides] = useState<Record<string, number>>({});
  const [segmentLayoutOverrides, setSegmentLayoutOverrides] = useState<Record<string, TrackTimelineSegment[]>>({});
  const [timelineHistory, setTimelineHistory] = useState<TimelineHistoryEntry[]>([]);
  const [dragError, setDragError] = useState<string | null>(null);
  const dragRef = useRef<TimelineDragState | null>(null);
  const [timelineTool, setTimelineTool] = useState<'select' | 'split' | 'merge' | 'fade'>('select');
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [splitHover, setSplitHover] = useState<SplitHoverState>(null);
  const [splitError, setSplitError] = useState<string | null>(null);
  const [pendingMergeSelection, setPendingMergeSelection] = useState<MergeSelection | null>(null);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [mergeSubmitting, setMergeSubmitting] = useState(false);
  const [fadeError, setFadeError] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<'project' | 'tracks' | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const pluginRackDragRef = useRef<{ trackVersionId: string; instanceId: string } | null>(null);

  useEffect(() => {
    const element = topShellRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;

    const updateTopOffset = () => {
      setToolsStickyTop(element.getBoundingClientRect().height);
    };

    updateTopOffset();
    const observer = new ResizeObserver(updateTopOffset);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = toolsBarRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;

    const updateHeight = () => {
      setToolsBarHeight(element.getBoundingClientRect().height);
    };

    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const sentinel = toolsStickySentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === 'undefined') return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsToolsBarStuck(!entry.isIntersecting);
      },
      {
        root: null,
        threshold: 1,
      },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  const [renameState, setRenameState] = useState<RenameState | null>(null);
  const [historyProjectState, setHistoryProjectState] = useState<LocalProjectState | null>(null);
  const [historyOperationSeq, setHistoryOperationSeq] = useState<number | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [pluginGraphIssue, setPluginGraphIssue] = useState<PlaybackPluginGraphIssue | null>(null);
  const clockRef = useRef<number | null>(null);
  const lastAppliedTempoBpmRef = useRef<number>(0);
  const tracksScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const hasHydratedVersionTreeRailRef = useRef(false);
  const versionTreeRailHydratedFromStorageRef = useRef(false);
  const versionTreeRailShouldPersistRef = useRef(false);
  const metronomeAudioRef = useRef<AudioContext | null>(null);
  const metronomeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const metronomeScheduledBeatRef = useRef<number | null>(null);
  const undoLatestTimelineEditRef = useRef<() => Promise<boolean>>(async () => false);
  const undoTimelineEditInFlightRef = useRef(false);
  const deleteSelectedClipRef = useRef<() => Promise<boolean>>(async () => false);
  const cancelTimelineDragRef = useRef<() => void>(() => {});
  const timelineToolRef = useRef<'select' | 'split' | 'merge' | 'fade'>('select');
  const presenceIdRef = useRef(crypto.randomUUID());
  const currentTimeMsRef = useRef(0);
  const selectedTrackIdRef = useRef<string | null>(null);
  const currentRecordingStateRef = useRef<'idle' | 'recording' | 'preview' | 'uploading' | 'error'>('idle');
  const playbackFollowStateRef = useRef(false);
  const lastPresencePayloadRef = useRef<string | null>(null);
  const fadeDragRef = useRef<{
    trackVersionId: string;
    segmentId: string;
    edge: 'left' | 'right';
    pointerId: number;
    startClientX: number;
    currentClientX: number;
    startFadeInMs: number;
    startFadeOutMs: number;
    currentFadeInMs: number;
    currentFadeOutMs: number;
    segmentDurationMs: number;
  } | null>(null);

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
  const pluginGraphFactory = useMemo(
    () =>
      createWamPlaybackPluginGraphFactory({
        getTrackPlugins: (trackVersionId) =>
          selectedTracksRef.current.find((track) => track.trackVersionId === trackVersionId)?.plugins ?? [],
        onIssue: setPluginGraphIssue,
      }),
    [],
  );
  const playbackEngine = useMemo(() => new AudioPlaybackEngine({ pluginGraphFactory }), [pluginGraphFactory]);
  const projectSyncEngine = useMemo(() => new ProjectSyncEngine(), []);
  const [projectSyncState, setProjectSyncState] = useState(() => projectSyncEngine.getState());
  const liveProjectState = projectSyncState.projectState;
  const liveVersions = liveProjectState?.versions ?? initialVersions;
  const liveBranchHeadVersionId = liveProjectState?.currentVersionId ?? initialCurrentVersionId;
  const liveActiveVersionId =
    liveProjectState?.activeVersionId ?? initialActiveVersionId ?? liveBranchHeadVersionId;
  const isFollowingHead = liveProjectState?.isFollowingHead ?? initialIsFollowingHead;
  const isWideViewport = viewportWidth >= 1280;
  const displayProjectState = historyProjectState ?? liveProjectState;
  const displayVersions = displayProjectState?.versions ?? liveVersions;
  const displayBranchHeadVersionId = displayProjectState?.currentVersionId ?? liveBranchHeadVersionId;
  const isHistoryViewActive = historyOperationSeq !== null;
  const isLocalOnlySync = !projectSyncState.isOnline;
  const localOnlyStatusText =
    projectSyncState.lastError ?? 'Changes stay in this browser until syncing resumes.';

  const updateVersionHistoryZoom = useCallback((nextZoomLevel: number | ((current: number) => number)) => {
    setVersionHistoryZoomLevel((current) => {
      const resolved = typeof nextZoomLevel === 'function' ? nextZoomLevel(current) : nextZoomLevel;
      return Math.min(1.5, Number(Math.max(0.05, resolved).toFixed(3)));
    });
  }, []);

  const selectedVersion = useMemo(
    () => selectVersionById(displayVersions, selectedVersionId),
    [displayVersions, selectedVersionId],
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
  const liveActiveVersion = useMemo(
    () => selectVersionById(liveVersions, liveActiveVersionId),
    [liveActiveVersionId, liveVersions],
  );
  const liveActiveTracks = useMemo(() => selectTracks(liveActiveVersion), [liveActiveVersion]);
  const selectedTrack = useMemo(
    () => selectedTracks.find((track) => track.trackVersionId === selectedTrackVersionId) ?? selectedTracks[0] ?? null,
    [selectedTrackVersionId, selectedTracks],
  );
  const pluginDefinitionsByIdentity = useMemo(
    () => new Map(pluginDefinitions.map((plugin) => [`${plugin.pluginKey}@${plugin.version}`, plugin] as const)),
    [pluginDefinitions],
  );
  const resolvePluginDefinition = useCallback(
    (plugin: Pick<DawTrack['plugins'][number], 'pluginKey' | 'version'>) =>
      pluginDefinitionsByIdentity.get(`${plugin.pluginKey}@${plugin.version}`) ?? null,
    [pluginDefinitionsByIdentity],
  );
  function logPluginModuleLoadFailure(input: {
    trackVersionId?: string;
    trackId?: string;
    trackName?: string;
    pluginKey: string;
    version: string;
    descriptorUrl?: string | null;
    source: 'preload' | 'manual-add';
    error: unknown;
  }) {
    const error =
      input.error instanceof Error
        ? {
            name: input.error.name,
            message: input.error.message,
            stack: input.error.stack,
            cause: (input.error as Error & { cause?: unknown }).cause ?? null,
          }
        : {
            name: typeof input.error,
            message: String(input.error),
            stack: null,
            cause: null,
          };

    console.error(
      '[daw][wam] plugin module load failed',
      JSON.stringify({
        source: input.source,
        projectId,
        demoId,
        selectedTrackVersionId,
        trackVersionId: input.trackVersionId ?? null,
        trackId: input.trackId ?? null,
        trackName: input.trackName ?? null,
        pluginKey: input.pluginKey,
        version: input.version,
        descriptorUrl: input.descriptorUrl ?? null,
        error,
      }),
    );
  }
  const preloadPluginDefinition = useCallback(
    async (pluginDefinition: PluginDefinition) => {
      if (!pluginDefinition.descriptorUrl) {
        return;
      }

      await loadWamModule(pluginDefinition.pluginKey, pluginDefinition.version, pluginDefinition.descriptorUrl);
    },
    [],
  );
  useEffect(() => {
    selectedTracksRef.current = selectedTracks;
  }, [selectedTracks]);
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

  const exportTracks = useMemo(
    () =>
      selectedTracks.map((track) => ({
        trackId: track.trackId,
        trackName: track.trackName,
        trackVersionId: track.trackVersionId,
        storageKey: track.storageKey,
        mimeType: getEffectiveTrackMimeType(track, segmentLayoutOverrides),
        startOffsetMs: selectTrackStartOffsetMs(track, offsetOverrides),
        durationMs: durationByTrackVersionId[track.trackVersionId] ?? track.durationMs,
        segments: selectDisplayedTrackSegments(track, segmentLayoutOverrides),
        recordedTempoBpm:
          recordedTempoByTrackVersionId[track.trackVersionId]?.recordedTempoBpm ??
          track.recordedTempoBpm ??
          sharedDemoTempoBpm,
        sourceTempoBpm:
          recordedTempoByTrackVersionId[track.trackVersionId]?.sourceTempoBpm ??
          track.sourceTempoBpm ??
          sharedDemoTempoBpm,
        isMuted: mutedTrackVersionIds.has(track.trackVersionId),
        gain: gainByTrackVersionId[track.trackVersionId] ?? 1,
        plugins: track.plugins,
      })),
    [
      durationByTrackVersionId,
      gainByTrackVersionId,
      mutedTrackVersionIds,
      offsetOverrides,
      recordedTempoByTrackVersionId,
      selectedTracks,
      segmentLayoutOverrides,
      sharedDemoTempoBpm,
    ],
  );

  useEffect(() => {
    return projectSyncEngine.subscribe((state) => {
      setProjectSyncState(state);
    });
  }, [projectSyncEngine]);

  const tempoMetadataByTrackVersionId = displayProjectState?.tempoMetadataByTrackVersionId;
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
            displayName: string | null;
            description: string | null;
            version: string;
            manufacturer: string | null;
            parameterSchema: unknown;
            ownerId: string | null;
            visibility: 'PRIVATE' | 'PUBLIC';
            descriptorUrl: string;
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
    function handleResize() {
      setViewportWidth(window.innerWidth);
    }

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const storageKey = getVersionTreeRailStorageKey(projectId, currentUserId);
    const fallbackExpanded = isWideViewport;

    try {
      const storedValue = window.localStorage.getItem(storageKey);
      if (storedValue === 'true' || storedValue === 'false') {
        versionTreeRailHydratedFromStorageRef.current = true;
        versionTreeRailShouldPersistRef.current = true;
        setIsVersionTreeRailExpanded(storedValue === 'true');
      } else {
        versionTreeRailHydratedFromStorageRef.current = false;
        versionTreeRailShouldPersistRef.current = false;
        setIsVersionTreeRailExpanded(fallbackExpanded);
      }
    } catch {
      versionTreeRailHydratedFromStorageRef.current = false;
      versionTreeRailShouldPersistRef.current = false;
      setIsVersionTreeRailExpanded(fallbackExpanded);
    }

    hasHydratedVersionTreeRailRef.current = true;
  }, [currentUserId, isWideViewport, projectId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!hasHydratedVersionTreeRailRef.current) return;
    if (!versionTreeRailShouldPersistRef.current) return;

    try {
      window.localStorage.setItem(
        getVersionTreeRailStorageKey(projectId, currentUserId),
        isVersionTreeRailExpanded ? 'true' : 'false',
      );
    } catch {
      // The rail state is a convenience only.
    }
  }, [currentUserId, isVersionTreeRailExpanded, projectId]);

  useEffect(() => {
    if (!hasHydratedVersionTreeRailRef.current) return;
    if (versionTreeRailHydratedFromStorageRef.current) return;
    setIsVersionTreeRailExpanded(isWideViewport);
  }, [isWideViewport]);

  useEffect(() => {
    if (toolbarTab === 'upload' || toolbarTab === 'plugins' || toolbarTab === 'members') {
      setBrowserTab(toolbarTab);
    }
  }, [toolbarTab]);

  useEffect(() => {
    let cancelled = false;

    async function loadHistoryPoint() {
      if (historyOperationSeq === null) {
        setHistoryProjectState(null);
        setHistoryLoading(false);
        return;
      }

      setHistoryLoading(true);
      setHistoryError(null);

      try {
        const nextHistoryState = await projectSyncEngine.loadHistoricalProjectState(historyOperationSeq);
        if (cancelled) return;

        setHistoryProjectState(nextHistoryState);
        if (nextHistoryState) {
          setSelectedVersionId((currentSelectedVersionId) =>
            nextHistoryState.currentVersionId ?? currentSelectedVersionId,
          );
        }
      } catch (error) {
        if (cancelled) return;
        setHistoryError(error instanceof Error ? error.message : 'Could not load version history');
        setHistoryProjectState(null);
      } finally {
        if (!cancelled) {
          setHistoryLoading(false);
        }
      }
    }

    void loadHistoryPoint();
    return () => {
      cancelled = true;
    };
  }, [historyOperationSeq, projectSyncEngine]);

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
  const normalizedBrowserQuery = browserQuery.trim().toLowerCase();
  const filteredPluginDefinitions = useMemo(() => {
    if (!normalizedBrowserQuery) return pluginDefinitions;
    return pluginDefinitions.filter((plugin) => {
      const haystack = [plugin.name, plugin.manufacturer ?? '', plugin.version, plugin.pluginKey]
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalizedBrowserQuery);
    });
  }, [normalizedBrowserQuery, pluginDefinitions]);
  const filteredPresenceRecords = useMemo(() => {
    if (!normalizedBrowserQuery) return presenceRecords;
    return presenceRecords.filter((presence) => {
      const haystack = [presence.actorUserId, presence.status, presence.currentTool, presence.recordingState]
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalizedBrowserQuery);
    });
  }, [normalizedBrowserQuery, presenceRecords]);
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
  const selectedTrackSegment = useMemo(() => {
    if (!selectedTrack || !selectedSegmentId) return null;
    return selectedTrack.segments.find((segment) => segment.id === selectedSegmentId) ?? null;
  }, [selectedSegmentId, selectedTrack]);
  const inspectorCommentTimestampLabel = selectedTiming?.tempoBpm
    ? formatBarBeatLabel(addCommentTimestampMs / 1000, selectedTiming) ?? formatTimeMs(addCommentTimestampMs)
    : formatTimeMs(addCommentTimestampMs);

  const comments = displayProjectState?.comments ?? [];

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
      plugins: track.plugins,
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
        plugins: previewTrackHost.plugins ?? [],
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
    temporaryRecordingTrack,
    selectedTracks,
    sharedDemoTempoBpm,
    soloTrackVersionIds,
  ]);

  const visualTemporaryRecordingTrack = useMemo(() => {
    return shouldShowTemporaryRecordingTrack(temporaryRecordingTrack) ? temporaryRecordingTrack : null;
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
      visualTemporaryRecordingTrack,
      waveformCache,
    ],
  );

  const totalDurationMs = useMemo(
    () => {
      return Math.max(
        selectTotalDurationMs({
          tracks: selectedTracks,
          durationByTrackVersionId,
          offsetOverrides,
          segmentLayoutOverrides,
          temporaryRecordingTrack: visualTemporaryRecordingTrack,
        }),
      );
    },
    [
      durationByTrackVersionId,
      offsetOverrides,
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
    setPendingMergeSelection(null);
    setMergeError(null);
    cancelFadeDrag();
    clearFadeSelection();
    setTimelineTool('select');
  }, [selectedTracks, selectedVersionId]);

  useEffect(() => {
    let cancelled = false;

    async function preloadPluginModules() {
      setPluginGraphIssue(null);
      const pendingLoads = new Map<string, Promise<void>>();

      for (const track of selectedTracks) {
        for (const plugin of track.plugins) {
          const definition = resolvePluginDefinition(plugin);
          if (!definition?.descriptorUrl) {
            continue;
          }

          const cacheKey = `${definition.pluginKey}@${definition.version}`;
          if (pendingLoads.has(cacheKey)) {
            continue;
          }

          pendingLoads.set(
            cacheKey,
            preloadPluginDefinition(definition)
              .then(() => undefined)
              .catch((error) => {
                console.log(
                  '[DemoDawClient] preloadPluginModules failure',
                  JSON.stringify({
                    pluginKey: definition.pluginKey,
                    version: definition.version,
                    descriptorUrl: definition.descriptorUrl,
                    trackVersionId: track.trackVersionId,
                    trackId: track.trackId,
                    trackName: track.trackName,
                    error: error instanceof Error ? { name: error.name, message: error.message } : error,
                  }),
                );
                logPluginModuleLoadFailure({
                  source: 'preload',
                  trackVersionId: track.trackVersionId,
                  trackId: track.trackId,
                  trackName: track.trackName,
                  pluginKey: definition.pluginKey,
                  version: definition.version,
                  descriptorUrl: definition.descriptorUrl,
                  error,
                });
                setPluginGraphIssue({
                  trackVersionId: track.trackVersionId,
                  pluginKey: definition.pluginKey,
                  version: definition.version,
                  message:
                    error instanceof Error
                      ? error.message
                      : `Could not load ${definition.pluginKey}@${definition.version}`,
                  severity: 'error',
                });
              }),
          );
        }
      }

      await Promise.all(pendingLoads.values());

      if (cancelled) {
        return;
      }

      playbackEngine.setProject({
        tracks: playbackEngineProjection.tracks,
        mutedTrackVersionIds: playbackEngineProjection.mutedTrackVersionIds,
        soloTrackVersionIds: playbackEngineProjection.soloTrackVersionIds,
        gainByTrackVersionId: playbackEngineProjection.gainByTrackVersionId,
        localTempoBpm: resolvedLocalTempoBpm,
        sharedDemoTempoBpm,
      });
    }

    void preloadPluginModules();

    return () => {
      cancelled = true;
    };
  }, [
    pluginModuleReloadTick,
    playbackEngine,
    playbackEngineProjection,
    resolvedLocalTempoBpm,
    preloadPluginDefinition,
    resolvePluginDefinition,
    sharedDemoTempoBpm,
    selectedTracks,
  ]);

  useEffect(() => {
    if (!pluginGraphIssue) {
      return;
    }

    const retryTimer = window.setTimeout(() => {
      setPluginModuleReloadTick((currentTick) => currentTick + 1);
    }, 1500);

    return () => window.clearTimeout(retryTimer);
  }, [pluginGraphIssue]);

  useEffect(() => {
    if (!isPlaying) {
      lastAppliedTempoBpmRef.current = resolvedLocalTempoBpm;
      return;
    }
    if (lastAppliedTempoBpmRef.current === resolvedLocalTempoBpm) return;
    lastAppliedTempoBpmRef.current = resolvedLocalTempoBpm;
    const playhead = currentTimeMsRef.current;
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
        activeVersionId: initialActiveVersionId ?? initialCurrentVersionId,
        isFollowingHead: initialIsFollowingHead,
        versionTreeUpdatedAt: null,
        lastVersionOperationSeq: 0,
        comments: [],
        annotations: [],
        tempoMetadataByTrackVersionId: {},
        operationHistory: [],
      },
    });
  }, [
    demoId,
    initialActiveVersionId,
    initialCurrentVersionId,
    initialIsFollowingHead,
    initialVersions,
    projectId,
    projectSyncEngine,
  ]);

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
        } else if (fadeDragRef.current) {
          cancelFadeDrag();
          clearFadeSelection();
          setTimelineTool('select');
        } else if (timelineToolRef.current === 'merge') {
          setPendingMergeSelection(null);
          setMergeError(null);
          setSelectedSegmentId(null);
          setTimelineTool('select');
        } else if (timelineToolRef.current === 'fade') {
          clearFadeSelection();
          setTimelineTool('select');
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
        const currentSegment = currentSegments.find((segment) => segment.id === lastEntry.segmentId);
        setTrackSegmentLayout(lastEntry.trackVersionId, nextSegments);
        if (currentSegment) {
          await commitEditingOperation(
            audioEditingEngine.moveSegment(
              buildSameTrackSegmentMoveUndoInput({
                segmentId: lastEntry.segmentId,
                trackVersionId: lastEntry.trackVersionId,
                previousTimelineStartMs: lastEntry.previousTimelineStartMs,
                currentSegment,
              }),
            ),
          );
        }
      } else if (lastEntry.kind === 'move-segment-track') {
        const movedSegment =
          lastEntry.nextTargetSegments.find((candidate) => candidate.id === lastEntry.segmentId) ??
          lastEntry.previousSourceSegments.find((candidate) => candidate.id === lastEntry.segmentId) ??
          null;
        const sourceSegment =
          lastEntry.previousSourceSegments.find((candidate) => candidate.id === lastEntry.segmentId) ??
          null;
        setTrackSegmentLayout(lastEntry.sourceTrackVersionId, lastEntry.previousSourceSegments);
        setTrackSegmentLayout(lastEntry.targetTrackVersionId, lastEntry.previousTargetSegments);
        setSelectedTrackVersionId(lastEntry.previousSelectedTrackVersionId);
        setSelectedSegmentId(lastEntry.previousSelectedSegmentId);
        if (movedSegment && sourceSegment) {
          await commitEditingOperation(
            audioEditingEngine.moveSegment({
              segmentId: lastEntry.segmentId,
              fromTrackVersionId: lastEntry.targetTrackVersionId,
              toTrackVersionId: lastEntry.sourceTrackVersionId,
              fromTimelineStartMs: movedSegment.timelineStartMs,
              fromTimelineEndMs: movedSegment.timelineEndMs,
              toTimelineStartMs: sourceSegment.timelineStartMs,
              toTimelineEndMs:
                sourceSegment.timelineEndMs ?? sourceSegment.timelineStartMs + sourceSegment.durationMs,
            }),
          );
        }
      } else if (lastEntry.kind === 'cut') {
        setTrackSegmentLayout(lastEntry.trackVersionId, lastEntry.previousSegments);
        setSelectedSegmentId(lastEntry.previousSelectedSegmentId);
      } else if (lastEntry.kind === 'delete-segment') {
        setTrackSegmentLayout(lastEntry.trackVersionId, lastEntry.previousSegments);
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
      getDisplayedTrackSegments(track).some((segment) => segment.id === selectedSegmentId),
    );
    if (!selectedTrack) return false;

    const renderedSegments = getRenderableTrackSegments(selectedTrack);
    const currentSegments = getDisplayedTrackSegments(selectedTrack);
    const selectedSegment =
      currentSegments.find((segment) => segment.id === selectedSegmentId) ??
      renderedSegments.find((segment) => segment.id === selectedSegmentId);
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
    stopTransportClock();
    setIsPlaying(false);
    setCurrentTimeMs(0);
    playbackEngine.stop();
    stopMetronomeSchedule();
    void publishPresence('idle');
  }, [playbackEngine, publishPresence, stopMetronomeSchedule]);

  function pauseTransport() {
    stopTransportClock();
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

  const downloadBlob = useCallback((blob: Blob, fileName: string) => {
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.rel = 'noreferrer';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 500);
  }, []);

  const handleProjectExport = useCallback(async () => {
    if (exportStatus) return;
    setExportStatus('project');
    setExportError(null);

    try {
      const blob = await renderDawProjectAsMp3Blob({
        tracks: exportTracks,
        localTempoBpm: resolvedLocalTempoBpm,
        sharedDemoTempoBpm,
      });
      downloadBlob(blob, `${demoName}.mp3`);
    } catch (error) {
      console.error('[daw] Failed to export project MP3', error);
      setExportError(error instanceof Error ? error.message : 'Unable to export project MP3.');
    } finally {
      setExportStatus(null);
    }
  }, [downloadBlob, exportStatus, exportTracks, demoName, resolvedLocalTempoBpm, sharedDemoTempoBpm]);

  const handleTrackExport = useCallback(async () => {
    if (exportStatus) return;
    setExportStatus('tracks');
    setExportError(null);

    try {
      const files = await renderDawTrackStemsAsMp3Blobs({
        tracks: exportTracks,
        localTempoBpm: resolvedLocalTempoBpm,
        sharedDemoTempoBpm,
      });

      for (const file of files) {
        downloadBlob(file.blob, `${demoName} - ${file.fileName}`);
      }
    } catch (error) {
      console.error('[daw] Failed to export track MP3 stems', error);
      setExportError(error instanceof Error ? error.message : 'Unable to export individual track MP3 files.');
    } finally {
      setExportStatus(null);
    }
  }, [demoName, downloadBlob, exportStatus, exportTracks, resolvedLocalTempoBpm, sharedDemoTempoBpm]);

  useEffect(() => {
    const previousActiveVersionId = previousActiveVersionIdRef.current;
    const activeVersionChanged = previousActiveVersionId !== liveActiveVersionId;

    if (activeVersionChanged && !isHistoryViewActive && selectedVersionId === previousActiveVersionId) {
      setSelectedVersionId(liveActiveVersionId);
    }

    if (activeVersionChanged && !isHistoryViewActive) {
      stopTransport();
    }

    previousActiveVersionIdRef.current = liveActiveVersionId;
  }, [isHistoryViewActive, liveActiveVersionId, selectedVersionId, stopTransport]);

  function seekAllTracks(timeMs: number) {
    playbackEngine.seek(timeMs);
  }

  function seekTransport(timeMs: number) {
    setCurrentTimeMs(timeMs);
    seekAllTracks(timeMs);
    void publishPresence();
  }

  function stopTransportClock() {
    if (clockRef.current !== null) {
      cancelAnimationFrame(clockRef.current);
      clockRef.current = null;
    }
  }

  function startTransportClock() {
    stopTransportClock();

    const tick = () => {
      const newTimeMs = playbackEngine.getCurrentTimeMs();

      // While a take is actively recording, the transport must keep running even if
      // the timeline length is being inferred from the live recording itself.
      if (totalDurationMs > 0 && newTimeMs >= totalDurationMs && !isLiveRecordingRef.current) {
        setCurrentTimeMs(totalDurationMs);
        stopTransport();
        return;
      }

      setCurrentTimeMs(newTimeMs);
      clockRef.current = requestAnimationFrame(tick);
    };

    clockRef.current = requestAnimationFrame(tick);
  }

  function playTransport(fromMs?: number) {
    const startMs = fromMs ?? currentTimeMs;
    seekAllTracks(startMs);
    void playbackEngine.play(startMs);
    setCurrentTimeMs(startMs);
    setIsPlaying(true);
    startTransportClock();
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
      case 'TRACK_REMOVED':
        return (payload as Extract<DawCommandPayload, { trackId: string }>).trackId;
      case 'TRACK_OFFSET_UPDATED':
        return findTrackByVersionId(
          (payload as Extract<DawCommandPayload, { trackVersionId: string }>).trackVersionId,
        )?.trackId ?? null;
      case 'PLUGIN_ADDED':
      case 'PLUGIN_REMOVED':
      case 'PLUGIN_REORDERED':
      case 'PLUGIN_PARAM_SET':
      case 'PLUGIN_BYPASS_SET':
      case 'PLUGIN_STATE_SET':
        return findTrackByVersionId(
          (payload as Extract<DawCommandPayload, { trackVersionId: string }>).trackVersionId,
        )?.trackId ?? null;
      case 'SEGMENT_SPLIT':
        return findTrackByVersionId(
          (payload as Extract<DawCommandPayload, { trackVersionId: string }>).trackVersionId,
        )?.trackId ?? null;
      case 'SEGMENT_MOVED':
        return findTrackByVersionId(
          (payload as Extract<DawCommandPayload, { toTrackVersionId: string }>).toTrackVersionId,
        )?.trackId ?? null;
      case 'SEGMENT_DELETED':
      case 'SEGMENT_TRIMMED':
      case 'SEGMENT_MERGED':
      case 'SEGMENT_FADE_SET':
      case 'CROSSFADE_SET':
        return findTrackByVersionId(
          (payload as Extract<DawCommandPayload, { trackVersionId: string }>).trackVersionId,
        )?.trackId ?? null;
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
      case 'SEGMENT_FADE_SET':
        return (payload as Extract<DawCommandPayload, { segmentId: string }>).segmentId ?? null;
      case 'CROSSFADE_SET':
        {
          const crossfade = payload as Extract<
            DawCommandPayload,
            { leftSegmentId: string; rightSegmentId: string }
          >;
          return crossfade.leftSegmentId ?? crossfade.rightSegmentId ?? null;
        }
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
        const moved = payload as Extract<
          DawCommandPayload,
          {
            fromTrackVersionId: string;
            toTrackVersionId: string;
            segmentId: string;
            fromTimelineStartMs: number;
            toTimelineStartMs: number;
            toTimelineEndMs: number;
          }
        >;
        const durationMs = Math.max(0, moved.toTimelineEndMs - moved.toTimelineStartMs);
        return {
          startMs: Math.min(moved.fromTimelineStartMs, moved.toTimelineStartMs),
          endMs: Math.max(moved.fromTimelineStartMs + durationMs, moved.toTimelineEndMs),
        };
      }
      case 'SEGMENT_DELETED': {
        const deleted = payload as Extract<DawCommandPayload, { trackVersionId: string; segmentId: string }>;
        const segment = findSegmentById(deleted.trackVersionId, deleted.segmentId);
        return segment ? { startMs: segment.timelineStartMs, endMs: segment.timelineEndMs } : null;
      }
      case 'SEGMENT_TRIMMED':
        {
          const trimmed = payload as Extract<DawCommandPayload, { to: { startMs: number; endMs: number } }>;
          return { startMs: trimmed.to.startMs, endMs: trimmed.to.endMs };
        }
      case 'SEGMENT_FADE_SET': {
        const fade = payload as Extract<DawCommandPayload, { trackVersionId: string; segmentId: string }>;
        const segment = findSegmentById(fade.trackVersionId, fade.segmentId);
        return segment ? { startMs: segment.timelineStartMs, endMs: segment.timelineEndMs } : null;
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
      baseSnapshotId: overrides.baseSnapshotId ?? projectSyncState.baseSnapshotId ?? null,
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
    console.log('[DemoDawClient] commitEditingOperation request', {
      operationType: request.operationType,
      payload: request.payload,
      baseSnapshotId: request.baseSnapshotId ?? null,
      baseOperationSeq: request.baseOperationSeq ?? null,
      targetTrackId: request.targetTrackId ?? null,
      targetSegmentId: request.targetSegmentId ?? null,
      affectedTimeRange: request.affectedTimeRange ?? null,
      idempotencyKey: request.idempotencyKey ?? null,
      clientOperationId: request.clientOperationId ?? null,
    });

    try {
      const result = await projectSyncEngine.commitOperation(
        buildCommitRequest(request.operationType, request.payload, request),
      );
      console.log('[DemoDawClient] commitEditingOperation response', {
        operationType: result.type,
        operationSeq: result.operationSeq,
        trackId: (result as { trackId?: string }).trackId ?? null,
        segmentId: (result as { segmentId?: string }).segmentId ?? null,
      });
      return result;
    } catch (error) {
      console.log('[DemoDawClient] commitEditingOperation error', {
        operationType: request.operationType,
        payload: request.payload,
        error: error instanceof Error ? { name: error.name, message: error.message } : error,
      });
      throw error;
    }
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

  function updateFadePreview(trackVersionId: string, segmentId: string, fadeInMs: number, fadeOutMs: number) {
    const track = selectedTracks.find((candidate) => candidate.trackVersionId === trackVersionId);
    if (!track) return;

    const currentSegments = getDisplayedTrackSegments(track);
    const nextSegments = currentSegments.map((segment) =>
      segment.id === segmentId
        ? {
            ...segment,
            fadeInMs,
            fadeOutMs,
          }
        : segment,
    );
    setTrackSegmentLayout(trackVersionId, nextSegments);
  }

  function getFadePointerMetrics(
    event: React.PointerEvent<HTMLDivElement>,
    drag: NonNullable<typeof fadeDragRef.current>,
    edge: 'left' | 'right',
  ) {
    const clip = event.currentTarget.closest<HTMLButtonElement>('button');
    const rect = clip?.getBoundingClientRect();
    if (!rect || rect.width <= 0) {
      return null;
    }

    const position = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
    const durationMs = Math.max(0, drag.segmentDurationMs);
    if (durationMs <= 0) {
      return null;
    }

    const pxPerMs = rect.width / durationMs;
    const handleInsetPx = 3;
    const maxFadeInMs = Math.max(0, durationMs - drag.currentFadeOutMs);
    const maxFadeOutMs = Math.max(0, durationMs - drag.currentFadeInMs);

    if (edge === 'left') {
      return {
        fadeInMs: Math.max(0, Math.min((position - handleInsetPx) / pxPerMs, maxFadeInMs)),
        fadeOutMs: drag.currentFadeOutMs,
      };
    }

    return {
      fadeInMs: drag.currentFadeInMs,
      fadeOutMs: Math.max(0, Math.min((rect.width - position - handleInsetPx) / pxPerMs, maxFadeOutMs)),
    };
  }

  function handleFadeHandlePointerDown(
    track: DawTrack,
    segment: TrackTimelineSegment,
    edge: 'left' | 'right',
    event: React.PointerEvent<HTMLDivElement>,
  ) {
    if (timelineTool !== 'fade') return;
    setSelectedTrackVersionId(track.trackVersionId);
    setSelectedSegmentId(segment.id);
    setFadeError(null);

    fadeDragRef.current = {
      trackVersionId: track.trackVersionId,
      segmentId: segment.id,
      edge,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      currentClientX: event.clientX,
      startFadeInMs: segment.fadeInMs,
      startFadeOutMs: segment.fadeOutMs,
      currentFadeInMs: segment.fadeInMs,
      currentFadeOutMs: segment.fadeOutMs,
      segmentDurationMs: segment.durationMs,
    };
  }

  function handleFadeHandlePointerMove(
    track: DawTrack,
    segment: TrackTimelineSegment,
    edge: 'left' | 'right',
    event: React.PointerEvent<HTMLDivElement>,
  ) {
    if (timelineTool !== 'fade') return;
    const drag = fadeDragRef.current;
    if (!drag || drag.trackVersionId !== track.trackVersionId || drag.segmentId !== segment.id || drag.edge !== edge) {
      return;
    }

    const next = getFadePointerMetrics(event, drag, edge);
    if (!next) return;

    drag.currentClientX = event.clientX;
    drag.currentFadeInMs = next.fadeInMs;
    drag.currentFadeOutMs = next.fadeOutMs;
    updateFadePreview(track.trackVersionId, segment.id, next.fadeInMs, next.fadeOutMs);
  }

  async function handleFadeHandlePointerUp(
    track: DawTrack,
    segment: TrackTimelineSegment,
    edge: 'left' | 'right',
    event: React.PointerEvent<HTMLDivElement>,
  ) {
    if (timelineTool !== 'fade') return;
    const drag = fadeDragRef.current;
    if (!drag || drag.trackVersionId !== track.trackVersionId || drag.segmentId !== segment.id || drag.edge !== edge) {
      return;
    }

    const next = getFadePointerMetrics(event, drag, edge);
    const finalFadeInMs = next?.fadeInMs ?? drag.currentFadeInMs;
    const finalFadeOutMs = next?.fadeOutMs ?? drag.currentFadeOutMs;

    drag.currentClientX = event.clientX;
    drag.currentFadeInMs = finalFadeInMs;
    drag.currentFadeOutMs = finalFadeOutMs;
    fadeDragRef.current = null;

    try {
      await commitEditingOperation(
        audioEditingEngine.setSegmentFade({
          trackVersionId: track.trackVersionId,
          segmentId: segment.id,
          fadeInMs: finalFadeInMs,
          fadeOutMs: finalFadeOutMs,
          previousFadeInMs: drag.startFadeInMs,
          previousFadeOutMs: drag.startFadeOutMs,
        }),
      );
      setFadeError(null);
    } catch (error) {
      updateFadePreview(track.trackVersionId, segment.id, drag.startFadeInMs, drag.startFadeOutMs);
      setFadeError(error instanceof Error ? error.message : 'Could not set fade');
    }
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
      if (!willSolo) {
        return new Set();
      }

      return new Set([trackVersionId]);
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

  async function addPlugin(trackVersionId: string, plugin: HostedPluginInstanceState) {
    const result = await commitEditingOperation(audioEditingEngine.addPlugin({ trackVersionId, plugin }));
    playbackEngine.rebuildTrackPluginChain(trackVersionId);
    return result;
  }

  async function removePlugin(trackVersionId: string, instanceId: string) {
    const result = await commitEditingOperation(audioEditingEngine.removePlugin({ trackVersionId, instanceId }));
    playbackEngine.rebuildTrackPluginChain(trackVersionId);
    return result;
  }

  async function reorderPlugin(trackVersionId: string, instanceId: string, position: number) {
    const result = await commitEditingOperation(audioEditingEngine.reorderPlugin({ trackVersionId, instanceId, position }));
    playbackEngine.rebuildTrackPluginChain(trackVersionId);
    return result;
  }

  async function setPluginParam(trackVersionId: string, instanceId: string, paramId: string, value: number) {
    const result = await commitEditingOperation(audioEditingEngine.setPluginParam({ trackVersionId, instanceId, paramId, value }));
    playbackEngine.setPluginParam(trackVersionId, instanceId, paramId, value);
    return result;
  }

  async function setPluginBypass(trackVersionId: string, instanceId: string, bypassed: boolean) {
    const result = await commitEditingOperation(audioEditingEngine.setPluginBypass({ trackVersionId, instanceId, bypassed }));
    playbackEngine.setPluginBypass(trackVersionId, instanceId, bypassed);
    return result;
  }

  async function setPluginState(
    trackVersionId: string,
    instanceId: string,
    state: HostedPluginInstanceState['state'],
    stateBlobKey?: string | null,
  ) {
    return commitEditingOperation(
      audioEditingEngine.setPluginState({ trackVersionId, instanceId, state, stateBlobKey }),
    );
  }

  async function addPluginToSelectedTrack(pluginDefinition: (typeof pluginDefinitions)[number]) {
    if (!selectedTrack) return;

    try {
      console.log('[DemoDawClient] addPluginToSelectedTrack', {
        trackVersionId: selectedTrack.trackVersionId,
        trackId: selectedTrack.trackId,
        trackName: selectedTrack.trackName,
        pluginKey: pluginDefinition.pluginKey,
        version: pluginDefinition.version,
        descriptorUrl: pluginDefinition.descriptorUrl,
      });
      await preloadPluginDefinition(pluginDefinition);
    } catch (error) {
      logPluginModuleLoadFailure({
        source: 'manual-add',
        trackVersionId: selectedTrack.trackVersionId,
        trackId: selectedTrack.trackId,
        trackName: selectedTrack.trackName,
        pluginKey: pluginDefinition.pluginKey,
        version: pluginDefinition.version,
        descriptorUrl: pluginDefinition.descriptorUrl,
        error,
      });
      setPluginGraphIssue({
        trackVersionId: selectedTrack.trackVersionId,
        pluginKey: pluginDefinition.pluginKey,
        version: pluginDefinition.version,
        message:
          error instanceof Error
            ? error.message
            : `Could not load ${pluginDefinition.pluginKey}@${pluginDefinition.version}`,
        severity: 'error',
      });
      return;
    }

    const pluginInstance: HostedPluginInstanceState = {
      instanceId: crypto.randomUUID(),
      pluginKey: pluginDefinition.pluginKey,
      version: pluginDefinition.version,
      backend: 'wam',
      position: selectedTrack.plugins.length,
      bypassed: false,
      params: {},
      stateBlobKey: null,
    };

    await addPlugin(selectedTrack.trackVersionId, pluginInstance);
  }

  function getPluginRackLabel(plugin: DawTrack['plugins'][number]) {
    const definition = resolvePluginDefinition(plugin);
    return definition?.displayName ?? definition?.name ?? `${plugin.pluginKey} ${plugin.version}`;
  }

  function getOrderedTrackPlugins(track: DawTrack) {
    return [...track.plugins].sort((left, right) => left.position - right.position);
  }

  function isTrackPluginRackExpanded(trackVersionId: string) {
    return expandedPluginTrackVersionIds.has(trackVersionId);
  }

  function toggleTrackPluginRack(trackVersionId: string) {
    setExpandedPluginTrackVersionIds((previous) => {
      const next = new Set(previous);
      if (next.has(trackVersionId)) {
        next.delete(trackVersionId);
      } else {
        next.add(trackVersionId);
      }
      return next;
    });
  }

  function renderPluginChain(track: DawTrack, options?: { variant?: 'rack' | 'browser' }) {
    const orderedTrackPlugins = getOrderedTrackPlugins(track);
    const isBrowserVariant = options?.variant === 'browser';
    const isRackVariant = !isBrowserVariant;

    return (
      <div
        className={
          isBrowserVariant
            ? 'space-y-4'
            : 'mt-2 overflow-hidden rounded-xl border border-slate-800/90 bg-slate-950/80 p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]'
        }
      >
        {isBrowserVariant ? (
          <div className="space-y-1">
            <p className="text-sm font-semibold text-white">{track.trackName}</p>
            <p className="text-xs text-slate-400">Edit the selected track&apos;s insert chain from the Plugins tab.</p>
          </div>
        ) : (
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-300">Insert chain</p>
              <p className="mt-0.5 text-[10px] text-slate-500">Plugins on this track</p>
            </div>
            <span className="shrink-0 rounded-full border border-slate-700 bg-slate-900/80 px-2 py-0.5 text-[10px] font-medium text-slate-300">
              {orderedTrackPlugins.length} slot{orderedTrackPlugins.length === 1 ? '' : 's'}
            </span>
          </div>
        )}
        <div className="space-y-2" data-testid={isBrowserVariant ? `browser-plugin-chain-${track.trackVersionId}` : undefined}>
          {orderedTrackPlugins.length > 0 ? (
            orderedTrackPlugins.map((plugin, index) => {
              const pluginDefinition = resolvePluginDefinition(plugin);
              const pluginLabel = pluginDefinition?.displayName ?? pluginDefinition?.name ?? 'WAM plugin';
              const isDropTarget =
                pluginRackDropTarget?.trackVersionId === track.trackVersionId && pluginRackDropTarget.position === index;
              const parameterEditor = renderPluginParameterEditor(track, plugin);

              return (
                <div
                  key={plugin.instanceId}
                  className={`rounded-xl border px-3 py-2.5 transition-colors ${
                    plugin.bypassed
                      ? 'border-slate-800 bg-slate-900/70 opacity-70'
                      : 'border-slate-700 bg-slate-900/95'
                  } ${isDropTarget ? 'ring-1 ring-cyan-400/70' : ''} ${
                    isRackVariant ? 'shadow-[0_8px_20px_-16px_rgba(0,0,0,0.9)]' : ''
                  }`}
                  onDragOver={(event) => handlePluginDragOver(event, track.trackVersionId, index)}
                  onDrop={(event) => void handlePluginDrop(event, track, index)}
                >
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      draggable
                      onDragStart={(event) => handlePluginDragStart(event, track.trackVersionId, plugin.instanceId)}
                      onDragEnd={handlePluginDragEnd}
                      aria-label={`Drag ${pluginLabel}`}
                      className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-950 text-sm font-semibold text-slate-300 transition-colors hover:border-slate-500 hover:text-white active:cursor-grabbing"
                    >
                      <span aria-hidden>::</span>
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-base font-semibold leading-5 text-white">{pluginLabel}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {!plugin.bypassed ? (
                            <button
                              type="button"
                              onClick={() => void setPluginBypass(track.trackVersionId, plugin.instanceId, true)}
                              aria-label={`Bypass ${pluginLabel}`}
                              className="rounded-full border border-slate-700 bg-slate-950/70 px-2 py-1 text-[10px] font-semibold text-slate-300 transition-colors hover:border-slate-500 hover:text-white"
                            >
                              Bypass
                            </button>
                          ) : (
                            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] font-semibold text-amber-200">
                              Bypassed
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => void removePlugin(track.trackVersionId, plugin.instanceId)}
                            aria-label={`Remove ${pluginLabel} from ${track.trackName}`}
                            className="rounded-full border border-slate-700 bg-slate-950/70 px-2 py-1 text-[10px] font-semibold text-rose-200 transition-colors hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-100"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                  {parameterEditor ? (
                    <div className="mt-3 rounded-lg border border-slate-800/80 bg-slate-950/60 p-2">{parameterEditor}</div>
                  ) : null}
                </div>
              );
            })
          ) : (
            <p className="rounded-lg border border-dashed border-slate-800 px-3 py-3 text-[10px] text-slate-500">
              No inserts on this track yet.
            </p>
          )}
          <div
            className={`h-2 rounded ${
              pluginRackDropTarget?.trackVersionId === track.trackVersionId &&
              pluginRackDropTarget.position === orderedTrackPlugins.length
                ? 'bg-cyan-400/40'
                : 'bg-transparent'
            }`}
            onDragOver={(event) => handlePluginDragOver(event, track.trackVersionId, orderedTrackPlugins.length)}
            onDrop={(event) => void handlePluginDrop(event, track, orderedTrackPlugins.length)}
            aria-hidden
          />
        </div>
      </div>
    );
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function normalizePluginParameters(parameterSchema: unknown): ResolvedPluginParameter[] {
    const rawDefinitions: unknown[] = Array.isArray(parameterSchema)
      ? parameterSchema
      : isRecord(parameterSchema) && Array.isArray(parameterSchema.parameters)
        ? parameterSchema.parameters
        : isRecord(parameterSchema) && Array.isArray(parameterSchema.controls)
          ? parameterSchema.controls
          : [];

    return rawDefinitions.flatMap((definition): ResolvedPluginParameter[] => {
      if (!isRecord(definition)) return [];
      const id = typeof definition.id === 'string' ? definition.id.trim() : '';
      if (!id) return [];

      const label =
        (typeof definition.label === 'string' && definition.label.trim()) ||
        (typeof definition.name === 'string' && definition.name.trim()) ||
        id;
      const unit = typeof definition.unit === 'string' && definition.unit.trim() ? definition.unit.trim() : undefined;
      const min =
        typeof definition.min === 'number'
          ? definition.min
          : isRecord(definition.range) && typeof definition.range.min === 'number'
            ? definition.range.min
            : undefined;
      const max =
        typeof definition.max === 'number'
          ? definition.max
          : isRecord(definition.range) && typeof definition.range.max === 'number'
            ? definition.range.max
            : undefined;
      const step =
        typeof definition.step === 'number'
          ? definition.step
          : isRecord(definition.range) && typeof definition.range.step === 'number'
            ? definition.range.step
            : undefined;
      const isToggle =
        definition.type === 'boolean' ||
        definition.type === 'toggle' ||
        typeof definition.default === 'boolean';
      const defaultValue = isToggle
        ? Boolean(definition.default)
        : typeof definition.default === 'number'
          ? definition.default
          : min ?? 0;

      return [
        {
          id,
          label,
          type: isToggle ? 'toggle' : 'slider',
          min: isToggle ? 0 : min ?? 0,
          max: isToggle ? 1 : max ?? 1,
          step: isToggle ? 1 : step ?? 0.01,
          unit,
          defaultValue,
        },
      ];
    });
  }

  function beginPluginDrag(trackVersionId: string, instanceId: string) {
    pluginRackDragRef.current = { trackVersionId, instanceId };
    setPluginRackDropTarget(null);
  }

  function cancelPluginDrag() {
    pluginRackDragRef.current = null;
    setPluginRackDropTarget(null);
  }

  async function commitPluginReorder(trackVersionId: string, instanceId: string, position: number) {
    const result = await reorderPlugin(trackVersionId, instanceId, position);
    cancelPluginDrag();
    return result;
  }

  function handlePluginDragStart(
    event: DragEvent<HTMLButtonElement>,
    trackVersionId: string,
    instanceId: string,
  ) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', instanceId);
    beginPluginDrag(trackVersionId, instanceId);
  }

  function handlePluginDragOver(
    event: DragEvent<HTMLElement>,
    trackVersionId: string,
    position: number,
  ) {
    if (pluginRackDragRef.current?.trackVersionId !== trackVersionId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setPluginRackDropTarget({ trackVersionId, position });
  }

  async function handlePluginDrop(
    event: DragEvent<HTMLElement>,
    track: DawTrack,
    position: number,
  ) {
    event.preventDefault();
    event.stopPropagation();

    const drag = pluginRackDragRef.current;
    if (!drag || drag.trackVersionId !== track.trackVersionId) {
      cancelPluginDrag();
      return;
    }

    const orderedPlugins = getOrderedTrackPlugins(track);
    const sourceIndex = orderedPlugins.findIndex((plugin) => plugin.instanceId === drag.instanceId);
    if (
      sourceIndex === -1 ||
      sourceIndex === position ||
      (sourceIndex === orderedPlugins.length - 1 && position === orderedPlugins.length)
    ) {
      cancelPluginDrag();
      return;
    }

    await commitPluginReorder(track.trackVersionId, drag.instanceId, position);
  }

  function handlePluginDragEnd() {
    cancelPluginDrag();
  }

  function renderPluginParameterEditor(track: DawTrack, plugin: DawTrack['plugins'][number]) {
    const pluginDefinition = resolvePluginDefinition(plugin);
    const parameters = normalizePluginParameters(pluginDefinition?.parameterSchema);
    if (parameters.length === 0) return null;

    return (
      <div className="mt-2 space-y-2 rounded border border-slate-800 bg-slate-950/70 p-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Parameters</p>
        <div className="space-y-2">
          {parameters.map((parameter) => {
            const currentValue = plugin.params[parameter.id];
            const normalizedValue =
              typeof currentValue === 'number'
                ? currentValue
                : typeof parameter.defaultValue === 'boolean'
                  ? parameter.defaultValue
                    ? 1
                    : 0
                  : parameter.defaultValue;

            if (parameter.type === 'toggle') {
              const isEnabled = normalizedValue >= 0.5;
              return (
                <label key={parameter.id} className="flex items-center justify-between gap-3 rounded bg-slate-900/60 px-2 py-1.5 text-[11px] text-slate-200">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-white">{parameter.label}</span>
                    {parameter.unit ? <span className="text-[10px] text-slate-500">{parameter.unit}</span> : null}
                  </span>
                  <input
                    type="checkbox"
                    checked={isEnabled}
                    onChange={(event) =>
                      void setPluginParam(track.trackVersionId, plugin.instanceId, parameter.id, event.currentTarget.checked ? 1 : 0)
                    }
                    aria-label={`${parameter.label} toggle`}
                    className="h-4 w-4 accent-cyan-500"
                  />
                </label>
              );
            }

            const sliderValue = Number.isFinite(Number(normalizedValue)) ? Number(normalizedValue) : 0;
            return (
              <label key={parameter.id} className="flex flex-col gap-1 rounded bg-slate-900/60 px-2 py-1.5 text-[11px] text-slate-200">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-medium text-white">{parameter.label}</span>
                  <span className="shrink-0 text-[10px] text-slate-500">
                    {sliderValue.toFixed(2)}
                    {parameter.unit ? ` ${parameter.unit}` : ''}
                  </span>
                </div>
                <input
                  type="range"
                  min={parameter.min ?? 0}
                  max={parameter.max ?? 1}
                  step={parameter.step ?? 0.01}
                  value={sliderValue}
                  onChange={(event) =>
                    void setPluginParam(track.trackVersionId, plugin.instanceId, parameter.id, Number(event.currentTarget.value))
                  }
                  aria-label={parameter.label}
                  className="h-1 w-full accent-cyan-500"
                />
              </label>
            );
          })}
        </div>
      </div>
    );
  }

  function beginTrackDrag(track: DawTrack, startX: number) {
    setSelectedTrackVersionId(track.trackVersionId);
    dragRef.current = {
      kind: 'track',
      trackVersionId: track.trackVersionId,
      originalStartOffsetMs: getTrackStartOffsetMs(track),
      currentStartOffsetMs: getTrackStartOffsetMs(track),
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
      originalTimelineEndMs: segment.timelineEndMs,
      currentTimelineStartMs: segment.timelineStartMs,
      originalSegments: getSegmentDragOriginalSegments(
        segment,
        getDisplayedTrackSegments(track),
        getRenderableTrackSegments(track),
      ),
      startX,
    };
  }

  function updateTrackDrag(trackVersionId: string, nextStartOffsetMs: number) {
    if (dragRef.current?.kind === 'track' && dragRef.current.trackVersionId === trackVersionId) {
      dragRef.current = updateTrackDragState(dragRef.current, nextStartOffsetMs);
    }
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
    if (dragRef.current?.kind === 'segment' && dragRef.current.trackVersionId === trackVersionId && dragRef.current.segmentId === segmentId) {
      dragRef.current = updateSegmentDragState(dragRef.current, nextTimelineStartMs);
    }
    setTrackSegmentLayout(trackVersionId, nextSegments);
  }

  function getTrackRowFromPoint(clientX: number, clientY: number) {
    const element = document.elementFromPoint(clientX, clientY);
    return element?.closest<HTMLElement>('[data-track-version-id]') ?? null;
  }

  function clearSegmentDragPreview(drag: Extract<TimelineDragState, { kind: 'segment' }>) {
    setSegmentLayoutOverrides((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, drag.trackVersionId)) {
        return prev;
      }

      const next = { ...prev };
      delete next[drag.trackVersionId];
      return next;
    });
  }

  async function commitTrackDrag(track: DawTrack) {
    const drag = dragRef.current;
    if (!drag || drag.kind !== 'track' || drag.trackVersionId !== track.trackVersionId) return;

    dragRef.current = null;
    const finalOffset = getTrackDragCommitOffset(drag);

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

  async function commitSegmentDrag(track: DawTrack, dropTrackVersionId: string) {
    console.log('[DemoDawClient] commitSegmentDrag', {
      sourceTrackVersionId: track.trackVersionId,
      dropTrackVersionId,
      dragKind: dragRef.current?.kind ?? null,
      dragTrackVersionId: dragRef.current?.trackVersionId ?? null,
      dragSegmentId: dragRef.current?.kind === 'segment' ? dragRef.current.segmentId : null,
    });
    const drag = dragRef.current;
    if (!drag || drag.trackVersionId !== track.trackVersionId || drag.kind !== 'segment') return;

    const durationMs = Math.max(0, drag.originalTimelineEndMs - drag.originalTimelineStartMs);
    const previewTimelineStartMs = getSegmentDragCommitTimelineStartMs(drag);
    const previousSelectedTrackVersionId = selectedTrackVersionId;
    const previousSelectedSegmentId = selectedSegmentId;
    const previousSourceSegments = drag.originalSegments;
    const previousVersion =
      projectSyncEngine.getState().projectState?.versions.find((version) => version.id === selectedVersionId) ?? null;
    const targetTrack =
      previousVersion?.tracks.find((candidate) => candidate.trackVersionId === dropTrackVersionId) ??
      selectedTracks.find((candidate) => candidate.trackVersionId === dropTrackVersionId) ??
      null;
    const previousTargetSegments = targetTrack ? getDisplayedTrackSegments(targetTrack) : [];
    const isCrossTrackMove = dropTrackVersionId !== drag.trackVersionId;

    dragRef.current = null;
    clearSegmentDragPreview(drag);
    setSelectedTrackVersionId(dropTrackVersionId);
    setSelectedSegmentId(drag.segmentId);

    if (!isCrossTrackMove && previewTimelineStartMs === drag.originalTimelineStartMs) return;

    try {
      const acceptedOperation = await commitEditingOperation(
        audioEditingEngine.moveSegment({
          segmentId: drag.segmentId,
          isImplicit:
            previousSourceSegments.find((candidate) => candidate.id === drag.segmentId)?.isImplicit === true,
          fromTrackVersionId: track.trackVersionId,
          toTrackVersionId: dropTrackVersionId,
          fromTimelineStartMs: drag.originalTimelineStartMs,
          fromTimelineEndMs: drag.originalTimelineEndMs,
          toTimelineStartMs: previewTimelineStartMs,
          toTimelineEndMs: previewTimelineStartMs + durationMs,
        }),
      );
      const committedSegmentId = (acceptedOperation.payload as { segmentId: string }).segmentId;
      setSelectedSegmentId(committedSegmentId);

      if (isCrossTrackMove) {
        const movedSegment = previousSourceSegments.find((candidate) => candidate.id === drag.segmentId) ?? null;
        if (movedSegment) {
          const historySourceSegments = previousSourceSegments.map((candidate) =>
            candidate.id === drag.segmentId
              ? { ...candidate, id: committedSegmentId, isImplicit: false }
              : candidate,
          );
          const nextSourceSegments = previousSourceSegments
            .filter((candidate) => candidate.id !== drag.segmentId)
            .map((candidate, index) => ({ ...candidate, position: index }));
          const nextTargetSegments = [
            ...previousTargetSegments.filter((candidate) => candidate.id !== drag.segmentId),
            {
              ...movedSegment,
              id: committedSegmentId,
              isImplicit: false,
              trackVersionId: dropTrackVersionId,
              timelineStartMs: previewTimelineStartMs,
              timelineEndMs: previewTimelineStartMs + durationMs,
              position: previousTargetSegments.length,
            },
          ].map((candidate, index) => ({ ...candidate, position: index }));

          pushTimelineHistory({
            kind: 'move-segment-track',
            sourceTrackVersionId: drag.trackVersionId,
            targetTrackVersionId: dropTrackVersionId,
            segmentId: committedSegmentId,
            previousSourceSegments: historySourceSegments,
            previousTargetSegments,
            nextSourceSegments,
            nextTargetSegments,
            previousSelectedTrackVersionId,
            previousSelectedSegmentId:
              previousSelectedSegmentId === drag.segmentId
                ? committedSegmentId
                : previousSelectedSegmentId,
          });
        }
      } else {
        pushTimelineHistory({
          kind: 'move-segment',
          trackVersionId: track.trackVersionId,
          segmentId: committedSegmentId,
          previousTimelineStartMs: drag.originalTimelineStartMs,
          nextTimelineStartMs: previewTimelineStartMs,
        });
      }
    } catch (error) {
      clearSegmentDragPreview(drag);
      setSelectedTrackVersionId(previousSelectedTrackVersionId);
      setSelectedSegmentId(previousSelectedSegmentId);
      setDragError(error instanceof Error ? error.message : 'Something went wrong saving segment position');
    }
  }

  function cancelTimelineDrag() {
    const drag = dragRef.current;
    if (!drag) return;

    if (drag.kind === 'track') {
      updateTrackDrag(drag.trackVersionId, drag.originalStartOffsetMs);
    } else {
      clearSegmentDragPreview(drag);
    }

    dragRef.current = null;
  }

  undoLatestTimelineEditRef.current = undoLatestTimelineEdit;
  deleteSelectedClipRef.current = deleteSelectedClip;
  cancelTimelineDragRef.current = cancelTimelineDrag;

  function clearMergeSelection() {
    setPendingMergeSelection(null);
    setMergeError(null);
  }

  function clearFadeSelection() {
    setSelectedSegmentId(null);
    setFadeError(null);
    fadeDragRef.current = null;
  }

  function cancelFadeDrag() {
    const drag = fadeDragRef.current;
    if (!drag) return;

    const track = selectedTracks.find((candidate) => candidate.trackVersionId === drag.trackVersionId);
    if (track) {
      const currentSegments = getDisplayedTrackSegments(track);
      const nextSegments = currentSegments.map((segment) =>
        segment.id === drag.segmentId
          ? {
              ...segment,
              fadeInMs: drag.startFadeInMs,
              fadeOutMs: drag.startFadeOutMs,
            }
          : segment,
      );
      setTrackSegmentLayout(drag.trackVersionId, nextSegments);
    }

    fadeDragRef.current = null;
  }

  function activateTimelineTool(nextTool: 'select' | 'split' | 'merge' | 'fade') {
    clearMergeSelection();
    cancelFadeDrag();
    clearFadeSelection();

    setSplitHover(null);
    setSplitError(null);

    if (nextTool === 'merge') {
      // Merge mode is a fresh two-click workflow, so we drop any prior clip selection
      // instead of reusing it as an ambiguous first click.
      setSelectedSegmentId(null);
    }

    if (nextTool === 'fade') {
      setSelectedSegmentId(null);
    }

    setTimelineTool(nextTool);
  }

  function handleTrackPointerDown(e: React.PointerEvent<HTMLDivElement>, track: DawTrack) {
    if (timelineTool !== 'select') return;
    setSelectedTrackVersionId(track.trackVersionId);

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
    e.stopPropagation();
    setSelectedTrackVersionId(track.trackVersionId);
    if (timelineTool !== 'select') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelectedSegmentId(segment.id);
    setSplitError(null);
    beginSegmentDrag(track, segment, e.clientX);
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
    console.log('[DemoDawClient] handleSegmentPointerUp', {
      trackVersionId: track.trackVersionId,
      segmentId: segment.id,
      dragKind: drag?.kind ?? null,
      dragTrackVersionId: drag?.trackVersionId ?? null,
      dragSegmentId: drag?.kind === 'segment' ? drag.segmentId : null,
      timelineTool,
      pointerId: e.pointerId,
    });
    if (!drag || drag.trackVersionId !== track.trackVersionId) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);

    if (drag.kind === 'track') {
      await commitTrackDrag(track);
      return;
    }

    if (drag.kind !== 'segment') return;
    if (drag.segmentId !== segment.id) return;

    const dropTrackRow = getTrackRowFromPoint(e.clientX, e.clientY);
    const dropTrackVersionId = dropTrackRow?.dataset.trackVersionId ?? track.trackVersionId;

    await commitSegmentDrag(track, dropTrackVersionId);
  }

  function handleSegmentPointerCancel(track: DawTrack, segment: TrackTimelineSegment) {
    if (timelineTool !== 'select') return;
    const drag = dragRef.current;
    console.log('[DemoDawClient] handleSegmentPointerCancel', {
      trackVersionId: track.trackVersionId,
      segmentId: segment.id,
      dragKind: drag?.kind ?? null,
      dragTrackVersionId: drag?.trackVersionId ?? null,
      dragSegmentId: drag?.kind === 'segment' ? drag.segmentId : null,
    });
    if (!drag || drag.trackVersionId !== track.trackVersionId) return;
    if (drag.kind === 'segment' && drag.segmentId !== segment.id) return;
    cancelTimelineDrag();
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

  async function deleteTrack(track: DawTrack) {
    console.log('[DemoDawClient] deleteTrack', {
      trackId: track.trackId,
      trackVersionId: track.trackVersionId,
      trackName: track.trackName,
      selectedTrackVersionId,
      selectedSegmentId,
    });
    try {
      await commitEditingOperation(audioEditingEngine.deleteTrack(track.trackId));
      if (selectedTrackVersionId === track.trackVersionId) {
        setSelectedTrackVersionId(null);
      }
      if (selectedSegmentId && selectedTrackSegment?.trackVersionId === track.trackVersionId) {
        setSelectedSegmentId(null);
      }
    } catch (error) {
      setDragError(error instanceof Error ? error.message : 'Could not delete track');
    }
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

  async function handleMergeSegmentClick(track: DawTrack, clickedSegment: TrackTimelineSegment) {
    if (timelineTool !== 'merge') return;
    if (mergeSubmitting) return;

    setSelectedTrackVersionId(track.trackVersionId);

    if (!isMergeSelectableSegment(clickedSegment)) {
      setMergeError('Only saved audio clips can be merged.');
      return;
    }

    if (isSameMergeSelection(pendingMergeSelection, clickedSegment)) {
      // Re-clicking the first clip is the easiest way to back out without losing the current mode.
      clearMergeSelection();
      return;
    }

    if (!pendingMergeSelection) {
      clearMergeSelection();
      setPendingMergeSelection({
        trackVersionId: clickedSegment.trackVersionId,
        segmentId: clickedSegment.id,
      });
      setSelectedSegmentId(null);
      return;
    }

    const firstSegment = findSegmentById(pendingMergeSelection.trackVersionId, pendingMergeSelection.segmentId);
    if (!firstSegment) {
      clearMergeSelection();
      setMergeError('The first clip is no longer available. Please choose another clip.');
      return;
    }

    const mergeError = getMergeCandidateError(firstSegment, clickedSegment);
    if (mergeError) {
      setMergeError(mergeError);
      return;
    }

    const [leftSegment, rightSegment] = sortSegmentsForMerge(firstSegment, clickedSegment);
    const mergedSegment = buildMergedSegmentFromPair(leftSegment, rightSegment, {
      id: crypto.randomUUID(),
    });

    setMergeError(null);
    setMergeSubmitting(true);

    try {
      await commitEditingOperation(
        audioEditingEngine.mergeSegments({
          trackVersionId: leftSegment.trackVersionId,
          segmentIds: [leftSegment.id, rightSegment.id],
          mergedSegment,
        }),
      );
      clearMergeSelection();
      setSelectedSegmentId(null);
    } catch (error) {
      setMergeError(error instanceof Error ? error.message : 'Could not merge clips');
    } finally {
      setMergeSubmitting(false);
    }
  }

  function toggleRecordArm(trackVersionId: string) {
    setRecordArmedTrackVersionId((prev) => (prev === trackVersionId ? null : trackVersionId));
  }

  async function handleAddTrack() {
    await performUpload(
      createBlankTrackFile(),
      getNextUploadTrackName({
        liveActiveVersionId,
        selectedVersionId,
        liveActiveTracks,
        selectedTracks,
      }),
      'uploadUnchanged',
      'empty-track',
    );
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
    stopTransportClock();
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
    const recordingBounds = buildRecordingBounds({
      timelineStartMs: recordingSession.timelineStartMs,
      measuredDurationMs,
      fallbackDurationMs: wallClockDurationMs,
    });
    const previewUrl = ingestEngine.createObjectUrl(blob);
    recordingPreviewUrlRef.current = previewUrl;
    pauseTransport();
    seekTransport(recordingBounds.startOffsetMs);
    tracksScrollContainerRef.current?.scrollTo?.({
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
    bounds: RecordingBounds | null = null,
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
      buildRecordingBounds({
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
      const shouldReuseArmedTrack = Boolean(armedTrack && isBlankTrack(armedTrack));
      const recordingSourceVersionId = resolveUploadSourceVersionId({
        selectedVersionId,
        liveActiveVersionId,
        freshestCommittedVersionId: freshestCommittedVersionIdRef.current,
      });

      console.log('[DemoDawClient] handleSaveRecording source selection', {
        projectId,
        demoId,
        selectedVersionId,
        liveActiveVersionId,
        freshestCommittedVersionId: freshestCommittedVersionIdRef.current,
        isHistoryViewActive,
        targetTrackId: track.targetTrackId,
        targetTrackVersionId: track.targetTrackVersionId,
        shouldReuseArmedTrack,
        resolvedSourceVersionId: recordingSourceVersionId,
      });

      const data = await ingestEngine.uploadRecordedBlob({
        demoId,
        projectId,
        name: track.name,
        sourceVersionId: recordingSourceVersionId ?? undefined,
        trackId: shouldReuseArmedTrack ? track.targetTrackId : undefined,
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
      freshestCommittedVersionIdRef.current = data.demoVersionId;
      void projectSyncEngine.setActiveVersion(data.demoVersionId, { isFollowingHead: true });
      if (recordingPreviewUrlRef.current) {
        ingestEngine.revokeObjectUrl(recordingPreviewUrlRef.current);
        recordingPreviewUrlRef.current = null;
      }
      recordingSessionRef.current = null;
      setTemporaryRecordingTrack(null);
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

  async function performUpload(
    file: File,
    name: string,
    timingChoice: UploadTimingChoice,
    sourceType: 'upload' | 'empty-track' = 'upload',
  ) {
    setIsUploading(true);
    setUploadError(null);
    setProcessingMessage(null);
    const uploadTempoBpm = resolvedLocalTempoBpm;
    const uploadSourceVersionId = resolveUploadSourceVersionId({
      selectedVersionId,
      liveActiveVersionId,
      freshestCommittedVersionId: freshestCommittedVersionIdRef.current,
    });
    try {
      const data = (await ingestEngine.uploadAudioFile({
        demoId,
        projectId,
        name,
        sourceVersionId: uploadSourceVersionId ?? undefined,
        recordedTempoBpm: uploadTempoBpm,
        sourceTempoBpm: uploadTempoBpm,
        timingChoice,
        sourceType,
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
      freshestCommittedVersionIdRef.current = data.demoVersionId;
      void projectSyncEngine.setActiveVersion(data.demoVersionId, { isFollowingHead: true });
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
            demoVersionId: liveActiveVersionId,
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
  const canEnterMergeMode = selectedTracks.some((track) =>
    getDisplayedTrackSegments(track).filter((segment) => !segment.isImplicit).length >= 2,
  );

  return (
    <div className="relative min-h-screen bg-[#060816] text-slate-100">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.11),_transparent_34%),radial-gradient(circle_at_top_right,_rgba(14,165,233,0.09),_transparent_30%),linear-gradient(to_bottom,_rgba(15,23,42,0.94),_rgba(2,6,23,1))]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.035)_1px,transparent_1px)] bg-[size:72px_72px] opacity-25"
      />
      <div className="relative mx-auto flex min-h-screen max-w-[1760px] flex-col gap-5 px-4 pb-4">
        <div
          ref={topShellRef}
          className="sticky top-0 z-50 space-y-2 overflow-hidden rounded-b-[1.75rem] border border-slate-800/80 border-t-0 bg-slate-950/88 px-3 pb-3 pt-3 shadow-[0_20px_60px_-28px_rgba(0,0,0,0.85)] backdrop-blur-xl"
        >
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <button
                type="button"
                onClick={() => {
                  if (typeof window !== 'undefined' && window.history.length > 1) {
                    router.back();
                  } else {
                    router.push(`/groups/${groupSlug}/projects/${projectSlug}`);
                  }
                }}
                className="mt-1 inline-flex h-9 items-center justify-center rounded-full border border-slate-700 bg-slate-950/80 px-3 text-xs font-semibold text-slate-100 shadow-sm shadow-black/20 hover:bg-slate-900"
              >
                Back
              </button>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-white">{demoName}</h1>
                {demoDescription ? <p className="mt-1 max-w-3xl text-sm text-slate-300">{demoDescription}</p> : null}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsTopControlRowCollapsed((prev) => !prev)}
                className="rounded-full border border-slate-700 bg-slate-900/90 px-3 py-1.5 text-xs font-medium text-slate-200 shadow-sm shadow-black/20 hover:bg-slate-800 hover:text-white"
                aria-expanded={!isTopControlRowCollapsed}
                aria-label={isTopControlRowCollapsed ? 'Restore timing and recording controls' : 'Minimize timing and recording controls'}
              >
                {isTopControlRowCollapsed ? 'Restore' : 'Minimize'}
              </button>
            </div>
          </header>

          {!isTopControlRowCollapsed ? (
            <div className="grid gap-2 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
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
                    microphoneSelector={
                      <AudioInputSelector
                        selectedAudioInputDeviceId={selectedAudioInputDeviceId}
                        onSelectedAudioInputDeviceIdChange={setSelectedAudioInputDeviceId}
                        isAudioInputReady={audioInputReady}
                        onAudioInputReadyChange={setAudioInputReady}
                      />
                    }
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
          ) : null}
        </div>

          {pluginGraphIssue ? (
            <div
              role="status"
              className={`rounded-xl border px-4 py-3 text-sm ${
                pluginGraphIssue.severity === 'error'
                  ? 'border-rose-500/40 bg-rose-500/10 text-rose-100'
                  : 'border-amber-500/40 bg-amber-500/10 text-amber-100'
              }`}
            >
              <p className="font-semibold">
                {pluginGraphIssue.severity === 'error' ? 'Plugin chain error' : 'Plugin chain warning'}
              </p>
              <p className="mt-1 text-xs opacity-90">{pluginGraphIssue.message}</p>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(280px,0.72fr)_minmax(0,1.58fr)_minmax(280px,0.7fr)] lg:items-stretch">
            <aside
              className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-950/80 shadow-[0_18px_60px_-36px_rgba(0,0,0,0.85)] backdrop-blur"
              data-testid="browser-rail"
            >
            <div className="border-b border-slate-800/80 bg-slate-950/40 px-4 py-4">
              <h2 className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-200">Browser</h2>
            </div>
            <div className="flex flex-wrap gap-2 border-b border-slate-800 px-4 py-3">
              {([
                ['upload', 'Upload'],
                ['plugins', 'Plugins'],
                ['members', 'Members'],
              ] as const).map(([id, label]) => {
                const isActive = browserTab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setBrowserTab(id);
                      setToolbarTab(id);
                    }}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                      isActive
                        ? 'bg-cyan-500/20 text-cyan-100 ring-1 ring-cyan-500/40'
                        : 'bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                    }`}
                    aria-pressed={isActive}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-4">
              {browserTab === 'upload' ? (
                <form onSubmit={onUploadTrack} className="space-y-5">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-white">Upload audio</p>
                    <p className="text-xs text-slate-400">Name the track, choose a file, then send it into the demo.</p>
                  </div>

                  <label className="block space-y-1.5">
                    <span className="block text-[10px] uppercase tracking-[0.18em] text-slate-400">Track name</span>
                    <input
                      type="text"
                      value={uploadName}
                      onChange={(e) => setUploadName(e.currentTarget.value)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-3 text-sm text-white outline-none transition-colors ring-indigo-500 placeholder:text-slate-500 focus:border-slate-500 focus:ring"
                      placeholder="Lead Vocal"
                    />
                  </label>

                  <div className="space-y-1.5">
                    <span className="block text-[10px] uppercase tracking-[0.18em] text-slate-400">Audio file</span>
                    <label className="flex cursor-pointer flex-col gap-3 rounded-xl border border-slate-700 bg-slate-950/80 p-3 transition-colors hover:border-slate-600 hover:bg-slate-900/80">
                      <div className="flex items-center gap-3">
                        <span className="inline-flex rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-500">
                          Choose file
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm text-slate-300">
                          {uploadFile ? uploadFile.name : 'No file selected'}
                        </span>
                      </div>
                      <input
                        type="file"
                        accept="audio/*"
                        onChange={(e) => handleUploadFilePicked(e.currentTarget.files?.[0] ?? null)}
                        className="sr-only"
                      />
                    </label>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="submit"
                      disabled={isUploading}
                      className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_10px_20px_rgba(79,70,229,0.28)] transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
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

              {browserTab === 'plugins' ? (
                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-semibold text-white">Plugins</p>
                    <p className="mt-1 text-xs text-slate-400">
                      Add a plugin to the selected track to emit a `PLUGIN_ADDED` commit.
                    </p>
                  </div>
                  {selectedTrack ? (
                    <section className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
                      {renderPluginChain(selectedTrack, { variant: 'browser' })}
                    </section>
                  ) : (
                    <p className="rounded-xl border border-dashed border-slate-800 px-3 py-3 text-xs text-slate-500">
                      Select a track to edit its insert chain here.
                    </p>
                  )}
                  {filteredPluginDefinitions.length > 0 ? (
                    <ul className="grid gap-2">
                      {filteredPluginDefinitions.map((plugin) => (
                        <li key={plugin.id} className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-white">{plugin.name}</p>
                              <p className="text-xs text-slate-400">
                                {plugin.manufacturer ?? 'Unknown maker'} · {plugin.version}
                              </p>
                            </div>
                            <button
                              type="button"
                              disabled={!selectedTrack}
                              onClick={() => void addPluginToSelectedTrack(plugin)}
                              className="shrink-0 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 text-xs font-semibold text-cyan-100 transition-colors hover:border-cyan-400 hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900 disabled:text-slate-500"
                              aria-label={`Add ${plugin.name} to selected track`}
                            >
                              Add
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-slate-400">No plugins match the current filter.</p>
                  )}
                </div>
              ) : null}

              {browserTab === 'members' ? (
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-semibold text-white">Members</p>
                  </div>
                  {filteredPresenceRecords.length > 0 ? (
                    <div className="grid gap-2">
                      {filteredPresenceRecords.map((presence) => (
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
                  ) : null}
                </div>
              ) : null}
            </div>
          </aside>
          {/* Size containment keeps graph content out of the grid's intrinsic row sizing. */}
          <div
            className="flex h-[32rem] min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-950/80 shadow-[0_18px_60px_-36px_rgba(0,0,0,0.85)] backdrop-blur lg:h-auto lg:[contain:size]"
            data-testid="version-history-column"
          >
            <section
              className="flex h-full min-h-0 flex-col overflow-hidden border-t border-slate-800/80 bg-slate-950/90 px-4 py-4"
              data-testid="version-tree-rail"
            >
              <div className="flex min-h-0 flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-200">Version history</h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 rounded-full border border-slate-800 bg-slate-950/85 px-2 py-1 shadow-lg backdrop-blur">
                      <button
                        type="button"
                        onClick={() => updateVersionHistoryZoom((current) => current - 0.125)}
                        aria-label="Zoom out version history"
                        className="rounded-full border border-slate-700 px-2.5 py-1 text-xs font-semibold text-slate-200 transition-colors hover:border-slate-500 hover:text-white"
                      >
                        -
                      </button>
                      <button
                        type="button"
                        onClick={() => updateVersionHistoryZoom(1)}
                        aria-label="Reset version history zoom"
                        className="min-w-14 rounded-full border border-slate-700 px-3 py-1 text-xs font-semibold text-slate-200 transition-colors hover:border-slate-500 hover:text-white"
                      >
                        {Math.round(versionHistoryZoomLevel * 100)}%
                      </button>
                      <button
                        type="button"
                        onClick={() => updateVersionHistoryZoom((current) => current + 0.125)}
                        aria-label="Zoom in version history"
                        className="rounded-full border border-slate-700 px-2.5 py-1 text-xs font-semibold text-slate-200 transition-colors hover:border-slate-500 hover:text-white"
                      >
                        +
                      </button>
                    </div>
                    {toolbarTab === 'tree' ? (
                      <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[10px] font-semibold text-cyan-200">
                        Focused
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        versionTreeRailShouldPersistRef.current = true;
                        setIsVersionTreeRailExpanded((prev) => !prev);
                      }}
                      className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-[11px] font-semibold text-slate-200 transition-colors hover:bg-slate-800 hover:text-white"
                      aria-expanded={isVersionTreeRailExpanded}
                      aria-label={isVersionTreeRailExpanded ? 'Collapse version history rail' : 'Expand version history rail'}
                    >
                      {isVersionTreeRailExpanded ? 'Collapse rail' : 'Expand rail'}
                    </button>
                  </div>
                </div>
              </div>
              <div
                className={`mt-4 min-h-0 flex-1 rounded-xl border border-slate-800/70 bg-slate-950/70 ${
                  isVersionTreeRailExpanded ? 'flex flex-col overflow-hidden' : 'max-h-0 overflow-hidden'
                }`}
              >
                <div className="flex min-h-0 min-w-full flex-1 overflow-hidden">
                  <VersionHistoryTree
                    projectId={projectId}
                    demoId={demoId}
                    demoName={demoName}
                    baseOperationSeq={displayProjectState?.lastVersionOperationSeq ?? projectSyncState.lastSyncedOperationSeq}
                    liveVersions={liveVersions}
                    operationHistory={liveProjectState?.operationHistory ?? []}
                    currentVersionId={liveBranchHeadVersionId}
                    activeVersionId={liveActiveVersionId}
                    selectedVersionId={selectedVersionId}
                    zoomLevel={versionHistoryZoomLevel}
                    scrollResetSignal={versionHistoryScrollResetSignal}
                    isFollowingHead={isFollowingHead}
                    isHistoryViewActive={isHistoryViewActive}
                    highlightedVersionId={projectSyncState.versionTreeAttention?.versionId ?? null}
                    highlightedVersionCreatedAt={projectSyncState.versionTreeAttention?.createdAt ?? null}
                    userDisplayNamesById={
                      displayProjectState?.userDisplayNamesById ?? liveProjectState?.userDisplayNamesById ?? {}
                    }
                    onSelectVersion={(id) => {
                      setSelectedVersionId(id);
                      stopTransport();
                      void projectSyncEngine.setActiveVersion(id, { isFollowingHead: true });
                    }}
                  />
                </div>
              </div>
              {!isVersionTreeRailExpanded ? <div className="mt-3" /> : null}
            </section>
          </div>

          <aside
            className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-950/80 shadow-[0_18px_60px_-36px_rgba(0,0,0,0.85)] backdrop-blur"
            data-testid="inspector-rail"
          >
            <div className="border-b border-slate-800/80 bg-slate-950/40 px-4 py-4">
              <h2 className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-200">Inspector</h2>
            </div>
            <div ref={inspectorScrollRef} className="flex-1 min-h-0 space-y-4 overflow-y-auto p-4">
              <section
                className={`space-y-3 rounded-lg border px-4 py-4 ${
                  addCommentModalOpen ? 'border-cyan-500/30 bg-cyan-500/10' : 'border-slate-800 bg-slate-950'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">Comments</p>
                  </div>
                  <button
                    type="button"
                    onClick={openAddCommentModal}
                    className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold text-cyan-200 transition-colors hover:bg-cyan-500/20 hover:text-cyan-100"
                  >
                    {addCommentModalOpen ? 'Draft' : 'New'}
                  </button>
                </div>

                <div className="rounded-md border border-slate-800 bg-slate-900/80 px-3 py-2 text-xs text-slate-300">
                  <p className="mt-1 text-sm font-medium text-slate-100">{inspectorCommentTimestampLabel}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setAddCommentTimestampMs(currentTimeMs)}
                      className="rounded-md bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
                    >
                      Use playhead
                    </button>
                    {selectedTrack ? (
                      <button
                        type="button"
                        onClick={() => setAddCommentTrackId(selectedTrack.trackId)}
                        className="rounded-md bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
                      >
                        Track
                      </button>
                    ) : null}
                  </div>
                </div>

                <label className="block space-y-1">
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

                <CommentInput
                  value={addCommentBody}
                  submitting={addCommentSubmitting}
                  error={addCommentError}
                  onChange={setAddCommentBody}
                  onSubmit={() => void submitAddComment()}
                  onCancel={closeAddCommentModal}
                />
              </section>
            </div>
          </aside>
        </div>

      {uploadModalState.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-lg border border-gray-700 bg-gray-950 p-5 shadow-2xl">
            <h3 className="text-base font-semibold text-white">Choose upload timing</h3>
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
            <div className="mt-4 rounded-md border border-gray-800 bg-gray-900 px-3 py-2">
              <p className="text-2xl font-semibold text-white">{tempoAnalysisPrompt.tempoBpm.toFixed(1)} BPM</p>
            </div>
            <div className="mt-4 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setTempoAnalysisPrompt(null)}
                className="text-sm text-gray-400 hover:text-gray-200"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {dragError ? (
        <p className="text-sm text-red-400">{dragError}</p>
      ) : null}

      <section className="space-y-4">
        <div ref={toolsStickySentinelRef} aria-hidden="true" className="h-px" />
        <div
          ref={toolsBarRef}
          className="sticky z-30 rounded-2xl border border-slate-800/80 bg-slate-950/92 px-4 py-4 shadow-[0_18px_60px_-36px_rgba(0,0,0,0.85)] backdrop-blur-xl"
          style={toolsStickyTop > 0 ? { top: `${toolsStickyTop}px` } : undefined}
        >
          <div className="flex flex-col items-start gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-200">Tools</p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  activateTimelineTool('select');
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
                  activateTimelineTool('split');
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
                onClick={() => activateTimelineTool(timelineTool === 'merge' ? 'select' : 'merge')}
                disabled={!canEnterMergeMode}
                title={
                  !canEnterMergeMode
                    ? 'Add or upload at least two saved clips on a track before using Merge'
                    : mergeSubmitting
                      ? 'Submitting merge request'
                      : timelineTool === 'merge'
                        ? 'Leave merge mode'
                        : 'Click two compatible clips on the same track to merge them'
                }
                className={`rounded-md px-3 py-2 text-sm font-medium ${
                  timelineTool === 'merge'
                    ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                    : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
                } disabled:cursor-not-allowed disabled:opacity-40`}
              >
                Merge
              </button>
              <button
                type="button"
                onClick={() => activateTimelineTool(timelineTool === 'fade' ? 'select' : 'fade')}
                title={timelineTool === 'fade' ? 'Leave fade mode' : 'Click a clip, then drag the top dot inward'}
                className={`rounded-md px-3 py-2 text-sm font-medium ${
                  timelineTool === 'fade'
                    ? 'bg-cyan-600 text-white hover:bg-cyan-500'
                    : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
                }`}
              >
                Fade
              </button>
              <button
                type="button"
                onClick={() => void undoLatestTimelineEditRef.current()}
                className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800"
              >
                Undo
              </button>
              <label className="flex items-center gap-2 text-sm text-slate-300">
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
          </div>
          {timelineTool === 'merge' ? (
            <div className="mt-3 space-y-1 text-xs">
              {mergeSubmitting ? <p className="text-amber-300">Submitting merge request...</p> : null}
              {mergeError ? <p className="text-rose-300">{mergeError}</p> : null}
              {!mergeSubmitting && !mergeError && pendingMergeSelection ? (
                <p className="text-emerald-300">
                  First clip selected. Click a second compatible clip on the same track, or press Escape to cancel.
                </p>
              ) : null}
              {!mergeSubmitting && !mergeError && !pendingMergeSelection ? (
                <p className="text-slate-500">Select two clips to merge.</p>
              ) : null}
            </div>
          ) : null}
          {timelineTool === 'fade' ? (
            <div className="mt-3 space-y-1 text-xs">
              {fadeError ? <p className="text-rose-300">{fadeError}</p> : null}
            </div>
          ) : null}
        </div>

        <div
          aria-hidden="true"
          className="shrink-0"
          style={{ height: isToolsBarStuck ? `${toolsBarHeight}px` : 0 }}
        />

        <div className="space-y-4">
        <section className="min-w-0 space-y-3 rounded-2xl border border-slate-800/80 bg-slate-950/80 p-4 shadow-[0_18px_60px_-36px_rgba(0,0,0,0.85)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-200">Timeline</h2>
            <button
              type="button"
              onClick={openAddCommentModal}
              className="rounded-md bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500"
            >
              Add Comment
            </button>
          </div>
          <div className="flex items-center gap-3 text-xs">{splitError ? <p className="text-amber-300">{splitError}</p> : null}</div>

          {hasTimelineContent ? (
            <div ref={tracksScrollContainerRef} className="overflow-x-auto rounded-xl border border-slate-800/80">
              <div className="flex" style={{ minWidth: TRACK_LABEL_WIDTH + totalTimelineWidth }}>
                <div
                  className="shrink-0 border-b border-r border-slate-800/80 bg-slate-900/90"
                  style={{ width: TRACK_LABEL_WIDTH }}
                />
                <div
                  className="shrink-0 overflow-hidden border-b border-slate-800/80"
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
                <div className="relative border-b border-slate-800/80 bg-slate-950" style={{ minWidth: TRACK_LABEL_WIDTH + totalTimelineWidth, height: 28 }}>
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
                const isMergeToolActive = timelineTool === 'merge';
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
                const trackIsBlank = trackSegments.length === 0 && trackRecording === null;
                const blankTrackTicks = trackIsBlank ? getTimelineTicks(totalDurationMs, selectedTiming) : [];

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
                                <button
                                  type="button"
                                  onClick={() => void deleteTrack(track)}
                                  title="Delete track"
                                  aria-label={`Delete track ${track.trackName}`}
                                  className="shrink-0 text-rose-500 transition-colors hover:text-rose-300"
                                >
                                  <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                                    <path d="M6.5 1.5a1 1 0 0 0-.9.55L5.01 3H2.5a.5.5 0 0 0 0 1h.68l.74 9.06A2 2 0 0 0 5.91 15h4.18a2 2 0 0 0 1.99-1.94L12.82 4h.68a.5.5 0 0 0 0-1h-2.51l-.59-.95a1 1 0 0 0-.9-.55h-3zm.42 1h2.16l.25.5H6.67l.25-.5zM6.5 6a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-1 0v-5A.5.5 0 0 1 6.5 6zm3 0a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-1 0v-5a.5.5 0 0 1 .5-.5z" />
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

                          {track.plugins.length > 0 ? (
                            <div className="space-y-1.5">
                              <button
                                type="button"
                                onClick={() => toggleTrackPluginRack(track.trackVersionId)}
                                aria-expanded={isTrackPluginRackExpanded(track.trackVersionId)}
                                aria-controls={`track-plugin-chain-${track.trackVersionId}`}
                                aria-label={
                                  isTrackPluginRackExpanded(track.trackVersionId)
                                    ? `Hide plugins on ${track.trackName}`
                                    : `Show plugins on ${track.trackName}`
                                }
                                className="flex w-full items-center justify-between gap-2 rounded-md border border-slate-800/80 bg-slate-950/70 px-2.5 py-1.5 text-left transition-colors hover:border-slate-700 hover:bg-slate-900/80"
                              >
                                <span className="min-w-0">
                                  <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-300">
                                    Plugins
                                  </span>
                                  <span className="mt-0.5 block text-[10px] text-slate-500">
                                    {isTrackPluginRackExpanded(track.trackVersionId)
                                      ? 'Hide insert chain'
                                      : 'Hidden by default'}
                                  </span>
                                </span>
                                <span className="flex shrink-0 items-center gap-2">
                                  <span className="rounded-full border border-slate-700 bg-slate-900/80 px-2 py-0.5 text-[10px] font-medium text-slate-300">
                                    {track.plugins.length}
                                  </span>
                                  <svg
                                    width="10"
                                    height="10"
                                    viewBox="0 0 10 10"
                                    fill="none"
                                    aria-hidden="true"
                                    className={`text-slate-400 transition-transform ${
                                      isTrackPluginRackExpanded(track.trackVersionId) ? 'rotate-180' : ''
                                    }`}
                                  >
                                    <path
                                      d="M2 3.5L5 6.5L8 3.5"
                                      stroke="currentColor"
                                      strokeWidth="1.4"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                </span>
                              </button>
                              {isTrackPluginRackExpanded(track.trackVersionId) ? (
                                <div
                                  id={`track-plugin-chain-${track.trackVersionId}`}
                                  data-testid={`track-plugin-chain-${track.trackVersionId}`}
                                >
                                  {renderPluginChain(track)}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
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

                      {trackIsBlank && blankTrackTicks.length > 0 ? (
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
                        const isPendingMerge =
                          pendingMergeSelection?.trackVersionId === track.trackVersionId &&
                          pendingMergeSelection.segmentId === segment.id;
                        const isMergeSelectable = isMergeToolActive && isMergeSelectableSegment(segment);
                        const isFadeSelected =
                          timelineTool === 'fade' &&
                          selectedTrackVersionId === track.trackVersionId &&
                          selectedSegmentId === segment.id;
                        const isFadeSelectable = timelineTool === 'fade' && isFadeSelectableSegment(segment);
                        const isDraggingSegment =
                          dragRef.current?.kind === 'segment' && dragRef.current.segmentId === segment.id;
                        const isDraggingImplicitTrack =
                          dragRef.current?.kind === 'track' && dragRef.current.trackVersionId === track.trackVersionId;
                        const segmentAudioSource = selectSegmentAudioSource(
                          track,
                          segment,
                          selectedTracks,
                        );

                        return (
                          <TrackSegmentClip
                            key={segment.id}
                            trackVersionId={track.trackVersionId}
                            segment={segment}
                            storageKey={segmentAudioSource.storageKey}
                            mimeType={segmentAudioSource.mimeType}
                            isSelected={isSelected}
                            isPendingMerge={isPendingMerge}
                            isFadeSelected={isFadeSelected}
                            isMuted={isMuted}
                            isDragging={isDraggingSegment || isDraggingImplicitTrack}
                            timelineTool={timelineTool}
                            isMergeSelectable={isMergeSelectable}
                            isFadeSelectable={isFadeSelectable}
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
                            onFadeHandlePointerDown={(edge, event) =>
                              handleFadeHandlePointerDown(track, segment, edge, event)
                            }
                            onFadeHandlePointerMove={(edge, event) =>
                              handleFadeHandlePointerMove(track, segment, edge, event)
                            }
                            onFadeHandlePointerUp={(edge, event) =>
                              void handleFadeHandlePointerUp(track, segment, edge, event)
                            }
                            onFadeHandlePointerCancel={() => {
                              if (
                                fadeDragRef.current?.trackVersionId === track.trackVersionId &&
                                fadeDragRef.current?.segmentId === segment.id
                              ) {
                                cancelFadeDrag();
                              }
                            }}
                            onClick={(event) => {
                              if (timelineTool === 'split') {
                                event.stopPropagation();
                                void handleSplitClick(event.currentTarget, event.clientX, track, segment.timelineStartMs);
                                return;
                              }
                              if (timelineTool === 'merge') {
                                event.stopPropagation();
                                void handleMergeSegmentClick(track, segment);
                                return;
                              }
                              if (timelineTool === 'fade') {
                                event.stopPropagation();
                                if (!isFadeSelectableSegment(segment)) {
                                  setFadeError('Only saved audio clips can be faded.');
                                  return;
                                }
                                setSelectedTrackVersionId(track.trackVersionId);
                                setSelectedSegmentId(segment.id);
                                setFadeError(null);
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

        <div className="rounded-2xl border border-slate-800/80 bg-slate-950/80 px-4 py-4 shadow-[0_18px_60px_-36px_rgba(0,0,0,0.85)] backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Export</p>
              <p className="mt-1 text-sm text-slate-300">Download the current mix as MP3 or export each track as its own MP3 file.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleProjectExport()}
                disabled={exportStatus !== null}
                className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-indigo-950/40 hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-700"
              >
                {exportStatus === 'project' ? 'Exporting project...' : 'Download project MP3'}
              </button>
              <button
                type="button"
                onClick={() => void handleTrackExport()}
                disabled={exportStatus !== null}
                className="rounded-full border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-800 disabled:cursor-not-allowed disabled:border-slate-800 disabled:bg-slate-900 disabled:text-slate-500"
              >
                {exportStatus === 'tracks' ? 'Exporting tracks...' : 'Download each track MP3'}
              </button>
            </div>
          </div>
          {exportError ? <p className="mt-3 text-sm text-rose-200">{exportError}</p> : null}
        </div>

        <div className="fixed bottom-4 right-4 z-[60] pointer-events-none">
          {isLocalOnlySync ? (
            <div className="max-w-xs rounded-md border border-amber-500/40 bg-amber-950/90 px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-amber-100 shadow-lg shadow-black/40 backdrop-blur">
              <p className="text-[9px] text-amber-300">Sync status</p>
              <div className="mt-1 text-[11px] font-medium tracking-normal text-amber-50">Offline / local-only</div>
              <p className="mt-1 text-[10px] normal-case tracking-normal text-amber-200/80">{localOnlyStatusText}</p>
            </div>
          ) : null}
        </div>
      </div>
      </section>
      </div>
      </div>
  );
}
