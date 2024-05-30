## base #############################################################################################
FROM node:18.20.3-alpine AS base
# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat
WORKDIR /app


COPY .yarn ./.yarn
COPY .yarnrc yarn.lock ./packages/app/package.json ./packages/app/tsconfig.json ./packages/app/next.config.js ./packages/app/mdx.d.ts ./packages/app/.eslintrc.js ./
RUN yarn install --frozen-lockfile && yarn cache clean


## dev #############################################################################################
FROM base AS dev

EXPOSE 8080

ENTRYPOINT ["yarn"]
CMD ["dev"]

## builder #########################################################################################
# Rebuild the source code only when needed
FROM base AS builder

# Expose custom env variables to the browser (needs NEXT_PUBLIC_ prefix)
# doc: https://nextjs.org/docs/pages/building-your-application/configuring/environment-variables#bundling-environment-variables-for-the-browser
ARG OTEL_EXPORTER_OTLP_ENDPOINT
ARG OTEL_SERVICE_NAME
ARG SERVER_URL
ENV NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT $OTEL_EXPORTER_OTLP_ENDPOINT
ENV NEXT_PUBLIC_OTEL_SERVICE_NAME $OTEL_SERVICE_NAME
ENV NEXT_PUBLIC_SERVER_URL $SERVER_URL

COPY ./packages/app/tsconfig.json ./packages/app/next.config.js ./packages/app/mdx.d.ts ./packages/app/.eslintrc.js ./
COPY ./packages/app/src ./src 
COPY ./packages/app/pages ./pages 
COPY ./packages/app/public ./public 
COPY ./packages/app/styles ./styles
COPY --from=base /app/node_modules ./node_modules
RUN yarn build && yarn install --production --ignore-scripts --prefer-offline


## prod ############################################################################################
FROM node:18.20.3-alpine AS prod
WORKDIR /app

ARG SERVER_URL

ENV NODE_ENV production
ENV NEXT_PUBLIC_SERVER_URL $SERVER_URL

RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001

# You only need to copy next.config.js if you are NOT using the default configuration
# COPY --from=builder /app/next.config.js ./
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

USER nextjs

ARG PORT

ENV PORT=$PORT

EXPOSE ${PORT}

# Next.js collects completely anonymous telemetry data about general usage.
# Learn more here: https://nextjs.org/telemetry
# Uncomment the following line in case you want to disable telemetry.
ENV NEXT_TELEMETRY_DISABLED 1

CMD ["sh", "-c", "node_modules/.bin/next start -p ${PORT}"]
