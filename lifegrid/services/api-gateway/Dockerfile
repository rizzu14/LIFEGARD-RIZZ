FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./
COPY ../../packages/shared-types/src ./packages/shared-types/src

RUN npm ci --only=production

COPY . .
RUN npm run build

# ── Production image ──────────────────────────────────────────
FROM node:20-alpine AS production

RUN addgroup -g 1001 -S lifegrid && adduser -S lifegrid -u 1001

WORKDIR /app

COPY --from=builder --chown=lifegrid:lifegrid /app/dist ./dist
COPY --from=builder --chown=lifegrid:lifegrid /app/node_modules ./node_modules
COPY --from=builder --chown=lifegrid:lifegrid /app/package.json ./

RUN mkdir -p logs && chown lifegrid:lifegrid logs

USER lifegrid

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:4000/health || exit 1

CMD ["node", "dist/index.js"]
