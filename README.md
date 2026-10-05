# cssthema — Central CSS Theme Builder

Eén self-hosted platform om custom CSS-thema's te maken, versioneren en distribueren voor alle webapplicaties achter Nginx Proxy Manager (Proxmox, Nextcloud, Immich, Home Assistant, Grafana, UniFi, Jellyfin, Authentik, Uptime Kuma, Portainer, …).

```
https://cssthema.domain.be/              → dashboard en editor
https://cssthema.domain.be/proxmox.css   → gepubliceerd Proxmox-thema
```

**Status:** ontwerpfase. De volledige ontwerpdocumentatie staat in [`docs/`](docs/README.md); de implementatie start na goedkeuring van het ontwerp.

Geplande stack: React + TypeScript (Monaco), FastAPI, PostgreSQL, SQLAlchemy, Alembic, Redis/arq, Playwright, Nginx en Docker Compose.
