# syntax=docker/dockerfile:1.7

FROM 1password/op:2@sha256:57d7d6a2bb2b74b2cf8111f6afb2973c74772198f82ea30359a53faae9fff5b1 AS op

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY public.pem ./public.pem
RUN npm run build

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates gosu \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd -g 1001 appuser \
  && useradd -m -u 1001 -g 1001 -s /usr/sbin/nologin appuser \
  && mkdir -p /home/appuser/.config

COPY --from=op /usr/local/bin/op /usr/local/bin/op
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/public.pem ./public.pem
COPY --from=build /app/package.json ./package.json
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod 0555 /usr/local/bin/docker-entrypoint.sh \
  && chown -R appuser:appuser /app /home/appuser

ENV HOME=/home/appuser

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "build/main.js"]

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD node -e "const http=require('http');const port=process.env.PORT||3011;const req=http.get({host:'127.0.0.1',port,path:'/health',timeout:4000},res=>{process.exit(res.statusCode===200?0:1)});req.on('error',()=>process.exit(1));req.on('timeout',()=>{req.destroy();process.exit(1);});"
