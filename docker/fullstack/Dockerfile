# Starts several services in a single container for local use
# - API (Node)
# - App (Frontend)

ARG NODE_VERSION=18.20.3

# base #############################################################################################
FROM node:${NODE_VERSION}-alpine AS base

WORKDIR /app/api

COPY ./yarn.lock ./.yarnrc.yml ./
COPY ./.yarn ./.yarn
COPY --from=api ./package.json .
RUN yarn install && yarn cache clean

WORKDIR /app/app

COPY ./yarn.lock ./.yarnrc.yml ./
COPY ./.yarn ./.yarn
COPY --from=app ./package.json ./

RUN yarn install && yarn cache clean


## API Builder Image ###############################################################################
FROM base AS api_builder

WORKDIR /app/api

COPY --from=api ./tsconfig.json ./
COPY --from=api ./src ./src
RUN yarn build && rm -rf node_modules && yarn workspaces focus --production


# APP Builder Image ###############################################################################
FROM base AS app_builder

WORKDIR /app/app

COPY --from=app ./.eslintrc.js ./next.config.js ./tsconfig.json ./next.config.js ./mdx.d.ts ./.eslintrc.js ./
COPY --from=app ./src ./src 
COPY --from=app ./pages ./pages 
COPY --from=app ./public ./public 
COPY --from=app ./styles ./styles

ENV NEXT_TELEMETRY_DISABLED 1
ENV NEXT_OUTPUT_STANDALONE false
ENV NEXT_PUBLIC_IS_LOCAL_MODE false
RUN yarn build && rm -rf node_modules && yarn workspaces focus --production


# prod ############################################################################################
FROM node:${NODE_VERSION}-alpine AS prod

ENV NODE_ENV production

# Install libs used for the start script
RUN npm install -g concurrently@9.1.0

USER node

# Set up API
WORKDIR /app/api
COPY --chown=node:node --from=api_builder /app/api/build ./build
COPY --chown=node:node --from=api_builder /app/api/node_modules ./node_modules

# Set up App
WORKDIR /app/app
COPY --chown=node:node --from=app_builder /app/app/next.config.js ./
COPY --chown=node:node --from=app_builder /app/app/public ./public
COPY --chown=node:node --from=app_builder /app/app/.next ./.next
COPY --chown=node:node --from=app_builder /app/app/node_modules ./node_modules
COPY --chown=node:node --from=app_builder /app/app/package.json ./package.json

# Set up start script
COPY --chown=node:node --from=fullstack ./entry.sh /etc/local/entry.sh
ENTRYPOINT ["sh", "/etc/local/entry.sh"]

# prod-extended ############################################################################################
FROM prod AS prod-extended

USER root

# == Install MongoDB v4 Deps ==
RUN echo 'http://dl-cdn.alpinelinux.org/alpine/v3.9/main' >> /etc/apk/repositories
RUN echo 'http://dl-cdn.alpinelinux.org/alpine/v3.9/community' >> /etc/apk/repositories
RUN apk update
RUN apk add mongodb yaml-cpp=0.6.2-r2 

# Set up Mongo directories with proper permissions
RUN mkdir -p /data/db && \
  chown -R node:node /data/db && \
  chown -R node:node /var/log

USER node

ENTRYPOINT ["sh", "/etc/local/entry.sh"]
