FROM node:18-slim

RUN apt-get update && apt-get install -y python3 python3-pip git curl unzip && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 1. PROMETHEUS (WEAREDEVS)
RUN git clone https://github.com/kira1-strick/Prometheus-Deobfuscator.git prometheus
RUN cd prometheus && npm install

# 2. LARPCORRUPT
RUN git clone https://github.com/larpcorrupt/luraph-v15-v14.x-deobfuscator.git larp
RUN cd larp && pip3 install -r requirements.txt || true

# 3. MOONSEC (0x251 - Python)
RUN git clone https://github.com/0x251/Prometheus-Deobfuscator.git moon_py
RUN cd moon_py && pip3 install -r requirements.txt || true

# 4. COPY WEB UTAMA
COPY package*.json ./
RUN npm install
COPY . .

# 5. SETUP BINARY LUAU
RUN rm -rf bin/ && mkdir -p bin && \
    curl -L -o luau.zip https://github.com/luau-lang/luau/releases/latest/download/luau-ubuntu.zip && \
    unzip luau.zip -d bin/ && \
    rm luau.zip && \
    chmod -R 777 /app/bin

# 6. TRIK LARPCORRUPT
RUN mkdir -p /app/larp/Deobfuscator/deobf/bin && \
    cp /app/bin/luau /app/larp/Deobfuscator/deobf/bin/luau || true && \
    cp /app/bin/luau-ast /app/larp/Deobfuscator/deobf/bin/luau-ast || true && \
    cp /app/bin/luau-compile /app/larp/Deobfuscator/deobf/bin/luau-compile || true && \
    cp /app/bin/luau-analyze /app/larp/Deobfuscator/deobf/bin/luau-analyze || true && \
    chmod -R 777 /app/larp/Deobfuscator/deobf/bin

EXPOSE 3000
CMD ["node", "server.js"]