# Histui

Histui is a reusable, framework-agnostic interactive history timeline package. It can render PastStruct datasets or already-normalized records into a zoomable, pannable, responsive timeline with LOD, clustering, a zoom navigator, hover-linked connectors, axis placement controls, themes, Persian/English UI strings, and explode mode.

## Files

- `src/index.js` - public package API
- `src/index.d.ts` - public TypeScript declarations
- `src/styles.css` - required component styles
- `src/timeline-view.js` - low-level timeline renderer
- `src/paststruct.js` - PastStruct normalization helpers
- `examples/basic.html` - no-build browser example

## Basic Usage

```html
<link rel="stylesheet" href="/path/to/histui/src/styles.css">
<div id="timeline" style="height: 720px"></div>
<script type="module">
  import { createHistuiTimeline } from "/path/to/histui/src/index.js";

  const histui = createHistuiTimeline({
    container: "#timeline",
    data: pastStructDataset,
    language: "en",
    themeId: "obsidian-lab",
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
</script>
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

Keep this server running while editing package files. For testing the package inside `histui-app-2`, keep the app pointed at the local file dependency (`"histui": "file:../histui"`), run the app dev server in that repo, and reinstall there only after changing package metadata or dependency wiring.

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
} from "histui";
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
- `controls`: render built-in timeline controls. Default `true`.
- `replace`: clear the container before mounting. Default `true`.
- `filters`: initial filter object.
- `orientation`: `"auto"`, `"horizontal"`, or `"vertical"`.
- `axisPlacement`: `{ horizontal, vertical }`, each `"center"`, `"side-start"`, or `"side-end"`.
- `lodEnabled`: boolean.
- `explodeEnabled`: boolean.
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
- `fit(options)`
- `zoomBy(factor)`
- `setViewRange(start, end, options)`
- `setOrientation(orientation)`
- `setAxisPlacement(orientation, placement)`
- `setLodEnabled(enabled)`
- `setExplodeEnabled(enabled)`
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
      explode: {
        maxVisible: 42,
        layers: 8,
        animationMs: 700
      }
    }
  }
});
```

## Check

```bash
npm run check
```

## Publishing

See [PUBLISHING.md](./PUBLISHING.md) for the npm publishing checklist.
