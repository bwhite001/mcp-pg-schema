FROM node:22.12-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./
COPY index.ts ./

RUN npm ci

FROM node:22-alpine AS release

# Install openssh for SSH tunnel support
RUN apk add --no-cache openssh-client

WORKDIR /app

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist

RUN npm ci --omit=dev --ignore-scripts

# Create directory for SSH keys and SQL files
RUN mkdir -p /config

ENTRYPOINT ["node", "dist/index.js"]