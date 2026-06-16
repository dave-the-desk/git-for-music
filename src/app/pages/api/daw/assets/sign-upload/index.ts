import { randomUUID } from 'node:crypto';
import { prisma } from '@git-for-music/db';
import { NextRequest, NextResponse } from 'next/server';
import type { ApiError, DawAssetUploadRequest, DawAssetUploadResponse } from '@git-for-music/shared';
import { getAuthenticatedUserFromRequest } from '@git-for-music/server/app/lib/auth/current-user';
import { createAssetUploadTarget } from '@git-for-music/server/app/lib/daw/server/assets';

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json()) as Partial<DawAssetUploadRequest>;

  if (!body.demoId || !body.projectId || !body.fileName || !body.contentType || typeof body.sizeBytes !== 'number') {
    return NextResponse.json<ApiError>({ error: 'demoId, projectId, fileName, contentType, and sizeBytes are required' }, { status: 400 });
  }

  const demo = await prisma.demo.findFirst({
    where: {
      id: body.demoId,
      projectId: body.projectId,
      project: {
        group: {
          members: {
            some: {
              userId: user.id,
            },
          },
        },
      },
    },
    select: {
      id: true,
      projectId: true,
      project: {
        select: {
          group: {
            select: {
              id: true,
            },
          },
        },
      },
    },
  });

  if (!demo) {
    return NextResponse.json<ApiError>({ error: 'Demo not found' }, { status: 404 });
  }

  let trackId = body.trackId?.trim() || null;
  let createTrack = false;
  if (trackId) {
    const existingTrack = await prisma.track.findFirst({
      where: {
        id: trackId,
        demoId: demo.id,
      },
      select: {
        id: true,
      },
    });

    if (!existingTrack) {
      return NextResponse.json<ApiError>({ error: 'Track not found' }, { status: 404 });
    }
  } else {
    trackId = randomUUID();
    createTrack = true;
  }

  const trackVersionId = body.trackVersionId?.trim() || randomUUID();

  const target = await createAssetUploadTarget({
    userId: user.id,
    groupId: demo.project.group.id,
    projectId: demo.projectId,
    demoId: demo.id,
    trackId,
    trackVersionId,
    name: body.name ?? null,
    sourceVersionId: body.sourceVersionId ?? null,
    sourceType: body.sourceType ?? 'upload',
    timingChoice: body.timingChoice ?? null,
    createTrack,
    fileName: body.fileName,
    contentType: body.contentType,
    sizeBytes: body.sizeBytes,
  });

  const response: DawAssetUploadResponse = {
    assetId: target.assetId,
    objectKey: target.objectKey,
    uploadUrl: target.uploadUrl,
    method: target.method,
    headers: target.headers,
    expiresAt: target.expiresAt,
    uploadToken: target.uploadToken,
    localFallback: target.localFallback,
  };

  return NextResponse.json(response);
}
