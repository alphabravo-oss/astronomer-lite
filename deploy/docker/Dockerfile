# syntax=docker/dockerfile:1.6
FROM node:24-alpine AS web-builder
WORKDIR /src/web
COPY web/package*.json ./
RUN npm ci
COPY web ./
RUN npm run build

FROM golang:1.26-alpine AS server-builder
ARG VERSION=dev
RUN apk add --no-cache git
WORKDIR /src
COPY server/go.mod server/go.sum* ./server/
RUN cd server && go mod download
COPY server ./server
COPY --from=web-builder /src/web/dist ./server/internal/server/static/dist
RUN cd server && CGO_ENABLED=0 go build -ldflags "-s -w -X github.com/alphabravo/astronomer-lite/server/internal/version.Version=${VERSION}" -o /bin/astronomer-lite ./cmd/astronomer-lite

FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata
RUN addgroup -S astronomer \
	&& adduser -S -D -h /home/astronomer -G astronomer astronomer \
	&& mkdir -p /home/astronomer/.config/astronomer-lite /home/astronomer/.kube \
	&& chown -R astronomer:astronomer /home/astronomer
COPY --from=server-builder /bin/astronomer-lite /usr/local/bin/astronomer-lite
ENV HOME=/home/astronomer
ENV ASTRONOMER_LITE_CONFIG_DIR=/home/astronomer/.config/astronomer-lite
USER astronomer
EXPOSE 8080
ENTRYPOINT ["astronomer-lite"]
