# One long-lived process that talks to Devin's cloud:
#
#   docker build -t ticket-enricher .
#   docker run -p 8787:8787 -e DEVIN_API_KEY -e WEBHOOK_SECRET ticket-enricher
FROM oven/bun:1
WORKDIR /app

COPY . .
# --omit=optional leaves out the Devin CLI binaries: the container never runs
# Devin itself, it only calls the cloud.
RUN bun install --frozen-lockfile --omit=optional --ignore-scripts

ENV PORT=8787
EXPOSE 8787
STOPSIGNAL SIGTERM
CMD ["bun", "src/server.ts"]
