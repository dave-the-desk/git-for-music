import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveUploadSourceVersionId } from './upload-source-version';

test('upload source prefers the selected checkout over a fresher committed head', () => {
  assert.equal(
    resolveUploadSourceVersionId({
      selectedVersionId: 'version-recording-branch',
      liveActiveVersionId: 'version-pre-recording',
      freshestCommittedVersionId: 'version-recording-branch',
    }),
    'version-recording-branch',
  );
});

test('upload source falls back to the live active version when no selected checkout exists', () => {
  assert.equal(
    resolveUploadSourceVersionId({
      selectedVersionId: null,
      liveActiveVersionId: 'version-live',
      freshestCommittedVersionId: 'version-old-history',
    }),
    'version-live',
  );
});

test('upload source falls back to the freshest committed version when nothing is checked out', () => {
  assert.equal(
    resolveUploadSourceVersionId({
      selectedVersionId: null,
      liveActiveVersionId: null,
      freshestCommittedVersionId: 'version-fresh',
    }),
    'version-fresh',
  );
});
