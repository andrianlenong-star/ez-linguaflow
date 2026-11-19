# Linguaflow Shared Backend & Web Production Image (Google Cloud Run Ready)
FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build

FROM node:22-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/src/shared ./src/shared
COPY --from=builder /app/src/utils ./src/utils
COPY --from=builder /app/firebase-applet-config.json ./firebase-applet-config.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json

EXPOSE 8080

CMD ["node", "server.ts"]
