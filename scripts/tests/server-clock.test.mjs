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

test("one sample that disagrees (an old cached answer) is ignored; two in a row that agree with each other (this clock was reset) start again from them", () => {
  const clock = createClock({ now: () => 0 });
  clock.sample(header("2026-11-10T06:00:00Z"), at("2026-11-10T06:00:00.100Z"), at("2026-11-10T06:00:00.200Z"));
  const inSync = clock.bounds();
  assert.ok(Math.abs(clock.offset()) < 1000, "first: about in sync");
  // a stale answer with an hour-old Date header
  clock.sample(header("2026-11-10T05:00:00Z"), at("2026-11-10T06:00:10.100Z"), at("2026-11-10T06:00:10.200Z"));
  assert.deepEqual(clock.bounds(), inSync, "a single outlier does not move the clock");
  // a normal answer afterwards still narrows the window as usual
  clock.sample(header("2026-11-10T06:00:20Z"), at("2026-11-10T06:00:20.800Z"), at("2026-11-10T06:00:20.900Z"));
  assert.ok(Math.abs(clock.offset()) < 1000);
  // the machine clock jumped 10 minutes back: the first answer alone is not trusted, the second confirms it
  clock.sample(header("2026-11-10T06:05:00Z"), at("2026-11-10T05:55:00.100Z"), at("2026-11-10T05:55:00.200Z"));
  assert.ok(Math.abs(clock.offset()) < 1000, "still the old offset after one disagreeing answer");
  clock.sample(header("2026-11-10T06:05:05Z"), at("2026-11-10T05:55:05.100Z"), at("2026-11-10T05:55:05.200Z"));
  assert.ok(Math.abs(clock.offset() - 600000) < 1000, `re-anchored to the new offset (${clock.offset()})`);
});

test("a slow answer gives a wide window that never widens a narrow one", () => {
  const clock = createClock({ now: () => 0 });
  clock.sample(header("2026-11-10T06:00:00Z"), at("2026-11-10T06:00:00.900Z"), at("2026-11-10T06:00:01.000Z"));
  const [lo, hi] = clock.bounds();
  // 3 seconds round trip
  clock.sample(header("2026-11-10T06:00:12Z"), at("2026-11-10T06:00:10.500Z"), at("2026-11-10T06:00:13.500Z"));
  const [lo2, hi2] = clock.bounds();
  assert.ok(lo2 >= lo && hi2 <= hi, "the window only narrows");
  assert.ok(hi2 - lo2 <= hi - lo);
});

test("bad samples are ignored", () => {
  const clock = createClock({ now: () => 0 });
  assert.equal(clock.sample("not a date", 0, 10), false);
  assert.equal(clock.sample(null, 0, 10), false);
  assert.equal(clock.sample(header("2026-11-10T06:00:00Z"), 20, 10), false, "received before it was sent");
  assert.equal(clock.sample(header("2026-11-10T06:00:00Z"), Number.NaN, 10), false);
  assert.equal(clock.bounds(), null);
});
