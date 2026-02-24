## base #############################################################################################
FROM node:22.16.0-alpine AS base
# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY .yarn ./.yarn
COPY .yarnrc.yml yarn.lock package.json nx.json .prettierrc .prettierignore ./tsconfig.base.json ./
COPY ./packages/common-utils ./packages/common-utils
COPY ./packages/app/jest.config.js ./packages/app/tsconfig.json ./packages/app/tsconfig.build.json ./packages/app/package.json ./packages/app/next.config.mjs ./packages/app/mdx.d.ts ./packages/app/eslint.config.mjs ./packages/app/
RUN yarn install --mode=skip-build && yarn cache clean


## dev #############################################################################################
FROM base AS dev

EXPOSE 8080

ENTRYPOINT ["npx", "nx", "run", "@hyperdx/app:dev"]


## builder #########################################################################################
# Rebuild the source code only when needed
FROM base AS builder

# Expose custom env variables to the browser (needs NEXT_PUBLIC_ prefix)
# doc: https://nextjs.org/docs/pages/building-your-application/configuring/environment-variables#bundling-environment-variables-for-the-browser
ARG OTEL_EXPORTER_OTLP_ENDPOINT
ARG OTEL_SERVICE_NAME
ARG IS_LOCAL_MODE
ENV NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT $OTEL_EXPORTER_OTLP_ENDPOINT
ENV NEXT_PUBLIC_OTEL_SERVICE_NAME $OTEL_SERVICE_NAME
ENV NEXT_PUBLIC_IS_LOCAL_MODE $IS_LOCAL_MODE
ENV NX_DAEMON false

COPY ./packages/app/src ./packages/app/src
COPY ./packages/app/pages ./packages/app/pages
COPY ./packages/app/public ./packages/app/public
COPY ./packages/app/styles ./packages/app/styles
COPY ./packages/app/types ./packages/app/types
RUN npx nx run-many --target=build --projects=@hyperdx/common-utils,@hyperdx/app 
RUN rm -rf node_modules && yarn workspaces focus @hyperdx/app --production


## prod ############################################################################################
FROM node:22.16.0-alpine AS prod

LABEL org.opencontainers.image.vendor="HyperDX" \
      org.opencontainers.image.title="HyperDX App" \
      org.opencontainers.image.description="HyperDX frontend application for observability platform" \
      org.opencontainers.image.source="https://github.com/hyperdxio/hyperdx" \
      org.opencontainers.image.licenses="MIT"

WORKDIR /app

ENV NODE_ENV production

RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001

# You only need to copy next.config.mjs if you are NOT using the default configuration
COPY --from=builder /app/packages/app/next.config.mjs ./
COPY --from=builder --chown=nextjs:nodejs /app/packages/app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/packages/app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/app/package.json ./package.json

USER nextjs

ARG PORT

ENV PORT=$PORT

EXPOSE ${PORT}

# Next.js collects completely anonymous telemetry data about general usage.
# Learn more here: https://nextjs.org/telemetry
# Uncomment the following line in case you want to disable telemetry.
ENV NEXT_TELEMETRY_DISABLED 1

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||8080)+'/api/health',r=>r.statusCode===200?process.exit(0):process.exit(1)).on('error',()=>process.exit(1))"

CMD ["sh", "-c", "node_modules/.bin/next start -p ${PORT}"]
