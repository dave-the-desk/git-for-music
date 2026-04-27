import { prisma } from '@git-for-music/db';
import { NextRequest, NextResponse } from 'next/server';
import type { CreateVersionRequest, ApiError } from '@git-for-music/shared';
import { getAuthenticatedUserFromRequest } from '@/lib/auth/current-user';
import { createDemoVersionWithCopiedTracks } from '@/lib/demos/versioning';

const MAX_LABEL_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 500;

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json()) as Partial<CreateVersionRequest>;
  const label = body.label?.trim() ?? '';
  const description = body.description?.trim() ?? '';

  if (!body.demoId) {
    return NextResponse.json<ApiError>(
      { error: 'demoId is required' },
      { status: 400 },
    );
  }

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
      id: body.demoId,
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
    },
  });

  if (!demo) {
    return NextResponse.json<ApiError>({ error: 'Demo not found' }, { status: 404 });
  }

  const sourceVersionId = body.sourceVersionId ?? demo.currentVersionId;

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
      parentId: demo.currentVersionId,
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

    return version;
  });

  return NextResponse.json(
    { id: createdVersion.id, label: createdVersion.label, demoId: body.demoId },
    { status: 201 },
  );
}
