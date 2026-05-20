FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache curl \
  && ARCH="$(uname -m)" \
  && case "$ARCH" in \
    x86_64) SUPERCRONIC_ARCH=linux-amd64 ;; \
    aarch64|arm64) SUPERCRONIC_ARCH=linux-arm64 ;; \
    *) SUPERCRONIC_ARCH=linux-amd64 ;; \
  esac \
  && curl -fsSL -o /usr/local/bin/supercronic \
    "https://github.com/aptible/supercronic/releases/download/v0.2.33/supercronic-${SUPERCRONIC_ARCH}" \
  && chmod +x /usr/local/bin/supercronic

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

RUN chmod +x /app/scripts/docker-entrypoint.sh

ENV NODE_ENV=production
EXPOSE 3000

ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
CMD ["npm", "start"]
