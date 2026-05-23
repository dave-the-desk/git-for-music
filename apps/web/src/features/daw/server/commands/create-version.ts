import { prisma } from '@git-for-music/db';
import { NextResponse } from 'next/server';
import type { ApiError } from '@git-for-music/shared';
import { checkpointDemoDawSnapshot } from '@/features/daw/server/snapshot-builder';
import { createDemoVersionWithCopiedTracks } from '@/features/daw/server/versions';

const MAX_LABEL_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 500;

export async function createDemoVersionCommand(input: {
  userId: string;
  demoId: string;
  label?: string | null;
  description?: string | null;
  sourceVersionId?: string | null;
}) {
  if (!input.demoId.trim()) {
    return NextResponse.json<ApiError>({ error: 'demoId is required' }, { status: 400 });
  }

  const label = input.label?.trim() ?? '';
  const description = input.description?.trim() ?? '';

  if (label.length > MAX_LABEL_LENGTH) {
    return NextResponse.json<ApiError>(
      { error: `Version label must be ${MAX_LABEL_LENGTH} characters or fewer` },
      { status: 400 },
    );
  }

  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return NextResponse.json<ApiError>(
      { error: `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer` },
      { status: 400 },
    );
  }

  const demo = await prisma.demo.findFirst({
    where: {
      id: input.demoId,
      project: {
        group: {
          members: {
            some: {
              userId: input.userId,
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
        },
      },
    },
  });

  if (!demo) {
    return NextResponse.json<ApiError>({ error: 'Demo not found' }, { status: 404 });
  }

  const sourceVersionId = input.sourceVersionId ?? demo.currentVersionId;

  if (!sourceVersionId) {
    return NextResponse.json<ApiError>(
      { error: 'No source version available to copy' },
      { status: 400 },
    );
  }

  const sourceVersion = await prisma.demoVersion.findFirst({
    where: {
      id: sourceVersionId,
      demoId: demo.id,
    },
    select: {
      id: true,
      label: true,
    },
  });

  if (!sourceVersion) {
    return NextResponse.json<ApiError>(
      { error: 'Selected source version was not found' },
      { status: 404 },
    );
  }

  const createdVersion = await prisma.$transaction(async (tx) => {
    const version = await createDemoVersionWithCopiedTracks(tx, {
      demoId: demo.id,
      sourceVersionId: sourceVersion.id,
      parentId: sourceVersion.id,
      label: label || `Snapshot from ${sourceVersion.label}`,
      description: description || null,
    });

    await tx.demo.update({
      where: {
        id: demo.id,
      },
      data: {
        currentVersionId: version.id,
      },
      select: {
        id: true,
      },
    });

    await checkpointDemoDawSnapshot(tx, {
      projectId: demo.project.id,
      demoId: demo.id,
      createdById: input.userId,
    });

    return version;
  });

  return NextResponse.json(
    { id: createdVersion.id, label: createdVersion.label, demoId: input.demoId },
    { status: 201 },
  );
}
