# cssthema backend

FastAPI-API en arq-worker. Zie `docs/02-technische-architectuur.md`.

```bash
uv sync
uv run uvicorn cssthema.main:app --reload
uv run pytest
```

De database-instellingen komen uit `POSTGRES_HOST`/`POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB`
(standaard `localhost`, `cssthema`, `cssthema`, `cssthema`) of uit één `DATABASE_URL`. Vanuit de
repo-root leest `make migrate` de waarden uit `.env`, met `localhost` als host; zo werkt het tegen
de dev-stack van `make dev`. Integratietests draaien als `DATABASE_URL` gezet is
(`uv run pytest -m integration`).
