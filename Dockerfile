FROM node:20-bookworm-slim AS build

WORKDIR /app/src

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl build-essential pkg-config python3 \
  && rm -rf /var/lib/apt/lists/*

COPY src/package.json src/package-lock.json ./
RUN npm ci

COPY src/ ./
RUN npm run build

FROM node:20-bookworm-slim AS runtime

WORKDIR /app/src
ENV NODE_ENV=production

COPY src/package.json src/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/src/dist ./dist
COPY --from=build /app/src/native/*.node ./native/
COPY --from=build /app/src/native/index.js ./native/
COPY --from=build /app/src/native/index.d.ts ./native/
COPY --from=build /app/src/config.json ./config.json

EXPOSE 3000
CMD ["npm", "start"]
