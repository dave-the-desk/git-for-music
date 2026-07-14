import { prisma } from '@git-for-music/db';
import { notFound, redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getAuthenticatedUserFromCookies } from '@git-for-music/server/app/lib/auth';
import { ProjectPageClient } from './project-page-client';

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ groupId: string; projectId: string }>;
}) {
  const { groupId, projectId } = await params;
  const cookieStore = await cookies();
  const user = await getAuthenticatedUserFromCookies(cookieStore);

  if (!user) {
    redirect('/login');
  }

  const project = await prisma.project.findFirst({
    where: {
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
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      demos: {
        orderBy: {
          updatedAt: 'desc',
        },
        select: {
          id: true,
          name: true,
          description: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!project) {
    notFound();
  }

  return (
    <ProjectPageClient
      groupSlug={groupId}
      projectSlug={project.slug}
      projectId={project.id}
      projectName={project.name}
      projectDescription={project.description}
      demos={project.demos.map((demo) => ({
        id: demo.id,
        name: demo.name,
        description: demo.description,
        updatedAt: demo.updatedAt.toISOString(),
      }))}
    />
  );
}
