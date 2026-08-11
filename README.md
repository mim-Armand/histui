# Histui

Histui is a reusable, framework-agnostic interactive history timeline package. It can render PastStruct datasets or already-normalized records into a zoomable, pannable, responsive timeline with LOD, clustering, a zoom navigator, hover-linked connectors, blueprint-style measurement indicators, axis placement controls, zoom-aware time breaks, keyboard record stepping, themes, broadcast display mode, Persian/English UI strings, and explode mode.

## Files

- `src/index.js` - public package API
- `src/index.d.ts` - public TypeScript declarations
- `src/styles.css` - required component styles
- `src/timeline-view.js` - low-level timeline renderer
- `src/time-scale.js` - piecewise year to unit mapping used by time breaks
- `src/paststruct.js` - PastStruct normalization helpers
- `examples/basic.html` - no-build browser example

## Basic Usage

Install the package from npm:

```bash
npm install @mim/histui
```

Import the JavaScript API and required stylesheet:

```js
import { createHistuiTimeline } from "@mim/histui";
import "@mim/histui/styles.css";

const histui = createHistuiTimeline({
  container: "#timeline",
  data: pastStructDataset,
  language: "en",
  themeId: "obsidian-lab",
  displayMode: "standard",
  explodeEnabled: false,
  onSelect(record) {
    console.log("selected", record.id);
  },
  onViewportChange(viewport) {
    console.log(viewport);
  }
});

histui.setExplodeEnabled(true);
histui.setFilters({ minSignificance: 7 });
```

## Local Development

Run the package directly from this repository when you want to develop `histui` itself and see source changes immediately in the browser:

```bash
npm run dev
```

Open [http://127.0.0.1:5175](http://127.0.0.1:5175). The dev server serves `examples/basic.html`, which imports `../src/index.js` and `../src/styles.css`, so it always uses the local package source instead of a published build.

Changes in `src/`, `examples/`, `README.md`, `PUBLISHING.md`, or `package.json` trigger an automatic browser reload. The server disables caching so style and JavaScript edits show up on the next reload without extra build steps.

Use a custom port when needed:

```bash
PORT=5180 npm run dev
```

Keep this server running while editing package files. For testing the package inside `histui-app-2`, run `npm run histui:local` in the app repo to point `@mim/histui` at `../histui`, then run `npm run histui:published` when you want to switch the app back to the published package.

## Public API

```js
import {
  HistuiTimeline,
  createHistuiTimeline,
  normalizeTimelineData,
  normalizePastStruct,
  createDefaultFilters,
  filterRecords,
  DEFAULT_HISTUI_CONFIG
} from "@mim/histui";
```

### `createHistuiTimeline(options)`

Creates and mounts a timeline instance.

Common options:

- `container`: CSS selector or element. Required.
- `data`: PastStruct dataset document, single PastStruct record, or array of records.
- `records`: normalized records or raw PastStruct record array.
- `config`: partial config merged with `DEFAULT_HISTUI_CONFIG`.
- `language`: default `"en"`.
- `direction`: optional text direction override.
- `themeId` or `theme`: built-in theme id or custom theme object.
- `displayMode`: `"standard"` or `"broadcast"`. Broadcast mode increases legibility and uses overlay-friendly timeline styling.
- `controls`: render built-in timeline controls. Default `true`.
- `replace`: clear the container before mounting. Default `true`.
- `filters`: initial filter object.
- `orientation`: `"auto"`, `"horizontal"`, or `"vertical"`.
- `axisPlacement`: `{ horizontal, vertical }`, each `"center"`, `"side-start"`, or `"side-end"`.
- `lodEnabled`: boolean.
- `explodeEnabled`: boolean.
- `timeBreaksEnabled`: boolean. Collapse empty stretches of time. See [Time Breaks](#time-breaks).
- `timeBreaks`: partial override for `config.timeline.timeBreaks`.
- `measurement`: optional override for `config.timeline.measurement`.
- `analytics.measurementId`: optional Google Analytics measurement id.
- `onSelect(record, instance)`: event callback.
- `onViewportChange(viewport, instance)`: event callback.
- `onRecordsChange(records, instance)`: event callback.
- `onTrack(name, payload, instance)`: analytics/telemetry callback.

### Instance Methods

- `setData(data, options)`
- `setRecords(records, options)`
- `setFilters(filters, options)`
- `resetFilters(options)`
- `select(recordId, options)`
- `focusRecord(recordId, options)`
- `stepSelection(direction)`
- `fit(options)`
- `zoomBy(factor)`
- `setViewRange(start, end, options)`
- `setOrientation(orientation)`
- `setAxisPlacement(orientation, placement)`
- `setLodEnabled(enabled)`
- `setExplodeEnabled(enabled)`
- `setTimeBreaksEnabled(enabled)`
- `setTimeBreakOptions(options)`
- `setMeasurementOptions(options)`
- `setMeasurementEnabled(enabled)`
- `setDisplayMode("standard" | "broadcast")`
- `setBroadcastMode(enabled)`
- `setLanguage(language, direction)`
- `setTheme(themeOrId)`
- `getState()`
- `destroy()`

## Filters

`setFilters()` accepts the same filter shape used internally:

```js
histui.setFilters({
  search: "revolution",
  recordTypes: ["event", "period"],
  types: ["political"],
  minSignificance: 6,
  mediaOnly: false,
  uncertainOnly: false,
  fromYear: 1800,
  toYear: 2026
});
```

Set-like fields can be arrays or `Set` instances.

## Config

The package exposes `DEFAULT_HISTUI_CONFIG`. You can override only the keys you need:

```js
createHistuiTimeline({
  container,
  data,
  config: {
    timeline: {
      measurement: {
        enabled: true,
        transient: true,
        fadeOutMs: 1200
      },
      explode: {
        maxVisible: 42,
        layers: 8,
        animationMs: 700
      }
    }
  }
});
```

`timeline.measurement.enabled` draws a dimension-style line across the currently visible timeline span and labels it with the visible year count. Set `timeline.measurement.transient` to `true` to show it only after the viewport changes; it fades out after `fadeOutMs` milliseconds, defaulting to `1200`.

## Time Breaks

Datasets that mix antiquity with the modern era leave huge empty stretches on a linear axis, so reaching the next record means panning through centuries of nothing. Time breaks collapse those empty stretches into short marked segments, which keeps the records spread across the frame at every zoom level.

```js
const histui = createHistuiTimeline({
  container: "#timeline",
  data: pastStructDataset,
  timeBreaksEnabled: true
});

histui.setTimeBreaksEnabled(false);
histui.setTimeBreakOptions({ minGapRatio: 0.1, collapsedRatio: 0.01 });
```

The built-in controls include a `Skip empty time` toggle. Each collapsed gap is drawn as a hatched band with zigzag edges and a chip labelled with the number of skipped years (for example `2.2K yr empty`). Hovering a chip shows the exact gap and the years on both sides; clicking it expands that one gap back to real scale, and clicking again collapses it. Expanded gaps stay expanded until the toggle, the dataset, or the options change.

Breaks follow the zoom. Whether a gap feels long depends on how much of the frame it takes, not on how many years it holds: 300 empty years are invisible across a millennium and half the screen across a century. Every threshold is therefore a fraction of the visible span, and the axis is re-cut whenever the zoom changes by more than `zoomSyncRatio`, so zooming in keeps cutting the newly dominant gaps instead of reopening the empty runs. Panning never re-cuts anything.

Behaviour is tuned through `config.timeline.timeBreaks`:

| Option | Default | Meaning |
| --- | --- | --- |
| `enabled` | `false` | Collapse empty time by default. |
| `minGapRatio` | `0.12` | Minimum gap size, as a fraction of the visible span, before it can be collapsed. |
| `minGapYears` | `0` | Absolute floor in years for a collapsible gap. |
| `collapsedRatio` | `0.022` | Width each collapsed gap keeps, as a fraction of the visible span. |
| `contextRatio` | `0.12` | Share of a gap left uncollapsed on each side, so records keep breathing room. |
| `maxBreaks` | `240` | Largest number of gaps to collapse; the widest gaps win. |
| `zoomSyncRatio` | `0.18` | How far the zoom must move before the axis is re-cut. Larger values re-cut less often. |

Gaps are computed from the merged coverage of the filtered records, so a long period spanning a quiet stretch prevents a break there. A re-cut keeps the zoom level and the year under the pointer fixed, so the pixels per year of dense time never jump; what changes is how much time the frame reaches, since collapsing a gap pulls the next records closer.

Years stay the unit of the public API: `setViewRange()`, `filters.fromYear`, axis labels, and the `start`, `end`, and `span` fields of `onViewportChange` are all real years. The viewport payload also reports `timeBreaksEnabled`, `breaks` (collapsed gaps currently in view), `breakCount` (collapsed gaps in the whole map), `skippedYears`, and `compressedSpan` for the internal compressed span.

The mapping itself is exported for custom axes or tooling:

```js
import { buildTimeScale, TimeScale, normalizeTimeBreakOptions, DEFAULT_TIME_BREAK_OPTIONS } from "@mim/histui";

// The fourth argument is the zoom level: how many units fit in the frame.
// Omit it to cut the axis as if the whole dataset were in view.
const scale = buildTimeScale(records, { start: -3000, end: 2026 }, { enabled: true }, { viewSpan: 400 });
scale.toUnit(1979); // compressed coordinate
scale.toYear(120); // back to a year
scale.breaks; // collapsed segments
```

## Keyboard

The timeline stage takes focus when clicked, and answers:

| Key | Action |
| --- | --- |
| `→` / `↓` | Select the next record in time and travel to it. |
| `←` / `↑` | Select the previous record and travel to it. |
| `Shift` + arrows | Pan the viewport without changing the selection. |
| `+` / `-` | Zoom in and out. |
| `Home` | Fit the whole dataset. |

Stepping keeps the current zoom, centres the record, and eases in and out of the move; the travel time grows with the distance covered, up to about twice `config.timeline.keyboardStepMs` (default `460`). Records longer than the frame widen it just enough to fit. Because breaks compress the empty time in between, a step across a collapsed gap is a short move rather than a long slide.

The same walk is available programmatically:

```js
histui.stepSelection(1); // next record
histui.stepSelection(-1); // previous record
histui.focusRecord("record-id"); // select and travel to a specific record
```

## Check

```bash
npm run check
```

## Publishing

See [PUBLISHING.md](./PUBLISHING.md) for the npm publishing checklist.
