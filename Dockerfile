# Multi-stage build (design doc §9): build the Vite frontend, embed its
# output into the Go binary via internal/webui's //go:embed, then run that
# binary in a slim runtime image with poppler-utils (PDF thumbnailing shells
# out to it — see CLAUDE.md's stack table, this isn't linked as a Go
# library).
#
# No cross-compilation anywhere in this file on purpose: the CI workflow
# (.github/workflows/docker-publish.yml) builds each target architecture
# natively on its own runner rather than emulating under QEMU, so a plain
# `go build` here already produces a binary matching the host it's running
# on — see that workflow's own comments for why.

# ---- Stage 1: frontend ----
FROM node:22-bookworm-slim AS frontend-builder
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: backend ----
FROM golang:1.26-bookworm AS backend-builder
WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ ./cmd/
COPY internal/ ./internal/
# Overwrites internal/webui/dist's committed placeholder with the real
# frontend build — must happen before `go build`, since //go:embed reads
# this directory at compile time.
COPY --from=frontend-builder /build/frontend/dist/. ./internal/webui/dist/
# CGO_ENABLED=0: no CGO anywhere in this module (modernc.org/sqlite and
# robfig/cron are both pure Go — see CLAUDE.md > Config/File handling),
# so a fully static binary needs nothing from the build image at runtime.
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/sonneck ./cmd/sonneck

# ---- Stage 3: runtime ----
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
        poppler-utils \
        wget \
    && rm -rf /var/lib/apt/lists/*
# wget exists solely so HEALTHCHECK below can hit /healthz without adding a
# dedicated Go subcommand for it — debian-slim ships neither wget nor curl
# by default.

# Non-root by default — a fixed UID/GID (1000, the common first-user
# default on most Linux distros) so a
# host bind-mount at /data "just works" without extra configuration for the
# common case; document chown-ing to 1000:1000 if someone's host directory
# was created under a different UID. Creating /data here (owned by the new
# user) *before* anything mounts over it matters: Docker initializes a
# fresh, empty named volume's ownership from whatever's already at that
# path in the image, so docker-compose.yml's named volume inherits the
# right ownership automatically — nothing else has to chown it at runtime.
RUN groupadd -g 1000 sonneck \
    && useradd -u 1000 -g sonneck -d /nonexistent -s /usr/sbin/nologin sonneck \
    && mkdir -p /data \
    && chown sonneck:sonneck /data

COPY --from=backend-builder /out/sonneck /usr/local/bin/sonneck

# org.opencontainers.image.source specifically: GHCR reads this label to
# auto-link the published package back to this repo, so that doesn't need
# to be done by hand in the GitHub UI after the first publish.
LABEL org.opencontainers.image.title="Sonneck" \
      org.opencontainers.image.description="A self-hosted library organizer for sheet music" \
      org.opencontainers.image.source="https://github.com/jpcranford/sonneck" \
      org.opencontainers.image.licenses="GPL-3.0"

ENV DATA_DIR=/data
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -O- http://localhost:8080/healthz || exit 1

USER sonneck
ENTRYPOINT ["/usr/local/bin/sonneck"]
