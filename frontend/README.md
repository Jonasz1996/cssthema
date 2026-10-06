# cssthema — frontend

React 19 + TypeScript (Vite, Tailwind 4, TanStack Query), in de stijl van aiverslag
(`src/components/ui/README.md`). Teksten in `src/locales/{nl,en}/`.

```bash
pnpm install
pnpm dev            # http://localhost:5173, proxyt /api, /healthz, /readyz en /<slug>.css naar :8000
                    # (andere api: VITE_BACKEND_URL=http://localhost:8011 pnpm dev)
pnpm lint && pnpm exec prettier --check . && pnpm typecheck && pnpm test && pnpm build
```

## End-to-end-tests (`pnpm e2e`)

Playwright-tests in `tests/e2e/` tegen de **productiebuild**: de acceptatieflow van fase 1
(docs/07 § 4: thema maken → CSS typen → autosave → publiceren → `/<slug>.css` 200 + ETag →
`If-None-Match` → 304 → rollback → nieuwe ETag), de conflictdialoog, verwijderen en herstellen,
import van een handgemaakt bestand en upload, thema-scripts (`.js` uploaden, URL kopiëren,
vervangen na de vraag, verwijderen) en een rooktest (pagina's, Monaco-workers uit `/assets/`,
preview, mobiel zonder horizontale scroll).

Nodig: PostgreSQL en Redis (zoals voor de backend-tests) en `uv` voor de backend. `pnpm e2e`
start zelf:

- de api op poort **8020** (`alembic upgrade head` + uvicorn, `CSS_FILES_DIR=test-results/css-files`);
- `vite build` + `vite preview` op **4173**, met een proxy naar de api voor `/api`, `/healthz`,
  `/readyz` en de publieke CSS-paden.

```bash
pnpm exec playwright install chromium        # eenmalig (of: PLAYWRIGHT_CHROMIUM_EXECUTABLE=/pad/naar/chrome)
pnpm e2e                                     # DATABASE_URL / REDIS_URL overschrijven de localhost-standaard
pnpm e2e --headed tests/e2e/conflict.spec.ts # één bestand, met zichtbare browser
E2E_BASE_URL=http://localhost:8080 pnpm e2e  # tegen een draaiende stack (docker compose, nginx)
```

Draait er al iets op 8020/4173, dan wordt dat hergebruikt (behalve in CI). De tests maken
thema's en scripts met namen `e2e-…` en verwijderen ze daarna (thema's definitief, scripts naar
`.scripts-archief/`): **nooit tegen productie draaien**. Via `vite preview` bestaat `/<naam>.js`
niet (alleen nginx serveert scripts); met `E2E_BASE_URL` controleert de scripttest ook die URL.
Bij een fout staan screenshot en trace in `test-results/e2e/`
(`pnpm exec playwright show-trace <trace.zip>`).
