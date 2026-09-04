# Multi-stage Dockerfile for Razorpay ReserveEngine
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency manifests
COPY package*.json tsconfig.json ./

# Install all dependencies including devDependencies for build
RUN npm install

# Copy source and assets
COPY src/ ./src/
COPY public/ ./public/

# Compile TypeScript
RUN npm run build

# Prune devDependencies for production image
RUN npm prune --production

# ----------------------------------------------------
# Production Runtime Stage
# ----------------------------------------------------
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copy node_modules, compiled output, and public assets
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

EXPOSE 3000

CMD ["node", "dist/server.js"]
