import { prisma } from '@git-for-music/db';
import { NextResponse } from 'next/server';
import type {
  ApiError,
  DemoTimingMetadata,
  UpdateDemoVersionTimingRequest,
} from '@git-for-music/shared';
import { isValidTempoBpm, normalizeTimeSignature } from '@/features/daw/utils/timing';
import type { DawProjectOperationRecord } from '@/features/daw/protocol';
import { recordDemoDawOperation } from '@/features/daw/server/snapshot-builder';
import { emitAcceptedDawOperation } from '@/features/daw/server/realtime-gateway';

const MAX_LABEL_LENGTH = 120;
const VALID_DENOMINATORS = new Set([1, 2, 4, 8, 16, 32]);
const VALID_TIMING_SOURCES = new Set(['MANUAL', 'ANALYZED', 'IMPORTED']);

function serializeTiming(version: {
  id: string;
  label: string;
  tempoBpm: number | null;
  timeSignatureNum: number;
  timeSignatureDen: number;
  musicalKey: string | null;
  tempoSource: 'MANUAL' | 'ANALYZED' | 'IMPORTED';
  keySource: 'MANUAL' | 'ANALYZED' | 'IMPORTED';
}) {
  return {
    id: version.id,
    label: version.label,
    tempoBpm: version.tempoBpm,
    timeSignature: {
      num: version.timeSignatureNum,
      den: version.timeSignatureDen,
    },
    musicalKey: version.musicalKey,
    tempoSource: version.tempoSource,
    keySource: version.keySource,
  } satisfies DemoTimingMetadata & { id: string; label: string };
}

export async function updateDemoVersionTimingCommand(input: {
  userId: string;
  versionId: string;
  body: Partial<UpdateDemoVersionTimingRequest>;
}) {
  const body = input.body;
  const hasLabel = typeof body.label === 'string';
  const hasTempo = body.tempoBpm !== undefined;
  const hasTimeSignature =
    body.timeSignatureNum !== undefined || body.timeSignatureDen !== undefined;
  const hasKey = body.musicalKey !== undefined;
  const hasTimingSource = body.tempoSource !== undefined || body.keySource !== undefined;

  if (!hasLabel && !hasTempo && !hasTimeSignature && !hasKey && !hasTimingSource) {
    return NextResponse.json<ApiError>({ error: 'No changes provided' }, { status: 400 });
  }

  const nextLabel = hasLabel ? body.label?.trim() ?? '' : undefined;
  if (nextLabel !== undefined && !nextLabel) {
    return NextResponse.json<ApiError>({ error: 'Label is required' }, { status: 400 });
  }
  if (nextLabel !== undefined && nextLabel.length > MAX_LABEL_LENGTH) {
    return NextResponse.json<ApiError>(
      { error: `Label must be ${MAX_LABEL_LENGTH} characters or fewer` },
      { status: 400 },
    );
  }

  let timeSignature = null as ReturnType<typeof normalizeTimeSignature> | null;
  if (hasTimeSignature) {
    timeSignature = normalizeTimeSignature({
      num: body.timeSignatureNum,
      den: body.timeSignatureDen,
    });
    if (!VALID_DENOMINATORS.has(timeSignature.den)) {
      return NextResponse.json<ApiError>(
        { error: 'Time signature denominator must be a standard musical denominator' },
        { status: 400 },
      );
    }
  }

  if (body.tempoBpm !== undefined && body.tempoBpm !== null && !isValidTempoBpm(body.tempoBpm)) {
    return NextResponse.json<ApiError>(
      { error: 'Tempo must be between 20 and 300 BPM' },
      { status: 400 },
    );
  }

  if (body.tempoSource !== undefined && !VALID_TIMING_SOURCES.has(body.tempoSource)) {
    return NextResponse.json<ApiError>({ error: 'Invalid tempo source' }, { status: 400 });
  }

  if (body.keySource !== undefined && !VALID_TIMING_SOURCES.has(body.keySource)) {
    return NextResponse.json<ApiError>({ error: 'Invalid key source' }, { status: 400 });
  }

  const version = await prisma.demoVersion.findFirst({
    where: {
      id: input.versionId,
      demo: {
        project: {
          group: {
            members: { some: { userId: input.userId } },
          },
        },
      },
    },
    select: {
      id: true,
      demoId: true,
      demo: {
        select: {
          project: {
            select: {
              id: true,
            },
          },
        },
      },
    },
  });

  if (!version) {
    return NextResponse.json<ApiError>({ error: 'Version not found' }, { status: 404 });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.demoVersion.update({
      where: { id: input.versionId },
      data: {
        ...(nextLabel !== undefined ? { label: nextLabel } : {}),
        ...(body.tempoBpm !== undefined ? { tempoBpm: body.tempoBpm } : {}),
        ...(timeSignature
          ? {
              timeSignatureNum: timeSignature.num,
              timeSignatureDen: timeSignature.den,
            }
          : {}),
        ...(body.musicalKey !== undefined ? { musicalKey: body.musicalKey?.trim() || null } : {}),
        ...(body.tempoSource !== undefined ? { tempoSource: body.tempoSource } : {}),
        ...(body.keySource !== undefined ? { keySource: body.keySource } : {}),
      },
      select: {
        id: true,
        label: true,
        tempoBpm: true,
        timeSignatureNum: true,
        timeSignatureDen: true,
        musicalKey: true,
        tempoSource: true,
        keySource: true,
      },
    });

    const operation = await recordDemoDawOperation(tx, {
      projectId: version.demo.project.id,
      demoId: version.demoId,
      actorUserId: input.userId,
      operationType: 'VERSION_TIMING_UPDATED',
      payload: {
        versionId: next.id,
        label: next.label,
        tempoBpm: next.tempoBpm,
        timeSignatureNum: next.timeSignatureNum,
        timeSignatureDen: next.timeSignatureDen,
        musicalKey: next.musicalKey,
        tempoSource: next.tempoSource,
        keySource: next.keySource,
      },
    });

    return { next, operation };
  });

  if (updated.operation.created) {
    emitAcceptedDawOperation({
      projectId: version.demo.project.id,
      demoId: version.demoId,
      operationId: updated.operation.id,
      operationSeq: updated.operation.operationSeq,
      actorUserId: updated.operation.actorUserId ?? input.userId,
      operationType: updated.operation.operationType ?? 'VERSION_TIMING_UPDATED',
      payload: updated.operation.payload as DawProjectOperationRecord['payload'],
      createdAt: updated.operation.createdAt ?? new Date().toISOString(),
      idempotencyKey: updated.operation.idempotencyKey ?? null,
      clientOperationId: updated.operation.clientOperationId ?? null,
      baseSnapshotId: updated.operation.baseSnapshotId ?? null,
      baseOperationSeq: updated.operation.baseOperationSeq ?? 0,
    });
  }

  return NextResponse.json(serializeTiming(updated.next));
}
