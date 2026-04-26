import { prisma } from '@git-for-music/db';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserFromRequest } from '@/lib/auth/current-user';

const GROUP_INVITE_NOTIFICATION_TYPE = 'GROUP_INVITE';

type InviteAction = 'accept' | 'decline';

function isValidAction(value: string): value is InviteAction {
  return value === 'accept' || value === 'decline';
}

export async function PATCH(
  req: NextRequest,
  context: {
    params: Promise<{ notificationId: string }>;
  },
) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { notificationId } = await context.params;
  const body = (await req.json()) as Partial<{ action: string }>;
  const action = body.action?.trim().toLowerCase() ?? '';

  if (!isValidAction(action)) {
    return NextResponse.json({ error: 'Action must be accept or decline' }, { status: 400 });
  }

  const notification = await prisma.notification.findFirst({
    where: {
      id: notificationId,
      userId: user.id,
    },
    select: {
      id: true,
      type: true,
      groupId: true,
    },
  });

  if (!notification) {
    return NextResponse.json({ error: 'Notification not found' }, { status: 404 });
  }

  if (notification.type !== GROUP_INVITE_NOTIFICATION_TYPE || !notification.groupId) {
    return NextResponse.json({ error: 'Notification is not a group invite' }, { status: 400 });
  }

  if (action === 'decline') {
    await prisma.notification.delete({
      where: { id: notification.id },
      select: { id: true },
    });

    return NextResponse.json({ status: 'declined' });
  }

  await prisma.$transaction(async (tx) => {
    await tx.groupMember.upsert({
      where: {
        groupId_userId: {
          groupId: notification.groupId!,
          userId: user.id,
        },
      },
      update: {},
      create: {
        groupId: notification.groupId!,
        userId: user.id,
        role: 'MEMBER',
      },
      select: { id: true },
    });

    await tx.notification.delete({
      where: {
        id: notification.id,
      },
      select: { id: true },
    });
  });

  return NextResponse.json({ status: 'accepted' });
}
