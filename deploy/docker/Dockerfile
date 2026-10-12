# syntax=docker/dockerfile:1.6
FROM node:24-alpine AS web-builder
WORKDIR /src/web
COPY web/package*.json ./
RUN npm ci
COPY web ./
COPY compat/headlamp /src/compat/headlamp
RUN cd /src/compat/headlamp && npm ci && npm run build
RUN npm run build

FROM golang:1.26-alpine AS server-builder
ARG VERSION=dev
RUN apk add --no-cache git nodejs
WORKDIR /src
COPY server/go.mod server/go.sum* ./server/
RUN cd server && go mod download
COPY server ./server
COPY scripts/third-party-notices.cjs ./scripts/
COPY release/licenses ./release/licenses
COPY LICENSE NOTICE ./
COPY --from=web-builder /src/web/package-lock.json ./web/package-lock.json
COPY --from=web-builder /src/web/node_modules ./web/node_modules
COPY --from=web-builder /src/compat/headlamp/package-lock.json ./compat/headlamp/package-lock.json
COPY --from=web-builder /src/compat/headlamp/node_modules ./compat/headlamp/node_modules
COPY --from=web-builder /src/web/dist ./server/internal/server/static/dist
RUN node scripts/third-party-notices.cjs
RUN cd server && CGO_ENABLED=0 go build -ldflags "-s -w -X github.com/alphabravo/astronomer-lite/server/internal/version.Version=${VERSION}" -o /bin/astronomer-lite ./cmd/astronomer-lite

FROM alpine:3.22
ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="Astronomer-Lite" \
      org.opencontainers.image.version=$VERSION \
      org.opencontainers.image.revision=$REVISION \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.source="https://github.com/alphabravo-oss/astronomer-lite"
COPY --from=server-builder /src/release/generated/ /usr/share/licenses/astronomer-lite/
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
