import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const model = require("../../modules/lab-mooney-model.js");
const source = readFileSync(new URL("../../supabase/functions/lab-sheet-sync/handler.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
vm.runInNewContext(output, { exports, require: () => model, MNP_LAB_MOONEY: model, Response, Request, TextEncoder, TextDecoder, Uint8Array, crypto: webcrypto, AbortSignal, fetch });
const handle = exports.handleSync;
const env = { url: "https://example.supabase.co", serviceKey: "server-only-key", secret: "x".repeat(48) };
const row = (id, overrides = {}) => ({
  source_sheet: "A", sample_id: String(id), material: "A", test_date: "2026-10-01", test_time: `08:0${id}:00`,
  temperature_c: 100, test_minutes: 4, mh: 50 + id, mv: 30 + id, avg_mh: 52, sd_mh: 1, avg_mv: 32, sd_mv: 1, ...overrides,
});
const snapshot = () => ({ rows: [row(1), row(2)], source_read_at: "2026-10-16T02:00:00Z", problem_count: 0 });
const request = (body = snapshot(), secret = env.secret) => new Request("https://example.test/sync", {
  method: "POST", headers: { "x-lab-sync-secret": secret }, body: JSON.stringify(body),
});

test("worker only accepts the dedicated integration secret, never a user token", async () => {
  for (const secret of ["", "user.jwt.token", "bad".repeat(20), "x".repeat(513)]) {
    const response = await handle(request(snapshot(), secret), env, () => { throw new Error("must not reach database"); });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { ok: false, error: "NOT_AUTHORIZED" });
  }
  assert.equal((await handle(new Request("https://example.test"), env)).status, 405);
  assert.equal((await handle(request(), { ...env, secret: "" })).status, 503);
});

test("publishes exact sheet order and compact summaries using the existing model", async () => {
  const body = snapshot();
  body.rows.push(row(3, { material: "B", source_sheet: "B", avg_mh: null, avg_mv: null, sd_mh: null, sd_mv: null }));
  let calls = 0;
  const response = await handle(request(body), env, async (url, options) => {
    calls += 1;
    assert.equal(url, `${env.url}/rest/v1/rpc/app_lab_mooney_publish`);
    assert.equal(options.headers.Authorization, `Bearer ${env.serviceKey}`);
    const sent = JSON.parse(options.body);
    assert.deepEqual(sent.p_rows, body.rows);
    assert.equal(sent.p_source_read_at, body.source_read_at);
    const expected = model.buildMaterialSummaries(model.normalizeFeed(body).rows).map(({ latest, ...summary }) => ({
      ...summary, latest: latest ? { mh: latest.mh, mv: latest.mv } : null,
    }));
    assert.deepEqual(sent.p_materials, expected);
    assert.ok(!options.body.includes('"items"'), "overview does not duplicate full groups");
    return Response.json({ applied: true, rows: 3 });
  });
  assert.equal(calls, 1);
  assert.deepEqual(await response.json(), { ok: true, applied: true, rows: 3 });
});

test("empty, incomplete, oversized and malformed reads never reach the import", async () => {
  for (const body of [null, [], { ...snapshot(), rows: [] }, { ...snapshot(), problem_count: 1 },
    { ...snapshot(), source_read_at: "bad" }, { ...snapshot(), rows: [{ material: "A" }] },
    { ...snapshot(), rows: Array(20001).fill(row(1)) }]) {
    assert.equal((await handle(request(body), env, () => { throw new Error("unexpected import"); })).status, 400);
  }
  const large = new Request("https://example.test", { method: "POST", headers: { "x-lab-sync-secret": env.secret }, body: "x".repeat(8 * 1024 * 1024 + 1) });
  assert.equal((await handle(large, env)).status, 413);
});

test("database errors, timeouts and stale snapshots do not expose internals or credentials", async () => {
  const responses = [async () => new Response("database internal details", { status: 400 }), async () => { throw new Error(env.serviceKey); }];
  for (const send of responses) {
    const response = await handle(request(), env, send);
    assert.equal(response.status, 502);
    const text = await response.text();
    assert.ok(!text.includes(env.serviceKey));
    assert.ok(!text.includes("database internal"));
  }
  const response = await handle(request(), env, async () => Response.json({ applied: false, reason: "OLDER_SNAPSHOT" }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).applied, false);
});
