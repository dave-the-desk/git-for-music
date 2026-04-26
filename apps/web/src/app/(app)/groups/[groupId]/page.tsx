import { prisma } from '@git-for-music/db';
import { notFound } from 'next/navigation';

export default async function GroupPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;

  const group = await prisma.group.findUnique({
    where: { slug: groupId },
    select: { name: true },
  });

  if (!group) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{group.name}</h1>
    </div>
  );
}
