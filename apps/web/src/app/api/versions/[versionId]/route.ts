import { prisma } from '@git-for-music/db';
import { NextRequest, NextResponse } from 'next/server';
import type { ApiError } from '@git-for-music/shared';
import { getAuthenticatedUserFromRequest } from '@/lib/auth/current-user';

const MAX_LABEL_LENGTH = 120;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ versionId: string }> },
) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 });
  }

  const { versionId } = await params;
  const body = (await req.json()) as { label?: unknown };
  const label = typeof body.label === 'string' ? body.label.trim() : '';

  if (!label) {
    return NextResponse.json<ApiError>({ error: 'Label is required' }, { status: 400 });
  }

  if (label.length > MAX_LABEL_LENGTH) {
    return NextResponse.json<ApiError>(
      { error: `Label must be ${MAX_LABEL_LENGTH} characters or fewer` },
      { status: 400 },
    );
  }

  const version = await prisma.demoVersion.findFirst({
    where: {
      id: versionId,
      demo: {
        project: {
          group: {
            members: { some: { userId: user.id } },
          },
        },
      },
    },
    select: { id: true },
  });

  if (!version) {
    return NextResponse.json<ApiError>({ error: 'Version not found' }, { status: 404 });
  }

  const updated = await prisma.demoVersion.update({
    where: { id: versionId },
    data: { label },
    select: { id: true, label: true },
  });

  return NextResponse.json(updated);
}
