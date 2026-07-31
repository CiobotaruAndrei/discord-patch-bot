FROM rust:1.96.0-slim-bookworm AS rust-toolchain

FROM node:24-bookworm-slim AS build

WORKDIR /app/src

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates build-essential pkg-config python3 cmake clang libclang-dev libseccomp-dev libmagic-dev libmspack-dev libssl-dev zlib1g-dev libbz2-dev liblzma-dev libzstd-dev liblz4-dev libxml2-dev libacl1-dev \
  && rm -rf /var/lib/apt/lists/*

ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH
COPY --from=rust-toolchain /usr/local/rustup /usr/local/rustup
COPY --from=rust-toolchain /usr/local/cargo /usr/local/cargo
RUN rustc --version && cargo --version

# libyara, libarchive, qpdf si ZXing-C++ se compileaza din surse prin build script-urile crate-urilor
# -sys, deci intra in stratul de dependinte cargo. Stratul acela e pus INAINTE de `npm ci` si depinde
# doar de manifestele cargo: altfel orice bump de dependinta npm (dependabot ruleaza saptamanal) ar
# invalida `npm ci` si tot ce urmeaza, recompiland cele patru librarii degeaba. Masurat pe rulari reale
# de container-scan: 85s cu totul in cache, 290-340s cand se schimbase doar package-lock.json.
COPY src/native/Cargo.toml src/native/Cargo.lock src/native/build.rs src/native/rust-toolchain.toml ./native/
COPY src/native/core/Cargo.toml ./native/core/
COPY src/native/inspector/Cargo.toml ./native/inspector/
# mspack-sys intra intreg, nu doar cu manifestul: build.rs ruleaza bindgen si compileaza shim-ul C,
# deci fara ele stratul n-ar incalzi nimic din ce costa la crate-ul asta.
COPY src/native/mspack-sys/Cargo.toml src/native/mspack-sys/build.rs src/native/mspack-sys/shim.c ./native/mspack-sys/
# tlsh-sys intra cu tot cu vendor/: build.rs compileaza sursa C++ vendorizata, care nu se schimba
# niciodata singura, deci stratul o compileaza o data si o refoloseste la orice build ulterior.
COPY src/native/tlsh-sys/Cargo.toml src/native/tlsh-sys/build.rs src/native/tlsh-sys/shim.cpp ./native/tlsh-sys/
COPY src/native/tlsh-sys/vendor/ ./native/tlsh-sys/vendor/
# Tripletul e explicit fiindca `napi build` compileaza cu --target, deci scrie in
# target/<triplet>/release. Un `cargo build` fara --target ar popula target/release, adica alt
# director, si pre-compilarea n-ar fi refolosita de nimic — ar adauga un build intreg in loc sa scuteasca.
RUN TARGET="$(rustc -vV | sed -n 's/^host: //p')" \
  && mkdir -p native/src native/core/src native/inspector/src native/mspack-sys/src native/tlsh-sys/src \
  && printf 'fn main() {}\n' > native/inspector/src/main.rs \
  && : > native/src/lib.rs \
  && : > native/core/src/lib.rs \
  && : > native/inspector/src/lib.rs \
  && : > native/mspack-sys/src/lib.rs \
  && : > native/tlsh-sys/src/lib.rs \
  && cargo build --release --target "$TARGET" --manifest-path native/Cargo.toml --workspace \
  && cargo clean --release --target "$TARGET" --manifest-path native/Cargo.toml \
    -p discord_patch_bot_core -p discord_patch_bot_logic -p native-inspector -p mspack-sys -p tlsh-sys \
  && rm -rf native/src native/core/src native/inspector/src native/mspack-sys/src native/tlsh-sys/src

COPY src/package.json src/package-lock.json ./
RUN npm ci

COPY src/native/ ./native/
RUN npm run build:rust

COPY src/ ./
RUN npm run build:ts
# Binarul de inspectie izolata nu e produs de `napi build` (acela compileaza doar addon-ul cdylib), deci
# se compileaza separat. Pasul trece prin scripts/build-native-inspector.ts, care citeste tripletul din
# `rustc -vV` si il transmite lui cargo: fara --target, cargo ar scrie in target/release, adica alt
# director decat cel incalzit mai sus, si ar recompila de la zero acelasi set de librarii C/C++.
RUN npm run build:inspector:prebuilt

FROM node:24-bookworm-slim AS runtime

WORKDIR /app/src
ENV NODE_ENV=production

RUN apt-get update \
  && apt-get upgrade -y \
  && apt-get install -y --no-install-recommends libssl3 libseccomp2 libmagic1 libmspack0 zlib1g libbz2-1.0 liblzma5 libzstd1 liblz4-1 libxml2 libacl1 \
  && rm -rf /var/lib/apt/lists/*

COPY src/package.json src/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/src/dist ./dist
COPY --from=build /app/src/native/*.node ./native/
COPY --from=build /app/src/native/native-inspector ./native/
COPY --from=build /app/src/native/index.js ./native/
COPY --from=build /app/src/native/index.d.ts ./native/
COPY --from=build /app/src/config.json ./config.json

RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
  && chown -R node:node /app
USER node

EXPOSE 3000
CMD ["node", "dist/app/main.js"]
