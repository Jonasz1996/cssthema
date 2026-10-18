# syntax=docker/dockerfile:1.7
# Eén backend-codebase, twee targets: `api` (slank) en `worker`.
# Vanaf fase 2 krijgt `worker` Playwright/Chromium (zie docs/02 § 1.1).

FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PATH="/app/.venv/bin:$PATH"
RUN pip install --no-cache-dir "uv>=0.8,<0.9"
WORKDIR /app

FROM base AS deps
COPY backend/pyproject.toml backend/uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

FROM deps AS app
COPY backend/ ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev
# /data/storage bestaat al in de image met de juiste eigenaar, zodat een nieuw
# named volume op dat pad die eigenaar overneemt (anders root:root).
RUN useradd --system --uid 10001 --home /app cssthema \
    && mkdir -p /data/storage \
    && chown -R cssthema /app /data/storage
USER cssthema

FROM app AS api
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz').status==200 else 1)"
ENTRYPOINT ["/app/docker-entrypoint.sh"]
# nginx stuurt alleen het door real_ip bepaalde client-IP als X-Forwarded-For door, en
# de api is alleen via nginx bereikbaar. Access-logs komen uit RequestContextMiddleware.
CMD ["uvicorn", "cssthema.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*", "--no-access-log"]

FROM app AS worker
CMD ["arq", "cssthema.worker.WorkerSettings"]
