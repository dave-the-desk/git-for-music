'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { TransportControls } from './TransportControls';
import { TimelineRuler, PX_PER_SECOND } from './TimelineRuler';
import { TrackWaveform, type TrackWaveformHandle } from './TrackWaveform';
import { RecordingControls } from './RecordingControls';

const TRACK_LABEL_WIDTH = 160;
const TRACK_HEIGHT = 72;
const TICK_INTERVAL_MS = 16;

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

type DemoDawClientProps = {
  groupSlug: string;
  projectSlug: string;
  demoId: string;
  demoName: string;
  demoDescription: string | null;
  currentVersionId: string;
  versions: DawVersion[];
};

function formatDateTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

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

  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadName, setUploadName] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [isReverting, setIsReverting] = useState<string | null>(null);
  const [versionError, setVersionError] = useState<string | null>(null);

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
      return t.startOffsetMs + dur;
    });
    return ends.length ? Math.max(...ends) : 0;
  }, [selectedTracks, durationByTrackVersionId]);

  const totalTimelineWidth = Math.max((totalDurationMs / 1000) * PX_PER_SECOND, 400);

  useEffect(() => {
    setSelectedVersionId(currentVersionId);
    stopTransport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentVersionId]);

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
      if (startMs < t.startOffsetMs + dur) {
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
        const relativeMs = newTimeMs - t.startOffsetMs;
        if (relativeMs >= 0 && relativeMs < dur) {
          // track should be playing; WaveSurfer drives itself
        } else if (relativeMs >= dur) {
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

  async function revertToVersion(version: DawVersion) {
    setVersionError(null);
    setIsReverting(version.id);
    try {
      const response = await fetch('/api/versions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          demoId,
          sourceVersionId: version.id,
          label: `Revert to ${version.label}`,
          description: `Snapshot copied from version ${version.label}`,
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setVersionError(data.error ?? 'Could not revert to selected version');
        return;
      }
      router.refresh();
    } catch {
      setVersionError('Something went wrong while reverting. Please try again.');
    } finally {
      setIsReverting(null);
    }
  }

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Header */}
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
        <TransportControls
          isPlaying={isPlaying}
          currentTimeMs={currentTimeMs}
          onPlay={() => playTransport()}
          onPause={pauseTransport}
          onStop={stopTransport}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        {/* DAW Timeline */}
        <section className="space-y-3 rounded-lg border border-gray-800 bg-gray-950 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Timeline</h2>

          {selectedTracks.length ? (
            <div className="overflow-x-auto rounded-md border border-gray-800">
              {/* Timeline ruler row */}
              <div className="flex" style={{ minWidth: TRACK_LABEL_WIDTH + totalTimelineWidth }}>
                <div className="shrink-0 border-b border-r border-gray-800 bg-gray-900" style={{ width: TRACK_LABEL_WIDTH }} />
                <div className="shrink-0 border-b border-gray-800 overflow-hidden" style={{ width: totalTimelineWidth }}>
                  <TimelineRuler
                    totalDurationMs={totalDurationMs}
                    currentTimeMs={currentTimeMs}
                    onSeek={handleSeek}
                  />
                </div>
              </div>

              {/* Track rows */}
              {selectedTracks.map((track) => (
                <div
                  key={track.trackVersionId}
                  className="flex border-b border-gray-800 last:border-b-0"
                  style={{ height: TRACK_HEIGHT }}
                >
                  {/* Label column */}
                  <div
                    className="flex shrink-0 items-center border-r border-gray-800 bg-gray-900 px-3"
                    style={{ width: TRACK_LABEL_WIDTH }}
                  >
                    <p className="truncate text-sm font-medium text-white">{track.trackName}</p>
                  </div>

                  {/* Waveform area */}
                  <div
                    className="relative shrink-0 bg-gray-950"
                    style={{ width: totalTimelineWidth, height: TRACK_HEIGHT }}
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
                      startOffsetMs={track.startOffsetMs}
                      durationMs={durationByTrackVersionId[track.trackVersionId] ?? track.durationMs ?? 0}
                      onDurationReady={handleDurationReady}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-gray-800 bg-gray-900 px-4 py-8 text-sm text-gray-400">
              This version has no tracks yet. Upload a track to create the next version.
            </div>
          )}

          {/* Upload form */}
          <form onSubmit={onUploadTrack} className="mt-4 space-y-3 rounded-md border border-gray-800 bg-gray-900 p-4">
            <p className="text-sm font-medium text-white">Upload Audio Track</p>
            <label className="block">
              <span className="mb-1 block text-xs uppercase tracking-wide text-gray-400">Track Name (optional)</span>
              <input
                type="text"
                value={uploadName}
                onChange={(e) => setUploadName(e.currentTarget.value)}
                className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm outline-none ring-indigo-500 focus:ring"
                placeholder="Lead Vocal"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs uppercase tracking-wide text-gray-400">Audio File</span>
              <input
                type="file"
                accept="audio/*"
                onChange={(e) => setUploadFile(e.currentTarget.files?.[0] ?? null)}
                className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-indigo-500"
              />
            </label>
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

          <RecordingControls demoId={demoId} onSaved={() => router.refresh()} />
        </section>

        {/* Version History sidebar */}
        <aside className="space-y-3 rounded-lg border border-gray-800 bg-gray-900 p-4">
          <h2 className="text-lg font-semibold text-white">Version History</h2>
          {versionError ? <p className="text-sm text-red-400">{versionError}</p> : null}
          <ul className="space-y-2">
            {versions.map((version) => {
              const isSelected = version.id === selectedVersion?.id;
              return (
                <li key={version.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedVersionId(version.id);
                      stopTransport();
                    }}
                    className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-500/10'
                        : 'border-gray-800 bg-gray-950 hover:bg-gray-900'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-white">{version.label}</p>
                      {version.isCurrent ? (
                        <span className="rounded bg-indigo-900 px-1.5 py-0.5 text-[11px] text-indigo-200">
                          current
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-gray-400">{formatDateTime(version.createdAt)}</p>
                    <p className="mt-1 text-xs text-gray-500">{version.tracks.length} track version(s)</p>
                  </button>
                  {!version.isCurrent ? (
                    <button
                      type="button"
                      onClick={() => void revertToVersion(version)}
                      disabled={Boolean(isReverting)}
                      className="mt-1 w-full rounded-md border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-gray-800 disabled:opacity-60"
                    >
                      {isReverting === version.id ? 'Reverting...' : 'Revert to This Version'}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </aside>
      </div>
    </div>
  );
}
