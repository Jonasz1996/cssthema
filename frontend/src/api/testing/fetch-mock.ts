/**
 * Nep-backend voor unit-tests: een `fetch` met routes per methode en pad. Niet in de app
 * gebruiken (alleen tests importeren dit, dus het komt niet in de bundel).
 *
 * ```ts
 * const server = createFetchMock()
 *   .on("GET", "/api/v1/themes/:id", ({ params }) => json(makeTheme({ id: params.id })))
 *   .on("PUT", "/api/v1/themes/:id/draft", () => json(makeDraft(), { headers: etag(4) }));
 * vi.stubGlobal("fetch", server.fetch);
 * // … na de actie:
 * expect(server.calls.at(-1)?.headers.get("If-Match")).toBe('"lv-3"');
 * ```
 */

export interface MockRequest {
  method: string;
  url: URL;
  /** Pad zonder query, bv. `/api/v1/themes/abc/draft`. */
  path: string;
  headers: Headers;
  /** JSON-object, `FormData` (multipart), tekst, of `null` zonder body. */
  body: unknown;
  /** Waarden van `:naam`-segmenten uit het patroon. */
  params: Record<string, string>;
}

export type MockReply = Response | Promise<Response>;
export type MockHandler = ((request: MockRequest) => MockReply) | Response | object;

interface Route {
  method: string;
  regex: RegExp;
  names: string[];
  handler: MockHandler;
}

export interface FetchMock {
  /** Voor `vi.stubGlobal("fetch", server.fetch)`. */
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  /**
   * Route toevoegen; de laatst toegevoegde passende route wint (zo kan een test een
   * standaardroute overschrijven). Een object als handler wordt JSON met status 200.
   */
  on: (method: string, pattern: string, handler: MockHandler) => FetchMock;
  /** Alle verzoeken, in volgorde. */
  calls: MockRequest[];
  /** Verzoeken zonder route (die kregen 404 `mock_unhandled`). */
  unhandled: MockRequest[];
  /** Verzoeken met deze methode (en optioneel dit pad of patroon). */
  callsTo: (method: string, pattern?: string) => MockRequest[];
}

function compile(pattern: string): { regex: RegExp; names: string[] } {
  const names: string[] = [];
  const source = pattern
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) {
        names.push(segment.slice(1));
        return "([^/]+)";
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { regex: new RegExp(`^${source}$`), names };
}

async function readBody(request: Request): Promise<unknown> {
  const type = request.headers.get("Content-Type") ?? "";
  if (request.method === "GET" || request.method === "HEAD") return null;
  if (type.includes("multipart/form-data")) return request.formData();
  const text = await request.text();
  if (!text) return null;
  if (type.includes("json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

export function createFetchMock(): FetchMock {
  const routes: Route[] = [];
  const mock: FetchMock = {
    calls: [],
    unhandled: [],
    on(method, pattern, handler) {
      routes.unshift({ method: method.toUpperCase(), ...compile(pattern), handler });
      return mock;
    },
    callsTo(method, pattern) {
      const matcher = pattern ? compile(pattern).regex : null;
      return mock.calls.filter(
        (call) => call.method === method.toUpperCase() && (!matcher || matcher.test(call.path)),
      );
    },
    async fetch(input, init) {
      const base = globalThis.location?.origin ?? "http://localhost";
      const request =
        input instanceof Request && !init
          ? input
          : new Request(input instanceof Request ? input : new URL(String(input), base).href, init);
      if (request.signal.aborted) throw new DOMException("Aborted", "AbortError");
      const url = new URL(request.url);
      const entry: MockRequest = {
        method: request.method.toUpperCase(),
        url,
        path: url.pathname,
        headers: new Headers(request.headers),
        body: await readBody(request.clone()),
        params: {},
      };
      mock.calls.push(entry);
      for (const route of routes) {
        if (route.method !== entry.method) continue;
        const match = route.regex.exec(entry.path);
        if (!match) continue;
        route.names.forEach((name, index) => {
          entry.params[name] = decodeURIComponent(match[index + 1] ?? "");
        });
        const { handler } = route;
        if (typeof handler === "function") return (handler as (r: MockRequest) => MockReply)(entry);
        if (handler instanceof Response) return handler.clone();
        return json(handler);
      }
      mock.unhandled.push(entry);
      return problem(404, "mock_unhandled", {
        title: `Geen mock voor ${entry.method} ${entry.path}`,
      });
    },
  };
  return mock;
}

export interface ReplyInit {
  status?: number;
  headers?: Record<string, string>;
}

/** JSON-antwoord (standaard 200). */
export function json(body: unknown, { status = 200, headers = {} }: ReplyInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/** 204 zonder body. */
export function noContent(): Response {
  return new Response(null, { status: 204 });
}

/** `ETag: "lv-<n>"`-header, voor `json(…, { headers: etag(4) })`. */
export function etag(lockVersion: number): Record<string, string> {
  return { ETag: `"lv-${lockVersion}"` };
}

/** Problem Details (`application/problem+json`) zoals de backend ze stuurt. */
export function problem(
  status: number,
  code: string,
  extra: Record<string, unknown> & { title?: string; headers?: Record<string, string> } = {},
): Response {
  const { headers = {}, title = code, ...rest } = extra;
  return new Response(
    JSON.stringify({
      type: `https://cssthema.dev/problems/${code.replace(/_/g, "-")}`,
      title,
      status,
      code,
      ...rest,
    }),
    { status, headers: { "Content-Type": "application/problem+json", ...headers } },
  );
}
