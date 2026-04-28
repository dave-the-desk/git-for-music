type VersionTrack = {
  trackId: string;
  trackName: string;
};

type VersionLike = {
  id: string;
  label: string;
  parentId: string | null;
  tracks: VersionTrack[];
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
