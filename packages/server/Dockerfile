FROM oven/bun:1-alpine AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# Runtime
FROM base
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

ENV PORT=3000
EXPOSE 3000

CMD ["bun", "src/index.ts"]
