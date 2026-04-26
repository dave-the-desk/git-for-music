import { prisma } from '@git-for-music/db';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { GroupsClient } from './groups-client';

export default async function GroupsPage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);

  if (!sessionCookie?.value) {
    redirect('/login');
  }

  const user = await prisma.user.findUnique({
    where: { id: sessionCookie.value },
    select: { id: true },
  });

  if (!user) {
    redirect('/login');
  }

  const memberships = await prisma.groupMember.findMany({
    where: { userId: user.id },
    select: {
      group: {
        select: {
          id: true,
          slug: true,
          name: true,
          description: true,
          _count: {
            select: {
              members: true,
            },
          },
        },
      },
    },
    orderBy: {
      joinedAt: 'desc',
    },
  });

  const groups = memberships.map(({ group }) => ({
    id: group.id,
    slug: group.slug,
    name: group.name,
    description: group.description,
    memberCount: group._count.members,
  }));

  return (
    <div className="space-y-6">
      <GroupsClient groups={groups} />
    </div>
  );
}
