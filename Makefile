.PHONY: run run-backend run-frontend install install-backend install-frontend test bench clean compose-up compose-down compose-build compose-logs loadtest

BACKEND_PORT ?= 8080
FRONTEND_PORT ?= 3000

run: install
	@echo "▶ backend  : http://localhost:$(BACKEND_PORT)"
	@echo "▶ frontend : http://localhost:$(FRONTEND_PORT)"
	@trap 'kill 0' INT TERM EXIT; \
	  ( cd src/backend && PORT=$(BACKEND_PORT) go run ./... ) & \
	  ( cd src/frontend && BACKEND_URL=http://localhost:$(BACKEND_PORT) PORT=$(FRONTEND_PORT) npm run dev ) & \
	  wait

run-backend: install-backend
	cd src/backend && PORT=$(BACKEND_PORT) go run ./...

run-frontend: install-frontend
	cd src/frontend && BACKEND_URL=http://localhost:$(BACKEND_PORT) PORT=$(FRONTEND_PORT) npm run dev

install: install-backend install-frontend

install-backend:
	cd src/backend && go mod download

install-frontend:
	cd src/frontend && [ -d node_modules ] || npm install

test:
	cd src/backend && go test ./...

bench:
	cd src/backend && go test -bench=. -benchmem -run=^$$ ./runtime/numerics/

loadtest:
	cd src/backend && go run ./cmd/loadtest \
	  -url http://localhost:$(BACKEND_PORT)/api/overseas/care \
	  -concurrency 200 -duration 10s

# ── docker-compose helpers ──────────────────────────────────────────────
compose-build:
	docker compose build

compose-up:
	docker compose up -d --build

compose-down:
	docker compose down

compose-logs:
	docker compose logs -f --tail=200

clean:
	rm -rf src/frontend/node_modules src/frontend/.next
