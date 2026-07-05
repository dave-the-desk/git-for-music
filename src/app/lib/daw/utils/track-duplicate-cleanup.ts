import { EMPTY_TRACK_MIME_TYPE } from './segments';

export type TrackDuplicateLike = {
  trackVersionId: string;
  trackId: string;
  trackName: string;
  mimeType: string | null;
};

function isBlankTrack(track: TrackDuplicateLike) {
  return track.mimeType === EMPTY_TRACK_MIME_TYPE;
}

function normalizeTrackName(trackName: string) {
  return trackName.trim();
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
  const removalIds = new Set<string>();

  for (const id of collectRemovalIdsByKey(tracks, (track) => track.trackId)) {
    removalIds.add(id);
  }

  for (const id of collectRemovalIdsByKey(tracks, (track) => normalizeTrackName(track.trackName))) {
    removalIds.add(id);
  }

  return [...removalIds];
}

export function pruneDuplicateBlankTracks<T extends TrackDuplicateLike>(tracks: T[]) {
  const removalIds = new Set(getDuplicateBlankTrackVersionIds(tracks));
  return tracks.filter((track) => !removalIds.has(track.trackVersionId));
}
