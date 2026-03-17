FROM node:20-slim AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npx esbuild server/index.ts --bundle --platform=node --target=node20 --outfile=dist/server.js --external:pg-native

FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/dist/server.js ./server.js
COPY --from=builder /app/presets ./presets
COPY --from=builder /app/server/templates ./server/templates

ENV NODE_ENV=production
ENV PORT=5000
EXPOSE 5000

CMD ["node", "server.js"]
