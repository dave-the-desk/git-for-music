import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectPageClient } from './project-page-client';

const mockRouter = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
}));

const mockRealtimeRefresh = vi.hoisted(() => ({
  calledWith: [] as string[],
}));

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}));

vi.mock('../lib/use-realtime-refresh', () => ({
  useRealtimeRefresh: (url: string) => {
    mockRealtimeRefresh.calledWith.push(url);
  },
}));

describe('ProjectPageClient', () => {
  beforeEach(() => {
    mockRouter.push.mockReset();
    mockRouter.refresh.mockReset();
    mockRealtimeRefresh.calledWith.length = 0;
  });

  it('does not render the removed project placeholders', () => {
    const { container } = render(
      <ProjectPageClient
        groupSlug="demo-group"
        projectSlug="demo-project"
        projectId="project-1"
        projectName="Demo Project"
        projectDescription="Project description"
        demos={[]}
      />,
    );

    expect(container.firstElementChild).toMatchInlineSnapshot(`
      <div
        class="space-y-6"
      >
        <a
          class="inline-flex rounded-md border border-gray-700 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-800"
          href="/groups/demo-group"
        >
          Back
        </a>
        <section>
          <h1
            class="text-2xl font-bold text-white"
          >
            Demo Project
          </h1>
          <p
            class="mt-2 text-sm text-gray-300"
          >
            Project description
          </p>
        </section>
        <section>
          <div
            class="mb-3 flex items-center justify-between"
          >
            <h2
              class="text-lg font-semibold text-white"
            >
              Demos
            </h2>
            <button
              class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
              type="button"
            >
              Create Demo
            </button>
          </div>
          <div
            class="rounded-lg border border-gray-800 bg-gray-900 px-6 py-8 text-sm text-gray-400"
          >
            No demos yet. Create one to get started.
          </div>
        </section>
      </div>
    `);
    expect(mockRealtimeRefresh.calledWith).toContain(
      '/api/groups/demo-group/projects/demo-project/realtime',
    );
  });
});
