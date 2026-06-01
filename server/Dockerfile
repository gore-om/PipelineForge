FROM node:24-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8095

COPY package*.json ./
COPY server/package.json ./server/package.json
RUN npm ci --omit=dev --workspace server

COPY server ./server

EXPOSE 8095
CMD ["node", "server/src/server.js"]
