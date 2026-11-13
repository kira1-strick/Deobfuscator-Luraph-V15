FROM node:18-slim

# Install Python, Git, dan alat download
RUN apt-get update && apt-get install -y python3 python3-pip git curl unzip && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# --- AMBIL PROMETHEUS DARI GITHUB ---
RUN git clone https://github.com/kira1-strick/Prometheus-Deobfuscator.git prometheus
RUN cd prometheus && npm install
# ------------------------------------

# --- AMBIL LARPCORRUPT DARI GITHUB ---
RUN git clone https://github.com/larpcorrupt/luraph-v15-v14.x-deobfuscator.git larp
RUN cd larp && pip3 install -r requirements.txt || true
# -------------------------------------

# Copy package.json web utama dan install
COPY package*.json ./
RUN npm install

# Copy semua file web utama
COPY . .

# Setup Luau buat Caomod (Luraph)
RUN rm -rf bin/ && mkdir -p bin && \
    curl -L -o luau.zip https://github.com/luau-lang/luau/releases/latest/download/luau-ubuntu.zip && \
    unzip luau.zip -d bin/ && \
    rm luau.zip && \
    chmod -R 777 /app/bin

EXPOSE 3000

CMD ["node", "server.js"]
