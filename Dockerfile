FROM node:22-alpine AS production

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 smart-home-be && \
    adduser -D -u 1001 -G smart-home-be smart-home-be

COPY package*.json ./
RUN npm ci && npm cache clean --force

# Change ownership of app directory to non-root user
RUN chown -R smart-home-be:smart-home-be /app

# Switch to non-root user
USER smart-home-be

ENV NODE_ENV=production

EXPOSE 3001

CMD ["node", "src/index.js"]