import { prisma } from '@git-for-music/db';

export async function getDemoDawPageData({
  groupId,
  projectId,
  demoId,
  userId,
}: {
  groupId: string;
  projectId: string;
  demoId: string;
  userId: string;
}) {
  const demo = await prisma.demo.findFirst({
    where: {
      id: demoId,
      project: {
        slug: projectId,
        group: {
          slug: groupId,
          members: {
            some: {
              userId,
            },
          },
        },
      },
    },
    select: {
      id: true,
      name: true,
      description: true,
      currentVersionId: true,
      project: {
        select: {
          slug: true,
          group: {
            select: {
              slug: true,
            },
          },
        },
      },
      versions: {
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          id: true,
          label: true,
          description: true,
          tempoBpm: true,
          timeSignatureNum: true,
          timeSignatureDen: true,
          musicalKey: true,
          tempoSource: true,
          keySource: true,
          parentId: true,
          createdAt: true,
          trackVersions: {
            orderBy: {
              createdAt: 'desc',
            },
            select: {
              id: true,
              storageKey: true,
              mimeType: true,
              durationMs: true,
              startOffsetMs: true,
              createdAt: true,
              isDerived: true,
              operationType: true,
              parentTrackVersionId: true,
              segments: {
                orderBy: {
                  position: 'asc',
                },
                select: {
                  id: true,
                  startMs: true,
                  endMs: true,
                  gainDb: true,
                  fadeInMs: true,
                  fadeOutMs: true,
                  isMuted: true,
                  position: true,
                },
              },
              track: {
                select: {
                  id: true,
                  name: true,
                  position: true,
                },
              },
            },
          },
        },
      },
    },
  });

  return demo;
}
