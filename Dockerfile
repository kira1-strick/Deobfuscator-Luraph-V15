# Pakai image Node.js versi slim
FROM node:18-slim

# Install Python 3 (wajib buat backend symbolic engine repo ini)
RUN apt-get update && apt-get install -y python3 python3-pip && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package.json dan install dependensi
COPY package*.json ./
RUN npm install

# Copy semua file repo lo
COPY . .

# Buka port 3000
EXPOSE 3000

# Jalanin server
CMD ["node", "server.js"]
