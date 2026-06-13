.PHONY: dev build web-build server-build test web-test lint vet verify-local e2e k3d-e2e fmt image image-size clean

BIN ?= server/bin/astronomer-lite
IMAGE ?= astronomer-lite:dev
MAX_IMAGE_BYTES ?= 209715200
VERSION ?= dev
LDFLAGS ?= -X github.com/alphabravo/astronomer-lite/server/internal/version.Version=$(VERSION)

dev:
	@echo "Run in two terminals:"
	@echo "  cd server && go run ./cmd/astronomer-lite"
	@echo "  cd web && npm run dev"

web-build:
	cd web && npm run build
	rm -rf server/internal/server/static/dist
	mkdir -p server/internal/server/static/dist
	cp -R web/dist/. server/internal/server/static/dist/
	touch server/internal/server/static/dist/.gitkeep

server-build:
	cd server && go build -ldflags "$(LDFLAGS)" -o bin/astronomer-lite ./cmd/astronomer-lite

build: web-build server-build

test:
	cd server && go test ./...

web-test:
	cd web && npm test

vet:
	cd server && go vet ./...

lint:
	cd web && npm run lint

verify-local: test web-test vet lint build
	cd web && npx playwright test --list
	bash -n scripts/run-k3d-e2e.sh

e2e:
	cd web && npm run e2e

k3d-e2e:
	./scripts/run-k3d-e2e.sh

fmt:
	cd server && gofmt -w ./cmd ./internal
	cd web && npm run build

image:
	docker build --build-arg VERSION=$(VERSION) -f deploy/docker/Dockerfile -t $(IMAGE) .

image-size:
	@size=$$(docker image inspect $(IMAGE) --format '{{.Size}}'); \
	echo "$(IMAGE) size: $$size bytes"; \
	if [ "$$size" -gt "$(MAX_IMAGE_BYTES)" ]; then \
		echo "image exceeds $(MAX_IMAGE_BYTES) bytes"; \
		exit 1; \
	fi

clean:
	rm -rf server/bin web/dist server/internal/server/static/dist
	mkdir -p server/internal/server/static/dist
	touch server/internal/server/static/dist/.gitkeep
