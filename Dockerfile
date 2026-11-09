FROM node:22-alpine

WORKDIR /app

ENV HOST=0.0.0.0 \
    PORT=3000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && mkdir -p /app/data/audit && chown -R node:node /app
COPY --chown=node:node server.js events-watcher.js auth.js audit.js ./
COPY --chown=node:node public ./public

USER node

EXPOSE 3000

CMD ["node", "server.js"]
