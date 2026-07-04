import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

import {
  DEFAULT_HISTUI_CONFIG,
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
