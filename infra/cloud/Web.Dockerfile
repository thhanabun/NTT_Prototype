FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web ./
ENV NEXT_PUBLIC_CLOUD_MODE=true NEXT_TELEMETRY_DISABLED=1
RUN mkdir -p public && npm run build

FROM node:24-bookworm-slim
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:1.1.0 /lambda-adapter /opt/extensions/lambda-adapter
WORKDIR /app
ENV NODE_ENV=production NEXT_PUBLIC_CLOUD_MODE=true PORT=3001 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
ENV AWS_LWA_PORT=3001 AWS_LWA_READINESS_CHECK_PATH=/ AWS_LWA_READINESS_CHECK_HEALTHY_STATUS=200
RUN useradd --create-home web
COPY --from=build --chown=web:web /app/.next/standalone ./
COPY --from=build --chown=web:web /app/.next/static ./.next/static
COPY --from=build --chown=web:web /app/public ./public
RUN rm -rf /app/.next/cache && ln -s /tmp/next-cache /app/.next/cache
USER web
EXPOSE 3001
CMD ["sh", "-c", "mkdir -p /tmp/next-cache && exec env HOSTNAME=0.0.0.0 node server.js"]
