# cssthema — veelgebruikte taken. `make help` toont een overzicht.
COMPOSE      := docker compose -f docker/compose/docker-compose.yml --env-file .env
COMPOSE_DEV  := $(COMPOSE) -f docker/compose/docker-compose.dev.yml
# Host-commando's (alembic) lezen de POSTGRES_*-waarden uit de root-.env; de host is
# dan localhost, waar de dev-stack postgres publiceert.
ENV_FILE     := $(if $(wildcard .env),--env-file ../.env)

.PHONY: help install dev up down logs lint fmt typecheck test test-backend test-frontend \
        test-e2e migrate migration openapi build

help: ## Toon deze hulp
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-16s %s\n", $$1, $$2}'

install: ## Installeer backend- en frontend-afhankelijkheden
	cd backend && uv sync
	cd frontend && pnpm install

dev: ## Start de dev-stack (postgres, redis, api met reload, worker); frontend: cd frontend && pnpm dev
	$(COMPOSE_DEV) up --build

up: ## Start de productie-stack op de achtergrond
	$(COMPOSE) up -d --build

down: ## Stop de stack
	$(COMPOSE) down

logs: ## Volg de logs van de stack
	$(COMPOSE) logs -f

lint: ## Lint backend en frontend
	cd backend && uv run ruff check . && uv run ruff format --check .
	cd frontend && pnpm lint && pnpm exec prettier --check .

fmt: ## Formatteer alle code
	cd backend && uv run ruff check --fix . && uv run ruff format .
	cd frontend && pnpm format

typecheck: ## Typecheck backend (mypy strict) en frontend (tsc)
	cd backend && uv run mypy
	cd frontend && pnpm typecheck

test: test-backend test-frontend ## Alle tests

test-backend: ## Backend-tests (integratietests als DATABASE_URL gezet is)
	cd backend && uv run pytest

test-frontend: ## Frontend-tests
	cd frontend && pnpm test

test-e2e: ## Playwright e2e tegen de productiebuild (api op :8020, vite preview op :4173; zie frontend/README.md)
	cd frontend && pnpm e2e

migrate: ## Database migreren naar de laatste versie
	cd backend && uv run $(ENV_FILE) alembic upgrade head

migration: ## Nieuwe migratie genereren: make migration m="omschrijving"
	cd backend && uv run $(ENV_FILE) alembic revision --autogenerate -m "$(m)"

openapi: ## openapi.json en frontend-types regenereren
	cd backend && uv run python -m cssthema.openapi openapi.json
	cd frontend && pnpm openapi && pnpm exec prettier --write src/api/schema.d.ts

build: ## Docker-images bouwen
	$(COMPOSE) build
