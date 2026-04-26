import { Prisma, prisma } from '@git-for-music/db';
import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';

const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 500;

function slugifyGroupName(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');

  return slug || 'group';
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export async function POST(req: NextRequest) {
  const sessionCookie = req.cookies.get(SESSION_COOKIE_NAME);
  if (!sessionCookie?.value) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: sessionCookie.value },
    select: { id: true },
  });

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json()) as Partial<{
    name: string;
    description: string;
  }>;

  const name = body.name?.trim() ?? '';
  const description = body.description?.trim() ?? '';

  if (!name) {
    return NextResponse.json({ error: 'Group name is required' }, { status: 400 });
  }

  if (name.length > MAX_NAME_LENGTH) {
    return NextResponse.json(
      { error: `Group name must be ${MAX_NAME_LENGTH} characters or fewer` },
      { status: 400 },
    );
  }

  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return NextResponse.json(
      { error: `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer` },
      { status: 400 },
    );
  }

  const baseSlug = slugifyGroupName(name);

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const slug = attempt === 1 ? baseSlug : `${baseSlug}-${attempt}`;

    try {
      const group = await prisma.$transaction(async (tx) => {
        const createdGroup = await tx.group.create({
          data: {
            name,
            description: description || null,
            slug,
          },
          select: {
            id: true,
            name: true,
            slug: true,
            description: true,
          },
        });

        await tx.groupMember.create({
          data: {
            groupId: createdGroup.id,
            userId: user.id,
            role: 'OWNER',
          },
          select: { id: true },
        });

        return createdGroup;
      });

      return NextResponse.json(group, { status: 201 });
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }
    }
  }

  return NextResponse.json({ error: 'Could not generate a unique group slug' }, { status: 409 });
}
