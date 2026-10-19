FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
RUN node scripts/build-download.js
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8780
USER node
EXPOSE 8780
CMD ["node", "src/server.js"]
