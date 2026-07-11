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
      fadeInMs?: number | null;
      fadeOutMs?: number | null;
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

function compareVersionDisplayOrder(left: VersionLike, right: VersionLike) {
  const leftCreatedAt = Date.parse((left as { createdAt?: string }).createdAt ?? '');
  const rightCreatedAt = Date.parse((right as { createdAt?: string }).createdAt ?? '');
  if (Number.isFinite(leftCreatedAt) && Number.isFinite(rightCreatedAt) && leftCreatedAt !== rightCreatedAt) {
    return leftCreatedAt - rightCreatedAt;
  }

  const leftOperationSeq = (left as { operationSeq?: number | null }).operationSeq ?? 0;
  const rightOperationSeq = (right as { operationSeq?: number | null }).operationSeq ?? 0;
  if (leftOperationSeq !== rightOperationSeq) {
    return leftOperationSeq - rightOperationSeq;
  }

  return left.id.localeCompare(right.id);
}

function getAncestorPath<T extends VersionLike>(version: T, versionsById: Map<string, T>) {
  const path: T[] = [];
  const seen = new Set<string>();
  let current: T | null | undefined = version;

  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.push(current);
    current = current.parentId ? versionsById.get(current.parentId) ?? null : null;
  }

  return path.reverse();
}

function getPrimaryChildren<T extends VersionLike>(versionId: string, versionsById: Map<string, T>) {
  return Array.from(versionsById.values())
    .filter((candidate) => candidate.parentId === versionId)
    .sort(compareVersionDisplayOrder);
}

export function getVersionBranchSource<T extends VersionLike>(version: T, versionsById: Map<string, T>) {
  const path = getAncestorPath(version, versionsById);
  if (path.length <= 1) {
    return path[0] ?? version;
  }

  for (let index = 0; index < path.length - 1; index += 1) {
    const parent = path[index];
    const children = getPrimaryChildren(parent.id, versionsById);
    if (children.length > 1) {
      const branchSource = path[index + 1] ?? path[1] ?? path[0] ?? version;
      return branchSource;
    }
  }

  return path[1] ?? path[0] ?? version;
}

export function getVersionBranchDisplayLabel<T extends VersionLike>(
  version: T,
  versionsById: Map<string, T>,
  demoName = 'Demo',
) {
  return getVersionDisplayLabel(getVersionBranchSource(version, versionsById), versionsById, demoName);
}

function hasAddedTrackLabel(label: string) {
  return label.startsWith('Added:') || label.startsWith('Upload:');
}

export function getVersionDisplayLabel<T extends VersionLike>(
  version: T,
  versionsById: Map<string, T>,
  demoName = 'Demo',
) {
  if (!version.parentId) {
    return `${demoName.trim() || 'Demo'} created`;
  }

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

function hasMeaningfulFadeChange(
  left:
    | {
        fadeInMs?: number | null;
        fadeOutMs?: number | null;
      }
    | undefined,
  right:
    | {
        fadeInMs?: number | null;
        fadeOutMs?: number | null;
      }
    | undefined,
) {
  if (!left || !right) return false;
  return left.fadeInMs !== right.fadeInMs || left.fadeOutMs !== right.fadeOutMs;
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
    case 'SEGMENT_FADE_SET':
      return 'Fade';
    case 'CROSSFADE_SET':
      return 'Crossfade';
    default:
      return 'Activity';
  }
}

export function getVersionOperationSummary<T extends VersionLike>(
  version: T,
  versionsById: Map<string, T>,
  demoName = 'Demo',
) {
  const parent = version.parentId ? versionsById.get(version.parentId) : null;
  if (!parent) return `${demoName.trim() || 'Demo'} created`;

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
    let faded = false;
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

      if (hasMeaningfulFadeChange(segment, previousSegment)) {
        faded = true;
      }

      if (
        previousSegment.position !== segment.position ||
        previousSegment.startMs !== segment.startMs ||
        previousSegment.endMs !== segment.endMs
      ) {
        edited = true;
      }
    }

    if (faded) return `Fade: ${track.trackName}`;
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
