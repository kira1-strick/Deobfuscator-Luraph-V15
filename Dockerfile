FROM node:18-slim

# 1. Install Python dan alat download (curl, unzip)
RUN apt-get update && apt-get install -y python3 python3-pip curl unzip && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 2. HAPUS file luau-ast bawaan repo yang rusak, download yang baru dari resmi Luau
RUN rm -rf bin/ && \
    mkdir -p bin && \
    curl -L -o luau.zip https://github.com/luau-lang/luau/releases/latest/download/luau-ubuntu.zip && \
    unzip luau.zip -d bin/ && \
    rm luau.zip

# 3. Copy dan install dependensi Node.js
COPY package*.json ./
RUN npm install

# 4. Copy semua file repo
COPY . .

# 5. Kasih izin eksekusi mutlak ke file luau-ast
RUN chmod -R 777 /app/bin

EXPOSE 3000

CMD ["node", "server.js"]
