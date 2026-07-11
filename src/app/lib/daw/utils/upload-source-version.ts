export function resolveUploadSourceVersionId(input: {
  selectedVersionId: string | null;
  liveActiveVersionId: string | null;
  freshestCommittedVersionId: string | null;
}) {
  if (input.selectedVersionId) {
    return input.selectedVersionId;
  }

  if (input.liveActiveVersionId) {
    return input.liveActiveVersionId;
  }

  return input.freshestCommittedVersionId;
}
