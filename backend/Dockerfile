FROM oven/bun:1-alpine
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY backend ./backend
EXPOSE 3001
CMD ["bun", "backend/server.ts"]
