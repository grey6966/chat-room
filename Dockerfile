# syntax=docker/dockerfile:1

# ---------- Frontend build ----------
FROM node:22-slim AS frontend-build
WORKDIR /app/frontend

# better-sqlite3 is not needed here; install with optional deps omitted.
COPY frontend/package.json ./
RUN npm install --no-audit --no-fund

COPY frontend/ ./
RUN npm run build

# ---------- Backend build ----------
FROM node:22-slim AS backend-build
WORKDIR /app/backend

COPY backend/package.json ./
# Install all deps (incl. dev) so tsc is available; npm pulls prebuilt
# better-sqlite3 binaries for linux/amd64 & linux/arm64 on Node 22.
RUN npm install --no-audit --no-fund

COPY backend/ ./
RUN npm run build

# Prune to production-only node_modules for the final image.
RUN npm prune --omit=dev

# ---------- Runtime ----------
FROM node:22-slim AS runtime
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001
WORKDIR /app

# Database + uploaded images live here (mounted as a volume in compose).
# Create and chown before dropping privileges so the node user can write.
RUN mkdir -p /app/data/uploads && chown -R node:node /app/data

# Run as an unprivileged user; node images ship with the "node" account.
USER node

COPY --chown=node:node --from=backend-build /app/backend/node_modules ./backend/node_modules
COPY --chown=node:node --from=backend-build /app/backend/dist ./backend/dist
COPY --chown=node:node --from=frontend-build /app/frontend/dist ./public

VOLUME ["/app/data"]

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "backend/dist/index.js"]
