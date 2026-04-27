import { prisma } from '@git-for-music/db';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { ProjectPageClient } from './project-page-client';

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ groupId: string; projectId: string }>;
}) {
  const { groupId, projectId } = await params;
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);

  if (!sessionCookie?.value) {
    redirect('/login');
  }

  const user = await prisma.user.findUnique({
    where: { id: sessionCookie.value },
    select: { id: true },
  });

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
