# ── build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# NEXT_PUBLIC_* зашиваются в клиентский бандл на этапе сборки.
ARG NEXT_PUBLIC_TG_BOT
ARG NEXT_PUBLIC_ALLOW_DEV=0
ENV NEXT_PUBLIC_TG_BOT=$NEXT_PUBLIC_TG_BOT
ENV NEXT_PUBLIC_ALLOW_DEV=$NEXT_PUBLIC_ALLOW_DEV
RUN npm run build

# ── runtime (standalone) ───────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
