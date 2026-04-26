'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NotificationBell } from '@/components/notifications/NotificationBell';

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <>
      <nav className="border-b border-gray-800 bg-gray-900 px-6 py-3">
        <div className="mx-auto flex max-w-7xl items-center gap-6">
          <Link href="/" className="text-lg font-semibold tracking-tight text-white">
            git-for-music
          </Link>
          <Link
            href="/home"
            className={`text-sm transition-colors hover:text-white ${isActive('/home') ? 'font-medium text-white' : 'text-gray-400'}`}
          >
            Home
          </Link>
          <Link
            href="/groups"
            className={`text-sm transition-colors hover:text-white ${isActive('/groups') ? 'font-medium text-white' : 'text-gray-400'}`}
          >
            Groups
          </Link>
          <div className="ml-auto">
            <NotificationBell />
          </div>
        </div>
      </nav>
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </>
  );
}
