# cssthema — Central CSS Theme Builder

Eén self-hosted platform om custom CSS-thema's te maken, versioneren en distribueren voor alle webapplicaties achter Nginx Proxy Manager (Proxmox, Nextcloud, Immich, Home Assistant, Grafana, UniFi, Jellyfin, Authentik, Uptime Kuma, Portainer, …).

```
https://cssthema.domain.be/              → dashboard en editor
https://cssthema.domain.be/proxmox.css   → gepubliceerd Proxmox-thema
```

**Status:** fase 0 (fundament) staat. Er is nog geen functionaliteit voor eindgebruikers; die komt vanaf fase 1. Zie [`docs/`](docs/README.md) voor het ontwerp en de [MVP-roadmap](docs/07-mvp-roadmap.md).

## Snel starten

```bash
cp .env.example .env        # vul minstens POSTGRES_PASSWORD en SECRET_KEY in
make up                     # docker compose: nginx, api, worker, postgres, redis
curl http://localhost:8080/readyz
```

Ontwikkelen:

```bash
make install                # backend (uv) en frontend (pnpm)
make dev                    # dev-stack met hot reload; frontend: cd frontend && pnpm dev
make lint typecheck test
```

## Structuur

| Map | Inhoud |
|---|---|
| `backend/` | FastAPI-api en arq-worker (Python 3.12, SQLAlchemy 2, Alembic) |
| `frontend/` | React 19 + TypeScript SPA (Vite, Tailwind, TanStack Query) |
| `docker/` | Dockerfiles, nginx-configuratie, compose-bestanden |
| `scripts/` | Hulpscripts en spike-prototypes |
| `docs/` | Ontwerp, spikes en (later) operationele handleidingen |
