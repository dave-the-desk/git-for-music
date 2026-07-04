import { createElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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
    description: overrides.description ?? null,
    parentId: overrides.parentId ?? null,
    parentVersionId: overrides.parentVersionId ?? overrides.parentId ?? null,
    createdAt: overrides.createdAt ?? '2025-01-01T00:00:00.000Z',
    kind: overrides.kind ?? 'EXPLICIT',
    operationSeq: overrides.operationSeq ?? 1,
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

describe('VersionHistoryTree revert action', () => {
  it('reverts the selected history version through the shared tree surface', async () => {
    const root = makeVersion('version-root', {
      isCurrent: false,
      operationSeq: 1,
      createdAt: '2025-01-01T00:00:00.000Z',
    });
    const branchHead = makeVersion('version-head', {
      parentId: root.id,
      parentVersionId: root.id,
      isCurrent: true,
      operationSeq: 2,
      createdAt: '2025-01-02T00:00:00.000Z',
    });
    const revert = makeVersion('version-revert', {
      parentId: branchHead.id,
      parentVersionId: branchHead.id,
      isCurrent: true,
      operationSeq: 3,
      createdAt: '2025-01-03T00:00:00.000Z',
    });

    const onSelectVersion = vi.fn();
    const onSelectHistoryOperation = vi.fn();
    const onCreateBranch = vi.fn().mockResolvedValue(null);
    const onCheckoutSelectedVersion = vi.fn();
    const onRevertToVersion = vi.fn().mockResolvedValue({
      versionId: revert.id,
      label: revert.label,
    });

    const user = userEvent.setup();
    render(
      createElement(VersionHistoryTree, {
        projectId: 'project-1',
        demoId: 'demo-1',
        baseOperationSeq: 3,
        versions: [root, branchHead, revert],
        operationHistory: [makeHistoryEntry({ versionId: root.id, currentVersionId: root.id })],
        currentVersionId: branchHead.id,
        activeVersionId: branchHead.id,
        selectedVersionId: root.id,
        selectedHistoryOperationSeq: 1,
        isFollowingHead: true,
        isHistoryViewActive: true,
        onSelectVersion,
        onCheckoutSelectedVersion,
        onSelectHistoryOperation,
        onCreateBranch,
        onRevertToVersion,
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Maximize version tree' }));
    await user.click(screen.getByRole('button', { name: 'Revert to this version' }));

    await waitFor(() => {
      expect(onRevertToVersion).toHaveBeenCalledWith(root.id);
      expect(onSelectHistoryOperation).toHaveBeenCalledWith(null);
      expect(onSelectVersion).toHaveBeenCalledWith(revert.id);
    });
  });
});
