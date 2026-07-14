import assert from 'node:assert/strict';
import test from 'node:test';
import { prisma } from '@git-for-music/db';
import { NextRequest } from 'next/server';
import { defaultAuthProvider } from './default-provider';
import { getAuthenticatedUserFromRequest } from './current-user';
import { resetExtensionBindingsForTests, setAuthProvider } from '../extensions';

test('getAuthenticatedUserFromRequest resolves the session user from the cookie', async () => {
  const prismaUser = prisma.user as unknown as { findUnique: any };
  const originalFindUnique = prismaUser.findUnique;
  setAuthProvider(defaultAuthProvider);

  prismaUser.findUnique = (async () => ({
    id: 'user-1',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
  })) as any;

  try {
    const req = new NextRequest('http://localhost/api/test', {
      headers: {
        cookie: 'gfm_session=user-1',
      },
    });

    const user = await getAuthenticatedUserFromRequest(req);

    assert.deepEqual(user, {
      id: 'user-1',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
    });
  } finally {
    prismaUser.findUnique = originalFindUnique;
    resetExtensionBindingsForTests();
  }
});
