# ============================ BASE ============================
FROM node:20-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-venv tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# ============================ BUILD ============================
FROM base AS build
RUN apt-get update && apt-get install -y --no-install-recommends git curl unzip \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Ganti HEAD dengan commit SHA agar build reproducible (disarankan)
ARG PROMETHEUS_REF=HEAD
ARG LARP_REF=HEAD
ARG MOONSEC_REF=HEAD
# Ganti "latest" dengan tag versi Luau (mis. .../releases/download/0.xxx/luau-ubuntu.zip)
ARG LUAU_URL=https://github.com/luau-lang/luau/releases/latest/download/luau-ubuntu.zip

# 1. Prometheus (WeAreDevs)
RUN git clone https://github.com/kira1-strick/Prometheus-Deobfuscator.git prometheus \
 && git -C prometheus checkout "$PROMETHEUS_REF" \
 && rm -rf prometheus/.git \
 && cd prometheus && npm install

# 2. MoonSec
RUN git clone https://github.com/mokaEZF/lua-deobfuscator-bot2.git moonsec \
 && git -C moonsec checkout "$MOONSEC_REF" \
 && rm -rf moonsec/.git \
 && cd moonsec && npm install --legacy-peer-deps

# 3. Larp (Python di dalam venv; error tidak disembunyikan)
RUN git clone https://github.com/larpcorrupt/luraph-v15-v14.x-deobfuscator.git larp \
 && git -C larp checkout "$LARP_REF" \
 && rm -rf larp/.git \
 && python3 -m venv /opt/venv \
 && if [ -f larp/requirements.txt ]; then /opt/venv/bin/pip install --no-cache-dir -r larp/requirements.txt; fi

# 4. Binary Luau (luau wajib ada, luau-ast opsional -> server menonaktifkan validasi bila tidak ada)
RUN mkdir -p bin \
 && curl -fsSL -o luau.zip "$LUAU_URL" \
 && unzip -q luau.zip -d bin && rm luau.zip \
 && chmod -R a+rx bin \
 && test -x bin/luau \
 && mkdir -p larp/Deobfuscator/deobf/bin \
 && cp bin/luau* larp/Deobfuscator/deobf/bin/

# ============================ RUNTIME ============================
FROM base
ENV NODE_ENV=production \
    PATH=/opt/venv/bin:$PATH \
    LUAU_AST_BIN=/app/bin/luau-ast \
    PYTHONDONTWRITEBYTECODE=1 \
    CONCURRENCY=2

RUN mkdir -p /app && chown node:node /app
WORKDIR /app
USER node

COPY --from=build --chown=node:node /opt/venv /opt/venv
COPY --from=build --chown=node:node /app/prometheus ./prometheus
COPY --from=build --chown=node:node /app/moonsec ./moonsec
COPY --from=build --chown=node:node /app/larp ./larp
COPY --from=build --chown=node:node /app/bin ./bin

COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node . .

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["tini", "--"]
CMD ["node", "server.js"]
