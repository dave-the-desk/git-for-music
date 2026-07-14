import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getAuthenticatedUserFromCookies } from '@git-for-music/server/app/lib/auth';

export default async function RootPage() {
  const cookieStore = await cookies();
  const user = await getAuthenticatedUserFromCookies(cookieStore);

  if (!user) {
    redirect('/login');
  }

  redirect('/groups');
}
