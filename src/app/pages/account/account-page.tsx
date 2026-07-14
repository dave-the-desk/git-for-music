import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getAuthenticatedUserFromCookies } from '@git-for-music/server/app/lib/auth';
import { getConfig, isFeatureEnabled } from '@git-for-music/shared';
import AccountPageClient from './account-page-client';
import '@/app/product/register-features';

export default async function AccountPage() {
  const cookieStore = await cookies();
  const user = await getAuthenticatedUserFromCookies(cookieStore);

  if (!user) {
    redirect('/login');
  }

  const showPluginLibraryLink = isFeatureEnabled('plugins', getConfig());

  return (
    <AccountPageClient
      userName={user.name}
      userEmail={user.email}
      showPluginLibraryLink={showPluginLibraryLink}
    />
  );
}
