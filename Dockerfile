# syntax=docker/dockerfile:1
FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then SSL_CERT_FILE=/run/secrets/proxy_ca go mod download; else go mod download; fi
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /thinkpit ./cmd/thinkpit

FROM alpine:3.23
RUN apk add --no-cache ca-certificates && adduser -D -u 10001 thinkpit
USER thinkpit
COPY --from=build /thinkpit /usr/local/bin/thinkpit
ENV THINKPIT_ADDR=0.0.0.0:8080 THINKPIT_KEY_FILE=/run/secrets/thinkpit_key
EXPOSE 8080
ENTRYPOINT ["thinkpit"]
CMD ["serve"]
