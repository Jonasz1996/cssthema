# cssthema — Central CSS Theme Builder

Eén self-hosted platform om custom CSS-thema's te maken, versioneren en distribueren voor alle webapplicaties achter Nginx Proxy Manager (Proxmox, Nextcloud, Immich, Home Assistant, Grafana, UniFi, Jellyfin, Authentik, Uptime Kuma, Portainer, …).

```
https://cssthema.domain.be/                      → dashboard en editor (in NPM achter Authentik)
https://css.domain.be/proxmox.css                → gepubliceerd Proxmox-thema (publiek)
https://css.domain.be/host/pve.domain.be.css     → alles wat die host krijgt (pagina Hosts)
```

**Status:** fase 1 staat: thema's maken en bewerken met live preview, publiceren, versies en terugzetten, paletten, import van bestaande CSS en het beheer van thema-scripts (`.js`). Daarbij: **Hosts** (één NPM-regel voor alle proxy hosts; per host kies je in het dashboard welke thema's en scripts hij krijgt, met een gezondheidscontrole), **Services** (de vastgelegde pagina's van je apps als preview in de editor) en back-ups met terugzetten. De eigen login volgt in fase 3; tot dan hoort het dashboard achter Authentik. Zie [`docs/`](docs/README.md) voor het ontwerp en de [MVP-roadmap](docs/07-mvp-roadmap.md).

## Installeren

Op een lege Debian 13-container, zonder Docker (volledige uitleg en NPM-config in [`docs/ops/installatie-debian.md`](docs/ops/installatie-debian.md)):

```bash
apt update && apt install -y git
git clone https://github.com/Jonasz1996/cssthema.git /opt/cssthema
DASHBOARD_HOST=cssthema.domain.be PUBLIC_BASE_URL=https://css.domain.be \
  TRUSTED_PROXIES=<ip-van-npm> bash /opt/cssthema/deploy/debian/install.sh
```

`DASHBOARD_HOST` is de hostnaam van het dashboard: alleen daar serveert nginx het dashboard en de api. `PUBLIC_BASE_URL` is het publieke CSS-domein (https) waar je apps de thema's vandaan halen. Bijwerken: `git -C /opt/cssthema pull && bash /opt/cssthema/deploy/debian/install.sh` (met eerst een back-up). Overstappen van een oude CSS-server of een oudere versie: volg [`docs/ops/uitrol.md`](docs/ops/uitrol.md), stap voor stap met controle en weg terug.

Met Docker:

```bash
cp .env.example .env        # vul minstens POSTGRES_PASSWORD en SECRET_KEY in (DASHBOARD_HOST: standaard localhost)
make up                     # docker compose: nginx, api, worker, postgres, redis
curl http://localhost:8080/readyz
```

Ontwikkelen:

```bash
make install                # backend (uv) en frontend (pnpm)
make dev                    # dev-stack met hot reload; frontend: cd frontend && pnpm dev
make lint typecheck test
make test-e2e               # Playwright tegen de productiebuild (frontend/README.md)
```

## Structuur

| Map | Inhoud |
|---|---|
| `backend/` | FastAPI-api en arq-worker (Python 3.12 of 3.13, SQLAlchemy 2, Alembic) |
| `frontend/` | React 19 + TypeScript SPA (Vite, Tailwind, TanStack Query) |
| `docker/` | Dockerfiles, nginx-configuratie, compose-bestanden |
| `deploy/` | Installatie zonder Docker (`deploy/debian/`: script en systemd-units) |
| `scripts/` | Hulpscripts en spike-prototypes |
| `docs/` | Ontwerp, spikes en operationele handleidingen (`docs/ops/`) |
