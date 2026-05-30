import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { prisma } from '@git-for-music/db';
import { DemoDawClient } from '@/features/daw/components/DemoDawClient';
import { createAssetDownloadUrl } from '@/features/daw/server/assets';
import { getDemoDawPageData } from '@/features/daw/server/demo-page-data';

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

  const initialActiveVersionId = demo?.activeVersionId ?? null;
  const initialCurrentVersionId = demo?.currentVersionId ?? initialActiveVersionId;

  if (!demo || !initialCurrentVersionId) {
    notFound();
  }

  const resolvedVersions = await Promise.all(
    demo.versions.map(async (version) => {
      const resolvedTracks = await Promise.all(
        version.tracks.map(async (trackVersion) => {
          const downloadUrl = await createAssetDownloadUrl({
            objectKey: trackVersion.storageKey,
          });

          return {
            trackId: trackVersion.trackId,
            trackName: trackVersion.trackName,
            trackPosition: trackVersion.trackPosition,
            trackVersionId: trackVersion.trackVersionId,
            storageKey: downloadUrl.url,
            mimeType: trackVersion.mimeType,
            durationMs: trackVersion.durationMs,
            startOffsetMs: trackVersion.startOffsetMs,
            createdAt: trackVersion.createdAt,
            isDerived: trackVersion.isDerived,
            operationType: trackVersion.operationType,
            parentTrackVersionId: trackVersion.parentTrackVersionId,
            segments: trackVersion.segments.map((segment) => ({
              id: segment.id,
              trackVersionId: trackVersion.trackVersionId,
              sourceStartMs: segment.startMs,
              sourceEndMs: segment.endMs,
              timelineStartMs: segment.timelineStartMs ?? trackVersion.startOffsetMs + segment.startMs,
              timelineEndMs:
                (segment.timelineStartMs ?? trackVersion.startOffsetMs + segment.startMs) +
                (segment.endMs - segment.startMs),
              durationMs: segment.endMs - segment.startMs,
              startMs: segment.startMs,
              endMs: segment.endMs,
              gainDb: segment.gainDb,
              fadeInMs: segment.fadeInMs,
              fadeOutMs: segment.fadeOutMs,
              isMuted: segment.isMuted,
              position: segment.position,
              isImplicit: false,
            })),
          };
        }),
      );

      return {
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
        createdAt: version.createdAt,
        isCurrent: version.id === initialCurrentVersionId,
        tracks: Array.from(
          resolvedTracks.reduce<Map<string, (typeof resolvedTracks)[number]>>((map, trackVersion) => {
            if (!map.has(trackVersion.trackId)) {
              map.set(trackVersion.trackId, trackVersion);
            }
            return map;
          }, new Map()).values(),
        ),
      };
    }),
  );

  return (
    <DemoDawClient
      groupSlug={demo.project.group.slug}
      projectSlug={demo.project.slug}
      projectId={demo.project.id}
      demoId={demo.id}
      currentUserId={user.id}
      demoName={demo.name}
      demoDescription={demo.description}
      initialCurrentVersionId={initialCurrentVersionId}
      initialActiveVersionId={initialActiveVersionId}
      initialIsFollowingHead={demo.isFollowingHead}
      initialVersions={resolvedVersions}
    />
  );
}
