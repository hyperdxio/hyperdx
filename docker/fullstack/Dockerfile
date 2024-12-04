# Starts several services in a single container for local use
# - API (Node)
# - App (Frontend)

ARG NODE_VERSION=18.20.3
# Get Node base image to copy over Node binaries
FROM node:${NODE_VERSION}-alpine AS node


# == API Builder Image ==
FROM node AS api_builder

WORKDIR /app/api

COPY ./yarn.lock ./.yarnrc.yml ./
COPY ./.yarn ./.yarn
COPY --from=api ./package.json .
RUN yarn install && yarn cache clean

COPY --from=api ./tsconfig.json ./
COPY --from=api ./src ./src
RUN yarn build && rm -rf node_modules && yarn workspaces focus --production


# == App Builder Image ==
FROM node AS app_builder

WORKDIR /app/app

COPY ./yarn.lock ./.yarnrc.yml ./
COPY ./.yarn ./.yarn
COPY --from=app ./package.json ./

RUN yarn install && yarn cache clean

COPY --from=app ./.eslintrc.js ./next.config.js ./tsconfig.json ./next.config.js ./mdx.d.ts ./.eslintrc.js ./
COPY --from=app ./src ./src 
COPY --from=app ./pages ./pages 
COPY --from=app ./public ./public 
COPY --from=app ./styles ./styles

ENV NEXT_TELEMETRY_DISABLED 1
ENV NEXT_OUTPUT_STANDALONE false
ENV NEXT_PUBLIC_IS_LOCAL_MODE false
RUN yarn build && rm -rf node_modules && yarn workspaces focus --production


FROM node as prod

ENV NODE_ENV production

USER node

# Set up API
WORKDIR /app/api
COPY --chown=node:node --from=api_builder ./app/api/build ./build
COPY --chown=node:node --from=api_builder ./app/api/node_modules ./node_modules

# Set up App
WORKDIR /app/app
COPY --from=app_builder /app/app/next.config.js ./
COPY --chown=node:node --from=app_builder /app/app/public ./public
COPY --chown=node:node --from=app_builder /app/app/.next ./.next
COPY --from=app_builder /app/app/node_modules ./node_modules
COPY --from=app_builder /app/app/package.json ./package.json

# Set up start script
COPY --chown=node:node --from=fullstack ./entry.sh /etc/local/entry.sh
CMD sh /etc/local/entry.sh
