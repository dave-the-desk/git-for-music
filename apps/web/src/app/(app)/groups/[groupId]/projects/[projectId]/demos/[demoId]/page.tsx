import { prisma } from '@git-for-music/db';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { DemoWorkspaceClient } from './demo-workspace-client';

export default async function DemoPage({
  params,
}: {
  params: Promise<{ groupId: string; projectId: string; demoId: string }>;
}) {
  const { groupId, projectId, demoId } = await params;
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);

  if (!sessionCookie?.value) {
    redirect('/login');
  }

  const user = await prisma.user.findUnique({
    where: {
      id: sessionCookie.value,
    },
    select: {
      id: true,
    },
  });

  if (!user) {
    redirect('/login');
  }

  const demo = await prisma.demo.findFirst({
    where: {
      id: demoId,
      project: {
        slug: projectId,
        group: {
          slug: groupId,
          members: {
            some: {
              userId: user.id,
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
          parentId: true,
          createdAt: true,
          trackVersions: {
            select: {
              id: true,
              storageKey: true,
              mimeType: true,
              durationMs: true,
              createdAt: true,
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

  if (!demo || !demo.currentVersionId) {
    notFound();
  }

  return (
    <DemoWorkspaceClient
      groupSlug={demo.project.group.slug}
      projectSlug={demo.project.slug}
      demoId={demo.id}
      demoName={demo.name}
      demoDescription={demo.description}
      currentVersionId={demo.currentVersionId}
      versions={demo.versions.map((version) => ({
        id: version.id,
        label: version.label,
        description: version.description,
        parentId: version.parentId,
        createdAt: version.createdAt.toISOString(),
        isCurrent: version.id === demo.currentVersionId,
        tracks: version.trackVersions.map((trackVersion) => ({
          trackId: trackVersion.track.id,
          trackName: trackVersion.track.name,
          trackPosition: trackVersion.track.position,
          trackVersionId: trackVersion.id,
          storageKey: trackVersion.storageKey,
          mimeType: trackVersion.mimeType,
          durationMs: trackVersion.durationMs,
          createdAt: trackVersion.createdAt.toISOString(),
        })),
      }))}
    />
  );
}
