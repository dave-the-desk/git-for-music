import { createElement } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { VersionHistoryTree } from './VersionHistoryTree';
import type { DawVersion, ProjectOperationHistoryEntry } from '@/app/lib/daw/state/local-project-state';

function makeVersion(id: string, overrides: Partial<DawVersion> = {}): DawVersion {
  return {
    id,
    label: overrides.label ?? id,
    name: overrides.name ?? overrides.label ?? id,
    branchName: overrides.branchName ?? overrides.label ?? id,
    operationSummary: overrides.operationSummary ?? null,
    createdBy: overrides.createdBy ?? 'user-a',
    createdByName: overrides.createdByName ?? null,
    description: overrides.description ?? null,
    parentId: overrides.parentId ?? null,
    parentVersionId: overrides.parentVersionId ?? overrides.parentId ?? null,
    createdAt: overrides.createdAt ?? '2025-01-01T00:00:00.000Z',
    kind: overrides.kind ?? 'EXPLICIT',
    operationSeq: overrides.operationSeq !== undefined ? overrides.operationSeq : 1,
    isCurrent: overrides.isCurrent ?? false,
    tempoBpm: overrides.tempoBpm ?? 120,
    timeSignatureNum: overrides.timeSignatureNum ?? 4,
    timeSignatureDen: overrides.timeSignatureDen ?? 4,
    musicalKey: overrides.musicalKey ?? null,
    tempoSource: overrides.tempoSource ?? 'MANUAL',
    keySource: overrides.keySource ?? 'MANUAL',
    tracks: overrides.tracks ?? [],
  };
}

function makeHistoryEntry(overrides: Partial<ProjectOperationHistoryEntry> = {}): ProjectOperationHistoryEntry {
  return {
    operationId: overrides.operationId ?? 'operation-1',
    operationSeq: overrides.operationSeq ?? 1,
    operationType: overrides.operationType ?? 'VERSION_CREATED',
    versionId: overrides.versionId ?? 'version-root',
    currentVersionId: overrides.currentVersionId ?? 'version-root',
    trackId: overrides.trackId ?? null,
    segmentId: overrides.segmentId ?? null,
    summary: overrides.summary ?? 'Initial version',
    actorUserId: overrides.actorUserId ?? 'user-a',
    createdAt: overrides.createdAt ?? '2025-01-01T00:00:00.000Z',
  };
}

describe('VersionHistoryTree live version updates', () => {
  it('uses the branch palette on the graph nodes', () => {
    const root = makeVersion('version-root', {
      isCurrent: false,
      createdBy: null,
      operationSeq: 1,
      createdAt: '2025-01-01T00:00:00.000Z',
    });
    const branchMid = makeVersion('version-branch-mid', {
      parentId: root.id,
      parentVersionId: root.id,
      isCurrent: false,
      operationSeq: 2,
      createdAt: '2025-01-02T00:00:00.000Z',
    });
    const branchHead = makeVersion('version-branch-head', {
      parentId: branchMid.id,
      parentVersionId: branchMid.id,
      isCurrent: true,
      operationSeq: 3,
      createdAt: '2025-01-03T00:00:00.000Z',
    });
    const otherBranchNode = makeVersion('version-other-node', {
      parentId: root.id,
      parentVersionId: root.id,
      isCurrent: false,
      operationSeq: 4,
      createdAt: '2025-01-04T00:00:00.000Z',
    });
    const otherBranchHead = makeVersion('version-other-head', {
      parentId: otherBranchNode.id,
      parentVersionId: otherBranchNode.id,
      isCurrent: false,
      operationSeq: 5,
      createdAt: '2025-01-05T00:00:00.000Z',
    });

    render(
      createElement(VersionHistoryTree, {
        projectId: 'project-1',
        demoId: 'demo-1',
        demoName: 'Sunset Session',
        baseOperationSeq: 5,
        liveVersions: [root, branchMid, branchHead, otherBranchNode, otherBranchHead],
        operationHistory: [],
        currentVersionId: branchHead.id,
        activeVersionId: branchHead.id,
        selectedVersionId: branchMid.id,
        zoomLevel: 1,
        isFollowingHead: false,
        isHistoryViewActive: false,
        highlightedVersionId: null,
        highlightedVersionCreatedAt: null,
        onSelectVersion: vi.fn(),
      }),
    );

    expect(screen.getByRole('button', { name: /Sunset Session created/ }).style.borderColor).toBe(
      'rgb(59, 130, 246)',
    );
    expect(screen.getByRole('button', { name: /version-branch-mid/ }).style.borderColor).toBe('rgb(59, 130, 246)');
    expect(screen.getByRole('button', { name: /version-branch-head/ }).style.borderColor).toBe('rgb(125, 211, 252)');
    expect(screen.getByRole('button', { name: /version-other-node/ }).style.borderColor).toBe('rgb(253, 224, 71)');
    expect(screen.getByRole('button', { name: /version-other-head/ }).style.borderColor).toBe('rgb(245, 158, 11)');
    expect(screen.getByText('Sunset Session created')).toBeTruthy();
  });

  it('opens node details on click and checks out from the popup button', async () => {
    const root = makeVersion('version-root', {
      isCurrent: false,
      createdByName: 'Avery Fox',
      createdBy: null,
      operationSeq: 1,
      createdAt: '2025-01-01T00:00:00.000Z',
    });
    const head = makeVersion('version-head', {
      parentId: root.id,
      parentVersionId: root.id,
      isCurrent: true,
      operationSeq: 2,
      createdAt: '2025-01-02T00:00:00.000Z',
    });

    const onSelectVersion = vi.fn();

    const user = userEvent.setup();
    render(
      createElement(VersionHistoryTree, {
        projectId: 'project-1',
        demoId: 'demo-1',
        demoName: 'Sunset Session',
        baseOperationSeq: 2,
        liveVersions: [root, head],
        operationHistory: [
          makeHistoryEntry({
            operationType: 'VERSION_CREATED',
            versionId: root.id,
            currentVersionId: root.id,
            actorUserId: 'user-a',
          }),
        ],
        userDisplayNamesById: {
          'user-a': 'Avery Fox',
        },
        currentVersionId: head.id,
        activeVersionId: head.id,
        selectedVersionId: head.id,
        zoomLevel: 1,
        isFollowingHead: true,
        isHistoryViewActive: false,
        highlightedVersionId: null,
        highlightedVersionCreatedAt: null,
        onSelectVersion,
      }),
    );

    await user.click(screen.getByRole('button', { name: /Sunset Session created/ }));

    const dialog = screen.getByRole('dialog', { name: /Sunset Session created details/i });
    expect(within(dialog).getByRole('button', { name: /Sunset Session created/ })).toBeTruthy();
    expect(screen.getByText(/Implemented by Avery Fox/i)).toBeTruthy();
    expect(screen.getAllByText('Avery Fox').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Go back to this version' }));
    expect(onSelectVersion).toHaveBeenCalledWith(root.id);
  });

  it('hides the back button, derives the branch label from ancestry, and renames from the title', async () => {
    const root = makeVersion('version-root', {
      isCurrent: false,
      createdByName: 'Avery Fox',
      createdBy: null,
      operationSeq: 1,
      createdAt: '2025-01-01T00:00:00.000Z',
    });
    const branchSource = makeVersion('version-branch-source', {
      parentId: root.id,
      parentVersionId: root.id,
      isCurrent: false,
      operationSeq: 2,
      createdAt: '2025-01-02T00:00:00.000Z',
      label: 'Original Branch',
      name: 'Original Branch',
      branchName: 'Original Branch',
    });
    const sibling = makeVersion('version-sibling', {
      parentId: root.id,
      parentVersionId: root.id,
      isCurrent: false,
      operationSeq: 3,
      createdAt: '2025-01-03T00:00:00.000Z',
      label: 'Sibling Branch',
      name: 'Sibling Branch',
      branchName: 'Sibling Branch',
    });
    const head = makeVersion('version-head', {
      parentId: branchSource.id,
      parentVersionId: branchSource.id,
      isCurrent: true,
      operationSeq: null,
      createdAt: '2025-01-04T00:00:00.000Z',
      label: 'Focus Cut',
      name: 'Focus Cut',
      branchName: 'Focus Cut',
    });

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);
    const onSelectVersion = vi.fn();
    const user = userEvent.setup();

    try {
      const { rerender } = render(
        createElement(VersionHistoryTree, {
          projectId: 'project-1',
          demoId: 'demo-1',
          demoName: 'Sunset Session',
          baseOperationSeq: 4,
          liveVersions: [root, branchSource, sibling, head],
          operationHistory: [
            makeHistoryEntry({
              operationType: 'VERSION_CREATED',
              versionId: root.id,
              currentVersionId: root.id,
              actorUserId: 'user-a',
              operationSeq: 1,
            }),
            makeHistoryEntry({
              operationType: 'VERSION_BRANCH_CREATED',
              versionId: head.id,
              currentVersionId: head.id,
              actorUserId: 'user-a',
              operationSeq: 42,
            }),
          ],
          userDisplayNamesById: {
            'user-a': 'Avery Fox',
          },
          currentVersionId: head.id,
          activeVersionId: head.id,
          selectedVersionId: head.id,
          zoomLevel: 1,
          isFollowingHead: true,
          isHistoryViewActive: false,
          highlightedVersionId: null,
          highlightedVersionCreatedAt: null,
          onSelectVersion,
        }),
      );

      await user.click(screen.getByRole('button', { name: /Focus Cut/ }));

      const dialog = screen.getByRole('dialog', { name: /Focus Cut details/i });
      expect(within(dialog).queryByRole('button', { name: 'Go back to this version' })).toBeNull();
      expect(within(dialog).queryByText('Version ID')).toBeNull();
      expect(within(dialog).queryByText('Parent')).toBeNull();
      expect(within(dialog).getByText('Original Branch')).toBeTruthy();

      rerender(
        createElement(VersionHistoryTree, {
          projectId: 'project-1',
          demoId: 'demo-1',
          demoName: 'Sunset Session',
          baseOperationSeq: 4,
          liveVersions: [
            root,
            makeVersion('version-branch-source', {
              parentId: root.id,
              parentVersionId: root.id,
              isCurrent: false,
              operationSeq: 2,
              createdAt: '2025-01-02T00:00:00.000Z',
              label: 'Renamed Branch Source',
              name: 'Renamed Branch Source',
              branchName: 'Renamed Branch Source',
            }),
            sibling,
            head,
          ],
          operationHistory: [
            makeHistoryEntry({
              operationType: 'VERSION_CREATED',
              versionId: root.id,
              currentVersionId: root.id,
              actorUserId: 'user-a',
              operationSeq: 1,
            }),
          ],
          userDisplayNamesById: {
            'user-a': 'Avery Fox',
          },
          currentVersionId: head.id,
          activeVersionId: head.id,
          selectedVersionId: head.id,
          zoomLevel: 1,
          isFollowingHead: true,
          isHistoryViewActive: false,
          highlightedVersionId: null,
          highlightedVersionCreatedAt: null,
          onSelectVersion,
        }),
      );

      expect(within(dialog).getByText('Renamed Branch Source')).toBeTruthy();

      await user.click(within(dialog).getByRole('button', { name: 'Focus Cut' }));
      const renameInput = within(dialog).getByRole('textbox');
      expect((renameInput as HTMLInputElement).value).toBe('Focus Cut');

      await user.clear(renameInput);
      await user.type(renameInput, 'New Focus Cut');
      await user.keyboard('{Enter}');

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });
      expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/daw/projects/project-1/operations');
      expect(onSelectVersion).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('keeps the demo creator on the initial version node even if later operations touch the same version', () => {
    const root = makeVersion('version-root', {
      isCurrent: false,
      createdByName: null,
      createdBy: null,
      operationSeq: 1,
      createdAt: '2025-01-01T00:00:00.000Z',
    });
    const head = makeVersion('version-head', {
      parentId: root.id,
      parentVersionId: root.id,
      isCurrent: true,
      operationSeq: 2,
      createdAt: '2025-01-02T00:00:00.000Z',
    });

    render(
      createElement(VersionHistoryTree, {
        projectId: 'project-1',
        demoId: 'demo-1',
        demoName: 'Sunset Session',
        baseOperationSeq: 2,
        liveVersions: [root, head],
        operationHistory: [
          makeHistoryEntry({
            operationType: 'VERSION_CREATED',
            versionId: root.id,
            currentVersionId: root.id,
            actorUserId: 'user-a',
            operationSeq: 1,
          }),
          makeHistoryEntry({
            operationType: 'TRACK_VERSION_CREATED',
            versionId: root.id,
            currentVersionId: root.id,
            actorUserId: 'user-b',
            operationSeq: 2,
          }),
        ],
        userDisplayNamesById: {
          'user-a': 'Avery Fox',
          'user-b': 'Bea Moss',
        },
        currentVersionId: head.id,
        activeVersionId: head.id,
        selectedVersionId: head.id,
        zoomLevel: 1,
        isFollowingHead: true,
        isHistoryViewActive: false,
        highlightedVersionId: null,
        highlightedVersionCreatedAt: null,
        onSelectVersion: vi.fn(),
      }),
    );

    expect(screen.getAllByText('Avery Fox').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Bea Moss')).toBeNull();
  });

  it('shows a newly created revert version while keeping older versions visible', async () => {
    const root = makeVersion('version-root', {
      isCurrent: true,
      operationSeq: 1,
      createdAt: '2025-01-01T00:00:00.000Z',
    });
    const head = makeVersion('version-head', {
      parentId: root.id,
      parentVersionId: root.id,
      operationSeq: 2,
      createdAt: '2025-01-02T00:00:00.000Z',
      label: 'Work in progress',
      name: 'Work in progress',
      branchName: 'Work in progress',
      isCurrent: true,
      kind: 'EXPLICIT',
    });
    const revertVersion = makeVersion('version-revert', {
      parentId: head.id,
      parentVersionId: head.id,
      isCurrent: true,
      operationSeq: 3,
      createdAt: '2025-01-03T00:00:00.000Z',
      label: 'Revert to root',
      name: 'Revert to root',
      branchName: 'Revert to root',
      kind: 'REVERT',
    });

    const onSelectVersion = vi.fn();

    const { rerender } = render(
      createElement(VersionHistoryTree, {
        projectId: 'project-1',
        demoId: 'demo-1',
        demoName: 'Sunset Session',
        baseOperationSeq: 1,
        liveVersions: [root],
        operationHistory: [],
        currentVersionId: root.id,
        activeVersionId: root.id,
        selectedVersionId: root.id,
        zoomLevel: 1,
        isFollowingHead: true,
        isHistoryViewActive: false,
        highlightedVersionId: null,
        highlightedVersionCreatedAt: null,
        onSelectVersion,
      }),
    );

    expect(screen.queryByText('Revert to root')).toBeNull();

    rerender(
      createElement(VersionHistoryTree, {
        projectId: 'project-1',
        demoId: 'demo-1',
        demoName: 'Sunset Session',
        baseOperationSeq: 3,
        liveVersions: [root, head, revertVersion],
        operationHistory: [],
        currentVersionId: revertVersion.id,
        activeVersionId: revertVersion.id,
        selectedVersionId: revertVersion.id,
        zoomLevel: 1,
        isFollowingHead: true,
        isHistoryViewActive: false,
        highlightedVersionId: revertVersion.id,
        highlightedVersionCreatedAt: revertVersion.createdAt,
        onSelectVersion,
      }),
    );

    await waitFor(() => {
      expect(screen.getByText('Revert to root')).toBeTruthy();
    });
    expect(screen.getByText('Work in progress')).toBeTruthy();
    expect(screen.getByText('Sunset Session created')).toBeTruthy();
    expect(onSelectVersion).not.toHaveBeenCalledWith(revertVersion.id);
  });
});

describe('VersionHistoryTree docked rail mode', () => {
  it('renders expanded when the docked rail asks for the graph up front', () => {
    const root = makeVersion('version-root', {
      isCurrent: true,
      operationSeq: 1,
      createdAt: '2025-01-01T00:00:00.000Z',
    });
    const head = makeVersion('version-head', {
      parentId: root.id,
      parentVersionId: root.id,
      isCurrent: true,
      operationSeq: 2,
      createdAt: '2025-01-02T00:00:00.000Z',
    });

    render(
      createElement(VersionHistoryTree, {
        projectId: 'project-1',
        demoId: 'demo-1',
        demoName: 'Sunset Session',
        baseOperationSeq: 2,
        liveVersions: [root, head],
        operationHistory: [],
        currentVersionId: head.id,
        activeVersionId: head.id,
        selectedVersionId: head.id,
        zoomLevel: 1,
        isFollowingHead: true,
        isHistoryViewActive: false,
        highlightedVersionId: null,
        highlightedVersionCreatedAt: null,
        onSelectVersion: vi.fn(),
      }),
    );

    expect(screen.queryByRole('button', { name: 'Create Branch' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Revert to this version' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Go back to this version' })).toBeNull();
  });

  it('resets the tree scroll position to the top when the rail layout signal changes', () => {
    const root = makeVersion('version-root', {
      isCurrent: true,
      operationSeq: 1,
      createdAt: '2025-01-01T00:00:00.000Z',
    });
    const head = makeVersion('version-head', {
      parentId: root.id,
      parentVersionId: root.id,
      isCurrent: true,
      operationSeq: 2,
      createdAt: '2025-01-02T00:00:00.000Z',
    });

    let scrollTopValue = 240;
    let scrollLeftValue = 32;
    const originalScrollTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop');
    const originalScrollLeft = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollLeft');
    Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollLeft', {
      configurable: true,
      get: () => scrollLeftValue,
      set: (value: number) => {
        scrollLeftValue = value;
      },
    });

    try {
      const { rerender } = render(
        createElement(VersionHistoryTree, {
          projectId: 'project-1',
          demoId: 'demo-1',
          demoName: 'Sunset Session',
          baseOperationSeq: 2,
          liveVersions: [root, head],
          operationHistory: [],
          currentVersionId: head.id,
          activeVersionId: head.id,
          selectedVersionId: head.id,
          zoomLevel: 1,
          isFollowingHead: true,
          isHistoryViewActive: false,
          highlightedVersionId: null,
          highlightedVersionCreatedAt: null,
          scrollResetSignal: 'collapsed:-1',
          onSelectVersion: vi.fn(),
        }),
      );

      expect(scrollTopValue).toBe(0);
      expect(scrollLeftValue).toBe(0);

      scrollTopValue = 184;
      scrollLeftValue = 27;

      rerender(
        createElement(VersionHistoryTree, {
          projectId: 'project-1',
          demoId: 'demo-1',
          demoName: 'Sunset Session',
          baseOperationSeq: 2,
          liveVersions: [root, head],
          operationHistory: [],
          currentVersionId: head.id,
          activeVersionId: head.id,
          selectedVersionId: head.id,
          zoomLevel: 1,
          isFollowingHead: true,
          isHistoryViewActive: false,
          highlightedVersionId: null,
          highlightedVersionCreatedAt: null,
          scrollResetSignal: 'expanded:500',
          onSelectVersion: vi.fn(),
        }),
      );

      expect(scrollTopValue).toBe(0);
      expect(scrollLeftValue).toBe(0);
    } finally {
      if (originalScrollTop) {
        Object.defineProperty(HTMLElement.prototype, 'scrollTop', originalScrollTop);
      } else {
        delete (HTMLElement.prototype as unknown as { scrollTop?: unknown }).scrollTop;
      }
      if (originalScrollLeft) {
        Object.defineProperty(HTMLElement.prototype, 'scrollLeft', originalScrollLeft);
      } else {
        delete (HTMLElement.prototype as unknown as { scrollLeft?: unknown }).scrollLeft;
      }
    }
  });
});
