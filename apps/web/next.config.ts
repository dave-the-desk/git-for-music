import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@git-for-music/db', '@git-for-music/shared'],
};

export default nextConfig;
