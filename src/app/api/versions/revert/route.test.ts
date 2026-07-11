import { NextRequest } from 'next/server';
import { beforeEach, expect, test, vi } from 'vitest';

const mockGetAuthenticatedUserFromRequest = vi.hoisted(() => vi.fn());
const mockRevertToVersionCommand = vi.hoisted(() => vi.fn());

vi.mock('@git-for-music/server/app/lib/auth/current-user', () => ({
  getAuthenticatedUserFromRequest: mockGetAuthenticatedUserFromRequest,
}));

vi.mock('@git-for-music/server/app/lib/daw/server/commands', () => ({
  revertToVersionCommand: mockRevertToVersionCommand,
}));

import { POST } from './route';

beforeEach(() => {
  mockGetAuthenticatedUserFromRequest.mockReset();
  mockRevertToVersionCommand.mockReset();
});

test('POST /api/versions/revert delegates to the revert command', async () => {
  mockGetAuthenticatedUserFromRequest.mockResolvedValue({ id: 'user-1' });
  mockRevertToVersionCommand.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

  const req = new NextRequest('http://localhost/api/versions/revert', {
    method: 'POST',
    body: JSON.stringify({
      demoId: 'demo-1',
      sourceVersionId: 'version-root',
      label: 'Revert label',
      description: 'Revert description',
    }),
    headers: {
      'content-type': 'application/json',
    },
  });

  await POST(req);

  expect(mockGetAuthenticatedUserFromRequest).toHaveBeenCalledOnce();
  expect(mockRevertToVersionCommand).toHaveBeenCalledWith({
    userId: 'user-1',
    demoId: 'demo-1',
    sourceVersionId: 'version-root',
    label: 'Revert label',
    description: 'Revert description',
  });
});
