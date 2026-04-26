import { prisma } from '@git-for-music/db';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { GroupPageClient } from './group-page-client';

type GroupMemberWithUser = {
  id: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  user: {
    id: string;
    name: string | null;
    email: string;
  };
};

export default async function GroupPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;

  const group = await prisma.group.findUnique({
    where: { slug: groupId },
    select: {
      name: true,
      projects: {
        orderBy: {
          updatedAt: 'desc',
        },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
        },
      },
      members: {
        orderBy: {
          joinedAt: 'asc',
        },
        select: {
          id: true,
          role: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      },
    },
  });

  if (!group) {
    notFound();
  }

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);
  const groupMembers = group.members as GroupMemberWithUser[];
  const currentMember = groupMembers.find((member) => member.user.id === sessionCookie?.value);
  const canInviteMembers = currentMember?.role === 'OWNER';

  const members = groupMembers.map((member) => ({
    id: member.id,
    role: member.role,
    userId: member.user.id,
    name: member.user.name,
    email: member.user.email,
  }));
  const projects = group.projects.map((project: { id: any; name: any; slug: any; description: any; }) => ({
    id: project.id,
    name: project.name,
    slug: project.slug,
    description: project.description,
  }));

  return (
    <GroupPageClient
      groupName={group.name}
      groupSlug={groupId}
      members={members}
      projects={projects}
      canInviteMembers={canInviteMembers}
    />
  );
}
