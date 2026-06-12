# ── build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── runtime ────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
EXPOSE 8081
# Применяем миграции, затем стартуем сервер.
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]
