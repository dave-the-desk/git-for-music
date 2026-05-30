type VersionTrack = {
  trackId: string;
  trackName: string;
};

type VersionLike = {
  id: string;
  label: string;
  parentId: string | null;
  tracks: Array<VersionTrack & {
    trackVersionId?: string;
    segments?: Array<{
      id: string;
      timelineStartMs?: number | null;
      timelineEndMs?: number | null;
      startMs?: number;
      endMs?: number;
      position?: number;
      crossfadeInMs?: number | null;
      crossfadeOutMs?: number | null;
      crossfadeCurve?: string | null;
      }>;
    }>;
  comments?: Array<{
    id: string;
    trackId: string | null;
    segmentId: string | null;
    startTimeMs: number | null;
    endTimeMs: number | null;
    body: string;
    resolved: boolean;
  }>;
  annotations?: Array<{
    id: string;
    trackId: string | null;
    segmentId: string | null;
    startTimeMs: number | null;
    endTimeMs: number | null;
    body: string;
    resolved: boolean;
  }>;
};

export function buildVersionsById<T extends VersionLike>(versions: T[]) {
  return new Map<string, T>(versions.map((version) => [version.id, version]));
}

function hasAddedTrackLabel(label: string) {
  return label.startsWith('Added:') || label.startsWith('Upload:');
}

export function getVersionDisplayLabel<T extends VersionLike>(
  version: T,
  versionsById: Map<string, T>,
) {
  const storedLabel = version.label.trim();
  if (!storedLabel) {
    return `Version ${version.id.slice(0, 7)}`;
  }

  if (!hasAddedTrackLabel(storedLabel)) {
    return storedLabel;
  }

  const parent = version.parentId ? versionsById.get(version.parentId) : null;
  const parentTrackIds = new Set(parent?.tracks.map((track) => track.trackId) ?? []);
  const addedTracks = version.tracks.filter((track) => !parentTrackIds.has(track.trackId));

  if (addedTracks.length === 1) {
    return `Added: ${addedTracks[0].trackName}`;
  }

  if (addedTracks.length > 1) {
    return `Added: ${addedTracks.map((track) => track.trackName).join(', ')}`;
  }

  return storedLabel.replace(/^Upload:/, 'Added:').trim();
}

function trackMap<T extends VersionLike>(version: T | null | undefined) {
  return new Map((version?.tracks ?? []).map((track) => [track.trackId, track]));
}

function hasMeaningfulCrossfadeChange(
  left:
    | {
        crossfadeInMs?: number | null;
        crossfadeOutMs?: number | null;
        crossfadeCurve?: string | null;
      }
    | undefined,
  right:
    | {
        crossfadeInMs?: number | null;
        crossfadeOutMs?: number | null;
        crossfadeCurve?: string | null;
      }
    | undefined,
) {
  if (!left || !right) return false;
  return (
    left.crossfadeInMs !== right.crossfadeInMs ||
    left.crossfadeOutMs !== right.crossfadeOutMs ||
    left.crossfadeCurve !== right.crossfadeCurve
  );
}

function summarizeNotes(
  label: 'Comment' | 'Annotation',
  current:
    | {
        id: string;
        trackId: string | null;
        segmentId: string | null;
        startTimeMs: number | null;
        endTimeMs: number | null;
        body: string;
        resolved: boolean;
      }[]
    | undefined,
  previous:
    | {
        id: string;
        trackId: string | null;
        segmentId: string | null;
        startTimeMs: number | null;
        endTimeMs: number | null;
        body: string;
        resolved: boolean;
      }[]
    | undefined,
) {
  const currentById = new Map((current ?? []).map((note) => [note.id, note]));
  const previousById = new Map((previous ?? []).map((note) => [note.id, note]));

  for (const note of current ?? []) {
    const previousNote = previousById.get(note.id);
    if (!previousNote) {
      return `${label} added`;
    }
    if (
      note.body !== previousNote.body ||
      note.resolved !== previousNote.resolved ||
      note.trackId !== previousNote.trackId ||
      note.segmentId !== previousNote.segmentId ||
      note.startTimeMs !== previousNote.startTimeMs ||
      note.endTimeMs !== previousNote.endTimeMs
    ) {
      return `${label} updated`;
    }
  }

  for (const note of previous ?? []) {
    if (!currentById.has(note.id)) {
      return `${label} deleted`;
    }
  }

  return null;
}

export function getHistoryOperationBadgeLabel(operationType: string) {
  switch (operationType) {
    case 'TRACK_VERSION_CREATED':
      return 'Track version';
    case 'TRACK_RENAMED':
      return 'Track renamed';
    case 'SEGMENT_SPLIT':
      return 'Split';
    case 'SEGMENT_MOVED':
      return 'Moved';
    case 'SEGMENT_TRIMMED':
      return 'Trimmed';
    case 'CROSSFADE_SET':
      return 'Crossfade';
    default:
      return 'Activity';
  }
}

export function getVersionOperationSummary<T extends VersionLike>(
  version: T,
  versionsById: Map<string, T>,
) {
  const parent = version.parentId ? versionsById.get(version.parentId) : null;
  if (!parent) return 'Initial version';

  const parentTracks = trackMap(parent);
  const addedTracks = version.tracks.filter((track) => !parentTracks.has(track.trackId));
  if (addedTracks.length === 1) {
    return `Added: ${addedTracks[0].trackName}`;
  }
  if (addedTracks.length > 1) {
    return `Added: ${addedTracks.map((track) => track.trackName).join(', ')}`;
  }

  for (const track of version.tracks) {
    const previousTrack = parentTracks.get(track.trackId);
    if (!previousTrack) continue;

    const prevSegments = previousTrack.segments ?? [];
    const nextSegments = track.segments ?? [];

    if (nextSegments.length !== prevSegments.length) {
      if (nextSegments.length > prevSegments.length) {
        return `Cut: ${track.trackName}`;
      }
      return `Edited: ${track.trackName}`;
    }

    const prevSegmentsById = new Map(prevSegments.map((segment) => [segment.id, segment]));
    let moved = false;
    let crossfade = false;
    let edited = false;

    for (const segment of nextSegments) {
      const previousSegment = prevSegmentsById.get(segment.id);
      if (!previousSegment) {
        edited = true;
        continue;
      }

      const nextTimelineStartMs = segment.timelineStartMs ?? segment.startMs ?? 0;
      const prevTimelineStartMs = previousSegment.timelineStartMs ?? previousSegment.startMs ?? 0;
      const nextTimelineEndMs =
        segment.timelineEndMs ?? (segment.endMs !== undefined && segment.startMs !== undefined
          ? nextTimelineStartMs + (segment.endMs - segment.startMs)
          : nextTimelineStartMs);
      const prevTimelineEndMs =
        previousSegment.timelineEndMs ?? (previousSegment.endMs !== undefined && previousSegment.startMs !== undefined
          ? prevTimelineStartMs + (previousSegment.endMs - previousSegment.startMs)
          : prevTimelineStartMs);

      if (nextTimelineStartMs !== prevTimelineStartMs || nextTimelineEndMs !== prevTimelineEndMs) {
        moved = true;
      }

      if (hasMeaningfulCrossfadeChange(segment, previousSegment)) {
        crossfade = true;
      }

      if (
        previousSegment.position !== segment.position ||
        previousSegment.startMs !== segment.startMs ||
        previousSegment.endMs !== segment.endMs
      ) {
        edited = true;
      }
    }

    if (crossfade) return `Crossfade: ${track.trackName}`;
    if (moved) return `Moved: ${track.trackName}`;
    if (edited) return `Edited: ${track.trackName}`;
  }

  const noteSummary =
    summarizeNotes('Comment', version.comments, parent.comments) ??
    summarizeNotes('Annotation', version.annotations, parent.annotations);
  if (noteSummary) return noteSummary;

  return 'Updated';
}
