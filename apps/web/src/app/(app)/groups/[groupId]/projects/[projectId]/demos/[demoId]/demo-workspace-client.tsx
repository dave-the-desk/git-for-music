'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type DemoWorkspaceTrack = {
  trackId: string;
  trackName: string;
  trackPosition: number;
  trackVersionId: string;
  storageKey: string;
  mimeType: string | null;
  durationMs: number | null;
  createdAt: string;
};

type DemoWorkspaceVersion = {
  id: string;
  label: string;
  description: string | null;
  parentId: string | null;
  createdAt: string;
  isCurrent: boolean;
  tracks: DemoWorkspaceTrack[];
};

type DemoWorkspaceClientProps = {
  groupSlug: string;
  projectSlug: string;
  demoId: string;
  demoName: string;
  demoDescription: string | null;
  currentVersionId: string;
  versions: DemoWorkspaceVersion[];
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

function formatDurationFromSeconds(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return '--:--';
  }

  const rounded = Math.floor(totalSeconds);
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function DemoWorkspaceClient({
  groupSlug,
  projectSlug,
  demoId,
  demoName,
  demoDescription,
  currentVersionId,
  versions,
}: DemoWorkspaceClientProps) {
  const router = useRouter();
  const [selectedVersionId, setSelectedVersionId] = useState(currentVersionId);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadName, setUploadName] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [isReverting, setIsReverting] = useState<string | null>(null);
  const [versionError, setVersionError] = useState<string | null>(null);
  const [durationByTrackVersionId, setDurationByTrackVersionId] = useState<Record<string, number>>({});

  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});

  useEffect(() => {
    setSelectedVersionId(currentVersionId);
    Object.values(audioRefs.current).forEach((player) => player?.pause());
    setIsPlaying(false);
  }, [currentVersionId]);

  const selectedVersion = useMemo(
    () => versions.find((version) => version.id === selectedVersionId) ?? versions[0],
    [selectedVersionId, versions],
  );

  const selectedTracks = useMemo(() => {
    if (!selectedVersion) {
      return [];
    }

    return [...selectedVersion.tracks].sort((left, right) => left.trackPosition - right.trackPosition);
  }, [selectedVersion]);

  const maxDurationSeconds = useMemo(() => {
    const durations = selectedTracks
      .map((track) => durationByTrackVersionId[track.trackVersionId] ?? (track.durationMs ? track.durationMs / 1000 : 0))
      .filter((duration) => duration > 0);

    return durations.length ? Math.max(...durations) : 0;
  }, [durationByTrackVersionId, selectedTracks]);

  function getTrackDurationSeconds(track: DemoWorkspaceTrack) {
    return durationByTrackVersionId[track.trackVersionId] ?? (track.durationMs ? track.durationMs / 1000 : 0);
  }

  function pauseSelectedTracks() {
    selectedTracks.forEach((track) => {
      audioRefs.current[track.trackVersionId]?.pause();
    });
    setIsPlaying(false);
  }

  async function togglePlayPause() {
    const players = selectedTracks
      .map((track) => audioRefs.current[track.trackVersionId])
      .filter((player): player is HTMLAudioElement => Boolean(player));

    if (!players.length) {
      return;
    }

    if (isPlaying) {
      pauseSelectedTracks();
      return;
    }

    const syncStartTime = players[0]?.currentTime ?? 0;

    const playResults = await Promise.all(
      players.map(async (player) => {
        if (Math.abs(player.currentTime - syncStartTime) > 0.1) {
          player.currentTime = syncStartTime;
        }

        try {
          await player.play();
          return true;
        } catch {
          return false;
        }
      }),
    );

    setIsPlaying(playResults.some(Boolean));
  }

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
      if (uploadName.trim()) {
        formData.append('name', uploadName.trim());
      }
      formData.append('file', uploadFile);

      const response = await fetch('/api/tracks/upload', {
        method: 'POST',
        body: formData,
      });

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

  async function revertToVersion(version: DemoWorkspaceVersion) {
    setVersionError(null);
    setIsReverting(version.id);

    try {
      const response = await fetch('/api/versions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
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
    <div className="space-y-6">
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
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <section className="space-y-4 rounded-lg border border-gray-800 bg-gray-900 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-white">Tracks</h2>
            <button
              type="button"
              onClick={() => void togglePlayPause()}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
            >
              {isPlaying ? 'Pause' : 'Play'}
            </button>
          </div>

          <form onSubmit={onUploadTrack} className="space-y-3 rounded-md border border-gray-800 bg-gray-950 p-4">
            <p className="text-sm font-medium text-white">Upload Audio Track</p>
            <label className="block">
              <span className="mb-1 block text-xs uppercase tracking-wide text-gray-400">Track Name (optional)</span>
              <input
                type="text"
                value={uploadName}
                onChange={(event) => setUploadName(event.currentTarget.value)}
                className="w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm outline-none ring-indigo-500 focus:ring"
                placeholder="Lead Vocal"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs uppercase tracking-wide text-gray-400">Audio File</span>
              <input
                type="file"
                accept="audio/*"
                onChange={(event) => setUploadFile(event.currentTarget.files?.[0] ?? null)}
                className="w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-200 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-indigo-500"
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

          {selectedTracks.length ? (
            <div className="space-y-3">
              {selectedTracks.map((track) => {
                const duration = getTrackDurationSeconds(track);
                const widthPercent = maxDurationSeconds
                  ? Math.max(8, Math.round((duration / maxDurationSeconds) * 100))
                  : 100;

                return (
                  <div key={track.trackVersionId} className="rounded-md border border-gray-800 bg-gray-950 p-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-white">{track.trackName}</p>
                      <p className="text-xs text-gray-400">{formatDurationFromSeconds(duration)}</p>
                    </div>

                    <div className="mb-3 h-3 rounded bg-gray-800">
                      <div
                        className="h-full rounded bg-indigo-500/80"
                        style={{ width: `${widthPercent}%` }}
                      />
                    </div>

                    <audio
                      ref={(element) => {
                        audioRefs.current[track.trackVersionId] = element;
                      }}
                      src={track.storageKey}
                      controls
                      className="w-full"
                      onPlay={() => setIsPlaying(true)}
                      onPause={() => setIsPlaying(false)}
                      onEnded={() => setIsPlaying(false)}
                      onLoadedMetadata={(event) => {
                        const durationSeconds = event.currentTarget.duration;
                        if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
                          return;
                        }

                        setDurationByTrackVersionId((previous) => ({
                          ...previous,
                          [track.trackVersionId]: durationSeconds,
                        }));
                      }}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-md border border-gray-800 bg-gray-950 px-4 py-8 text-sm text-gray-400">
              This version has no tracks yet. Upload a track to create the next version.
            </div>
          )}
        </section>

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
                      pauseSelectedTracks();
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
