export function resolveUploadSourceVersionId(input: {
  selectedVersionId: string | null;
  liveActiveVersionId: string | null;
  freshestCommittedVersionId: string | null;
  isHistoryViewActive: boolean;
}) {
  if (input.isHistoryViewActive) {
    return input.liveActiveVersionId ?? input.selectedVersionId;
  }

  if (input.freshestCommittedVersionId) {
    return input.freshestCommittedVersionId;
  }

  if (input.selectedVersionId) {
    return input.selectedVersionId;
  }

  return input.liveActiveVersionId;
}
