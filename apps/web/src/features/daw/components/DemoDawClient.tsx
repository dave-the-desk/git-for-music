'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type {
  CreateDemoCommentRequest,
  DemoComment as SharedDemoComment,
  DemoTimingMetadata,
  JobStatusResponse,
  SnapResolution,
  SplitSegmentRequest,
  SplitSegmentResponse,
  UploadTimingChoice,
  UploadTrackResponse,
} from '@git-for-music/shared';
import { TransportControls } from '@/features/daw/components/TransportControls';
import { TimelineRuler, PX_PER_SECOND } from '@/features/daw/components/TimelineRuler';
import { RecordingControls } from '@/features/daw/components/RecordingControls';
import { RecordingTrackLane } from '@/features/daw/components/RecordingTrackLane';
import { TrackSegmentClip, type TrackSegmentClipHandle } from '@/features/daw/components/TrackSegmentClip';
import { VersionHistoryTree } from '@/features/daw/components/VersionHistoryTree';
import { AudioInputSelector } from '@/components/daw/AudioInputSelector';
import { useDemoComments } from '@/features/daw/hooks/useDemoComments';
import { buildRenderableTrackSegments, isValidSplitTime, type TrackTimelineSegment } from '@/features/daw/utils/segments';
import {
  formatBarBeatLabel,
  getBeatSubdivisionSeconds,
  isValidTempoBpm,
  normalizeTimeSignature,
  snapMsToGrid,
} from '@/features/daw/utils/timing';
import {
  DEFAULT_SNAP,
  TICK_INTERVAL_MS,
  TRACK_HEIGHT,
  TRACK_LABEL_WIDTH,
  type CommentComposerState,
  type DawTrack,
  type DawVersion,
  type RenameState,
  type TempoAnalysisPromptState,
  type TimingFormState,
  type TemporaryRecordingTrack,
  type UploadModalState,
  formatTimeMs,
  timingFormFromVersion,
} from '@/features/daw/state/daw-state';

const DEMO_PAGE_TRACK_HEIGHT = TRACK_HEIGHT;

type TimelineHistoryEntry =
  | {
      kind: 'move-track';
      trackVersionId: string;
      previousStartOffsetMs: number;
      nextStartOffsetMs: number;
    }
  | {
      kind: 'move-segment';
      trackVersionId: string;
      segmentId: string;
      previousTimelineStartMs: number;
      nextTimelineStartMs: number;
    }
  | {
      kind: 'cut';
      trackVersionId: string;
      previousSegments: TrackTimelineSegment[];
      nextSegments: TrackTimelineSegment[];
      previousSelectedSegmentId: string | null;
    }
  | {
      kind: 'delete-segment';
      trackVersionId: string;
      previousSegments: TrackTimelineSegment[];
      nextSegments: TrackTimelineSegment[];
      previousSelectedSegmentId: string | null;
    };

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
    };

type SplitHoverState = {
  trackVersionId: string;
  timeMs: number;
} | null;

type DemoDawClientProps = {
  groupSlug: string;
  projectSlug: string;
  demoId: string;
  demoName: string;
  demoDescription: string | null;
  currentVersionId: string;
  versions: DawVersion[];
};

export function DemoDawClient({
  groupSlug,
  projectSlug,
  demoId,
  demoName,
  demoDescription,
  currentVersionId,
  versions,
}: DemoDawClientProps) {
  const router = useRouter();
  const { comments, setComments, commentsLoading, commentsError } = useDemoComments(demoId);

  const [selectedVersionId, setSelectedVersionId] = useState(currentVersionId);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [durationByTrackVersionId, setDurationByTrackVersionId] = useState<Record<string, number>>({});
  const [mutedTrackVersionIds, setMutedTrackVersionIds] = useState<Set<string>>(() => new Set());

  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadName, setUploadName] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [versionHistoryExpanded, setVersionHistoryExpanded] = useState(false);
  const [timingFormState, setTimingFormState] = useState<TimingFormState>(() =>
    timingFormFromVersion(versions.find((v) => v.id === currentVersionId)),
  );
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
  const [tempoAnalysisPrompt, setTempoAnalysisPrompt] = useState<TempoAnalysisPromptState | null>(null);
  const [processingStartedAt, setProcessingStartedAt] = useState<number | null>(null);
  const [lastProcessingAt, setLastProcessingAt] = useState<number | null>(null);

  const [temporaryRecordingTrack, setTemporaryRecordingTrack] = useState<TemporaryRecordingTrack | null>(null);
  const [recordingStream, setRecordingStream] = useState<MediaStream | null>(null);
  const [selectedAudioInputDeviceId, setSelectedAudioInputDeviceId] = useState<string | null>(null);
  const [audioInputReady, setAudioInputReady] = useState(false);
  const recordingPreviewUrlRef = useRef<string | null>(null);
  const isLiveRecordingRef = useRef(false);

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
  const [commentComposerState, setCommentComposerState] = useState<Record<string, CommentComposerState>>({});

  const clockRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startWallTimeRef = useRef<number>(0);
  const startPlayheadMsRef = useRef<number>(0);
  const tracksScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const segmentRefs = useRef<Record<string, TrackSegmentClipHandle | null>>({});
  const metronomeAudioRef = useRef<AudioContext | null>(null);
  const metronomeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const metronomeScheduledBeatRef = useRef<number | null>(null);
  const undoLatestTimelineEditRef = useRef<() => Promise<boolean>>(async () => false);
  const deleteSelectedClipRef = useRef<() => Promise<boolean>>(async () => false);
  const cancelTimelineDragRef = useRef<() => void>(() => {});
  const timelineToolRef = useRef<'select' | 'split'>('select');

  const selectedVersion = useMemo(
    () => versions.find((v) => v.id === selectedVersionId) ?? versions[0],
    [selectedVersionId, versions],
  );

  const selectedTracks = useMemo(() => {
    if (!selectedVersion) return [];
    return [...selectedVersion.tracks].sort((a, b) => a.trackPosition - b.trackPosition);
  }, [selectedVersion]);

  const activeProcessingJobs = useMemo(
    () => processingJobIds.map((id) => processingJobs[id]).filter(Boolean),
    [processingJobIds, processingJobs],
  );

  const activeTempoAnalysisJob = useMemo(() => {
    if (!tempoAnalysisPrompt) return null;
    return processingJobs[tempoAnalysisPrompt.jobId] ?? null;
  }, [processingJobs, tempoAnalysisPrompt]);

  const workerStatus = (() => {
    const activeJobs = activeProcessingJobs.filter(
      (job) => job.status === 'PENDING' || job.status === 'PROCESSING',
    );
    const hasActiveJobs = activeJobs.length > 0;
    const latestCompletedAt = lastProcessingAt;
    const now = Date.now();

    if (hasActiveJobs) {
      const stalled = processingStartedAt !== null && now - processingStartedAt > 20000;
      return {
        label: stalled ? 'Worker stalled' : 'Worker busy',
        tone: stalled ? 'red' : 'amber',
        detail: stalled
          ? 'Jobs have been waiting too long.'
          : `Processing ${activeJobs.length} job${activeJobs.length === 1 ? '' : 's'} now.`,
      };
    }

    if (latestCompletedAt !== null && now - latestCompletedAt < 60000) {
      return {
        label: 'Worker active',
        tone: 'emerald',
        detail: 'Recent jobs completed successfully.',
      };
    }

    return {
      label: 'Worker idle',
      tone: 'gray',
      detail: 'No processing jobs are currently running.',
    };
  })();

  const selectedTiming = useMemo<DemoTimingMetadata | null>(() => {
    if (!selectedVersion) return null;
    return {
      tempoBpm: selectedVersion.tempoBpm,
      timeSignature: normalizeTimeSignature({
        num: selectedVersion.timeSignatureNum,
        den: selectedVersion.timeSignatureDen,
      }),
      musicalKey: selectedVersion.musicalKey,
      tempoSource: selectedVersion.tempoSource,
      keySource: selectedVersion.keySource,
    };
  }, [selectedVersion]);

  const commentsByTrackId = useMemo(() => {
    const grouped = comments.reduce<Record<string, SharedDemoComment[]>>((acc, comment) => {
      if (!comment.trackId) return acc;
      if (!acc[comment.trackId]) acc[comment.trackId] = [];
      acc[comment.trackId]!.push(comment);
      return acc;
    }, {});

    for (const trackComments of Object.values(grouped)) {
      trackComments.sort((a, b) => {
        const aPoint = a.timestampMs ?? Number.POSITIVE_INFINITY;
        const bPoint = b.timestampMs ?? Number.POSITIVE_INFINITY;
        if (aPoint !== bPoint) return aPoint - bPoint;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });
    }

    return grouped;
  }, [comments]);

  const totalDurationMs = useMemo(() => {
    const ends = selectedTracks.flatMap((t) => {
      const dur = durationByTrackVersionId[t.trackVersionId] ?? t.durationMs ?? 0;
      const offset = offsetOverrides[t.trackVersionId] ?? t.startOffsetMs;
      const trackSegments = buildRenderableTrackSegments({
        trackVersionId: t.trackVersionId,
        trackStartOffsetMs: offset,
        segments: segmentLayoutOverrides[t.trackVersionId] ?? t.segments,
        fallbackDurationMs: dur,
      });
      return trackSegments.map((segment) => segment.timelineEndMs);
    });
    if (temporaryRecordingTrack) {
      ends.push(temporaryRecordingTrack.startOffsetMs + temporaryRecordingTrack.durationMs);
    }
    return ends.length ? Math.max(...ends) : 0;
  }, [selectedTracks, durationByTrackVersionId, offsetOverrides, segmentLayoutOverrides, temporaryRecordingTrack]);

  const totalTimelineWidth = Math.max((totalDurationMs / 1000) * PX_PER_SECOND, 400);
  const currentRecordingTrackId = temporaryRecordingTrack?.status === 'recording' ? temporaryRecordingTrack.id : null;

  useEffect(() => {
    setOffsetOverrides({});
    setSegmentLayoutOverrides({});
    setTimelineHistory([]);
    setDragError(null);
    setSelectedSegmentId(null);
    setSplitHover(null);
    setSplitError(null);
    setTimelineTool('select');
    segmentRefs.current = {};
  }, [selectedVersionId]);

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
        setLastProcessingAt(Date.now());

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
    setTimingFormState(timingFormFromVersion(selectedVersion));
  }, [selectedVersion]);

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
      if (recordingPreviewUrlRef.current) URL.revokeObjectURL(recordingPreviewUrlRef.current);
    };
  }, []);

  useEffect(() => {
    timelineToolRef.current = timelineTool;
  }, [timelineTool]);

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
    return offsetOverrides[track.trackVersionId] ?? track.startOffsetMs;
  }

  function getDisplayedTrackSegments(track: DawTrack) {
    return segmentLayoutOverrides[track.trackVersionId] ?? track.segments;
  }

  function getRenderableTrackSegments(track: DawTrack) {
    return buildRenderableTrackSegments({
      trackVersionId: track.trackVersionId,
      trackStartOffsetMs: getTrackStartOffsetMs(track),
      segments: getDisplayedTrackSegments(track),
      fallbackDurationMs: getTrackDurationMs(track),
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
    const lastEntry = timelineHistory[timelineHistory.length - 1];
    if (!lastEntry) return false;

    if (lastEntry.kind === 'move-track') {
      setOffsetOverrides((prev) => ({
        ...prev,
        [lastEntry.trackVersionId]: lastEntry.previousStartOffsetMs,
      }));
      try {
        const res = await fetch(`/api/tracks/versions/${lastEntry.trackVersionId}/offset`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ startOffsetMs: lastEntry.previousStartOffsetMs }),
        });
        if (!res.ok) {
          throw new Error('Could not undo track move');
        }
      } catch (error) {
        setDragError(error instanceof Error ? error.message : 'Could not undo track move');
      }
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
      try {
        const res = await fetch(
          `/api/tracks/versions/${lastEntry.trackVersionId}/segments/${lastEntry.segmentId}/position`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ timelineStartMs: lastEntry.previousTimelineStartMs }),
          },
        );
        if (!res.ok) {
          throw new Error('Could not undo segment move');
        }
      } catch (error) {
        setDragError(error instanceof Error ? error.message : 'Could not undo segment move');
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
  }

  async function deleteSelectedClip() {
    if (!selectedSegmentId) return false;

    const selectedTrack = selectedTracks.find((track) =>
      getRenderableTrackSegments(track).some((segment) => segment.id === selectedSegmentId),
    );
    if (!selectedTrack) return false;

    const currentSegments = getDisplayedTrackSegments(selectedTrack);
    const selectedSegment = currentSegments.find((segment) => segment.id === selectedSegmentId);
    if (!selectedSegment || selectedSegment.isImplicit) return false;

    const nextSegments = currentSegments
      .filter((segment) => segment.id !== selectedSegment.id)
      .map((segment, index) => ({
        ...segment,
        position: index,
      }));

    try {
      const res = await fetch(
        `/api/tracks/versions/${selectedTrack.trackVersionId}/segments/${selectedSegment.id}`,
        {
          method: 'DELETE',
        },
      );
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? 'Could not delete clip');
      }
    } catch (error) {
      setDragError(error instanceof Error ? error.message : 'Could not delete clip');
      return false;
    }

    setTrackSegmentLayout(selectedTrack.trackVersionId, nextSegments);
    setSelectedSegmentId(nextSegments.find((segment) => segment.position === selectedSegment.position)?.id ?? null);
    setSplitError(null);
    setDragError(null);
    pushTimelineHistory({
      kind: 'delete-segment',
      trackVersionId: selectedTrack.trackVersionId,
      previousSegments: currentSegments,
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

  function scheduleMetronomeThrough(playheadMs: number) {
    const timing = getActiveTiming();
    if (!timing || !metronomeEnabled) return;

    const ctx = ensureMetronomeContext();
    const secondsPerBeat = getBeatSubdivisionSeconds(
      timing.tempoBpm as number,
      timing.timeSignature,
      'beat',
    );
    if (!secondsPerBeat) return;
    const nowSeconds = playheadMs / 1000;
    const lookaheadSeconds = 1.25;
    const endSeconds = nowSeconds + lookaheadSeconds;
    const startBeat = Math.max(
      Math.ceil(nowSeconds / secondsPerBeat),
      (metronomeScheduledBeatRef.current ?? -1) + 1,
    );
    const endBeat = Math.floor(endSeconds / secondsPerBeat);

    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    for (let beatIndex = startBeat; beatIndex <= endBeat; beatIndex += 1) {
      const beatTimeSeconds = beatIndex * secondsPerBeat;
      const isAccent = beatIndex % timing.timeSignature.num === 0;
      scheduleMetronomeClick(ctx.currentTime + Math.max(0, beatTimeSeconds - nowSeconds), isAccent);
      metronomeScheduledBeatRef.current = beatIndex;
    }
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

  const stopTransport = useCallback(() => {
    if (clockRef.current) {
      clearInterval(clockRef.current);
      clockRef.current = null;
    }
    setIsPlaying(false);
    setCurrentTimeMs(0);
    Object.values(segmentRefs.current).forEach((clip) => clip?.stop());
    stopMetronomeSchedule();
  }, [stopMetronomeSchedule]);

  useEffect(() => {
    setSelectedVersionId(currentVersionId);
    stopTransport();
  }, [currentVersionId, stopTransport]);

  function pauseTransport() {
    if (clockRef.current) {
      clearInterval(clockRef.current);
      clockRef.current = null;
    }
    setIsPlaying(false);
    Object.values(segmentRefs.current).forEach((clip) => clip?.pause());
    stopMetronomeSchedule();
  }

  function seekAllTracks(timeMs: number) {
    selectedTracks.forEach((track) => {
      getRenderableTrackSegments(track).forEach((segment) => {
        segmentRefs.current[`${track.trackVersionId}:${segment.id}`]?.seekToTimelineTimeMs(timeMs);
      });
    });
  }

  function playTransport(fromMs?: number) {
    const startMs = fromMs ?? currentTimeMs;
    startPlayheadMsRef.current = startMs;
    startWallTimeRef.current = performance.now();

    seekAllTracks(startMs);
    scheduleMetronomeThrough(startMs);

    selectedTracks.forEach((t) => {
      const muted = mutedTrackVersionIds.has(t.trackVersionId);
      getRenderableTrackSegments(t).forEach((segment) => {
        const clip = segmentRefs.current[`${t.trackVersionId}:${segment.id}`];
        if (!clip) return;
        clip.setMuted(muted);
        clip.playSegmentFromTimelineTime(startMs);
      });
    });

    clockRef.current = setInterval(() => {
      const elapsed = performance.now() - startWallTimeRef.current;
      const newTimeMs = startPlayheadMsRef.current + elapsed;

      // While a take is actively recording, the transport must keep running even if
      // the timeline length is being inferred from the live recording itself.
      if (totalDurationMs > 0 && newTimeMs >= totalDurationMs && !isLiveRecordingRef.current) {
        setCurrentTimeMs(totalDurationMs);
        stopTransport();
        return;
      }

      setCurrentTimeMs(newTimeMs);
      scheduleMetronomeThrough(newTimeMs);

      selectedTracks.forEach((t) => {
        const muted = mutedTrackVersionIds.has(t.trackVersionId);
        getRenderableTrackSegments(t).forEach((segment) => {
          const clip = segmentRefs.current[`${t.trackVersionId}:${segment.id}`];
          if (!clip) return;
          clip.setMuted(muted);
          clip.playSegmentFromTimelineTime(newTimeMs);
        });
      });
    }, TICK_INTERVAL_MS);

    setIsPlaying(true);
  }

  function handleSeek(timeMs: number) {
    const wasPlaying = isPlaying;
    if (wasPlaying) pauseTransport();
    setCurrentTimeMs(timeMs);
    seekAllTracks(timeMs);
    if (wasPlaying) playTransport(timeMs);
  }

  const handleDurationReady = useCallback((trackVersionId: string, durationMs: number) => {
    setDurationByTrackVersionId((prev) => ({ ...prev, [trackVersionId]: durationMs }));
  }, []);

  function getTrackDurationMs(track: DawTrack) {
    return durationByTrackVersionId[track.trackVersionId] ?? track.durationMs ?? 0;
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
    const body: SplitSegmentRequest = {
      segmentId: segment.isImplicit ? undefined : segment.id,
      segmentStartMs: segment.startMs,
      segmentEndMs: segment.endMs,
      splitTimeMs,
    };

    const response = await fetch(`/api/tracks/versions/${track.trackVersionId}/segments/split`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = (await response.json()) as SplitSegmentResponse | { error?: string };
    if (!response.ok) {
      const errorData = data as { error?: string };
      throw new Error(errorData.error ?? 'Could not split clip');
    }

    const payload = data as SplitSegmentResponse;
    const currentSegments = getDisplayedTrackSegments(track);
    const nextSegments = currentSegments
      .filter((current) => current.id !== segment.id)
      .concat([
        {
          ...payload.leftSegment,
          isImplicit: false,
          sourceStartMs: payload.leftSegment.startMs,
          sourceEndMs: payload.leftSegment.endMs,
          durationMs: payload.leftSegment.endMs - payload.leftSegment.startMs,
          timelineEndMs:
            payload.leftSegment.timelineStartMs +
            (payload.leftSegment.endMs - payload.leftSegment.startMs),
        },
        {
          ...payload.rightSegment,
          isImplicit: false,
          sourceStartMs: payload.rightSegment.startMs,
          sourceEndMs: payload.rightSegment.endMs,
          durationMs: payload.rightSegment.endMs - payload.rightSegment.startMs,
          timelineEndMs:
            payload.rightSegment.timelineStartMs +
            (payload.rightSegment.endMs - payload.rightSegment.startMs),
        },
      ])
      .sort((a, b) => a.position - b.position);

    setTrackSegmentLayout(track.trackVersionId, nextSegments);
    setSelectedSegmentId(payload.leftSegment.id);
    setSplitError(null);
    pushTimelineHistory({
      kind: 'cut',
      trackVersionId: track.trackVersionId,
      previousSegments: currentSegments,
      nextSegments,
      previousSelectedSegmentId: selectedSegmentId,
    });
  }

  function toggleMute(trackVersionId: string) {
    const willMute = !mutedTrackVersionIds.has(trackVersionId);
    const track = selectedTracks.find((currentTrack) => currentTrack.trackVersionId === trackVersionId);
    if (track) {
      getRenderableTrackSegments(track).forEach((segment) => {
        segmentRefs.current[`${trackVersionId}:${segment.id}`]?.setMuted(willMute);
      });
    }
    setMutedTrackVersionIds((prev) => {
      const next = new Set(prev);
      if (willMute) next.add(trackVersionId);
      else next.delete(trackVersionId);
      return next;
    });
  }

  function beginTrackDrag(track: DawTrack, startX: number) {
    dragRef.current = {
      kind: 'track',
      trackVersionId: track.trackVersionId,
      originalStartOffsetMs: getTrackStartOffsetMs(track),
      startX,
    };
  }

  function beginSegmentDrag(track: DawTrack, segment: TrackTimelineSegment, startX: number) {
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

  async function commitTrackDrag(track: DawTrack) {
    const drag = dragRef.current;
    if (!drag || drag.kind !== 'track' || drag.trackVersionId !== track.trackVersionId) return;

    dragRef.current = null;
    const finalOffset = getTrackStartOffsetMs(track);

    if (finalOffset === drag.originalStartOffsetMs) return;

    try {
      const res = await fetch(`/api/tracks/versions/${track.trackVersionId}/offset`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startOffsetMs: finalOffset }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        updateTrackDrag(track.trackVersionId, drag.originalStartOffsetMs);
        setDragError(data.error ?? 'Could not save track position');
        return;
      }

      pushTimelineHistory({
        kind: 'move-track',
        trackVersionId: track.trackVersionId,
        previousStartOffsetMs: drag.originalStartOffsetMs,
        nextStartOffsetMs: finalOffset,
      });
    } catch {
      updateTrackDrag(track.trackVersionId, drag.originalStartOffsetMs);
      setDragError('Something went wrong saving track position');
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
        const res = await fetch(`/api/tracks/versions/${track.trackVersionId}/offset`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ startOffsetMs: finalTimelineStartMs }),
        });
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          updateTrackDrag(track.trackVersionId, drag.originalTimelineStartMs);
          setDragError(data.error ?? 'Could not save track position');
          return;
        }
        pushTimelineHistory({
          kind: 'move-track',
          trackVersionId: track.trackVersionId,
          previousStartOffsetMs: drag.originalTimelineStartMs,
          nextStartOffsetMs: finalTimelineStartMs,
        });
      } catch {
        updateTrackDrag(track.trackVersionId, drag.originalTimelineStartMs);
        setDragError('Something went wrong saving track position');
      }
      return;
    }

    try {
      const res = await fetch(`/api/tracks/versions/${track.trackVersionId}/segments/${drag.segmentId}/position`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timelineStartMs: finalTimelineStartMs }),
      });
      const data = (await res.json()) as { error?: string; segment?: { timelineStartMs?: number } };
      if (!res.ok) {
        throw new Error(data.error ?? 'Could not move segment');
      }
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
    } else {
      updateSegmentDrag(drag.trackVersionId, drag.segmentId, drag.originalTimelineStartMs);
    }

    dragRef.current = null;
  }

  undoLatestTimelineEditRef.current = undoLatestTimelineEdit;
  deleteSelectedClipRef.current = deleteSelectedClip;
  cancelTimelineDragRef.current = cancelTimelineDrag;

  function handleTrackPointerDown(e: React.PointerEvent<HTMLDivElement>, track: DawTrack) {
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

    if (drag.segmentId !== segment.id) return;
    await commitSegmentDrag(track);
  }

  function handleSegmentPointerCancel(track: DawTrack, segment: TrackTimelineSegment) {
    const drag = dragRef.current;
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
      const res = await fetch(`/api/tracks/${renameState.trackId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setRenameState((prev) => (prev ? { ...prev, saving: false, error: data.error ?? 'Could not rename track' } : null));
        return;
      }
      setRenameState(null);
      router.refresh();
    } catch {
      setRenameState((prev) => (prev ? { ...prev, saving: false, error: 'Something went wrong' } : null));
    }
  }

  function cancelRename() {
    setRenameState(null);
  }

  function getComposerState(trackId: string) {
    return commentComposerState[trackId] ?? {
      trackId,
      open: false,
      value: '',
      submitting: false,
      error: null,
    };
  }

  function updateComposerState(trackId: string, next: Partial<CommentComposerState>) {
    setCommentComposerState((prev) => {
      const current = prev[trackId] ?? {
        trackId,
        open: false,
        value: '',
        submitting: false,
        error: null,
      };
      return {
        ...prev,
        [trackId]: {
          ...current,
          ...next,
        },
      };
    });
  }

  function openCommentComposer(trackId: string) {
    updateComposerState(trackId, { open: true, error: null });
  }

  function closeCommentComposer(trackId: string) {
    updateComposerState(trackId, { open: false, value: '', error: null });
  }

  async function submitComment(track: DawTrack) {
    const composer = getComposerState(track.trackId);
    const body = composer.value.trim();

    if (!body) {
      updateComposerState(track.trackId, { error: 'Comment body cannot be empty' });
      return;
    }

    updateComposerState(track.trackId, { submitting: true, error: null });

    try {
      const payload: CreateDemoCommentRequest = {
        body,
        trackId: track.trackId,
        timestampMs: currentTimeMs,
      };

      const res = await fetch(`/api/demos/${demoId}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = (await res.json()) as SharedDemoComment | { error?: string };

      if (!res.ok) {
        updateComposerState(track.trackId, {
          submitting: false,
          error: 'error' in data ? data.error ?? 'Could not save comment' : 'Could not save comment',
        });
        return;
      }

      setComments((prev) => [...prev, data as SharedDemoComment]);
      closeCommentComposer(track.trackId);
    } catch {
      updateComposerState(track.trackId, {
        submitting: false,
        error: 'Something went wrong while saving the comment',
      });
    } finally {
      updateComposerState(track.trackId, { submitting: false });
    }
  }

  function handleRecordingStreamReady(stream: MediaStream, startOffsetMs: number) {
    isLiveRecordingRef.current = true;
    setRecordingStream(stream);
    setTemporaryRecordingTrack({
      id: `rec-${Date.now()}`,
      name: '',
      startOffsetMs,
      durationMs: 0,
      status: 'recording',
    });
    if (clockRef.current) {
      clearInterval(clockRef.current);
      clockRef.current = null;
    }
    Object.values(segmentRefs.current).forEach((clip) => clip?.pause());
    playTransport(startOffsetMs);
  }

  function handleRecordingDurationUpdate(durationMs: number) {
    setTemporaryRecordingTrack((prev) => (prev ? { ...prev, durationMs } : prev));
  }

  function handleRecordingStopped(blob: Blob, previewUrl: string, durationMs: number) {
    recordingPreviewUrlRef.current = previewUrl;
    isLiveRecordingRef.current = false;
    setRecordingStream(null);
    setTemporaryRecordingTrack((prev) =>
      prev ? { ...prev, status: 'preview', blob, previewUrl, durationMs } : prev,
    );
    pauseTransport();
  }

  function handleRecordingNameChange(name: string) {
    setTemporaryRecordingTrack((prev) => (prev ? { ...prev, name } : prev));
  }

  useEffect(() => {
    if (timelineTool !== 'split') {
      setSplitHover(null);
    }
  }, [timelineTool]);

  function handleDiscardRecording() {
    if (recordingPreviewUrlRef.current) {
      URL.revokeObjectURL(recordingPreviewUrlRef.current);
      recordingPreviewUrlRef.current = null;
    }
    isLiveRecordingRef.current = false;
    setTemporaryRecordingTrack(null);
    setRecordingStream(null);
  }

  async function handleSaveRecording() {
    const track = temporaryRecordingTrack;
    if (!track?.blob) return;

    isLiveRecordingRef.current = false;
    setTemporaryRecordingTrack((prev) =>
      prev ? { ...prev, status: 'uploading', error: undefined } : prev,
    );

    try {
      const ext = track.blob.type.includes('ogg') ? 'ogg' : track.blob.type.includes('mp4') ? 'mp4' : 'webm';
      const file = new File([track.blob], `recording-${Date.now()}.${ext}`, { type: track.blob.type });
      const formData = new FormData();
      formData.append('demoId', demoId);
      formData.append('sourceVersionId', selectedVersionId);
      if (track.name.trim()) formData.append('name', track.name.trim());
      formData.append('file', file);

      const res = await fetch('/api/tracks/upload', { method: 'POST', body: formData });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setTemporaryRecordingTrack((prev) =>
          prev ? { ...prev, status: 'error', error: data.error ?? 'Could not save recording' } : prev,
        );
        return;
      }

      if (recordingPreviewUrlRef.current) {
        URL.revokeObjectURL(recordingPreviewUrlRef.current);
        recordingPreviewUrlRef.current = null;
      }
      setTemporaryRecordingTrack(null);
      router.refresh();
    } catch {
      setTemporaryRecordingTrack((prev) =>
        prev ? { ...prev, status: 'error', error: 'Something went wrong while saving.' } : prev,
      );
    }
  }

  async function performUpload(file: File, name: string, timingChoice: UploadTimingChoice) {
    setIsUploading(true);
    setUploadError(null);
    setProcessingMessage(null);
    try {
      const formData = new FormData();
      formData.append('demoId', demoId);
      formData.append('sourceVersionId', selectedVersionId);
      if (name.trim()) formData.append('name', name.trim());
      formData.append('file', file);
      formData.append('timingChoice', timingChoice);

      const response = await fetch('/api/tracks/upload', { method: 'POST', body: formData });
      const data = (await response.json()) as UploadTrackResponse | { error?: string };
      if (!response.ok) {
        setUploadError('error' in data ? data.error ?? 'Could not upload track' : 'Could not upload track');
        return;
      }
      setUploadName('');
      setUploadFile(null);
      if ('processingJobIds' in data && data.processingJobIds.length > 0) {
        setProcessingStartedAt(Date.now());
        setProcessingJobIds(data.processingJobIds);
        setProcessingMessage('Processing upload in the background...');
      } else {
        router.refresh();
      }
    } catch {
      setUploadError('Something went wrong while uploading. Please try again.');
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

  async function confirmTempoAnalysisAsProjectTempo() {
    if (!tempoAnalysisPrompt) return;
    const tempoBpm = tempoAnalysisPrompt.tempoBpm;
    if (!Number.isFinite(tempoBpm) || !isValidTempoBpm(tempoBpm)) {
      setTempoAnalysisPrompt((prev) =>
        prev ? { ...prev, error: 'Tempo analysis did not return a valid BPM' } : prev,
      );
      return;
    }

    setTempoAnalysisPrompt((prev) => (prev ? { ...prev, applying: true, error: null } : prev));
    try {
      const res = await fetch(`/api/versions/${selectedVersionId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tempoBpm,
          tempoSource: 'ANALYZED',
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setTempoAnalysisPrompt((prev) =>
          prev ? { ...prev, applying: false, error: data.error ?? 'Could not set project tempo' } : prev,
        );
        return;
      }
      setTempoAnalysisPrompt(null);
      setProcessingMessage(`Project tempo set to ${tempoBpm.toFixed(1)} BPM.`);
      router.refresh();
    } catch {
      setTempoAnalysisPrompt((prev) =>
        prev ? { ...prev, applying: false, error: 'Something went wrong while updating project tempo.' } : prev,
      );
    }
  }

  async function onUploadTrack(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUploadError(null);
    if (!uploadFile) {
      setUploadError('Please choose an audio file to upload.');
      return;
    }
    const hasTempo = isValidTempoBpm(selectedTiming?.tempoBpm);
    if (hasTempo) {
      setUploadModalState({
        open: true,
        file: uploadFile,
        name: uploadName,
        choice: 'keepProjectTempo',
      });
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

  async function saveTimingSettings() {
    const tempoInput = timingFormState.tempoBpm.trim();
    const tempoBpm = tempoInput ? Number(tempoInput) : null;
    const timeSignatureNum = Number(timingFormState.timeSignatureNum);
    const timeSignatureDen = Number(timingFormState.timeSignatureDen);
    const musicalKey = timingFormState.musicalKey.trim();

    if (tempoInput && (!Number.isFinite(tempoBpm) || !isValidTempoBpm(tempoBpm))) {
      setTimingFormState((prev) => ({ ...prev, error: 'Tempo must be between 40 and 240 BPM' }));
      return;
    }

    if (
      !Number.isFinite(timeSignatureNum) ||
      !Number.isFinite(timeSignatureDen) ||
      timeSignatureNum < 1 ||
      timeSignatureDen < 1
    ) {
      setTimingFormState((prev) => ({ ...prev, error: 'Time signature must use positive numbers' }));
      return;
    }

    setTimingFormState((prev) => ({ ...prev, saving: true, error: null }));
    try {
      const res = await fetch(`/api/versions/${selectedVersionId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tempoBpm: tempoInput ? tempoBpm : null,
          timeSignatureNum: Math.floor(timeSignatureNum),
          timeSignatureDen: Math.floor(timeSignatureDen),
          musicalKey: musicalKey || null,
          tempoSource: 'MANUAL',
          keySource: 'MANUAL',
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setTimingFormState((prev) => ({ ...prev, saving: false, error: data.error ?? 'Could not save timing' }));
        return;
      }
      router.refresh();
    } catch {
      setTimingFormState((prev) => ({ ...prev, saving: false, error: 'Something went wrong while saving timing' }));
      return;
    }
    setTimingFormState((prev) => ({ ...prev, saving: false, error: null }));
  }

  const hasTimelineContent = selectedTracks.length > 0 || temporaryRecordingTrack !== null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link
              href={`/groups/${groupSlug}/projects/${projectSlug}`}
              className="inline-flex rounded-md border border-gray-700 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-800"
            >
              Back to Project
            </Link>
            <h1 className="mt-3 text-2xl font-bold text-white">{demoName}</h1>
            {demoDescription ? <p className="mt-1 text-sm text-gray-300">{demoDescription}</p> : null}
          </div>

          <div
            className={`rounded-md border px-3 py-2 text-xs ${
              workerStatus.tone === 'red'
                ? 'border-red-500/40 bg-red-500/10 text-red-100'
                : workerStatus.tone === 'amber'
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-100'
                  : workerStatus.tone === 'emerald'
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100'
                    : 'border-gray-700 bg-gray-900 text-gray-300'
            }`}
          >
            <p className="font-medium">{workerStatus.label}</p>
            <p className="mt-1 max-w-[240px] text-[11px] leading-snug opacity-90">{workerStatus.detail}</p>
          </div>
        </div>
      </div>

      <form onSubmit={onUploadTrack} className="space-y-3 rounded-md border border-gray-800 bg-gray-900 p-4">
        <p className="text-sm font-medium text-white">Add Audio Track</p>
        <p className="text-xs text-gray-400">
          New uploads and recordings branch from the selected version in the history tree.
        </p>
        <div className="flex flex-wrap gap-3">
          <label className="min-w-[160px] flex-1">
            <span className="mb-1 block text-xs uppercase tracking-wide text-gray-400">Track Name (optional)</span>
            <input
              type="text"
              value={uploadName}
              onChange={(e) => setUploadName(e.currentTarget.value)}
              className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm outline-none ring-indigo-500 focus:ring"
              placeholder="Lead Vocal"
            />
          </label>
          <label className="min-w-[200px] flex-[2]">
            <span className="mb-1 block text-xs uppercase tracking-wide text-gray-400">Audio File</span>
            <input
              type="file"
              accept="audio/*"
              onChange={(e) => setUploadFile(e.currentTarget.files?.[0] ?? null)}
              className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-indigo-500"
            />
          </label>
        </div>
        {processingJobIds.length > 0 ? (
          <div className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-100">
            <p className="font-medium">Processing {processingJobIds.length} job{processingJobIds.length === 1 ? '' : 's'}…</p>
            {processingMessage ? <p className="mt-1 text-indigo-200">{processingMessage}</p> : null}
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
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isUploading}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {isUploading ? 'Uploading...' : 'Upload Track'}
          </button>
        </div>
      </form>

      <section className="space-y-3 rounded-md border border-gray-800 bg-gray-900 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-white">Timing</p>
            <p className="text-xs text-gray-400">Tempo, meter, key, metronome, and snap grid.</p>
          </div>
          <button
            type="button"
            onClick={() => void saveTimingSettings()}
            disabled={timingFormState.saving}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {timingFormState.saving ? 'Saving…' : 'Save Timing'}
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-5">
          <label className="space-y-1">
            <span className="block text-[10px] uppercase tracking-wide text-gray-400">Tempo BPM</span>
            <input
              type="number"
              min={40}
              max={240}
              step="0.1"
              value={timingFormState.tempoBpm}
              onChange={(e) => {
                const value = e.currentTarget.value;
                setTimingFormState((prev) => ({ ...prev, tempoBpm: value, error: null }));
              }}
              className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white outline-none ring-indigo-500 focus:ring"
              placeholder="120"
            />
          </label>
          <label className="space-y-1">
            <span className="block text-[10px] uppercase tracking-wide text-gray-400">Time Sig Num</span>
            <input
              type="number"
              min={1}
              value={timingFormState.timeSignatureNum}
              onChange={(e) => {
                const value = e.currentTarget.value;
                setTimingFormState((prev) => ({ ...prev, timeSignatureNum: value, error: null }));
              }}
              className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white outline-none ring-indigo-500 focus:ring"
              placeholder="4"
            />
          </label>
          <label className="space-y-1">
            <span className="block text-[10px] uppercase tracking-wide text-gray-400">Time Sig Den</span>
            <input
              type="number"
              min={1}
              value={timingFormState.timeSignatureDen}
              onChange={(e) => {
                const value = e.currentTarget.value;
                setTimingFormState((prev) => ({ ...prev, timeSignatureDen: value, error: null }));
              }}
              className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white outline-none ring-indigo-500 focus:ring"
              placeholder="4"
            />
          </label>
          <label className="space-y-1 md:col-span-2">
            <span className="block text-[10px] uppercase tracking-wide text-gray-400">Musical Key</span>
            <input
              type="text"
              value={timingFormState.musicalKey}
              onChange={(e) => {
                const value = e.currentTarget.value;
                setTimingFormState((prev) => ({ ...prev, musicalKey: value, error: null }));
              }}
              className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white outline-none ring-indigo-500 focus:ring"
              placeholder="C major"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
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
          <label className="flex items-center gap-2 text-xs text-gray-300">
            <span className="uppercase tracking-wide text-gray-400">Snap</span>
            <select
              value={snapResolution}
              onChange={(e) => setSnapResolution(e.currentTarget.value as SnapResolution)}
              className="rounded-md border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-white outline-none ring-indigo-500 focus:ring"
            >
              <option value="off">Off</option>
              <option value="bar">Bar</option>
              <option value="beat">Beat</option>
              <option value="halfBeat">Half beat</option>
              <option value="quarterBeat">Quarter beat</option>
            </select>
          </label>
          {selectedTiming?.tempoBpm ? (
            <p className="text-xs text-gray-500">
              Grid: bar/beat labels at {selectedTiming.tempoBpm} BPM
            </p>
          ) : (
            <p className="text-xs text-gray-500">Grid falls back to seconds until tempo is set.</p>
          )}
        </div>
        {timingFormState.error ? <p className="text-xs text-red-400">{timingFormState.error}</p> : null}
      </section>

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
              <button
                type="button"
                onClick={() => void confirmTempoAnalysisAsProjectTempo()}
                disabled={tempoAnalysisPrompt.applying}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
              >
                {tempoAnalysisPrompt.applying ? 'Saving…' : 'Set as project tempo?'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <TransportControls
        isPlaying={isPlaying}
        currentTimeMs={currentTimeMs}
        onPlay={() => playTransport()}
        onPause={pauseTransport}
        onStop={stopTransport}
        leadingSlot={
          <RecordingControls
            currentTimeMs={currentTimeMs}
            isDisabled={temporaryRecordingTrack !== null || !audioInputReady || !selectedAudioInputDeviceId}
            selectedAudioInputDeviceId={selectedAudioInputDeviceId}
            isAudioInputReady={audioInputReady}
            onNeedsAudioInput={() => {}}
            onStreamReady={handleRecordingStreamReady}
            onDurationUpdate={handleRecordingDurationUpdate}
            onStopped={handleRecordingStopped}
          />
        }
        trailingSlot={
          <AudioInputSelector
            selectedAudioInputDeviceId={selectedAudioInputDeviceId}
            onSelectedAudioInputDeviceIdChange={setSelectedAudioInputDeviceId}
            isAudioInputReady={audioInputReady}
            onAudioInputReadyChange={setAudioInputReady}
          />
        }
      />

      {dragError ? (
        <p className="text-sm text-red-400">{dragError}</p>
      ) : null}

      <div className={`grid gap-4 ${versionHistoryExpanded ? 'lg:grid-cols-2' : 'lg:grid-cols-[1fr_280px]'}`}>
        <section className="min-w-0 space-y-3 rounded-lg border border-gray-800 bg-gray-950 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Timeline</h2>
            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  setTimelineTool('select');
                  setSplitHover(null);
                  setSplitError(null);
                }}
                className={`rounded px-2 py-1 font-medium transition-colors ${
                  timelineTool === 'select'
                    ? 'bg-indigo-500/20 text-indigo-200 ring-1 ring-indigo-500/40'
                    : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
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
                className={`rounded px-2 py-1 font-medium transition-colors ${
                  timelineTool === 'split'
                    ? 'bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/40'
                    : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}
                title="Cut tool: click a clip to split it"
              >
                Cut
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs">
            {commentsLoading ? <p className="text-gray-500">Loading comments…</p> : null}
            {commentsError ? <p className="text-red-400">{commentsError}</p> : null}
            {splitError ? <p className="text-amber-300">{splitError}</p> : null}
          </div>
          <p className="text-[11px] text-gray-500">
            Cut mode keeps the source audio intact and creates new timeline segments from the clip you click.
          </p>

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

              {selectedTracks.map((track) => {
                const isMuted = mutedTrackVersionIds.has(track.trackVersionId);
                const trackSegments = getRenderableTrackSegments(track);
                const selectedTrackSegment = trackSegments.find((segment) => segment.id === selectedSegmentId) ?? null;
                const splitHoverTimeMs =
                  timelineTool === 'split' && splitHover?.trackVersionId === track.trackVersionId
                    ? splitHover.timeMs
                    : null;
                const hoveredTrackSegment =
                  timelineTool === 'split' && splitHoverTimeMs !== null
                    ? findSegmentAtTime(track, splitHoverTimeMs)
                    : null;
                const isRenaming = renameState?.trackId === track.trackId;
                const trackComments = commentsByTrackId[track.trackId] ?? [];
                const composer = getComposerState(track.trackId);

                return (
                  <div
                    key={track.trackVersionId}
                    className="flex border-b border-gray-800 last:border-b-0"
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
                              setRenameState((prev) =>
                                prev ? { ...prev, value } : null,
                              );
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
                          <div className="flex items-center justify-between gap-1">
                            <p
                              className={`flex-1 truncate text-sm font-medium ${isMuted ? 'text-gray-500 line-through' : 'text-white'}`}
                              onDoubleClick={() => startRename(track)}
                              title="Double-click to rename"
                            >
                              {track.trackName}
                            </p>
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
                                <path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207zm-7.468 7.468A.5.5 0 0 1 6 13.5V13h-.5a.5.5 0 0 1-.5-.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.5-.5V10h-.5a.499.499 0 0 1-.175-.032l-.179.178a.5.5 0 0 0-.11.168l-2 5a.5.5 0 0 0 .65.65l5-2a.5.5 0 0 0 .168-.11z"/>
                              </svg>
                            </button>
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
                          </div>

                          <div className="space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-[10px] uppercase tracking-wide text-gray-500">
                                Comments {trackComments.length > 0 ? `(${trackComments.length})` : ''}
                              </p>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => void requestTempoAnalysis(track)}
                                  className="text-[10px] font-medium text-amber-400 hover:text-amber-300"
                                >
                                  Analyze tempo
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    composer.open ? closeCommentComposer(track.trackId) : openCommentComposer(track.trackId)
                                  }
                                  className="text-[10px] font-medium text-indigo-400 hover:text-indigo-300"
                                >
                                  {composer.open ? 'Cancel' : 'Add comment'}
                                </button>
                              </div>
                            </div>

                            {trackComments.length > 0 ? (
                              <div className="max-h-28 space-y-1 overflow-y-auto pr-1">
                                {trackComments.map((comment) => (
                                  <div
                                    key={comment.id}
                                    className="rounded border border-gray-800 bg-gray-950/80 px-2 py-1"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <p className="truncate text-[10px] font-medium text-gray-300">
                                        {comment.author.name ?? 'Unknown'}
                                      </p>
                                      {comment.isResolved ? (
                                        <span className="shrink-0 rounded bg-emerald-900/60 px-1 py-0.5 text-[9px] text-emerald-200">
                                          Resolved
                                        </span>
                                      ) : null}
                                    </div>
                                    <p className="mt-0.5 break-words text-[11px] leading-snug text-gray-200">
                                      {comment.body}
                                    </p>
                                    {comment.timestampMs != null ? (
                                      <button
                                        type="button"
                                        onClick={() => handleSeek(comment.timestampMs ?? 0)}
                                        className="mt-1 text-[10px] font-medium text-indigo-400 hover:text-indigo-300"
                                      >
                                        At{' '}
                                        {selectedTiming?.tempoBpm
                                          ? `${formatBarBeatLabel(comment.timestampMs / 1000, selectedTiming) ?? formatTimeMs(comment.timestampMs)}`
                                          : formatTimeMs(comment.timestampMs)}
                                      </button>
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-[11px] text-gray-500">No notes yet.</p>
                            )}

                            {composer.open ? (
                              <div className="space-y-1">
                                <textarea
                                  rows={2}
                                  value={composer.value}
                                  onChange={(e) => {
                                    const value = e.currentTarget.value;
                                    updateComposerState(track.trackId, {
                                      value,
                                      error: null,
                                    });
                                  }}
                                  placeholder="Leave a note"
                                  className="w-full rounded border border-gray-700 bg-gray-950 px-2 py-1 text-[11px] text-white outline-none ring-indigo-500 focus:ring"
                                />
                                <p className="text-[10px] text-gray-500">
                                  Anchored at{' '}
                                  {selectedTiming?.tempoBpm
                                    ? formatBarBeatLabel(currentTimeMs / 1000, selectedTiming) ?? formatTimeMs(currentTimeMs)
                                    : formatTimeMs(currentTimeMs)}
                                </p>
                                {composer.error ? (
                                  <p className="text-[10px] text-red-400">{composer.error}</p>
                                ) : null}
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => void submitComment(track)}
                                    disabled={composer.submitting}
                                    className="rounded bg-indigo-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    {composer.submitting ? 'Saving…' : 'Submit'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => closeCommentComposer(track.trackId)}
                                    className="text-[10px] text-gray-500 hover:text-gray-300"
                                  >
                                    Close
                                  </button>
                                </div>
                              </div>
                            ) : null}
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
                        style={{ left: (currentTimeMs / 1000) * PX_PER_SECOND }}
                      />

                      {timelineTool === 'split' && splitHoverTimeMs !== null && hoveredTrackSegment ? (
                        <div
                          className="pointer-events-none absolute top-0 z-30 h-full w-px bg-amber-300/90"
                          style={{ left: (splitHoverTimeMs / 1000) * PX_PER_SECOND }}
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
                            ref={(el) => {
                              segmentRefs.current[`${track.trackVersionId}:${segment.id}`] = el;
                            }}
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

              {temporaryRecordingTrack && (
                <RecordingTrackLane
                  track={temporaryRecordingTrack}
                  stream={recordingStream}
                  currentTimeMs={currentTimeMs}
                  totalTimelineWidth={totalTimelineWidth}
                  currentRecordingTrackId={currentRecordingTrackId}
                  scrollContainerRef={tracksScrollContainerRef}
                  onNameChange={handleRecordingNameChange}
                  onSave={() => void handleSaveRecording()}
                  onDiscard={handleDiscardRecording}
                />
              )}
            </div>
          ) : (
            <div className="rounded-md border border-gray-800 bg-gray-900 px-4 py-8 text-sm text-gray-400">
              This version has no tracks yet. Upload or record a track to get started.
            </div>
          )}
        </section>

        <VersionHistoryTree
          demoId={demoId}
          versions={versions}
          currentVersionId={currentVersionId}
          selectedVersionId={selectedVersionId}
          onSelectVersion={(id) => {
            setSelectedVersionId(id);
            stopTransport();
          }}
          expanded={versionHistoryExpanded}
          onExpandToggle={() => setVersionHistoryExpanded((prev) => !prev)}
        />
      </div>
    </div>
  );
}
