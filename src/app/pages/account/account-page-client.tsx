'use client';

import Link from 'next/link';

type AccountPageClientProps = {
  userName: string | null;
  userEmail: string;
  showPluginLibraryLink?: boolean;
};

export default function AccountPageClient({
  userName,
  userEmail,
  showPluginLibraryLink = true,
}: AccountPageClientProps) {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-xl flex-col justify-between gap-10">
      <section className="space-y-5">
        <div className="space-y-2">
          <p className="text-sm uppercase tracking-[0.18em] text-cyan-300">Account</p>
          <h1 className="text-4xl font-semibold tracking-tight text-white">
            {userName ?? 'Your account'}
          </h1>
        </div>

        <dl className="space-y-4 rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-xs uppercase tracking-[0.16em] text-gray-500">Name</dt>
            <dd className="text-sm font-medium text-white">{userName ?? 'Not set'}</dd>
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-gray-800 pt-4">
            <dt className="text-xs uppercase tracking-[0.16em] text-gray-500">Email</dt>
            <dd className="text-sm font-medium text-white">{userEmail}</dd>
          </div>
        </dl>
      </section>

      {showPluginLibraryLink ? (
        <div className="flex justify-center">
          <Link
            href="/account/plugins"
            className="inline-flex rounded-full bg-cyan-500 px-6 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-400"
          >
            Plugin Library
          </Link>
        </div>
      ) : null}
    </div>
  );
}
