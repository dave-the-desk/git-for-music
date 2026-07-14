import { randomUUID, createHmac } from 'node:crypto';
import type { Prisma, PrismaClient } from '@git-for-music/db';
import { prisma } from '@git-for-music/db';
import { getConfig } from '@git-for-music/shared';
import {
  assetObjectExists,
  createObjectUploadTarget,
} from '@/app/lib/daw/server/assets';
import {
  buildPluginBundlePrefix,
  buildPluginModuleObjectKey,
} from '@/app/lib/daw/server/storage';

type PluginDb = Pick<
  PrismaClient,
  | 'demo'
  | 'groupMember'
  | 'pluginGrant'
  | 'pluginMetadata'
  | 'user'
>;

export type PluginVisibility = 'PRIVATE' | 'PUBLIC';
export type PluginBundleKind = 'SINGLE_MODULE' | 'ZIP_BUNDLE';

export type PluginDefinitionRow = {
  id: string;
  pluginKey: string;
  name: string;
  displayName: string | null;
  description: string | null;
  version: string;
  manufacturer: string | null;
  parameterSchema: Prisma.JsonValue;
  ownerId: string | null;
  visibility: PluginVisibility;
  moduleObjectKey: string | null;
  bundlePrefix: string | null;
  bundleKind: PluginBundleKind | null;
  sizeBytes: bigint | null;
  checksum: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SerializedPluginDefinitionRow = Omit<PluginDefinitionRow, 'sizeBytes' | 'createdAt' | 'updatedAt'> & {
  sizeBytes: string | null;
  createdAt: string;
  updatedAt: string;
};

type PluginUploadToken = {
  userId: string;
  pluginId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  bundleKind: PluginBundleKind;
  displayName: string | null;
  description: string | null;
  visibility: PluginVisibility;
  projectId: string | null;
  demoId: string | null;
  expiresAt: string;
  objectKey: string;
};

type CreatePluginUploadTargetInput = {
  userId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  bundleKind?: PluginBundleKind;
  displayName?: string | null;
  description?: string | null;
  visibility?: PluginVisibility;
  projectId?: string | null;
  demoId?: string | null;
  expiresAt?: string;
  pluginId?: string;
};

type PluginUpdateInput = {
  displayName?: string | null;
  description?: string | null;
  visibility?: PluginVisibility;
};

type PluginGrantInput = {
  userId: string;
  projectId: string;
  pluginId: string;
  demoId: string;
};

function getTokenSecret() {
  const config = getConfig();
  return (
    config.secrets.dawPluginUploadTokenSecret ||
    config.secrets.dawAssetUploadTokenSecret ||
    config.secrets.nextAuthSecret ||
    'dev-only-daw-plugin-token-secret'
  );
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signToken(payload: PluginUploadToken) {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = createHmac('sha256', getTokenSecret()).update(encodedPayload).digest('base64url');
  return `${encodedPayload}.${signature}`;
}

function verifyToken(token: string) {
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) {
    return null;
  }

  const expected = createHmac('sha256', getTokenSecret()).update(encodedPayload).digest('base64url');
  if (signature !== expected) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as Partial<PluginUploadToken>;
    const hasValidOptionalString = (value: string | null | undefined) =>
      value === undefined || value === null || typeof value === 'string';
    if (
      typeof payload.userId !== 'string' ||
      typeof payload.pluginId !== 'string' ||
      typeof payload.fileName !== 'string' ||
      typeof payload.contentType !== 'string' ||
      typeof payload.sizeBytes !== 'number' ||
      typeof payload.bundleKind !== 'string' ||
      !hasValidOptionalString(payload.displayName) ||
      !hasValidOptionalString(payload.description) ||
      typeof payload.visibility !== 'string' ||
      typeof payload.expiresAt !== 'string' ||
      typeof payload.objectKey !== 'string'
    ) {
      return null;
    }

    if (Date.now() > Date.parse(payload.expiresAt)) {
      return null;
    }

    return payload as PluginUploadToken;
  } catch {
    return null;
  }
}

function sanitizeBundleFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '') || 'module.mjs';
}

function assertSupportedBundleKind(bundleKind: PluginBundleKind, fileName: string, contentType: string) {
  if (bundleKind !== 'SINGLE_MODULE') {
    throw new Error('Only single-module plugin bundles are supported right now.');
  }

  const normalizedFileName = fileName.toLowerCase();
  const normalizedContentType = contentType.toLowerCase();
  const supportedExtension = normalizedFileName.endsWith('.js') || normalizedFileName.endsWith('.mjs');
  const supportedMimeType =
    normalizedContentType.startsWith('text/javascript') ||
    normalizedContentType.startsWith('application/javascript') ||
    normalizedContentType.startsWith('application/x-javascript');

  if (!supportedExtension || !supportedMimeType) {
    throw new Error('Plugin bundles must be a JavaScript module (.js or .mjs) with a JavaScript content type.');
  }
}

function buildPluginKey(ownerId: string, pluginId: string) {
  return `user:${ownerId}:${pluginId}`;
}

function buildPluginVersion(pluginId: string) {
  return pluginId;
}

function serializePluginDefinition(row: PluginDefinitionRow): SerializedPluginDefinitionRow {
  return {
    ...row,
    sizeBytes: row.sizeBytes?.toString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function buildPluginDescriptorUrl(pluginId: string, cacheBust?: Date | null) {
  const url = `/api/plugins/${pluginId}/module`;
  if (!cacheBust) {
    return url;
  }

  return `${url}?v=${cacheBust.getTime()}`;
}

export async function listUserPlugins(db: PluginDb, userId: string) {
  const plugins = await db.pluginMetadata.findMany({
    where: {
      ownerId: userId,
    },
    orderBy: {
      updatedAt: 'desc',
    },
    select: {
      id: true,
      pluginKey: true,
      name: true,
      displayName: true,
      description: true,
      version: true,
      manufacturer: true,
      parameterSchema: true,
      ownerId: true,
      visibility: true,
      moduleObjectKey: true,
      bundlePrefix: true,
      bundleKind: true,
      sizeBytes: true,
      checksum: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return plugins.map((plugin) => ({
    ...serializePluginDefinition(plugin),
    descriptorUrl: buildPluginDescriptorUrl(plugin.id, plugin.updatedAt),
  }));
}

export async function listPluginsForDemo(db: PluginDb, input: { demoId: string; userId: string }) {
  const pluginDefinitions = await db.pluginMetadata.findMany({
    where: {
      OR: [
        { ownerId: null },
        { visibility: 'PUBLIC' },
        { ownerId: input.userId },
        {
          grants: {
            some: {
              demoId: input.demoId,
            },
          },
        },
      ],
    },
    orderBy: {
      updatedAt: 'desc',
    },
    select: {
      id: true,
      pluginKey: true,
      name: true,
      displayName: true,
      description: true,
      version: true,
      manufacturer: true,
      parameterSchema: true,
      ownerId: true,
      visibility: true,
      moduleObjectKey: true,
      bundlePrefix: true,
      bundleKind: true,
      sizeBytes: true,
      checksum: true,
      createdAt: true,
      updatedAt: true,
      grants: {
        where: {
          demoId: input.demoId,
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 1,
        select: {
          createdAt: true,
        },
      },
    },
  });

  return pluginDefinitions.map(({ grants, ...plugin }) => ({
    ...plugin,
    sizeBytes: plugin.sizeBytes?.toString() ?? null,
    createdAt: plugin.createdAt.toISOString(),
    updatedAt: plugin.updatedAt.toISOString(),
    descriptorUrl: buildPluginDescriptorUrl(plugin.id, grants[0]?.createdAt ?? plugin.updatedAt),
  }));
}

export async function assertPluginModuleAccess(db: PluginDb, input: { userId: string; pluginId: string }) {
  const plugin = await db.pluginMetadata.findFirst({
    where: {
      id: input.pluginId,
      OR: [
        { ownerId: input.userId },
        { ownerId: null },
        { visibility: 'PUBLIC' },
        {
          grants: {
            some: {
              demo: {
                project: {
                  group: {
                    members: {
                      some: {
                        userId: input.userId,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      ],
    },
    select: {
      id: true,
      pluginKey: true,
      name: true,
      displayName: true,
      description: true,
      version: true,
      manufacturer: true,
      parameterSchema: true,
      ownerId: true,
      visibility: true,
      moduleObjectKey: true,
      bundlePrefix: true,
      bundleKind: true,
      sizeBytes: true,
      checksum: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return plugin ? serializePluginDefinition(plugin) : null;
}

export async function createPluginUploadTarget(input: CreatePluginUploadTargetInput) {
  const bundleKind = input.bundleKind ?? 'SINGLE_MODULE';
  assertSupportedBundleKind(bundleKind, input.fileName, input.contentType);

  const pluginId = input.pluginId ?? randomUUID();
  const expiresAt = input.expiresAt ?? new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const objectKey = buildPluginModuleObjectKey({
    ownerId: input.userId,
    pluginId,
    version: buildPluginVersion(pluginId),
    fileName: sanitizeBundleFileName(input.fileName),
  });
  const bundlePrefix = buildPluginBundlePrefix({
    ownerId: input.userId,
    pluginId,
    version: buildPluginVersion(pluginId),
  });
  const uploadToken = signToken({
    userId: input.userId,
    pluginId,
    fileName: input.fileName,
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
    bundleKind,
    displayName: input.displayName ?? null,
    description: input.description ?? null,
    visibility: input.visibility ?? 'PRIVATE',
    projectId: input.projectId ?? null,
    demoId: input.demoId ?? null,
    expiresAt,
    objectKey,
  });

  return {
    pluginId,
    bundlePrefix,
    uploadToken,
    ...(await createObjectUploadTarget({
      objectKey,
      contentType: input.contentType,
      expiresAt,
    })),
  };
}

export async function completePluginUpload(db: PluginDb, input: {
  userId: string;
  uploadToken: string;
}) {
  const token = verifyToken(input.uploadToken);
  if (!token) {
    throw new Error('Invalid or expired plugin upload token');
  }

  if (token.userId !== input.userId) {
    throw new Error('Unauthorized');
  }

  const uploadExists = await assetObjectExists(token.objectKey);
  if (!uploadExists) {
    throw new Error('Uploaded plugin bundle not found');
  }

  const demo = token.demoId
    ? await db.demo.findFirst({
        where: {
          id: token.demoId,
          projectId: token.projectId ?? undefined,
          project: {
            group: {
              members: {
                some: {
                  userId: input.userId,
                },
              },
            },
          },
        },
        select: {
          id: true,
          projectId: true,
          project: {
            select: {
              group: {
                select: {
                  id: true,
                },
              },
            },
          },
        },
      })
    : null;

  if (token.demoId && !demo) {
    throw new Error('Demo not found');
  }

  const plugin = await db.pluginMetadata.upsert({
    where: {
      id: token.pluginId,
    },
    create: {
      id: token.pluginId,
      pluginKey: buildPluginKey(token.userId, token.pluginId),
      name: token.displayName?.trim() || token.fileName.replace(/\.[^.]+$/, '') || token.pluginId,
      displayName: token.displayName?.trim() || null,
      description: token.description?.trim() || null,
      version: buildPluginVersion(token.pluginId),
      manufacturer: null,
      parameterSchema: {},
      ownerId: token.userId,
      visibility: token.visibility,
      moduleObjectKey: token.objectKey,
      bundlePrefix: buildPluginBundlePrefix({
        ownerId: token.userId,
        pluginId: token.pluginId,
        version: buildPluginVersion(token.pluginId),
      }),
      bundleKind: token.bundleKind,
      sizeBytes: BigInt(token.sizeBytes),
      checksum: null,
    },
    update: {
      displayName: token.displayName?.trim() || null,
      description: token.description?.trim() || null,
      visibility: token.visibility,
      moduleObjectKey: token.objectKey,
      bundlePrefix: buildPluginBundlePrefix({
        ownerId: token.userId,
        pluginId: token.pluginId,
        version: buildPluginVersion(token.pluginId),
      }),
      bundleKind: token.bundleKind,
      sizeBytes: BigInt(token.sizeBytes),
      checksum: null,
    },
    select: {
      id: true,
      pluginKey: true,
      name: true,
      displayName: true,
      description: true,
      version: true,
      manufacturer: true,
      parameterSchema: true,
      ownerId: true,
      visibility: true,
      moduleObjectKey: true,
      bundlePrefix: true,
      bundleKind: true,
      sizeBytes: true,
      checksum: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (demo) {
    await db.pluginGrant.upsert({
      where: {
        pluginId_demoId: {
          pluginId: plugin.id,
          demoId: demo.id,
        },
      },
      create: {
        pluginId: plugin.id,
        demoId: demo.id,
        grantedById: input.userId,
      },
      update: {
        grantedById: input.userId,
      },
    });
  }

  return {
    plugin: serializePluginDefinition(plugin),
    autoGrantedDemoId: demo?.id ?? null,
  };
}

export async function updatePlugin(
  db: PluginDb,
  input: {
    userId: string;
    pluginId: string;
    updates: PluginUpdateInput;
  },
) {
  const plugin = await db.pluginMetadata.findFirst({
    where: {
      id: input.pluginId,
      ownerId: input.userId,
    },
    select: {
      id: true,
    },
  });

  if (!plugin) {
    throw new Error('Plugin not found');
  }

  const updatedPlugin = await db.pluginMetadata.update({
    where: {
      id: input.pluginId,
    },
    data: {
      displayName: input.updates.displayName?.trim() || null,
      description: input.updates.description?.trim() || null,
      visibility: input.updates.visibility,
    },
    select: {
      id: true,
      pluginKey: true,
      name: true,
      displayName: true,
      description: true,
      version: true,
      manufacturer: true,
      parameterSchema: true,
      ownerId: true,
      visibility: true,
      moduleObjectKey: true,
      bundlePrefix: true,
      bundleKind: true,
      sizeBytes: true,
      checksum: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return serializePluginDefinition(updatedPlugin);
}

export async function deletePlugin(db: PluginDb, input: { userId: string; pluginId: string }) {
  const plugin = await db.pluginMetadata.findFirst({
    where: {
      id: input.pluginId,
      ownerId: input.userId,
    },
    select: {
      id: true,
    },
  });

  if (!plugin) {
    throw new Error('Plugin not found');
  }

  await db.pluginMetadata.delete({
    where: {
      id: input.pluginId,
    },
  });
}

export async function grantPluginToDemo(db: PluginDb, input: PluginGrantInput) {
  const plugin = await db.pluginMetadata.findFirst({
    where: {
      id: input.pluginId,
      ownerId: input.userId,
    },
    select: {
      id: true,
    },
  });

  if (!plugin) {
    throw new Error('Plugin not found');
  }

  const demo = await db.demo.findFirst({
    where: {
      id: input.demoId,
      projectId: input.projectId,
      project: {
        group: {
          members: {
            some: {
              userId: input.userId,
            },
          },
        },
      },
    },
    select: {
      id: true,
    },
  });

  if (!demo) {
    throw new Error('Demo not found');
  }

  return db.pluginGrant.upsert({
    where: {
      pluginId_demoId: {
        pluginId: input.pluginId,
        demoId: input.demoId,
      },
    },
    create: {
      pluginId: input.pluginId,
      demoId: input.demoId,
      grantedById: input.userId,
    },
    update: {
      grantedById: input.userId,
    },
  });
}

export async function revokePluginFromDemo(db: PluginDb, input: PluginGrantInput) {
  const plugin = await db.pluginMetadata.findFirst({
    where: {
      id: input.pluginId,
      ownerId: input.userId,
    },
    select: {
      id: true,
    },
  });

  if (!plugin) {
    throw new Error('Plugin not found');
  }

  const demo = await db.demo.findFirst({
    where: {
      id: input.demoId,
      projectId: input.projectId,
      project: {
        group: {
          members: {
            some: {
              userId: input.userId,
            },
          },
        },
      },
    },
    select: {
      id: true,
    },
  });

  if (!demo) {
    throw new Error('Demo not found');
  }

  await db.pluginGrant.deleteMany({
    where: {
      pluginId: input.pluginId,
      demoId: input.demoId,
    },
  });
}

export function getPluginModuleObjectKey(plugin: Pick<PluginDefinitionRow, 'moduleObjectKey' | 'bundlePrefix'>, path: string[] = []) {
  if (path.length > 0) {
    return `${plugin.bundlePrefix ?? plugin.moduleObjectKey ?? ''}/${path.map((segment) => segment.replace(/^\/+/, '')).join('/')}`;
  }

  return plugin.moduleObjectKey ?? plugin.bundlePrefix ?? null;
}

export { prisma };
