.PHONY: run run-backend run-frontend install install-backend install-frontend build test bench clean compose-up compose-down compose-build compose-logs loadtest

BACKEND_PORT ?= 8080
FRONTEND_PORT ?= 3000

run: install
	@echo "▶ backend  : http://localhost:$(BACKEND_PORT)"
	@echo "▶ frontend : http://localhost:$(FRONTEND_PORT)"
	@trap 'kill 0' INT TERM; \
	  ( cd src/backend && PORT=$(BACKEND_PORT) mvn -B spring-boot:run 2>&1 | sed 's/^/[backend]  /' ) & \
	  ( cd src/frontend && BACKEND_URL=http://localhost:$(BACKEND_PORT) PORT=$(FRONTEND_PORT) npm run dev 2>&1 | sed 's/^/[frontend] /' ) & \
	  wait

run-backend: install-backend
	cd src/backend && PORT=$(BACKEND_PORT) mvn -B spring-boot:run

run-frontend: install-frontend
	cd src/frontend && BACKEND_URL=http://localhost:$(BACKEND_PORT) PORT=$(FRONTEND_PORT) npm run dev

install: install-backend install-frontend

install-backend:
	cd src/backend && mvn -B -q dependency:go-offline

install-frontend:
	cd src/frontend && [ -d node_modules ] || npm install

build:
	cd src/backend && mvn -B -DskipTests package

test:
	cd src/backend && mvn -B test

bench:
	cd src/backend && mvn -B -q test -Dtest='*Benchmark*' || true

loadtest:
	@command -v hey >/dev/null || { echo "install 'hey' (brew install hey) — Go cmd/loadtest는 제거되었습니다."; exit 1; }
	hey -n 2000 -c 200 -m POST -T application/json \
	  -d '{"departureDate":"2026-01-15"}' \
	  http://localhost:$(BACKEND_PORT)/api/overseas/care

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
	rm -rf src/backend/target src/frontend/node_modules src/frontend/.next
