# ── builder ─────────────────────────────────────────────────────────────
FROM golang:1.23-alpine AS builder
WORKDIR /src

# Pre-cache modules first so source edits don't re-download.
COPY go.mod ./
RUN go mod download

COPY . .

# Static, stripped, no CGO.
ENV CGO_ENABLED=0 GOOS=linux GOARCH=amd64
RUN go build -trimpath -ldflags="-s -w" -o /out/backend . \
 && go test ./runtime/numerics/

# ── runtime ────────────────────────────────────────────────────────────
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /out/backend /usr/local/bin/backend
USER nonroot:nonroot
EXPOSE 8080
ENV PORT=8080
ENTRYPOINT ["/usr/local/bin/backend"]
