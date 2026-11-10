import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createClock } = require("../../modules/server-clock.js");

const at = (iso) => Date.parse(iso);
const header = (iso) => new Date(at(iso)).toUTCString();

test("with no sample the clock is this machine's clock", () => {
  const clock = createClock({ now: () => 1000 });
  assert.equal(clock.offset(), 0);
  assert.equal(clock.now(), 1000);
  assert.equal(clock.bounds(), null);
});

test("a Date header narrows the offset to the window the server answered in, and more samples narrow it further", () => {
  // this machine is 3.4 s behind the server; the header is rounded down to the second
  const behind = 3400;
  const local = (serverIso) => at(serverIso) - behind;
  const clock = createClock({ now: () => local("2026-11-10T06:40:00.000Z") });
  // request sent at server 06:33:29.900, answered at 06:33:30.050 (header 06:33:30), received at 06:33:30.100
  assert.equal(clock.sample(header("2026-11-10T06:33:30Z"), local("2026-11-10T06:33:29.900Z"), local("2026-11-10T06:33:30.100Z")), true);
  const [lo1, hi1] = clock.bounds();
  assert.ok(lo1 <= behind && behind <= hi1, `the true offset ${behind} is inside [${lo1}, ${hi1}]`);
  // a second request answered late in its second (06:33:41.950, header 06:33:41) pulls the lower bound up
  clock.sample(header("2026-11-10T06:33:41Z"), local("2026-11-10T06:33:41.900Z"), local("2026-11-10T06:33:42.000Z"));
  const [lo2, hi2] = clock.bounds();
  assert.ok(lo2 >= lo1 && hi2 <= hi1 && lo2 <= behind && behind <= hi2, `still contains the truth and is no wider: [${lo2}, ${hi2}]`);
  assert.ok(hi2 - lo2 <= 300, `two samples leave a window of ${hi2 - lo2} ms`);
  assert.ok(Math.abs(clock.offset() - behind) <= 150, `offset ${clock.offset()} is within 150 ms of ${behind}`);
  assert.ok(Math.abs(clock.now() - at("2026-11-10T06:40:00.000Z")) <= 150, "now() reads the server's time");
});

test("a sample that cannot overlap the current window (this clock was reset) starts again from that sample", () => {
  const clock = createClock({ now: () => 0 });
  clock.sample(header("2026-11-10T06:00:00Z"), at("2026-11-10T06:00:00.100Z"), at("2026-11-10T06:00:00.200Z"));
  assert.ok(Math.abs(clock.offset()) < 1000, "first: about in sync");
  // the machine clock jumped 10 minutes back
  clock.sample(header("2026-11-10T06:05:00Z"), at("2026-11-10T05:55:00.100Z"), at("2026-11-10T05:55:00.200Z"));
  assert.ok(Math.abs(clock.offset() - 600000) < 1000, `re-anchored to the new offset (${clock.offset()})`);
});

test("bad samples are ignored", () => {
  const clock = createClock({ now: () => 0 });
  assert.equal(clock.sample("not a date", 0, 10), false);
  assert.equal(clock.sample(null, 0, 10), false);
  assert.equal(clock.sample(header("2026-11-10T06:00:00Z"), 20, 10), false, "received before it was sent");
  assert.equal(clock.sample(header("2026-11-10T06:00:00Z"), Number.NaN, 10), false);
  assert.equal(clock.bounds(), null);
});
