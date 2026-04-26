import { prisma } from '@git-for-music/db';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserFromRequest } from '@/lib/auth/current-user';

export async function DELETE(
  req: NextRequest,
  context: {
    params: Promise<{ groupSlug: string; memberUserId: string }>;
  },
) {
  const currentUser = await getAuthenticatedUserFromRequest(req);
  if (!currentUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { groupSlug, memberUserId } = await context.params;

  const group = await prisma.group.findUnique({
    where: { slug: groupSlug },
    select: { id: true },
  });

  if (!group) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  }

  const currentMembership = await prisma.groupMember.findUnique({
    where: {
      groupId_userId: {
        groupId: group.id,
        userId: currentUser.id,
      },
    },
    select: { role: true },
  });

  if (!currentMembership || currentMembership.role !== 'OWNER') {
    return NextResponse.json({ error: 'Only group owners can remove members' }, { status: 403 });
  }

  const targetMembership = await prisma.groupMember.findUnique({
    where: {
      groupId_userId: {
        groupId: group.id,
        userId: memberUserId,
      },
    },
    select: {
      id: true,
      role: true,
    },
  });

  if (!targetMembership) {
    return NextResponse.json({ error: 'Member not found in this group' }, { status: 404 });
  }

  if (targetMembership.role === 'OWNER') {
    return NextResponse.json({ error: 'Owners cannot be removed from the group' }, { status: 400 });
  }

  await prisma.groupMember.delete({
    where: {
      id: targetMembership.id,
    },
    select: { id: true },
  });

  return NextResponse.json({ removed: true });
}
