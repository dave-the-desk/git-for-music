'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { TransportControls } from './TransportControls';
import { TimelineRuler, PX_PER_SECOND } from './TimelineRuler';
import { TrackWaveform, type TrackWaveformHandle } from './TrackWaveform';
import { RecordingControls } from './RecordingControls';
import { RecordingTrackLane } from './RecordingTrackLane';
import { VersionHistoryTree } from './VersionHistoryTree';

const TRACK_LABEL_WIDTH = 160;
const TRACK_HEIGHT = 72;
const TICK_INTERVAL_MS = 16;
const SNAP_MS = 50;

export type DawTrack = {
  trackId: string;
  trackName: string;
  trackPosition: number;
  trackVersionId: string;
  storageKey: string;
  mimeType: string | null;
  durationMs: number | null;
  startOffsetMs: number;
};

export type DawVersion = {
  id: string;
  label: string;
  description: string | null;
  parentId: string | null;
  createdAt: string;
  isCurrent: boolean;
  tracks: DawTrack[];
};

// Represents a live or just-finished recording that hasn't been saved yet.
// Lives only in component state — no DemoVersion is created until the user clicks Save.
export type TemporaryRecordingTrack = {
  id: string;
  name: string;
  startOffsetMs: number;
  durationMs: number;
  // recording  → stream open, waveform capturing
  // preview    → recorder stopped, blob ready for listen-back
  // uploading  → upload in flight
  // error      → upload failed, user can retry
  status: 'recording' | 'preview' | 'uploading' | 'error';
  blob?: Blob;
  previewUrl?: string;
  error?: string;
};

type RenameState = {
  trackId: string;
  value: string;
  saving: boolean;
  error: string | null;
};

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

  const [temporaryRecordingTrack, setTemporaryRecordingTrack] = useState<TemporaryRecordingTrack | null>(null);
  const [recordingStream, setRecordingStream] = useState<MediaStream | null>(null);
  const recordingPreviewUrlRef = useRef<string | null>(null);

  // Optimistic offset overrides while dragging or after a successful save (before refresh)
  const [offsetOverrides, setOffsetOverrides] = useState<Record<string, number>>({});
  const [dragError, setDragError] = useState<string | null>(null);
  const dragRef = useRef<{ trackVersionId: string; originalOffset: number; startX: number } | null>(null);

  // Inline rename state
  const [renameState, setRenameState] = useState<RenameState | null>(null);

  const clockRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startWallTimeRef = useRef<number>(0);
  const startPlayheadMsRef = useRef<number>(0);
  const waveformRefs = useRef<Record<string, TrackWaveformHandle | null>>({});

  const selectedVersion = useMemo(
    () => versions.find((v) => v.id === selectedVersionId) ?? versions[0],
    [selectedVersionId, versions],
  );

  const selectedTracks = useMemo(() => {
    if (!selectedVersion) return [];
    return [...selectedVersion.tracks].sort((a, b) => a.trackPosition - b.trackPosition);
  }, [selectedVersion]);

  const totalDurationMs = useMemo(() => {
    const ends = selectedTracks.map((t) => {
      const dur = durationByTrackVersionId[t.trackVersionId] ?? t.durationMs ?? 0;
      const offset = offsetOverrides[t.trackVersionId] ?? t.startOffsetMs;
      return offset + dur;
    });
    if (temporaryRecordingTrack) {
      ends.push(temporaryRecordingTrack.startOffsetMs + temporaryRecordingTrack.durationMs);
    }
    return ends.length ? Math.max(...ends) : 0;
  }, [selectedTracks, durationByTrackVersionId, offsetOverrides, temporaryRecordingTrack]);

  const totalTimelineWidth = Math.max((totalDurationMs / 1000) * PX_PER_SECOND, 400);

  useEffect(() => {
    setSelectedVersionId(currentVersionId);
    stopTransport();
  }, [currentVersionId]);

  // Clear drag overrides when switching versions
  useEffect(() => {
    setOffsetOverrides({});
    setDragError(null);
  }, [selectedVersionId]);

  useEffect(() => {
    return () => {
      if (recordingPreviewUrlRef.current) URL.revokeObjectURL(recordingPreviewUrlRef.current);
    };
  }, []);

  // --- Transport ---
  //
  // Single global clock: one setInterval drives currentTimeMs for every track.
  // WaveSurfer instances follow this clock — they never manage their own playback.

  function stopTransport() {
    if (clockRef.current) {
      clearInterval(clockRef.current);
      clockRef.current = null;
    }
    setIsPlaying(false);
    setCurrentTimeMs(0);
    Object.values(waveformRefs.current).forEach((wf) => wf?.stop());
  }

  function pauseTransport() {
    if (clockRef.current) {
      clearInterval(clockRef.current);
      clockRef.current = null;
    }
    setIsPlaying(false);
    Object.values(waveformRefs.current).forEach((wf) => wf?.pause());
  }

  const seekAllTracks = useCallback(
    (timeMs: number) => {
      selectedTracks.forEach((t) => {
        waveformRefs.current[t.trackVersionId]?.seekToTimeMs(timeMs);
      });
    },
    [selectedTracks],
  );

  function playTransport(fromMs?: number) {
    const startMs = fromMs ?? currentTimeMs;
    startPlayheadMsRef.current = startMs;
    startWallTimeRef.current = performance.now();

    seekAllTracks(startMs);

    selectedTracks.forEach((t) => {
      const wf = waveformRefs.current[t.trackVersionId];
      const dur = durationByTrackVersionId[t.trackVersionId] ?? t.durationMs ?? 0;
      const offset = offsetOverrides[t.trackVersionId] ?? t.startOffsetMs;
      if (!mutedTrackVersionIds.has(t.trackVersionId) && startMs < offset + dur) {
        wf?.play();
      }
    });

    clockRef.current = setInterval(() => {
      const elapsed = performance.now() - startWallTimeRef.current;
      const newTimeMs = startPlayheadMsRef.current + elapsed;

      if (totalDurationMs > 0 && newTimeMs >= totalDurationMs) {
        setCurrentTimeMs(totalDurationMs);
        stopTransport();
        return;
      }

      setCurrentTimeMs(newTimeMs);

      selectedTracks.forEach((t) => {
        const wf = waveformRefs.current[t.trackVersionId];
        const dur = durationByTrackVersionId[t.trackVersionId] ?? t.durationMs ?? 0;
        const offset = offsetOverrides[t.trackVersionId] ?? t.startOffsetMs;
        const relativeMs = newTimeMs - offset;
        if (relativeMs >= dur) {
          wf?.pause();
        }
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

  // --- Mute ---

  function toggleMute(trackVersionId: string) {
    const willMute = !mutedTrackVersionIds.has(trackVersionId);
    waveformRefs.current[trackVersionId]?.setMuted(willMute);
    setMutedTrackVersionIds((prev) => {
      const next = new Set(prev);
      if (willMute) next.add(trackVersionId);
      else next.delete(trackVersionId);
      return next;
    });
  }

  // --- Track drag (horizontal offset) ---

  function handleWaveformPointerDown(e: React.PointerEvent<HTMLDivElement>, track: DawTrack) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const currentOffset = offsetOverrides[track.trackVersionId] ?? track.startOffsetMs;
    const dur = durationByTrackVersionId[track.trackVersionId] ?? track.durationMs ?? 0;
    const leftPx = (currentOffset / 1000) * PX_PER_SECOND;
    const widthPx = dur > 0 ? (dur / 1000) * PX_PER_SECOND : 200;

    // Only initiate drag if the pointer started within the waveform block
    if (x < leftPx || x > leftPx + widthPx) return;

    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      trackVersionId: track.trackVersionId,
      originalOffset: currentOffset,
      startX: e.clientX,
    };
    setDragError(null);
  }

  function handleWaveformPointerMove(e: React.PointerEvent<HTMLDivElement>, track: DawTrack) {
    const drag = dragRef.current;
    if (!drag || drag.trackVersionId !== track.trackVersionId) return;

    const deltaX = e.clientX - drag.startX;
    const deltaMs = (deltaX / PX_PER_SECOND) * 1000;
    const rawMs = drag.originalOffset + deltaMs;
    const snapped = Math.max(0, Math.round(rawMs / SNAP_MS) * SNAP_MS);

    setOffsetOverrides((prev) => ({ ...prev, [track.trackVersionId]: snapped }));
  }

  async function handleWaveformPointerUp(e: React.PointerEvent<HTMLDivElement>, track: DawTrack) {
    const drag = dragRef.current;
    if (!drag || drag.trackVersionId !== track.trackVersionId) return;

    dragRef.current = null;
    const finalOffset = offsetOverrides[track.trackVersionId] ?? track.startOffsetMs;

    if (finalOffset === drag.originalOffset) return;

    try {
      const res = await fetch(`/api/tracks/versions/${track.trackVersionId}/offset`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startOffsetMs: finalOffset }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setOffsetOverrides((prev) => ({ ...prev, [track.trackVersionId]: drag.originalOffset }));
        setDragError(data.error ?? 'Could not save track position');
      } else {
        // Keep override active — router.refresh will update prop data with the saved value.
        router.refresh();
      }
    } catch {
      setOffsetOverrides((prev) => ({ ...prev, [track.trackVersionId]: drag.originalOffset }));
      setDragError('Something went wrong saving track position');
    }
  }

  function handleWaveformPointerCancel(track: DawTrack) {
    const drag = dragRef.current;
    if (!drag || drag.trackVersionId !== track.trackVersionId) return;
    setOffsetOverrides((prev) => ({ ...prev, [track.trackVersionId]: drag.originalOffset }));
    dragRef.current = null;
  }

  // --- Inline rename ---

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

  // --- Recording ---

  function handleRecordingStreamReady(stream: MediaStream, startOffsetMs: number) {
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
    Object.values(waveformRefs.current).forEach((wf) => wf?.pause());
    playTransport(startOffsetMs);
  }

  function handleRecordingDurationUpdate(durationMs: number) {
    setTemporaryRecordingTrack((prev) => (prev ? { ...prev, durationMs } : prev));
  }

  function handleRecordingStopped(blob: Blob, previewUrl: string, durationMs: number) {
    recordingPreviewUrlRef.current = previewUrl;
    setRecordingStream(null);
    setTemporaryRecordingTrack((prev) =>
      prev ? { ...prev, status: 'preview', blob, previewUrl, durationMs } : prev,
    );
    pauseTransport();
  }

  function handleRecordingNameChange(name: string) {
    setTemporaryRecordingTrack((prev) => (prev ? { ...prev, name } : prev));
  }

  function handleDiscardRecording() {
    if (recordingPreviewUrlRef.current) {
      URL.revokeObjectURL(recordingPreviewUrlRef.current);
      recordingPreviewUrlRef.current = null;
    }
    setTemporaryRecordingTrack(null);
    setRecordingStream(null);
  }

  async function handleSaveRecording() {
    const track = temporaryRecordingTrack;
    if (!track?.blob) return;

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

  // --- File upload ---

  async function onUploadTrack(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!uploadFile) {
      setUploadError('Please choose an audio file to upload.');
      return;
    }
    setIsUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append('demoId', demoId);
      formData.append('sourceVersionId', selectedVersionId);
      if (uploadName.trim()) formData.append('name', uploadName.trim());
      formData.append('file', uploadFile);

      const response = await fetch('/api/tracks/upload', { method: 'POST', body: formData });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setUploadError(data.error ?? 'Could not upload track');
        return;
      }
      setUploadName('');
      setUploadFile(null);
      router.refresh();
    } catch {
      setUploadError('Something went wrong while uploading. Please try again.');
    } finally {
      setIsUploading(false);
    }
  }

  const hasTimelineContent = selectedTracks.length > 0 || temporaryRecordingTrack !== null;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
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

      {/* Upload form */}
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

      {/* Transport row: [Record] | [Stop] [Play/Pause] [Time] */}
      <TransportControls
        isPlaying={isPlaying}
        currentTimeMs={currentTimeMs}
        onPlay={() => playTransport()}
        onPause={pauseTransport}
        onStop={stopTransport}
        leadingSlot={
          <RecordingControls
            currentTimeMs={currentTimeMs}
            isDisabled={temporaryRecordingTrack !== null}
            onStreamReady={handleRecordingStreamReady}
            onDurationUpdate={handleRecordingDurationUpdate}
            onStopped={handleRecordingStopped}
          />
        }
      />

      {dragError ? (
        <p className="text-sm text-red-400">{dragError}</p>
      ) : null}

      {/* Main workspace: timeline + version history sidebar */}
      <div className={`grid gap-4 ${versionHistoryExpanded ? 'lg:grid-cols-2' : 'lg:grid-cols-[1fr_280px]'}`}>

        {/* DAW Timeline — min-w-0 prevents it from pushing the sidebar off screen */}
        <section className="min-w-0 space-y-3 rounded-lg border border-gray-800 bg-gray-950 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Timeline</h2>

          {hasTimelineContent ? (
            /* overflow-x-auto is on this wrapper so ruler + tracks scroll together */
            <div className="overflow-x-auto rounded-md border border-gray-800">
              {/* All rows share the same totalTimelineWidth so they scroll in sync */}

              {/* Timeline ruler row */}
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
                  />
                </div>
              </div>

              {/* Saved track rows */}
              {selectedTracks.map((track) => {
                const isMuted = mutedTrackVersionIds.has(track.trackVersionId);
                const effectiveOffset = offsetOverrides[track.trackVersionId] ?? track.startOffsetMs;
                const isRenaming = renameState?.trackId === track.trackId;

                return (
                  <div
                    key={track.trackVersionId}
                    className="flex border-b border-gray-800 last:border-b-0"
                    style={{ minWidth: TRACK_LABEL_WIDTH + totalTimelineWidth, height: TRACK_HEIGHT }}
                  >
                    {/* Label column */}
                    <div
                      className="flex shrink-0 flex-col justify-center gap-1 border-r border-gray-800 bg-gray-900 px-2"
                      style={{ width: TRACK_LABEL_WIDTH }}
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
                        <div className="flex items-center justify-between gap-1">
                          <p
                            className={`flex-1 truncate text-sm font-medium ${isMuted ? 'text-gray-500 line-through' : 'text-white'}`}
                            onDoubleClick={() => startRename(track)}
                            title="Double-click to rename"
                          >
                            {track.trackName}
                          </p>
                          <button
                            type="button"
                            onClick={() => startRename(track)}
                            title="Rename track"
                            className="shrink-0 text-gray-600 hover:text-gray-300"
                          >
                            {/* Pencil icon */}
                            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                              <path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207zm-7.468 7.468A.5.5 0 0 1 6 13.5V13h-.5a.5.5 0 0 1-.5-.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.5-.5V10h-.5a.499.499 0 0 1-.175-.032l-.179.178a.5.5 0 0 0-.11.168l-2 5a.5.5 0 0 0 .65.65l5-2a.5.5 0 0 0 .168-.11z"/>
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
                      )}
                    </div>

                    {/* Waveform area — pointer events handle horizontal drag */}
                    <div
                      className={`relative shrink-0 select-none bg-gray-950 transition-opacity ${isMuted ? 'opacity-40' : ''}`}
                      style={{ width: totalTimelineWidth, height: TRACK_HEIGHT, cursor: 'grab' }}
                      onPointerDown={(e) => handleWaveformPointerDown(e, track)}
                      onPointerMove={(e) => handleWaveformPointerMove(e, track)}
                      onPointerUp={(e) => void handleWaveformPointerUp(e, track)}
                      onPointerCancel={() => handleWaveformPointerCancel(track)}
                    >
                      {/* Global playhead */}
                      <div
                        className="pointer-events-none absolute top-0 z-20 h-full w-px bg-yellow-400/80"
                        style={{ left: (currentTimeMs / 1000) * PX_PER_SECOND }}
                      />

                      <TrackWaveform
                        ref={(el) => {
                          waveformRefs.current[track.trackVersionId] = el;
                        }}
                        trackVersionId={track.trackVersionId}
                        storageKey={track.storageKey}
                        startOffsetMs={effectiveOffset}
                        durationMs={durationByTrackVersionId[track.trackVersionId] ?? track.durationMs ?? 0}
                        onDurationReady={handleDurationReady}
                      />
                    </div>
                  </div>
                );
              })}

              {/* Live recording track lane */}
              {temporaryRecordingTrack && (
                <RecordingTrackLane
                  track={temporaryRecordingTrack}
                  stream={recordingStream}
                  currentTimeMs={currentTimeMs}
                  totalTimelineWidth={totalTimelineWidth}
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
