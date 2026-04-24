# ============================================================
# Stage 1: Build
# ============================================================
FROM node:22-alpine AS builder

WORKDIR /app

# Install all dependencies (including devDependencies needed for build)
COPY package*.json ./
RUN npm ci

# Copy source code
COPY . .

# Generate Prisma Client (required before build)
RUN npx prisma generate

# Build application (nest build)
RUN npm run build

# ============================================================
# Stage 2: Production
# ============================================================
FROM node:22-alpine

WORKDIR /app

# Install production dependencies only (reproducible, lockfile-based)
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy Prisma schema and generated client from builder
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Copy built application from builder
COPY --from=builder /app/dist ./dist

# Run as non-root user for security
USER node

# Expose application port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s \
  CMD wget -q --spider http://localhost:3000/v1/health || exit 1

# Start application
CMD ["node", "dist/main"]
