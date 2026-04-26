import { prisma } from '@git-for-music/db';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserFromRequest } from '@/lib/auth/current-user';

const GROUP_INVITE_NOTIFICATION_TYPE = 'GROUP_INVITE';

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
  const body = (await req.json()) as Partial<{ query: string }>;
  const query = body.query?.trim() ?? '';

  if (!query) {
    return NextResponse.json({ error: 'Name or email is required' }, { status: 400 });
  }

  const group = await prisma.group.findUnique({
    where: { slug: groupSlug },
    select: {
      id: true,
      name: true,
    },
  });

  if (!group) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  }

  const inviterMembership = await prisma.groupMember.findUnique({
    where: {
      groupId_userId: {
        groupId: group.id,
        userId: user.id,
      },
    },
    select: { role: true },
  });

  if (!inviterMembership) {
    return NextResponse.json({ error: 'You are not a member of this group' }, { status: 403 });
  }

  if (inviterMembership.role !== 'OWNER') {
    return NextResponse.json({ error: 'Only group owners can invite members' }, { status: 403 });
  }

  const isEmailQuery = query.includes('@');
  const invitee = await prisma.user.findFirst({
    where: isEmailQuery
      ? { email: { equals: query.toLowerCase(), mode: 'insensitive' } }
      : { name: { equals: query, mode: 'insensitive' } },
    select: {
      id: true,
      name: true,
      email: true,
    },
  });

  if (!invitee) {
    return NextResponse.json({ error: 'No user found for that name or email' }, { status: 404 });
  }

  if (invitee.id === user.id) {
    return NextResponse.json({ error: 'You cannot invite yourself' }, { status: 400 });
  }

  const existingMembership = await prisma.groupMember.findUnique({
    where: {
      groupId_userId: {
        groupId: group.id,
        userId: invitee.id,
      },
    },
    select: { id: true },
  });

  if (existingMembership) {
    return NextResponse.json({ error: 'That user is already in the group' }, { status: 409 });
  }

  const existingInvite = await prisma.notification.findFirst({
    where: {
      userId: invitee.id,
      type: GROUP_INVITE_NOTIFICATION_TYPE,
      groupId: group.id,
    },
    select: { id: true },
  });

  if (existingInvite) {
    return NextResponse.json({ error: 'That user already has a pending invite to this group' }, { status: 409 });
  }

  const inviter = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      name: true,
      email: true,
    },
  });

  const inviterLabel = inviter?.name?.trim() || inviter?.email || 'A group member';

  await prisma.notification.create({
    data: {
      userId: invitee.id,
      type: GROUP_INVITE_NOTIFICATION_TYPE,
      title: `Group invite: ${group.name}`,
      message: `${inviterLabel} invited you to join ${group.name}.`,
      entityType: 'GROUP_INVITE',
      entityId: group.id,
      groupId: group.id,
    },
    select: { id: true },
  });

  return NextResponse.json(
    {
      invitedUser: {
        name: invitee.name,
        email: invitee.email,
      },
    },
    { status: 201 },
  );
}
