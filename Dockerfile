FROM node:22-alpine AS production

WORKDIR /app

COPY package*.json ./
RUN npm install && npm cache clean --force

ENV NODE_ENV=production

EXPOSE 3001

CMD ["node", "src/index.js"]