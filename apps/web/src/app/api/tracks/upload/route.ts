import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@git-for-music/db';
import { NextRequest, NextResponse } from 'next/server';
import type { ApiError, UploadTimingChoice, UploadTrackResponse } from '@git-for-music/shared';
import { getAuthenticatedUserFromRequest } from '@/lib/auth/current-user';
import { createDemoVersionWithCopiedTracks } from '@/features/daw/api/versioning';
import { buildTrackVersionStorageKey } from '@/features/daw/api/storage';
import { enqueueProcessingJob } from '@/lib/processing/jobs';

export const runtime = 'nodejs';

function sanitizeFileName(fileName: string) {
  return fileName
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 120);
}

function fileNameWithoutExtension(fileName: string) {
  const extension = path.extname(fileName);
  return fileName.slice(0, fileName.length - extension.length) || fileName;
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const contentType = req.headers.get('content-type') ?? '';

  if (!contentType.startsWith('multipart/form-data')) {
    return NextResponse.json<ApiError>(
      { error: 'multipart/form-data required' },
      { status: 415 },
    );
  }

  const formData = await req.formData();
  const demoId = formData.get('demoId');
  const name = formData.get('name');
  const incomingTrackId = formData.get('trackId');
  const sourceVersionId = formData.get('sourceVersionId');
  const timingChoiceRaw = formData.get('timingChoice');
  const file = formData.get('file');

  if (typeof demoId !== 'string' || !demoId.trim()) {
    return NextResponse.json<ApiError>({ error: 'demoId is required' }, { status: 400 });
  }

  if (!(file instanceof File)) {
    return NextResponse.json<ApiError>({ error: 'Audio file is required' }, { status: 400 });
  }

  const demo = await prisma.demo.findFirst({
    where: {
      id: demoId,
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
      currentVersionId: true,
      project: {
        select: {
          id: true,
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

  const currentVersionId = demo.currentVersionId;
  if (!currentVersionId) {
    return NextResponse.json<ApiError>(
      { error: 'Demo has no current version yet' },
      { status: 400 },
    );
  }

  let selectedSourceVersionId = currentVersionId;
  if (typeof sourceVersionId === 'string' && sourceVersionId.trim()) {
    const version = await prisma.demoVersion.findFirst({
      where: {
        id: sourceVersionId,
        demoId: demo.id,
      },
      select: {
        id: true,
      },
    });

    if (!version) {
      return NextResponse.json<ApiError>({ error: 'Source version not found' }, { status: 404 });
    }

    selectedSourceVersionId = version.id;
  }

  const rawBuffer = Buffer.from(await file.arrayBuffer());
  const timestamp = Date.now();
  const originalName = sanitizeFileName(file.name || `track-${timestamp}.wav`);
  const checksum = createHash('sha256').update(rawBuffer).digest('hex');
  const trackVersionId = randomUUID();

  let existingTrackId: string | null = null;
  if (typeof incomingTrackId === 'string' && incomingTrackId) {
    const existingTrack = await prisma.track.findFirst({
      where: {
        id: incomingTrackId,
        demoId: demo.id,
      },
      select: {
        id: true,
      },
    });

    if (!existingTrack) {
      return NextResponse.json<ApiError>({ error: 'Track not found' }, { status: 404 });
    }

    existingTrackId = existingTrack.id;
  }

  const trackId = existingTrackId ?? randomUUID();
  const storageObjectKey = buildTrackVersionStorageKey({
    groupId: demo.project.group.id,
    projectId: demo.project.id,
    demoId: demo.id,
    trackId,
    trackVersionId,
    artifact: 'original-audio',
    fileName: originalName,
  });
  const storageKey = `/uploads/${storageObjectKey}`;
  const uploadDir = path.join(process.cwd(), 'public', 'uploads', path.dirname(storageObjectKey));
  const absolutePath = path.join(process.cwd(), 'public', 'uploads', storageObjectKey);

  await mkdir(uploadDir, { recursive: true });
  await writeFile(absolutePath, rawBuffer);

  const createdTrackVersion = await prisma.$transaction(async (tx) => {
    const nextVersion = await createDemoVersionWithCopiedTracks(tx, {
      demoId: demo.id,
      sourceVersionId: selectedSourceVersionId,
      parentId: selectedSourceVersionId,
      label: `Added: ${typeof name === 'string' && name.trim() ? name.trim() : fileNameWithoutExtension(originalName)}`,
      description: 'Added audio track',
    });

    if (!existingTrackId) {
      const highestPositionTrack = await tx.track.findFirst({
        where: {
          demoId: demo.id,
        },
        orderBy: {
          position: 'desc',
        },
        select: {
          position: true,
        },
      });

      await tx.track.create({
        data: {
          id: trackId,
          demoId: demo.id,
          name:
            typeof name === 'string' && name.trim()
              ? name.trim()
              : fileNameWithoutExtension(originalName),
          position: (highestPositionTrack?.position ?? -1) + 1,
        },
        select: {
          id: true,
        },
      });
    }

    const trackVersion = await tx.trackVersion.create({
      data: {
        id: trackVersionId,
        trackId,
        demoVersionId: nextVersion.id,
        storageKey,
        mimeType: file.type || 'audio/mpeg',
        sizeBytes: BigInt(file.size),
        checksum,
      },
      select: {
        id: true,
      },
    });

    const timingChoice =
      timingChoiceRaw === 'keepProjectTempo' ||
      timingChoiceRaw === 'updateProjectTempoFromUpload' ||
      timingChoiceRaw === 'uploadUnchanged'
        ? (timingChoiceRaw as UploadTimingChoice)
        : 'uploadUnchanged';

    const jobIds: string[] = [];

    if (timingChoice === 'keepProjectTempo') {
      const job = await enqueueProcessingJob(tx, {
        type: 'TIME_STRETCH_TO_PROJECT',
        trackVersionId: trackVersion.id,
        createdById: user.id,
        payload: {
          demoId: demo.id,
          demoVersionId: nextVersion.id,
          trackVersionId: trackVersion.id,
        },
      });
      jobIds.push(job.id);
    } else if (timingChoice === 'updateProjectTempoFromUpload') {
      const job = await enqueueProcessingJob(tx, {
        type: 'PROJECT_RETEMPO_FROM_TRACK',
        trackVersionId: trackVersion.id,
        createdById: user.id,
        payload: {
          demoId: demo.id,
          demoVersionId: nextVersion.id,
          trackVersionId: trackVersion.id,
        },
      });
      jobIds.push(job.id);
    }

    await tx.demo.update({
      where: {
        id: demo.id,
      },
      data: {
        currentVersionId: nextVersion.id,
      },
      select: {
        id: true,
      },
    });

    return {
      trackVersionId: trackVersion.id,
      demoVersionId: nextVersion.id,
      jobIds,
    };
  });

  const response: UploadTrackResponse = {
    trackVersionId: createdTrackVersion.trackVersionId,
    demoVersionId: createdTrackVersion.demoVersionId,
    status: 'ready',
    processingJobIds: createdTrackVersion.jobIds,
  };

  return NextResponse.json(response, { status: 201 });
}
