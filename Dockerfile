FROM node:22.23.4-alpine3.24
# Refresh the system trust store as well as Node's bundled certificates.
RUN apk add --no-cache --upgrade 'ca-certificates>=20261020-r0' 'ca-certificates-bundle>=20261020-r0' \
    && update-ca-certificates \
    && node --version \
    && apk info -v ca-certificates ca-certificates-bundle
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
