# One long-lived process that talks to Devin's cloud and serves the board:
#
#   docker build -t session-board .
#   docker run -p 3211:3211 -e DEVIN_API_KEY session-board

# Build: install and build with Bun. Optional dependencies stay: Next.js and
# Tailwind ship their platform binaries that way.
FROM node:22-bookworm-slim AS build
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile --ignore-scripts && bun run build

# Run: only Next's standalone output (`output: "standalone"` in next.config.ts).
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3211 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
USER node
EXPOSE 3211
STOPSIGNAL SIGTERM
CMD ["node", "server.js"]
