import { getAuthProvider } from '../extensions';

export async function hashPassword(password: string) {
  return getAuthProvider().hashPassword(password);
}

export async function verifyPassword(password: string, storedHash: string) {
  return getAuthProvider().verifyPassword(password, storedHash);
}

export function createSessionCookie(userId: string) {
  return getAuthProvider().createSessionCookie(userId);
}

export function destroySessionCookie() {
  return getAuthProvider().destroySessionCookie();
}
