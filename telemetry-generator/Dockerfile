FROM node:22-alpine

WORKDIR /app

# Install deps first for layer caching.
COPY package.json ./
RUN npm install --omit=dev --no-package-lock

COPY src ./src

CMD ["node", "src/index.js"]
