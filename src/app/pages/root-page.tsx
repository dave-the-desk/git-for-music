import { prisma } from '@git-for-music/db';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE_NAME } from '@git-for-music/server/app/lib/auth/session';

export default async function RootPage() {
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

  redirect('/groups');
}
