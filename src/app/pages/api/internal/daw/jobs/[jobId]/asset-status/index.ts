import { prisma } from '@git-for-music/db';
import { NextRequest, NextResponse } from 'next/server';
import type { ApiError } from '@git-for-music/shared';
import { emitDawAssetProcessingStatus } from '@git-for-music/server/app/lib/daw/server/realtime-gateway';

const WORKER_SECRET = process.env.DAW_WORKER_CALLBACK_SECRET?.trim() ?? '';

type WorkerAssetStatus = 'queued' | 'processing' | 'complete' | 'failed';

type WorkerCallbackBody = {
  status?: WorkerAssetStatus;
  message?: string | null;
};

const assetSelect = {
  id: true,
  projectId: true,
  demoId: true,
  trackId: true,
  trackVersionId: true,
} as const;

const DERIVED_ASSET_JOB_TYPES = new Set(['CREATE_DERIVED_AUDIO', 'TIME_STRETCH_TO_PROJECT']);

function isAssetStatus(value: unknown): value is WorkerAssetStatus {
  return value === 'queued' || value === 'processing' || value === 'complete' || value === 'failed';
}

async function loadAssetByTrackVersion(trackVersionId: string, assetKind: 'ORIGINAL' | 'PEAKS' | 'DERIVED' | 'ANALYSIS') {
  return prisma.audioAssetMetadata.findFirst({
    where: {
      trackVersionId,
      assetKind,
    },
    select: assetSelect,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  if (!WORKER_SECRET) {
    return NextResponse.json<ApiError>({ error: 'Worker callbacks are not configured' }, { status: 503 });
  }

  const secret = req.headers.get('x-daw-worker-secret');
  if (secret !== WORKER_SECRET) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const { jobId } = await params;
  if (!jobId) {
    return NextResponse.json<ApiError>({ error: 'Job not found' }, { status: 404 });
  }

  let body: WorkerCallbackBody;
  try {
    body = (await req.json()) as WorkerCallbackBody;
  } catch {
    return NextResponse.json<ApiError>({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!isAssetStatus(body.status)) {
    return NextResponse.json<ApiError>({ error: 'status is required' }, { status: 400 });
  }

  const job = await prisma.processingJob.findFirst({
    where: {
      id: jobId,
    },
    select: {
      id: true,
      type: true,
      trackVersionId: true,
      result: true,
      createdTrackVersion: {
        select: {
          id: true,
        },
      },
    },
  });

  if (!job) {
    return NextResponse.json<ApiError>({ error: 'Job not found' }, { status: 404 });
  }

  const sourceAsset = await loadAssetByTrackVersion(job.trackVersionId, 'ORIGINAL');
  const peaksAsset = await loadAssetByTrackVersion(job.trackVersionId, 'PEAKS');
  const derivedTrackVersionId = job.createdTrackVersion?.id ?? null;
  const derivedAsset = derivedTrackVersionId ? await loadAssetByTrackVersion(derivedTrackVersionId, 'DERIVED') : null;
  const analysisAsset = await loadAssetByTrackVersion(job.trackVersionId, 'ANALYSIS');

  const result = (job.result as { derivedAssetId?: string; peaksAssetId?: string } | null) ?? null;
  const explicitAssetId = result?.derivedAssetId ?? result?.peaksAssetId ?? null;
  const explicitAsset = explicitAssetId
    ? await prisma.audioAssetMetadata.findUnique({
        where: {
          id: explicitAssetId,
        },
        select: assetSelect,
      })
    : null;

  const asset =
    body.status === 'processing'
      ? sourceAsset ?? peaksAsset ?? analysisAsset ?? derivedAsset
      : explicitAsset ??
        (DERIVED_ASSET_JOB_TYPES.has(job.type)
          ? derivedAsset ?? peaksAsset ?? sourceAsset
          : peaksAsset ?? analysisAsset ?? sourceAsset ?? derivedAsset);

  if (!asset) {
    return NextResponse.json<ApiError>({ error: 'Asset metadata not found' }, { status: 404 });
  }

  emitDawAssetProcessingStatus({
    projectId: asset.projectId,
    demoId: asset.demoId,
    assetId: asset.id,
    status: body.status,
    trackId: asset.trackId,
    trackVersionId: asset.trackVersionId,
    message: body.message ?? null,
  });

  return new NextResponse(null, { status: 204 });
}
