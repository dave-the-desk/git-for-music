import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { prisma } from '@git-for-music/db';
import { DemoDawClient } from '@/features/daw/components/DemoDawClient';
import { getDemoDawPageData } from '@/features/daw/api/demo-page-data';

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

  const demo = await getDemoDawPageData({
    groupId,
    projectId,
    demoId,
    userId: user.id,
  });

  if (!demo || !demo.currentVersionId) {
    notFound();
  }

  return (
    <DemoDawClient
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
        tempoBpm: version.tempoBpm,
        timeSignatureNum: version.timeSignatureNum,
        timeSignatureDen: version.timeSignatureDen,
        musicalKey: version.musicalKey,
        tempoSource: version.tempoSource,
        keySource: version.keySource,
        parentId: version.parentId,
        createdAt: version.createdAt.toISOString(),
        isCurrent: version.id === demo.currentVersionId,
        tracks: Array.from(
          version.trackVersions.reduce<Map<string, (typeof version.trackVersions)[number]>>((map, trackVersion) => {
            if (!map.has(trackVersion.track.id)) {
              map.set(trackVersion.track.id, trackVersion);
            }
            return map;
          }, new Map()).values(),
        ).map((trackVersion) => ({
          trackId: trackVersion.track.id,
          trackName: trackVersion.track.name,
          trackPosition: trackVersion.track.position,
          trackVersionId: trackVersion.id,
          storageKey: trackVersion.storageKey,
          mimeType: trackVersion.mimeType,
          durationMs: trackVersion.durationMs,
          startOffsetMs: trackVersion.startOffsetMs,
          createdAt: trackVersion.createdAt.toISOString(),
          isDerived: trackVersion.isDerived,
          operationType: trackVersion.operationType,
          parentTrackVersionId: trackVersion.parentTrackVersionId,
          segments: trackVersion.segments.map((segment) => ({
            id: segment.id,
            trackVersionId: trackVersion.id,
            startMs: segment.startMs,
            endMs: segment.endMs,
            gainDb: segment.gainDb,
            fadeInMs: segment.fadeInMs,
            fadeOutMs: segment.fadeOutMs,
            isMuted: segment.isMuted,
            position: segment.position,
            isImplicit: false,
          })),
        })),
      }))}
    />
  );
}
