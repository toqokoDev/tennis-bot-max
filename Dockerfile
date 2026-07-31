FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip python3-venv \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY scripts ./scripts
RUN pip3 install --break-system-packages -r scripts/requirements.txt
ENV PYTHON_PATH=python3
RUN mkdir -p /app/data /app/data/sessions /app/data/brackets
VOLUME ["/app/data"]
CMD ["node", "dist/index.js"]
