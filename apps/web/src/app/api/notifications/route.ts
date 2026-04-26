import { prisma } from '@git-for-music/db';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserFromRequest } from '@/lib/auth/current-user';

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [notifications, unreadCount] = await prisma.$transaction([
    prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        type: true,
        title: true,
        message: true,
        entityType: true,
        entityId: true,
        groupId: true,
        projectId: true,
        demoId: true,
        readAt: true,
        createdAt: true,
      },
    }),
    prisma.notification.count({
      where: {
        userId: user.id,
        readAt: null,
      },
    }),
  ]);

  return NextResponse.json({ notifications, unreadCount });
}
