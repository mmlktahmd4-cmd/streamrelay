FROM node:20-alpine

RUN apk add --no-cache ffmpeg wget coreutils procps docker-cli docker-cli-compose git

# تعريفات Intel VAAPI للترميز العتادي لسلّم ABR (iHD لـBroadwell+ و i965 للأقدم).
# متوفّرة لـx86_64 فقط — على معماريات أخرى يُتجاوز السطر ويبقى الترميز البرمجي.
RUN apk add --no-cache intel-media-driver libva-intel-driver 2>/dev/null || echo "VAAPI drivers unavailable for this arch — software ABR"

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src

RUN mkdir -p /var/www/hls /var/www/mpegts /var/www/vod /var/log/streamrelay

ENV NODE_ENV=production

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "src/index.js"]
