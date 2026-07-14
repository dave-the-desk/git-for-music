import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { prisma } from '@git-for-music/db';
import { createDemoCommand } from '@/app/lib/daw/server/commands/create-demo';
import { createDemoVersionCommand } from '@/app/lib/daw/server/commands/create-version';
import { revertToVersionCommand } from '@/app/lib/daw/server/commands/revert-version';
import { uploadTrackCommand } from '@/app/lib/daw/server/commands/upload-track';
import { assetObjectExists, createAssetDownloadUrl } from '@/app/lib/daw/server/assets';
import { loadSnapshotStateForDemo } from '@/app/lib/daw/server/snapshot-builder';
import { getStorageProvider } from '@/app/lib/extensions';
import { POST as signupPost } from '@/app/pages/api/auth/signup/index';
import { POST as createGroupPost } from '@/app/pages/api/groups/index';
import { POST as createProjectPost } from '@/app/pages/api/groups/[groupSlug]/projects/index';

function hasIntegrationEnvironment() {
  return (
    process.env.RUN_INTEGRATION_TESTS === '1' &&
    Boolean(process.env.DATABASE_URL) &&
    Boolean(process.env.OBJECT_STORAGE_BUCKET_NAME) &&
    Boolean(process.env.OBJECT_STORAGE_ACCESS_KEY_ID) &&
    Boolean(process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY) &&
    Boolean(process.env.OBJECT_STORAGE_PUBLIC_URL) &&
    Boolean(process.env.OBJECT_STORAGE_INTERNAL_URL)
  );
}

function jsonRequest(url: string, body: unknown, cookie?: string) {
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function extractSessionCookie(setCookieHeader: string | null) {
  return setCookieHeader ? setCookieHeader.split(';', 1)[0] ?? '' : '';
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

const integration = hasIntegrationEnvironment() ? test : test.skip;

integration('public repo integration flow covers signup, project creation, upload, snapshot bootstrap, branch, and revert', async () => {
  const suffix = randomUUID().slice(0, 8);
  const email = `integration-${suffix}@example.com`;
  const password = 'integration-pass-123';
  const cookieJar: string[] = [];
  let uploadedStorageKey: string | null = null;
  let groupId: string | null = null;
  let projectId: string | null = null;
  let demoId: string | null = null;
  let userId: string | null = null;

  const sessionCookie = (setCookieHeader: string | null) => {
    const cookie = extractSessionCookie(setCookieHeader);
    if (cookie) {
      cookieJar.push(cookie);
    }
    return cookieJar.join('; ');
  };

  try {
    const signupResponse = await signupPost(
      jsonRequest('http://localhost/api/auth/signup', {
        email,
        name: `Integration ${suffix}`,
        password,
        confirmPassword: password,
      }),
    );
    assert.equal(signupResponse.status, 201);
    const signupBody = await readJson<{ id: string; email: string; name: string | null }>(signupResponse);
    userId = signupBody.id;
    const authCookie = sessionCookie(signupResponse.headers.get('set-cookie'));

    const groupResponse = await createGroupPost(
      jsonRequest(
        'http://localhost/api/groups',
        {
          name: `Integration Group ${suffix}`,
          description: 'Integration test group',
        },
        authCookie,
      ),
    );
    assert.equal(groupResponse.status, 201);
    const groupBody = await readJson<{ id: string; slug: string }>(groupResponse);
    groupId = groupBody.id;
    const groupSlug = groupBody.slug;

    const projectResponse = await createProjectPost(
      jsonRequest(
        `http://localhost/api/groups/${groupSlug}/projects`,
        {
          name: `Integration Project ${suffix}`,
          description: 'Integration test project',
        },
        authCookie,
      ),
      {
        params: Promise.resolve({ groupSlug }),
      },
    );
    assert.equal(projectResponse.status, 201);
    const projectBody = await readJson<{ id: string; slug: string }>(projectResponse);
    projectId = projectBody.id;

    const demoResponse = await createDemoCommand({
      userId,
      projectId,
      name: `Integration Demo ${suffix}`,
      description: 'Integration test demo',
      sharedDemoTempoBpm: 96,
    });
    assert.equal(demoResponse.status, 201);
    const demoBody = await readJson<{ id: string; name: string; projectId: string }>(demoResponse);
    demoId = demoBody.id;

    const initialSnapshot = await loadSnapshotStateForDemo(prisma, {
      projectId,
      demoId,
    });
    assert.ok(initialSnapshot.versions.length >= 1);
    const initialVersionId = initialSnapshot.currentVersionId;
    assert.ok(initialVersionId);

    const uploadFile = new File([Buffer.from('integration audio data')], `upload-${suffix}.wav`, {
      type: 'audio/wav',
    });
    const uploadResponse = await uploadTrackCommand({
      userId,
      demoId,
      name: `Upload ${suffix}`,
      sourceVersionId: initialVersionId,
      file: uploadFile,
    });
    assert.equal(uploadResponse.status, 201);
    const uploadBody = await readJson<{
      trackVersionId: string;
      demoVersionId: string;
      status: string;
      processingJobIds: string[];
    }>(uploadResponse);

    const uploadedAsset = await prisma.audioAssetMetadata.findFirst({
      where: {
        demoId,
        trackVersionId: uploadBody.trackVersionId,
      },
      select: {
        storageKey: true,
      },
    });
    assert.ok(uploadedAsset);
    uploadedStorageKey = uploadedAsset.storageKey;
    assert.equal(await assetObjectExists(uploadedStorageKey), true);

    const uploadedSnapshot = await loadSnapshotStateForDemo(prisma, {
      projectId,
      demoId,
    });
    assert.equal(uploadedSnapshot.currentVersionId, uploadBody.demoVersionId);
    assert.ok(
      uploadedSnapshot.versions.some((version) =>
        version.tracks.some((track) => track.trackVersionId === uploadBody.trackVersionId),
      ),
    );

    const branchResponse = await createDemoVersionCommand({
      userId,
      demoId,
      sourceVersionId: uploadBody.demoVersionId,
      label: `Integration branch ${suffix}`,
      description: 'Integration branch command',
    });
    assert.equal(branchResponse.status, 201);
    const branchBody = await readJson<{
      id: string;
      label: string;
      activeVersionId: string;
      isFollowingHead: boolean;
    }>(branchResponse);
    assert.equal(branchBody.activeVersionId, branchBody.id);
    assert.equal(branchBody.isFollowingHead, true);

    const revertResponse = await revertToVersionCommand({
      userId,
      demoId,
      sourceVersionId: uploadBody.demoVersionId,
      label: `Integration revert ${suffix}`,
      description: 'Integration revert command',
    });
    assert.equal(revertResponse.status, 201);
    const revertBody = await readJson<{
      id: string;
      activeVersionId: string;
      isFollowingHead: boolean;
      activeBranchName: string;
    }>(revertResponse);
    assert.equal(revertBody.activeVersionId, revertBody.id);
    assert.equal(revertBody.isFollowingHead, true);

    const finalSnapshot = await loadSnapshotStateForDemo(prisma, {
      projectId,
      demoId,
    });
    assert.equal(finalSnapshot.currentVersionId, revertBody.id);

    const operationTypes = await prisma.projectOperationLog.findMany({
      where: {
        demoId,
      },
      orderBy: {
        operationSeq: 'asc',
      },
      select: {
        operationType: true,
      },
    });
    assert.deepEqual(
      operationTypes.map((entry) => entry.operationType),
      ['VERSION_CREATED', 'TRACK_VERSION_CREATED', 'VERSION_BRANCH_CREATED', 'VERSION_BRANCH_CREATED', 'VERSION_REVERTED_FROM'],
    );

    const latestSnapshot = await prisma.projectSnapshot.findFirst({
      where: {
        demoId,
      },
      orderBy: {
        operationSeq: 'desc',
      },
      select: {
        operationSeq: true,
        snapshot: true,
      },
    });
    assert.ok(latestSnapshot);
    assert.equal(latestSnapshot?.operationSeq, operationTypes.length);
    assert.equal(
      (latestSnapshot?.snapshot as { currentVersionId?: string } | null)?.currentVersionId,
      revertBody.id,
    );

    const downloadTarget = await createAssetDownloadUrl({
      objectKey: uploadedStorageKey,
      contentType: 'audio/wav',
    });
    assert.ok(downloadTarget.url.startsWith('http://'));

  } finally {
    if (uploadedStorageKey) {
      try {
        await getStorageProvider().deleteObject(uploadedStorageKey);
      } catch {
        // Ignore cleanup failures; the DB cleanup below is the important part.
      }
    }

    if (groupId) {
      await prisma.group.deleteMany({
        where: {
          id: groupId,
        },
      });
    }

    if (userId) {
      await prisma.user.deleteMany({
        where: {
          id: userId,
        },
      });
    }
  }
});
