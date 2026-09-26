FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8080 \
    GOLDENBOOK_FILE=/app/data/goldenbook.txt \
    RUN_AS=node
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY docker-entrypoint.sh /usr/local/bin/
COPY server.js ./
COPY src ./src
COPY public ./public

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" >/dev/null || exit 1

# Starts as root only to fix the data directory's owner, then runs as "node".
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
