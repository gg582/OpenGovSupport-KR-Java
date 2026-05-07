.PHONY: run run-backend run-frontend install install-backend install-frontend build test bench clean compose-up compose-down compose-build compose-logs loadtest \
        desktop-install desktop-prepare desktop-jre desktop-dev \
        package-windows package-macos package-linux package-freebsd package-all

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
	rm -rf src/backend/target src/frontend/node_modules src/frontend/.next desktop/dist desktop/out desktop/build/jre desktop/build/backend desktop/build/frontend

# ── desktop packaging (Mode B) ─────────────────────────────────────────
# 모든 데스크톱 빌드는 desktop/ 디렉터리에서 실행. Docker compose (Mode A) 와 무관.

desktop-install:
	cd desktop && npm install --no-audit --no-fund

desktop-prepare:
	cd desktop && npm run prepare:resources

desktop-jre:
	cd desktop && npm run prepare:jre

desktop-dev: desktop-install
	cd desktop && npm run dev

# 각 OS 의 패키지는 해당 OS 위에서 실행해야 함 (CI 매트릭스 권장).
package-windows: desktop-install desktop-prepare desktop-jre
	cd desktop && npm run package:win

package-macos: desktop-install desktop-prepare desktop-jre
	cd desktop && npm run package:mac

package-linux: desktop-install desktop-prepare desktop-jre
	cd desktop && npm run package:linux

package-freebsd: desktop-install desktop-prepare desktop-jre
	cd desktop && npm run package:freebsd

package-all:
	@echo "▶ 현재 OS 에서 가능한 패키지를 모두 빌드합니다."
	@case "$$(uname -s)" in \
	  Linux*)   $(MAKE) package-linux ;; \
	  Darwin*)  $(MAKE) package-macos ;; \
	  MINGW*|MSYS*|CYGWIN*) $(MAKE) package-windows ;; \
	  FreeBSD*) $(MAKE) package-freebsd ;; \
	  *) echo "지원되지 않는 OS — CI 매트릭스(.github/workflows/package.yml)를 사용하세요." ;; \
	esac
