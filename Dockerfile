# HyperDX API and App Server Dockerfile
# This Dockerfile creates a single image with both the API and App servers

ARG NODE_VERSION=22.16.0

# Base stage with Node.js and dependencies
FROM node:${NODE_VERSION}-alpine AS base

WORKDIR /app

# Copy workspace configuration files
COPY .yarn ./.yarn
COPY .yarnrc.yml yarn.lock package.json nx.json .prettierrc .prettierignore ./

# Copy package.json files for all packages
COPY ./packages/common-utils/package.json ./packages/common-utils/
COPY ./packages/api/package.json ./packages/api/
COPY ./packages/app/package.json ./packages/app/

# Install dependencies
RUN apk add --no-cache libc6-compat
RUN yarn install --mode=skip-build && yarn cache clean

# Builder stage
FROM base AS builder

WORKDIR /app

# Copy source code for all packages
COPY ./packages/common-utils ./packages/common-utils
COPY ./packages/api ./packages/api
COPY ./packages/app ./packages/app

# Set build environment variables
ENV NEXT_TELEMETRY_DISABLED 1
ENV NEXT_PUBLIC_IS_LOCAL_MODE false
ENV NX_DAEMON=false

# Build packages in dependency order
RUN yarn workspace @hyperdx/common-utils build
RUN yarn workspace @hyperdx/api build
RUN yarn workspace @hyperdx/app build

# Production stage
FROM node:${NODE_VERSION}-alpine AS production

ARG CODE_VERSION=2.1.1

ENV CODE_VERSION=2.1.1
ENV NODE_ENV production

# Install concurrently for running multiple processes
RUN npm install -g concurrently@9.1.0

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

USER nodejs

WORKDIR /app

# Copy built API
COPY --chown=nodejs:nodejs --from=builder /app/packages/api/dist ./packages/api/dist
COPY --chown=nodejs:nodejs --from=builder /app/packages/api/package.json ./packages/api/package.json

# Copy built App (Next.js)
COPY --chown=nodejs:nodejs --from=builder /app/packages/app/.next ./packages/app/.next
COPY --chown=nodejs:nodejs --from=builder /app/packages/app/public ./packages/app/public
COPY --chown=nodejs:nodejs --from=builder /app/packages/app/package.json ./packages/app/package.json
COPY --chown=nodejs:nodejs --from=builder /app/packages/app/next.config.js ./packages/app/next.config.js

# Copy built common-utils
COPY --chown=nodejs:nodejs --from=builder /app/packages/common-utils/dist ./packages/common-utils/dist
COPY --chown=nodejs:nodejs --from=builder /app/packages/common-utils/package.json ./packages/common-utils/package.json

# Copy node_modules for runtime dependencies
COPY --chown=nodejs:nodejs --from=builder /app/node_modules ./node_modules
COPY --chown=nodejs:nodejs --from=builder /app/packages/api/node_modules ./packages/api/node_modules
COPY --chown=nodejs:nodejs --from=builder /app/packages/app/node_modules ./packages/app/node_modules
COPY --chown=nodejs:nodejs --from=builder /app/packages/common-utils/node_modules ./packages/common-utils/node_modules

# Copy and set up entry script
COPY --chown=nodejs:nodejs docker/hyperdx/entry.prod.sh /etc/local/entry.sh
RUN chmod +x /etc/local/entry.sh

# Expose ports
EXPOSE 8000 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1

ENTRYPOINT ["sh", "/etc/local/entry.sh"]