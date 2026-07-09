'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NotificationBell } from './components/NotificationBell';

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isAppRoute = pathname.startsWith('/groups') || pathname.startsWith('/account');
  const isDemoDawPage = /^\/groups\/[^/]+\/projects\/[^/]+\/demos\/[^/]+$/.test(pathname);

  if (!isAppRoute) {
    return <main>{children}</main>;
  }

  if (isDemoDawPage) {
    return <main>{children}</main>;
  }

  return (
    <>
      <nav className="border-b border-gray-800 bg-gray-900 px-6 py-3">
        <div className="mx-auto flex max-w-7xl items-center gap-6">
          <Link href="/groups" className="text-lg font-semibold tracking-tight text-white">
            git-for-music
          </Link>
          <div className="ml-auto flex items-center gap-3">
            <NotificationBell />
            <Link
              href="/account"
              className="rounded-md border border-gray-700 px-3 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-gray-800 hover:text-white"
            >
              Account
            </Link>
          </div>
        </div>
      </nav>
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </>
  );
}
