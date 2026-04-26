import { prisma } from '@git-for-music/db';
import { NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME } from './session';

export async function getAuthenticatedUserFromRequest(req: NextRequest) {
  const sessionCookie = req.cookies.get(SESSION_COOKIE_NAME);
  if (!sessionCookie?.value) {
    return null;
  }

  return prisma.user.findUnique({
    where: { id: sessionCookie.value },
    select: { id: true },
  });
}
