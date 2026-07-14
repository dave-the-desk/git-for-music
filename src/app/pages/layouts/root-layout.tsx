import type { Metadata } from 'next';
import AppLayout from './app-layout';
import '@/app/product/providers';
import '@/app/product/register-features';
import { branding } from '@/app/product/branding';

export const metadata: Metadata = {
  title: branding.appName,
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
        <AppLayout>{children}</AppLayout>
      </body>
    </html>
  );
}
