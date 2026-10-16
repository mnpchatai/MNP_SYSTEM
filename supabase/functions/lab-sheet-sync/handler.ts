import "../../../modules/lab-mooney-model.js";

type SyncEnvironment = { url: string; serviceKey: string; secret: string };
type Summary = Record<string, unknown> & { latest: { mh: unknown; mv: unknown } | null };
const model = (globalThis as unknown as {
  MNP_LAB_MOONEY: {
    normalizeFeed(body: { rows: unknown[] }): { rows: unknown[] };
    buildMaterialSummaries(rows: unknown[]): Summary[];
  };
}).MNP_LAB_MOONEY;
const MAX_BYTES = 8 * 1024 * 1024;

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function matchesSecret(actual: string, expected: string) {
  const encode = new TextEncoder();
  const [a, b] = await Promise.all([actual, expected].map(async (value) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", encode.encode(value)))));
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

async function readBody(request: Request) {
  if (Number(request.headers.get("content-length")) > MAX_BYTES) throw new Error("TOO_LARGE");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("BAD_REQUEST");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) { await reader.cancel(); throw new Error("TOO_LARGE"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

// Server-to-server only. No browser CORS, no user JWT or service key in Apps Script.
export async function handleSync(request: Request, env: SyncEnvironment, send: typeof fetch = fetch) {
  if (request.method !== "POST") return reply(405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  if (!env.url || !env.serviceKey || env.secret.length < 32) return reply(503, { ok: false, error: "NOT_CONFIGURED" });
  const secret = request.headers.get("x-lab-sync-secret") ?? "";
  if (secret.length > 512 || !await matchesSecret(secret, env.secret)) return reply(401, { ok: false, error: "NOT_AUTHORIZED" });
  let body: Record<string, unknown>;
  try {
    const parsed = await readBody(request);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("BAD_REQUEST");
    body = parsed as Record<string, unknown>;
  } catch (error) {
    return reply(error instanceof Error && error.message === "TOO_LARGE" ? 413 : 400, { ok: false, error: "BAD_REQUEST" });
  }
  if (!Array.isArray(body.rows) || body.rows.length < 1 || body.rows.length > 20000
    || typeof body.source_read_at !== "string" || !Number.isFinite(Date.parse(body.source_read_at))
    || body.problem_count !== 0) return reply(400, { ok: false, error: "INVALID_SNAPSHOT" });
  try {
    const rows = model.normalizeFeed({ rows: body.rows }).rows;
    if (rows.length !== body.rows.length) return reply(400, { ok: false, error: "INVALID_SNAPSHOT" });
    // Store only what the overview displays, not the full last group and its rows.
    const materials = model.buildMaterialSummaries(rows).map(({ latest, ...summary }) => ({
      ...summary, latest: latest ? { mh: latest.mh, mv: latest.mv } : null,
    }));
    const response = await send(`${env.url}/rest/v1/rpc/app_lab_mooney_publish`, {
      method: "POST",
      headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_rows: body.rows, p_materials: materials, p_source_read_at: body.source_read_at }),
      signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) return reply(502, { ok: false, error: "SYNC_REJECTED" });
    const result: unknown = await response.json();
    if (!result || typeof result !== "object") return reply(502, { ok: false, error: "SYNC_REJECTED" });
    return reply(200, { ok: true, ...(result as Record<string, unknown>) });
  } catch {
    return reply(502, { ok: false, error: "SYNC_FAILED" });
  }
}
