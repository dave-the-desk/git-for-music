import { prisma } from '@git-for-music/db';
import type { NextRequest } from 'next/server';
import { getConfig } from '@git-for-music/shared';
import { hashPassword, verifyPassword } from './password';
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from './session';
import { setAuthProvider, type AuthProvider } from '../extensions';

async function getUserFromSession(sessionId: string | null | undefined) {
  if (!sessionId) {
    return null;
  }

  return prisma.user.findUnique({
    where: { id: sessionId },
    select: { id: true, name: true, email: true },
  });
}

const defaultAuthProvider: AuthProvider = {
  async getUserFromRequest(req: NextRequest) {
    const sessionCookie = req.cookies.get(SESSION_COOKIE_NAME);
    return getUserFromSession(sessionCookie?.value);
  },
  getUserFromSession,
  createSessionCookie(userId: string) {
    return {
      name: SESSION_COOKIE_NAME,
      value: userId,
      httpOnly: true,
      sameSite: 'lax',
      secure: getConfig().environment.isProduction,
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
    };
  },
  destroySessionCookie() {
    return {
      name: SESSION_COOKIE_NAME,
      value: '',
      httpOnly: true,
      sameSite: 'lax',
      secure: getConfig().environment.isProduction,
      path: '/',
      maxAge: 0,
    };
  },
  hashPassword,
  verifyPassword,
};

setAuthProvider(defaultAuthProvider);

export { defaultAuthProvider };
