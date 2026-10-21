# One image for both the web app and the background worker.
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY . .
ARG APP_URL=http://localhost:3000
ARG PLATFORM_NAME="OrbitModul"
ARG PLATFORM_TAGLINE=""
ENV APP_URL=$APP_URL PLATFORM_NAME=$PLATFORM_NAME PLATFORM_TAGLINE=$PLATFORM_TAGLINE NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npx next build

FROM base AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
RUN groupadd -r app && useradd -r -g app -d /app app
COPY --from=build --chown=app:app /app /app
USER app
EXPOSE 3000
ENTRYPOINT ["/app/docker/entrypoint.sh"]
CMD ["web"]
