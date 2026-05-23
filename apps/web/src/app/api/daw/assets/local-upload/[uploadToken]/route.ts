import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import type { ApiError } from '@git-for-music/shared';
import { verifyAssetUploadToken } from '@/features/daw/server/assets';
import { normalizeLegacyUploadKey } from '@git-for-music/shared';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ uploadToken: string }> },
) {
  const { uploadToken } = await params;
  const token = verifyAssetUploadToken(uploadToken);
  if (!token) {
    return NextResponse.json<ApiError>({ error: 'Invalid or expired upload token' }, { status: 400 });
  }

  const bytes = Buffer.from(await req.arrayBuffer());
  const uploadPath = path.join(
    process.cwd(),
    'public',
    normalizeLegacyUploadKey(token.objectKey),
  );
  await mkdir(path.dirname(uploadPath), { recursive: true });
  await writeFile(uploadPath, bytes);

  return new NextResponse(null, { status: 204 });
}
