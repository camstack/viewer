# CamStack viewer PWA — the hosted site at https://camstack.zentik.app.
#
# Stage 1 builds the static web export at base path `/` (EXPO_PUBLIC_WEB_BASE_PATH
# unset — the hub-embedded `/viewer` build is `npm run build:orchestrator`, a
# different artifact). Stage 2 is Node alone: web-server/server.ts serves dist/,
# the SPA fallback, the Universal/App Link pair and /health (Node 24 runs the
# TypeScript directly via native type stripping — no build step, no deps).

FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npx patch-package
ENV EXPO_PUBLIC_WEB_BASE_PATH=""
RUN npm run build:web

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY web-server/package.json web-server/app-links.ts web-server/http-cache.ts web-server/server.ts ./web-server/
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "web-server/server.ts"]
