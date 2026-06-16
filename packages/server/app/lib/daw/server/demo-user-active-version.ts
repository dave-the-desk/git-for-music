import { Prisma, PrismaClient } from '@git-for-music/db';

export type DawDatabaseClient = PrismaClient | Prisma.TransactionClient;

export type DemoUserActiveVersionState = {
  activeVersionId: string | null;
  isFollowingHead: boolean;
  activeBranchName: string | null;
};

type DemoVersionCheckoutNode = {
  id: string;
  label: string;
  parentId: string | null;
  createdAt: string | Date;
};

function buildDemoVersionLookup(versions: DemoVersionCheckoutNode[]) {
  return new Map(
    versions.map((version) => [
      version.id,
      {
        ...version,
        createdAt: version.createdAt instanceof Date ? version.createdAt.toISOString() : version.createdAt,
      },
    ]),
  );
}

function isDescendantOf(
  candidateVersionId: string,
  ancestorVersionId: string,
  versionsById: Map<string, DemoVersionCheckoutNode>,
) {
  const visited = new Set<string>();
  let currentVersionId: string | null = candidateVersionId;

  while (currentVersionId) {
    if (currentVersionId === ancestorVersionId) {
      return true;
    }

    if (visited.has(currentVersionId)) {
      break;
    }

    visited.add(currentVersionId);
    currentVersionId = versionsById.get(currentVersionId)?.parentId ?? null;
  }

  return false;
}

function resolveDemoBranchHeadVersionId(
  versionsById: Map<string, DemoVersionCheckoutNode>,
  candidateVersionId: string | null,
  sharedHeadVersionId: string | null,
) {
  if (!candidateVersionId) {
    return sharedHeadVersionId;
  }

  if (!versionsById.has(candidateVersionId)) {
    return sharedHeadVersionId;
  }

  if (sharedHeadVersionId && isDescendantOf(sharedHeadVersionId, candidateVersionId, versionsById)) {
    return sharedHeadVersionId;
  }

  return candidateVersionId;
}

export async function setDemoUserActiveVersion(
  client: DawDatabaseClient,
  input: {
    projectId?: string;
    demoId: string;
    userId: string;
    versionId: string;
    isFollowingHead?: boolean;
  },
): Promise<DemoUserActiveVersionState | null> {
  return upsertDemoUserActiveVersionState(client, {
    projectId: input.projectId,
    demoId: input.demoId,
    userId: input.userId,
    activeVersionId: input.versionId,
    isFollowingHead: input.isFollowingHead,
  });
}

export async function upsertDemoUserActiveVersionState(
  client: DawDatabaseClient,
  input: {
    projectId?: string;
    demoId: string;
    userId: string;
    activeVersionId: string;
    isFollowingHead?: boolean;
  },
): Promise<DemoUserActiveVersionState | null> {
  const demo = await client.demo.findFirst({
    where: {
      id: input.demoId,
      ...(input.projectId
        ? {
            projectId: input.projectId,
          }
        : {}),
    },
    select: {
      id: true,
    },
  });

  if (!demo) {
    return null;
  }

  const activeVersion = await client.demoVersion.findFirst({
    where: {
      id: input.activeVersionId,
      demoId: demo.id,
    },
    select: {
      id: true,
      label: true,
    },
  });

  if (!activeVersion) {
    throw new Error('Version not found');
  }

  const shouldFollowHead = input.isFollowingHead ?? true;
  const activeVersionState = await client.demoUserActiveVersion.upsert({
    where: {
      demoId_userId: {
        demoId: demo.id,
        userId: input.userId,
      },
    },
    create: {
      demoId: demo.id,
      userId: input.userId,
      activeVersionId: activeVersion.id,
      isFollowingHead: shouldFollowHead,
    },
    update: {
      activeVersionId: activeVersion.id,
      isFollowingHead: shouldFollowHead,
    },
    select: {
      activeVersionId: true,
      isFollowingHead: true,
      activeVersion: {
        select: {
          label: true,
        },
      },
    },
  });

  return {
    activeVersionId: activeVersionState.activeVersionId,
    isFollowingHead: activeVersionState.isFollowingHead,
    activeBranchName: activeVersionState.activeVersion?.label ?? null,
  };
}

export async function loadOrCreateDemoUserActiveVersionState(
  client: DawDatabaseClient,
  input: {
    projectId?: string;
    demoId: string;
    userId: string;
    currentActiveVersionId?: string | null;
    isFollowingHead?: boolean | null;
  },
): Promise<DemoUserActiveVersionState> {
  const demo = await client.demo.findFirst({
    where: {
      id: input.demoId,
      ...(input.projectId
        ? {
            projectId: input.projectId,
          }
        : {}),
    },
    select: {
      id: true,
      currentVersionId: true,
      versions: {
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          id: true,
          label: true,
          parentId: true,
          createdAt: true,
        },
      },
    },
  });

  if (!demo) {
    return {
      activeVersionId: null,
      isFollowingHead: true,
      activeBranchName: null,
    };
  }

  const versionLookup = buildDemoVersionLookup(demo.versions);
  // Prefer the freshest version row we can see. `Demo.currentVersionId` is a legacy fallback
  // and can lag behind the actual branch head after new version nodes are created.
  const sharedHeadVersionId =
    demo.versions[0]?.id ??
    (demo.currentVersionId && versionLookup.has(demo.currentVersionId) ? demo.currentVersionId : null) ??
    null;
  const existingActiveVersionState = await client.demoUserActiveVersion.findFirst({
    where: {
      demoId: demo.id,
      userId: input.userId,
    },
    select: {
      activeVersionId: true,
      isFollowingHead: true,
    },
  });

  const shouldFollowHead = input.isFollowingHead ?? existingActiveVersionState?.isFollowingHead ?? true;
  const preferredActiveVersionId =
    (input.currentActiveVersionId && versionLookup.has(input.currentActiveVersionId)
      ? input.currentActiveVersionId
      : null) ??
    (existingActiveVersionState?.activeVersionId && versionLookup.has(existingActiveVersionState.activeVersionId)
      ? existingActiveVersionState.activeVersionId
      : null) ??
    sharedHeadVersionId;
  const resolvedActiveVersionId = shouldFollowHead
    ? resolveDemoBranchHeadVersionId(versionLookup, preferredActiveVersionId, sharedHeadVersionId)
    : preferredActiveVersionId;

  if (!resolvedActiveVersionId) {
    return {
      activeVersionId: null,
      isFollowingHead: true,
      activeBranchName: null,
    };
  }

  const resolvedActiveVersion = versionLookup.get(resolvedActiveVersionId) ?? null;
  if (existingActiveVersionState) {
    if (
      existingActiveVersionState.activeVersionId !== resolvedActiveVersionId ||
      existingActiveVersionState.isFollowingHead !== shouldFollowHead
    ) {
      const repairedActiveVersionState = await setDemoUserActiveVersion(client, {
        projectId: input.projectId,
        demoId: input.demoId,
        userId: input.userId,
        versionId: resolvedActiveVersionId,
        isFollowingHead: shouldFollowHead,
      });

      return repairedActiveVersionState ?? {
        activeVersionId: resolvedActiveVersionId,
        isFollowingHead: shouldFollowHead,
        activeBranchName: resolvedActiveVersion?.label ?? null,
      };
    }

    return {
      activeVersionId: resolvedActiveVersionId,
      isFollowingHead: shouldFollowHead,
      activeBranchName: resolvedActiveVersion?.label ?? null,
    };
  }

  const activeVersionState = await setDemoUserActiveVersion(client, {
    projectId: input.projectId,
    demoId: input.demoId,
    userId: input.userId,
    versionId: resolvedActiveVersionId,
    isFollowingHead: shouldFollowHead,
  });

  return activeVersionState ?? {
    activeVersionId: resolvedActiveVersionId,
    isFollowingHead: shouldFollowHead,
    activeBranchName: resolvedActiveVersion?.label ?? null,
  };
}
