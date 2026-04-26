import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Git for Music',
  description: 'Music collaboration and versioning',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-950 text-gray-100">
        <nav className="border-b border-gray-800 bg-gray-900 px-6 py-3">
          <div className="mx-auto flex max-w-7xl items-center gap-6">
            <a href="/" className="text-lg font-semibold tracking-tight text-white">
              git-for-music
            </a>
            <a href="/groups" className="text-sm text-gray-400 hover:text-white">
              Groups
            </a>
          </div>
        </nav>
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
