# ---------- build ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json tsconfig.build.json ./
# postinstall chạy `prisma generate`; DATABASE_URL giả chỉ để nạp prisma.config.ts.
RUN DATABASE_URL=postgresql://build@localhost/build npm ci --no-audit --no-fund
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runtime

# LibreOffice + poppler để tự sinh ảnh xem trước khi upload template mới; prisma CLI cần openssl.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libreoffice-writer-nogui libreoffice-impress-nogui poppler-utils \
        fonts-liberation fonts-dejavu-core openssl curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    TEMPLATES_ROOT=/templates \
    DOCUMENTS_ROOT=/app/data/documents \
    HOME=/tmp

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json prisma.config.ts openapi.yaml docker-entrypoint.sh ./
COPY prisma ./prisma
RUN mkdir -p /app/data/documents && chown -R node:node /app/data && chmod +x docker-entrypoint.sh

USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
    CMD curl -fsS http://localhost:8080/api/health || exit 1
ENTRYPOINT ["./docker-entrypoint.sh"]
