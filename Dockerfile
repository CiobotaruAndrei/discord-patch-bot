FROM node:20-bookworm-slim AS build

WORKDIR /app/src

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl build-essential pkg-config python3 \
  && rm -rf /var/lib/apt/lists/*

ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable \
  && rustc --version && cargo --version

COPY src/package.json src/package-lock.json ./
RUN npm ci

COPY src/ ./
RUN npm run build

FROM node:20-bookworm-slim AS runtime

WORKDIR /app/src
ENV NODE_ENV=production

RUN apt-get update \
  && apt-get upgrade -y \
  && rm -rf /var/lib/apt/lists/*

COPY src/package.json src/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/src/dist ./dist
COPY --from=build /app/src/native/*.node ./native/
COPY --from=build /app/src/native/index.js ./native/
COPY --from=build /app/src/native/index.d.ts ./native/
COPY --from=build /app/src/config.json ./config.json

RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
  && chown -R node:node /app
USER node

EXPOSE 3000
CMD ["node", "dist/app/main.js"]
