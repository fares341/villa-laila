# ---- deps + build ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

# ---- runtime (web + worker + migrations share this image) ----
FROM node:22-alpine AS run
WORKDIR /app
# ffmpeg converts Telegram voice notes (OGG/Opus) to MP3 for the AI model
RUN apk add --no-cache ffmpeg
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app ./
EXPOSE 3000
CMD ["npm", "run", "start"]
