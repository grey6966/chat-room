# syntax=docker/dockerfile:1

# ---------- 1. 构建前端静态资源 ----------
FROM node:24-alpine AS web-build
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---------- 2. 构建后端（better-sqlite3 无预编译包时可现场编译） ----------
FROM node:24-alpine AS server-build
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY server/package.json server/package-lock.json* ./
RUN npm ci
COPY server/tsconfig.json ./tsconfig.json
COPY server/src ./src
RUN npm run build && npm prune --omit=dev

# ---------- 3. 运行时（单容器同时提供 API / WebSocket / 静态页面） ----------
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/app/data
ENV PORT=3000
COPY --from=server-build /app/node_modules ./node_modules
COPY --from=server-build /app/dist ./dist
COPY --from=server-build /app/package.json ./package.json
COPY --from=web-build /web/dist ./public
RUN mkdir -p /app/data/uploads
EXPOSE 3000
CMD ["node", "dist/index.js"]
