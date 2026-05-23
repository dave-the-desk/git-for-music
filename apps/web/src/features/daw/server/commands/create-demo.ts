import { prisma } from '@git-for-music/db';
import { NextResponse } from 'next/server';
import type { ApiError } from '@git-for-music/shared';
import { checkpointDemoDawSnapshot } from '@/features/daw/server/snapshot-builder';

const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 500;

export async function createDemoCommand(input: {
  userId: string;
  projectId: string;
  name: string;
  description?: string | null;
}) {
  const name = input.name.trim();
  const description = input.description?.trim() ?? '';

  if (!input.projectId || !name) {
    return NextResponse.json<ApiError>(
      { error: 'projectId and name are required' },
      { status: 400 },
    );
  }

  if (name.length > MAX_NAME_LENGTH) {
    return NextResponse.json<ApiError>(
      { error: `Demo name must be ${MAX_NAME_LENGTH} characters or fewer` },
      { status: 400 },
    );
  }

  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return NextResponse.json<ApiError>(
      { error: `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer` },
      { status: 400 },
    );
  }

  const project = await prisma.project.findFirst({
    where: {
      id: input.projectId,
      group: {
        members: {
          some: {
            userId: input.userId,
          },
        },
      },
    },
    select: {
      id: true,
      slug: true,
      group: {
        select: {
          slug: true,
        },
      },
    },
  });

  if (!project) {
    return NextResponse.json<ApiError>({ error: 'Project not found' }, { status: 404 });
  }

  const demo = await prisma.$transaction(async (tx) => {
    const createdDemo = await tx.demo.create({
      data: {
        projectId: project.id,
        name,
        description: description || null,
      },
      select: {
        id: true,
        name: true,
        projectId: true,
      },
    });

    const initialVersion = await tx.demoVersion.create({
      data: {
        demoId: createdDemo.id,
        label: 'Initial version',
        description: 'Created demo',
        parentId: null,
      },
      select: {
        id: true,
      },
    });

    await tx.demo.update({
      where: {
        id: createdDemo.id,
      },
      data: {
        currentVersionId: initialVersion.id,
      },
      select: {
        id: true,
      },
    });

    await checkpointDemoDawSnapshot(tx, {
      projectId: project.id,
      demoId: createdDemo.id,
      createdById: input.userId,
    });

    return createdDemo;
  });

  return NextResponse.json(
    {
      id: demo.id,
      name: demo.name,
      projectId: demo.projectId,
      projectSlug: project.slug,
      groupSlug: project.group.slug,
    },
    { status: 201 },
  );
}
