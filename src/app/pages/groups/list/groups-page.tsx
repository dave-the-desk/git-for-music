import { prisma } from '@git-for-music/db';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getAuthenticatedUserFromCookies } from '@git-for-music/server/app/lib/auth';
import { GroupsClient } from './groups-client';

export default async function GroupsPage() {
  const cookieStore = await cookies();
  const user = await getAuthenticatedUserFromCookies(cookieStore);

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
