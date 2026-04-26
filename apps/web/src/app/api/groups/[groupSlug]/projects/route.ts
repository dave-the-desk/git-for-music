import { Prisma, prisma } from '@git-for-music/db';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserFromRequest } from '@/lib/auth/current-user';

const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 500;

function slugifyProjectName(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');

  return slug || 'project';
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export async function POST(
  req: NextRequest,
  context: {
    params: Promise<{ groupSlug: string }>;
  },
) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { groupSlug } = await context.params;
  const body = (await req.json()) as Partial<{
    name: string;
    description: string;
  }>;

  const name = body.name?.trim() ?? '';
  const description = body.description?.trim() ?? '';

  if (!name) {
    return NextResponse.json({ error: 'Project name is required' }, { status: 400 });
  }

  if (name.length > MAX_NAME_LENGTH) {
    return NextResponse.json(
      { error: `Project name must be ${MAX_NAME_LENGTH} characters or fewer` },
      { status: 400 },
    );
  }

  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return NextResponse.json(
      { error: `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer` },
      { status: 400 },
    );
  }

  const group = await prisma.group.findUnique({
    where: { slug: groupSlug },
    select: { id: true },
  });

  if (!group) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  }

  const membership = await prisma.groupMember.findUnique({
    where: {
      groupId_userId: {
        groupId: group.id,
        userId: user.id,
      },
    },
    select: { id: true },
  });

  if (!membership) {
    return NextResponse.json({ error: 'You are not a member of this group' }, { status: 403 });
  }

  const baseSlug = slugifyProjectName(name);

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const slug = attempt === 1 ? baseSlug : `${baseSlug}-${attempt}`;

    try {
      const project = await prisma.project.create({
        data: {
          groupId: group.id,
          name,
          slug,
          description: description || null,
        },
        select: {
          id: true,
          slug: true,
          name: true,
          description: true,
        },
      });

      return NextResponse.json(project, { status: 201 });
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }
    }
  }

  return NextResponse.json({ error: 'Could not generate a unique project slug' }, { status: 409 });
}
