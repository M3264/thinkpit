# syntax=docker/dockerfile:1
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package*.json ./
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca npm ci --no-audit --no-fund; else npm ci --no-audit --no-fund; fi
COPY web ./
RUN npm run build
RUN rm -rf /web/node_modules

FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then SSL_CERT_FILE=/run/secrets/proxy_ca go mod download; else go mod download; fi
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /thinkpit ./cmd/thinkpit

FROM alpine:3.23
RUN apk add --no-cache ca-certificates poppler-utils && adduser -D -u 10001 thinkpit
WORKDIR /app
USER thinkpit
COPY --from=build /thinkpit /usr/local/bin/thinkpit
COPY --from=web /web/dist /app/web/dist
ENV THINKPIT_ADDR=0.0.0.0:8080 THINKPIT_KEY_FILE=/run/secrets/thinkpit_key
EXPOSE 8080
ENTRYPOINT ["thinkpit"]
CMD ["serve"]
