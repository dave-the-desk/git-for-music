import { PrismaClient } from '@prisma/client';
import { getConfig } from '@git-for-music/shared';

const config = getConfig();
const databaseUrl = config.database.url;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required before creating the Prisma client.');
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
    log: config.environment.nodeEnv === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (!config.environment.isProduction) {
  globalForPrisma.prisma = prisma;
}

export * from '@prisma/client';
export { Prisma } from '@prisma/client';
