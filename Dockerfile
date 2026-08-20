# syntax=docker/dockerfile:1.7

########################
# Base: node + pnpm
########################
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable

########################
# Deps: full install (better-sqlite3 compiles from source on musl)
########################
FROM base AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/pnpm/store \
    pnpm install --frozen-lockfile

########################
# Build: produce .next/standalone
########################
FROM deps AS build
WORKDIR /app

# NEXT_PUBLIC_* values are inlined into the client bundle at build time,
# so they must be present here rather than at runtime.
ARG NEXT_PUBLIC_AUTH_BASE_URL=""
ENV NEXT_PUBLIC_AUTH_BASE_URL=$NEXT_PUBLIC_AUTH_BASE_URL

COPY . .
RUN pnpm build

########################
# Runner: minimal (no pnpm, no toolchain, no source)
########################
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# SQLite lives on a mounted volume, not in the image layer.
ENV SQLITE_URL=/data/sqlite.db

RUN addgroup -S nodejs -g 1001 && adduser -S nextjs -u 1001 -G nodejs \
    && mkdir -p /data && chown nextjs:nodejs /data

COPY --from=build --chown=nextjs:nodejs /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
# Drizzle migrations are applied at process start from ./drizzle
COPY --from=build --chown=nextjs:nodejs /app/drizzle ./drizzle

USER nextjs
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
