import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { buildTrackVersionAudioUrl } from '@git-for-music/shared';
import { DemoDawClient } from './components/daw/DemoDawClient';
import { getAuthenticatedUserFromCookies } from '@git-for-music/server/app/lib/auth';
import { getDemoDawPageData } from '@git-for-music/server/app/lib/daw/server/demo-page-data';

export default async function DemoPage({
  params,
}: {
  params: Promise<{ groupId: string; projectId: string; demoId: string }>;
}) {
  const { groupId, projectId, demoId } = await params;
  const cookieStore = await cookies();
  const user = await getAuthenticatedUserFromCookies(cookieStore);

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
          const audioUrl = buildTrackVersionAudioUrl(trackVersion.trackVersionId);

          return {
            trackId: trackVersion.trackId,
            trackName: trackVersion.trackName,
            trackPosition: trackVersion.trackPosition,
            trackVersionId: trackVersion.trackVersionId,
            storageKey: audioUrl,
            mimeType: trackVersion.mimeType,
            durationMs: trackVersion.durationMs,
            startOffsetMs: trackVersion.startOffsetMs,
            createdAt: trackVersion.createdAt,
            isDerived: trackVersion.isDerived,
            operationType: trackVersion.operationType,
            parentTrackVersionId: trackVersion.parentTrackVersionId,
            plugins: trackVersion.plugins.map((plugin) => ({
              ...plugin,
              params: { ...plugin.params },
              state:
                plugin.state && typeof plugin.state === 'object' && !Array.isArray(plugin.state)
                  ? { ...plugin.state }
                  : plugin.state,
            })),
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
