type TrackNameLike = {
  trackName: string;
  trackPosition?: number;
};

function getHighestTrackNumber(tracks: TrackNameLike[]) {
  return tracks.reduce((maxTrackNumber, track) => {
    const positionNumber =
      typeof track.trackPosition === 'number' && Number.isFinite(track.trackPosition)
        ? Math.max(0, Math.floor(track.trackPosition)) + 1
        : 0;
    const match = /^Track (\d+)$/.exec(track.trackName.trim());
    if (!match) return Math.max(maxTrackNumber, positionNumber);

    const trackNumber = Number(match[1]);
    return Number.isFinite(trackNumber)
      ? Math.max(maxTrackNumber, positionNumber, trackNumber)
      : Math.max(maxTrackNumber, positionNumber);
  }, 0);
}

export function getNextEmptyTrackName(tracks: TrackNameLike[]) {
  return `Track ${getHighestTrackNumber(tracks) + 1}`;
}

export function getNextUploadTrackName(input: {
  liveActiveVersionId: string | null;
  selectedVersionId: string | null;
  liveActiveTracks: TrackNameLike[];
  selectedTracks: TrackNameLike[];
}) {
  if (input.selectedVersionId) {
    return getNextEmptyTrackName(input.selectedTracks);
  }

  if (input.liveActiveVersionId) {
    return getNextEmptyTrackName(input.liveActiveTracks);
  }

  return getNextEmptyTrackName(input.selectedTracks);
}
