import Link from 'next/link';

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <nav className="border-b border-gray-800 bg-gray-900 px-6 py-3">
        <div className="mx-auto flex max-w-7xl items-center gap-6">
          <Link href="/" className="text-lg font-semibold tracking-tight text-white">
            git-for-music
          </Link>
          <Link href="/home" className="text-sm text-gray-400 hover:text-white">
            Home
          </Link>
          <Link href="/groups" className="text-sm text-gray-400 hover:text-white">
            Groups
          </Link>
        </div>
      </nav>
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </>
  );
}
