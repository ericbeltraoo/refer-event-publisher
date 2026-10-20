FROM node:22-alpine

WORKDIR /app

ENV HOST=0.0.0.0 \
    PORT=3000

COPY --chown=node:node server.js ./
COPY --chown=node:node public ./public

USER node

EXPOSE 3000

CMD ["node", "server.js"]
