const EMPTY_TRACK_MIME_TYPE = 'application/x-git-for-music-empty-track';

export type TrackDuplicateLike = {
  trackVersionId: string;
  trackId: string;
  trackName: string;
  mimeType: string | null;
};

function isBlankTrack(track: TrackDuplicateLike) {
  return track.mimeType === EMPTY_TRACK_MIME_TYPE;
}

function collectRemovalIdsByKey(
  tracks: TrackDuplicateLike[],
  getKey: (track: TrackDuplicateLike) => string,
) {
  const removalIds = new Set<string>();
  const groups = new Map<string, TrackDuplicateLike[]>();

  for (const track of tracks) {
    const key = getKey(track);
    const group = groups.get(key);
    if (group) {
      group.push(track);
    } else {
      groups.set(key, [track]);
    }
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;

    const audioTracks = group.filter((track) => !isBlankTrack(track));
    const blankTracks = group.filter((track) => isBlankTrack(track));

    if (audioTracks.length > 0) {
      for (const blankTrack of blankTracks) {
        removalIds.add(blankTrack.trackVersionId);
      }
      continue;
    }

    for (const duplicateTrack of group.slice(1)) {
      removalIds.add(duplicateTrack.trackVersionId);
    }
  }

  return removalIds;
}

export function getDuplicateBlankTrackVersionIds(tracks: TrackDuplicateLike[]) {
  // Names are mutable display metadata. Only a stable logical track ID can
  // prove that a blank placeholder and an audio version represent one track.
  return [...collectRemovalIdsByKey(tracks, (track) => track.trackId)];
}
