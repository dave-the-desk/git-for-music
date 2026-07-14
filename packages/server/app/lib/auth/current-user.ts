import { NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME } from './session';
import './default-provider';
import { getAuthProvider } from '../extensions';

export async function getAuthenticatedUserFromRequest(req: NextRequest) {
  return getAuthProvider().getUserFromRequest(req);
}

export async function getAuthenticatedUserFromSession(sessionId: string | null | undefined) {
  return getAuthProvider().getUserFromSession(sessionId);
}

export async function getAuthenticatedUserFromCookies(cookieStore: {
  get(name: string): { value?: string } | undefined;
}) {
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);
  return getAuthenticatedUserFromSession(sessionCookie?.value);
}
