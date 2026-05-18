FROM node:20-bookworm-slim AS base

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable

WORKDIR /app

FROM base AS deps

ENV DATABASE_URL=postgresql://postgres:postgres@postgres:5432/git_for_music

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/db/prisma packages/db/prisma
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile

RUN pnpm --filter @git-for-music/db generate

FROM base AS builder

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=deps /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY tsconfig.json ./tsconfig.json
COPY --from=deps /app/apps/web/package.json ./apps/web/package.json
COPY --from=deps /app/packages/db/package.json ./packages/db/package.json
COPY --from=deps /app/packages/db/prisma ./packages/db/prisma
COPY --from=deps /app/packages/shared/package.json ./packages/shared/package.json
COPY apps/web ./apps/web
COPY packages ./packages

ENV DATABASE_URL=postgresql://postgres:postgres@postgres:5432/git_for_music \
    REDIS_URL=redis://redis:6379 \
    NEXT_PUBLIC_APP_URL=http://localhost:3000

RUN pnpm --filter @git-for-music/web build

FROM base AS runner

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /app/apps/web ./apps/web
COPY --from=builder /app/packages ./packages

EXPOSE 3000

CMD ["pnpm", "--filter", "@git-for-music/web", "start"]
