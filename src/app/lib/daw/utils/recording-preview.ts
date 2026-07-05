type TemporaryRecordingTrackLike = {
  syncStatus: 'idle' | 'recording' | 'preview' | 'uploading' | 'complete' | 'error';
  serverTrackVersionId?: string | null;
  serverDemoVersionId?: string | null;
};

export function shouldShowTemporaryRecordingTrack(
  track: TemporaryRecordingTrackLike | null,
) {
  if (!track) return false;

  return !(
    track.syncStatus === 'complete' &&
    Boolean(track.serverTrackVersionId) &&
    Boolean(track.serverDemoVersionId)
  );
}
