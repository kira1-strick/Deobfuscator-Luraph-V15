FROM node:18-slim

# 1. Install Python, Git, dan alat download
RUN apt-get update && apt-get install -y python3 python3-pip git curl unzip && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 2. AMBIL PROMETHEUS (WEAREDEVS)
RUN git clone https://github.com/kira1-strick/Prometheus-Deobfuscator.git prometheus
RUN cd prometheus && npm install

# 3. AMBIL LARPCORRUPT
RUN git clone https://github.com/larpcorrupt/luraph-v15-v14.x-deobfuscator.git larp
RUN cd larp && pip3 install -r requirements.txt || true

# 4. Copy package.json web utama dan install dependensi Node.js
COPY package*.json ./
RUN npm install

# 5. Copy semua file web utama lo
COPY . .

# 6. SETUP BINARY LUAU (BUAT CAOMOD)
RUN rm -rf bin/ && mkdir -p bin && \
    curl -L -o luau.zip https://github.com/luau-lang/luau/releases/latest/download/luau-ubuntu.zip && \
    unzip luau.zip -d bin/ && \
    rm luau.zip && \
    chmod -R 777 /app/bin

# 7. TRIK LARPCORRUPT: Copy binary Luau TANPA .exe
RUN mkdir -p /app/larp/Deobfuscator/deobf/bin && \
    cp /app/bin/luau /app/larp/Deobfuscator/deobf/bin/luau || true && \
    cp /app/bin/luau-ast /app/larp/Deobfuscator/deobf/bin/luau-ast || true && \
    cp /app/bin/luau-compile /app/larp/Deobfuscator/deobf/bin/luau-compile || true && \
    cp /app/bin/luau-analyze /app/larp/Deobfuscator/deobf/bin/luau-analyze || true && \
    chmod -R 777 /app/larp/Deobfuscator/deobf/bin

# 8. Jalanin server
EXPOSE 3000
CMD ["node", "server.js"]
