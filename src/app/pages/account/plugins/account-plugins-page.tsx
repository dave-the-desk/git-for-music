import { prisma } from '@git-for-music/db';
import { notFound, redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getAuthenticatedUserFromCookies } from '@git-for-music/server/app/lib/auth';
import { listUserPlugins } from '@git-for-music/server/app/lib/plugins';
import { getConfig, isFeatureEnabled } from '@git-for-music/shared';
import AccountPluginsPageClient from './account-plugins-page-client';
import '@/app/product/register-features';

export default async function AccountPluginsPage() {
  const cookieStore = await cookies();
  const user = await getAuthenticatedUserFromCookies(cookieStore);

  if (!user) {
    redirect('/login');
  }

  if (!isFeatureEnabled('plugins', getConfig())) {
    notFound();
  }

  const plugins = await listUserPlugins(prisma, user.id);

  return (
    <AccountPluginsPageClient
      initialPlugins={plugins}
    />
  );
}
