import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveUploadSourceVersionId } from './upload-source-version';

test('upload source prefers the freshly committed version over a stale live active version', () => {
  assert.equal(
    resolveUploadSourceVersionId({
      selectedVersionId: 'version-recording-branch',
      liveActiveVersionId: 'version-pre-recording',
      freshestCommittedVersionId: 'version-recording-branch',
      isHistoryViewActive: false,
    }),
    'version-recording-branch',
  );
});

test('upload source falls back to live active version when selection is a detached history view', () => {
  assert.equal(
    resolveUploadSourceVersionId({
      selectedVersionId: 'version-old-history',
      liveActiveVersionId: 'version-live',
      freshestCommittedVersionId: 'version-old-history',
      isHistoryViewActive: true,
    }),
    'version-live',
  );
});

test('upload source falls back to selected version when no fresher commit is known', () => {
  assert.equal(
    resolveUploadSourceVersionId({
      selectedVersionId: 'version-selected',
      liveActiveVersionId: 'version-live',
      freshestCommittedVersionId: null,
      isHistoryViewActive: false,
    }),
    'version-selected',
  );
});
