import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AccountPluginsPageClient from './account-plugins-page-client';

const mockRouter = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}));

function createDropDataTransfer(file: File) {
  return {
    files: [file] as unknown as FileList,
    items: [
      {
        kind: 'file',
        type: file.type,
        getAsFile: () => file,
      },
    ],
    types: ['Files'],
  } as DataTransfer;
}

describe('AccountPluginsPageClient', () => {
  beforeEach(() => {
    mockRouter.refresh.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uploads a dropped plugin module through sign, PUT, and complete', async () => {
    const pluginFile = new File(
      ['export function createInstance() { return { connect() {}, disconnect() {} }; }'],
      'delay.mjs',
      { type: 'application/javascript' },
    );

    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.includes('/api/plugins/sign-upload')) {
        return new Response(
          JSON.stringify({
            uploadUrl: 'https://storage.example.test/upload-target',
            uploadToken: 'token-1',
            headers: { 'content-type': 'application/javascript' },
          }),
          { status: 200 },
        );
      }

      if (url === 'https://storage.example.test/upload-target' && init?.method === 'PUT') {
        return new Response('', { status: 200 });
      }

      if (url.includes('/api/plugins/complete-upload')) {
        return new Response(
          JSON.stringify({
            plugin: {
              id: 'plugin-1',
              pluginKey: 'user:user-1:plugin-1',
              name: 'delay',
              displayName: 'delay',
              description: null,
              version: 'plugin-1',
              manufacturer: null,
              parameterSchema: {},
              ownerId: 'user-1',
              visibility: 'PRIVATE',
              moduleObjectKey: '/plugins/user-1/plugin-1/plugin-1/delay.mjs',
              bundlePrefix: 'plugins/user-1/plugin-1/plugin-1',
              bundleKind: 'SINGLE_MODULE',
              sizeBytes: '81',
              checksum: null,
              createdAt: '2026-07-08T12:00:00.000Z',
              updatedAt: '2026-07-08T12:00:00.000Z',
            },
          }),
          { status: 200 },
        );
      }

      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch;

    try {
      render(
        <AccountPluginsPageClient
          initialPlugins={[]}
        />,
      );

      const dropZone = screen.getByText('Drop plugin here').parentElement;
      expect(dropZone).toBeTruthy();
      if (!dropZone) {
        throw new Error('drop zone missing');
      }

      fireEvent.drop(dropZone, {
        dataTransfer: createDropDataTransfer(pluginFile),
      });

      await waitFor(() => {
        expect(screen.getByText('Uploaded delay.mjs.')).toBeTruthy();
      });
      await waitFor(() => {
        expect(screen.getByText('delay')).toBeTruthy();
      });
      expect(mockRouter.refresh).toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });
});
