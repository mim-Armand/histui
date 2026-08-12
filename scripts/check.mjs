import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

import {
  DEFAULT_HISTUI_CONFIG,
  TIME_BREAK_LABELS,
  TimeScale,
  buildTimeScale,
  createDefaultFilters,
  filterRecords,
  normalizeTimeBreakOptions,
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

assert.equal(brokenScale.breaks[0].ongoing, false, "nothing covers the gap between the records");

const coveredRecords = [{ __meta: { start: 0, end: 3140 } }, ...breakRecords];
const coveredBreaks = buildTimeScale(coveredRecords, breakDomain, { enabled: true });
assert.equal(coveredBreaks.breaks.length, 1, "a quiet stretch is cut even while a record runs across it");
assert.equal(coveredBreaks.breaks[0].ongoing, true, "a cut inside a record is marked as ongoing");
assert.equal(
  buildTimeScale(coveredRecords, breakDomain, { enabled: true, breakOngoing: false }).hasBreaks,
  false,
  "breakOngoing: false leaves the axis whole wherever a record covers it"
);
assert.equal(
  buildTimeScale([{ __meta: { start: 0, end: 3140 } }], breakDomain, { enabled: true }).breaks.length,
  1,
  "a single long record can be cut on its own"
);
assert.equal(TimeScale.identity(breakDomain).hasBreaks, false);
assert.equal(DEFAULT_HISTUI_CONFIG.timeline.timeBreaks.enabled, false);
assert.equal(DEFAULT_HISTUI_CONFIG.timeline.timeBreaks.breakOngoing, true);
assert.equal(normalizeTimeBreakOptions({}).breakOngoing, true);
assert.equal(normalizeTimeBreakOptions({ breakOngoing: false }).breakOngoing, false);

// Cutting shortens the axis, so the frame the next cut is judged against shrinks too.
// Feeding that back must not lower the bar, or the axis keeps cutting itself until no
// dense time is left to zoom into.
let cascadeSpan = breakDomain.end - breakDomain.start;
const cascadeYears = cascadeSpan;
const cascadeCounts = [];
for (let pass = 0; pass < 5; pass += 1) {
  const scale = buildTimeScale(coveredRecords, breakDomain, { enabled: true }, {
    viewSpan: cascadeSpan,
    viewYears: cascadeYears
  });
  cascadeSpan = scale.span;
  cascadeCounts.push(scale.breaks.length);
}
assert.deepEqual(cascadeCounts, [1, 1, 1, 1, 1], "re-cutting for the shortened axis must not find new gaps");
assert.ok(cascadeSpan > 250, `the axis must keep its dense time, kept ${cascadeSpan} units`);

const zoomedOut = buildTimeScale(breakRecords, breakDomain, { enabled: true }, { viewSpan: 3240 });
const zoomedIn = buildTimeScale(breakRecords, breakDomain, { enabled: true }, { viewSpan: 100 });
assert.equal(zoomedOut.breaks.length, 1, "only the wide gap matters when the whole span is in frame");
assert.ok(zoomedIn.breaks.length > 1, "zooming in must also cut stretches that were small before");
const zoomedWide = zoomedIn.breaks.find((segment) => segment.id === zoomedOut.breaks[0].id);
assert.ok(zoomedWide, "break ids follow the gap so expanded gaps survive a zoom change");
assert.ok(
  zoomedWide.unitSpan < zoomedOut.breaks[0].unitSpan,
  "a collapsed gap keeps a share of the frame, not a share of the dataset"
);

// A compressed frame holds far more years than units, and it is the years on screen that
// decide what counts as a long stretch: 100 units reaching across 3,240 years is still a
// wide view, so it gets the wide view's single cut.
const compressed = buildTimeScale(breakRecords, breakDomain, { enabled: true }, { viewSpan: 100, viewYears: 3240 });
assert.equal(compressed.breaks.length, 1, "the bar follows the years on screen, not the units");
assert.ok(
  compressed.breaks[0].unitSpan < zoomedOut.breaks[0].unitSpan,
  "the room a cut takes still follows the units, so a tight frame keeps a thin band"
);

const [wideBreak] = zoomedOut.breaks;
assert.equal(wideBreak.gapStartYear, 80, "a break remembers where the empty stretch really starts");
assert.equal(wideBreak.gapEndYear, 3000);
assert.ok(
  wideBreak.gapYears > wideBreak.yearSpan,
  "the collapsed segment is shorter than the gap because context is kept on both sides"
);

assert.equal(normalizeTimeBreakOptions({}).label, "gap");
assert.equal(normalizeTimeBreakOptions({ label: "both" }).label, "both");
assert.equal(normalizeTimeBreakOptions({ label: "nonsense" }).label, "gap", "an unknown label falls back");
assert.deepEqual(TIME_BREAK_LABELS, ["gap", "removed", "both", "range", "none"]);
assert.equal(DEFAULT_HISTUI_CONFIG.timeline.timeBreaks.label, "gap");

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
