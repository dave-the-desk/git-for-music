import type { NextConfig } from 'next';
import path from 'node:path';

const serverPackageRoot = path.resolve(__dirname, '../packages/server');

const nextConfig: NextConfig = {
  transpilePackages: ['@git-for-music/db', '@git-for-music/server', '@git-for-music/shared'],
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@/app/lib/auth': path.join(serverPackageRoot, 'app/lib/auth'),
      '@/app/lib/daw/protocol': path.join(serverPackageRoot, 'app/lib/daw/protocol'),
      '@/app/lib/daw/server': path.join(serverPackageRoot, 'app/lib/daw/server'),
      '@/app/lib/processing': path.join(serverPackageRoot, 'app/lib/processing'),
    };

    return config;
  },
};

export default nextConfig;
