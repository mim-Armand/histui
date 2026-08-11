import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

import {
  DEFAULT_HISTUI_CONFIG,
  TimeScale,
  buildTimeScale,
  createDefaultFilters,
  filterRecords,
  normalizeTimelineData
} from "../src/index.js";

const stylesheet = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
assert.match(stylesheet, /\.histui-timeline/);
assert.equal(DEFAULT_HISTUI_CONFIG.app.name, "Histui");

const normalized = normalizeTimelineData({
  paststructVersion: "1.0",
  dataset: {
    id: "check",
    title: { en: "Check" },
    defaultLanguage: "en"
  },
  records: [
    {
      id: "event-a",
      recordType: "event",
      type: "political",
      label: { en: "Event A" },
      description: { en: "A test event" },
      temporal: {
        dates: [
          {
            rank: 1,
            confidence: "certain",
            date: { from: "1900-01-01" }
          }
        ]
      },
      significance: { value: 8, scale: 10, scope: "local" }
    }
  ]
});

assert.equal(normalized.records.length, 1);
assert.equal(normalized.records[0].__meta.importance, 8);

const filters = createDefaultFilters(normalized.records, {
  recordTypes: [{ key: "event" }],
  types: [{ key: "political" }],
  factuality: [{ key: "unknown" }],
  confidence: [{ key: "certain" }],
  scopes: [{ key: "local" }],
  categories: [],
  countries: []
});
assert.equal(filterRecords(normalized.records, filters).length, 1);

const breakRecords = [
  { __meta: { start: 0, end: 40 } },
  { __meta: { start: 60, end: 80 } },
  { __meta: { start: 3000, end: 3040 } }
];
const breakDomain = { start: -100, end: 3140 };

const identityScale = buildTimeScale(breakRecords, breakDomain, { enabled: false });
assert.equal(identityScale.hasBreaks, false);
assert.equal(identityScale.span, breakDomain.end - breakDomain.start);
assert.equal(identityScale.toUnit(0), 100);
assert.equal(identityScale.toYear(100), 0);

const brokenScale = buildTimeScale(breakRecords, breakDomain, { enabled: true });
assert.equal(brokenScale.breaks.length, 1);
assert.ok(brokenScale.span < identityScale.span / 2, "breaks must shorten the axis");
assert.ok(brokenScale.toUnit(80) < brokenScale.toUnit(3000), "mapping stays monotonic across a break");

for (const year of [-100, 0, 79, 80, 1500, 3000, 3140]) {
  const roundTrip = brokenScale.toYear(brokenScale.toUnit(year));
  assert.ok(Math.abs(roundTrip - year) < 1e-6, `round trip failed for ${year}`);
}

const denseSpans = brokenScale.denseSpansForRange(0, brokenScale.span);
assert.equal(denseSpans.length, 2);
assert.ok(denseSpans[0].yearEnd < denseSpans[1].yearStart);
assert.equal(brokenScale.breaksForRange(0, brokenScale.span).length, 1);
assert.equal(brokenScale.breaksForRange(0, 1).length, 0);

const emptyBreaks = buildTimeScale([{ __meta: { start: 0, end: 3140 } }, ...breakRecords], breakDomain, { enabled: true });
assert.equal(emptyBreaks.hasBreaks, false, "a record covering the gap must prevent a break");
assert.equal(TimeScale.identity(breakDomain).hasBreaks, false);
assert.equal(DEFAULT_HISTUI_CONFIG.timeline.timeBreaks.enabled, false);

const zoomedOut = buildTimeScale(breakRecords, breakDomain, { enabled: true }, { viewSpan: 3240 });
const zoomedIn = buildTimeScale(breakRecords, breakDomain, { enabled: true }, { viewSpan: 100 });
assert.equal(zoomedOut.breaks.length, 1, "only the wide gap matters when the whole span is in frame");
assert.equal(zoomedIn.breaks.length, 2, "zooming in must also cut gaps that were small before");
assert.ok(
  zoomedIn.breaks[1].unitSpan < zoomedOut.breaks[0].unitSpan,
  "a collapsed gap keeps a share of the frame, not a share of the dataset"
);
assert.equal(
  zoomedIn.breaks[1].id,
  zoomedOut.breaks[0].id,
  "break ids follow the gap so expanded gaps survive a zoom change"
);

const devServerSyntax = spawnSync(process.execPath, ["--check", "scripts/dev-server.mjs"], {
  cwd: new URL("..", import.meta.url),
  encoding: "utf8"
});
assert.equal(
  devServerSyntax.status,
  0,
  devServerSyntax.stderr || devServerSyntax.stdout || "dev server syntax check failed"
);

console.log("Histui package check passed.");
