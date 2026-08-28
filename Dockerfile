# syntax=docker/dockerfile:1

FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine AS runner

WORKDIR /app

RUN addgroup -g 1001 app \
  && adduser -u 1001 -G app -s /bin/sh -D app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

USER app

EXPOSE 3000

ENTRYPOINT ["node", "dist/main.js"]
CMD ["--role=api"]
