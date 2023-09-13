## base #############################################################################################
FROM node:18.15.0-alpine AS base

WORKDIR /app

COPY .yarn ./.yarn
COPY .yarnrc yarn.lock ./packages/api/jest.config.js ./packages/api/tsconfig.json ./packages/api/package.json ./
RUN yarn install --frozen-lockfile && yarn cache clean


## dev #############################################################################################

FROM base AS dev

EXPOSE 8000

ENTRYPOINT ["yarn"]
CMD ["dev"]
