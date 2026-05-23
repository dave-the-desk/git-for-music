import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildTrackVersionObjectKey } from '@/features/daw/server/storage';

export function fileNameWithoutExtension(fileName: string) {
  const extension = path.extname(fileName);
  return fileName.slice(0, fileName.length - extension.length) || fileName;
}

export async function storeTrackUploadAsset(input: {
  groupId: string;
  projectId: string;
  demoId: string;
  trackId: string;
  trackVersionId: string;
  assetId: string;
  fileName: string;
  rawBuffer: Buffer;
}) {
  const storageObjectKey = buildTrackVersionObjectKey({
    groupId: input.groupId,
    projectId: input.projectId,
    demoId: input.demoId,
    trackId: input.trackId,
    trackVersionId: input.trackVersionId,
    assetId: input.assetId,
    fileName: input.fileName,
  });
  const storageKey = `/${storageObjectKey}`;
  const uploadDir = path.join(process.cwd(), 'public', path.dirname(storageObjectKey));
  const absolutePath = path.join(process.cwd(), 'public', storageObjectKey);

  await mkdir(uploadDir, { recursive: true });
  await writeFile(absolutePath, input.rawBuffer);

  return {
    absolutePath,
    originalName: input.fileName,
    storageKey,
    storageObjectKey,
  };
}
