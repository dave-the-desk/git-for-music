type TrackNameLike = {
  trackName: string;
};

function getHighestTrackNumber(tracks: TrackNameLike[]) {
  return tracks.reduce((maxTrackNumber, track) => {
    const match = /^Track (\d+)$/.exec(track.trackName.trim());
    if (!match) return maxTrackNumber;

    const trackNumber = Number(match[1]);
    return Number.isFinite(trackNumber) ? Math.max(maxTrackNumber, trackNumber) : maxTrackNumber;
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
