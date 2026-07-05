import { initializeAnalytics, trackAnalyticsEvent } from "./analytics.js";
import { DEFAULT_HISTUI_CONFIG } from "./default-config.js";
import { createDefaultFilters, filterRecords, normalizeFilters } from "./filters.js";
import { dirForLanguage, makeTranslator } from "./i18n.js";
import {
  collectFacets,
  escapeHtml,
  normalizePastStruct,
  normalizeRecord,
  textOf
} from "./paststruct.js";
import { TimelineView } from "./timeline-view.js";
import { applyTheme, getTheme } from "./theme.js";

export { initializeAnalytics, trackAnalyticsEvent } from "./analytics.js";
export { DEFAULT_HISTUI_CONFIG } from "./default-config.js";
export { createDefaultFilters, filterRecords, getDatasetBounds, normalizeFilters } from "./filters.js";
export { dirForLanguage, makeTranslator, UI_STRINGS } from "./i18n.js";
export * from "./paststruct.js";
export { TimelineView } from "./timeline-view.js";
export { applyTheme, getTheme, localizedThemeLabel } from "./theme.js";

export function createHistuiTimeline(options) {
  return new HistuiTimeline(options);
}

export class HistuiTimeline {
  constructor(options = {}) {
    if (!options.container) throw new Error("HistuiTimeline requires a container element or selector.");
    this.container = resolveContainer(options.container);
    this.options = {
      controls: true,
      replace: true,
      selectInitial: true,
      ...options
    };
    this.config = mergeConfig(DEFAULT_HISTUI_CONFIG, options.config || {});
    if (options.measurement) {
      this.config.timeline = this.config.timeline || {};
      this.config.timeline.measurement = mergeConfig(this.config.timeline.measurement || {}, options.measurement);
    }
    this.language = options.language || this.config.app.defaultLanguage || "en";
    this.direction = options.direction || dirForLanguage(this.language);
    this.t = options.translator || makeTranslator(this.language);
    this.themeId = options.themeId || this.config.app.defaultTheme;
    this.orientation = options.orientation || this.config.app.orientation || "auto";
    this.axisPlacement = {
      horizontal: options.axisPlacement?.horizontal || this.config.app.axisPlacement?.horizontal || "center",
      vertical: options.axisPlacement?.vertical || this.config.app.axisPlacement?.vertical || "side-start"
    };
    this.lodEnabled = options.lodEnabled ?? (this.config.timeline?.lod?.enabled !== false);
    this.explodeEnabled = options.explodeEnabled ?? (this.config.timeline?.explode?.enabled === true);
    this.dataset = null;
    this.records = [];
    this.filteredRecords = [];
    this.facets = {};
    this.filters = null;
    this.selected = null;
    this.viewport = null;

    this.handleControlClick = (event) => this.onControlClick(event);
    this.handleControlChange = (event) => this.onControlChange(event);

    this.mount();
    this.applyTheme(options.theme || getTheme(this.config, this.themeId));
    this.initializeAnalytics();

    if (options.data) this.setData(options.data, { filters: options.filters, resetView: true });
    else if (options.records) this.setRecords(options.records, { dataset: options.dataset, filters: options.filters, resetView: true });
    else this.timeline.setRecords([], { resetView: true });
    if (options.selectedId) this.select(options.selectedId, { emit: false });
  }

  mount() {
    if (this.options.replace) this.container.replaceChildren();
    this.root = document.createElement("div");
    this.root.className = "histui-timeline";
    this.root.lang = this.language;
    this.root.dir = this.direction;
    this.root.innerHTML = `
      <section class="histui-timeline-workbench">
        <header class="histui-timeline-head" data-histui-head></header>
        <div class="timeline-stage" data-histui-stage tabindex="0" aria-label="Interactive historical timeline">
          <canvas class="histui-timeline-canvas" data-histui-canvas aria-hidden="true"></canvas>
          <div class="timeline-cards" data-histui-cards></div>
          <div class="stage-hint" data-histui-hint></div>
        </div>
        <div class="timeline-zoom-bar" data-histui-zoom-bar aria-label="Timeline overview and zoom controls"></div>
      </section>
    `;
    this.container.append(this.root);
    this.head = this.root.querySelector("[data-histui-head]");
    this.stage = this.root.querySelector("[data-histui-stage]");
    this.canvas = this.root.querySelector("[data-histui-canvas]");
    this.cards = this.root.querySelector("[data-histui-cards]");
    this.hint = this.root.querySelector("[data-histui-hint]");
    this.zoomBar = this.root.querySelector("[data-histui-zoom-bar]");

    this.root.addEventListener("click", this.handleControlClick);
    this.root.addEventListener("change", this.handleControlChange);

    this.timeline = new TimelineView({
      stage: this.stage,
      canvas: this.canvas,
      cards: this.cards,
      hint: this.hint,
      zoomBar: this.zoomBar,
      themeRoot: this.root,
      config: this.config,
      t: this.t,
      language: this.language,
      direction: this.direction,
      onSelect: (record) => this.handleTimelineSelect(record),
      onViewportChange: (viewport) => {
        this.viewport = viewport;
        this.renderControls();
        this.options.onViewportChange?.(viewport, this);
      }
    });
    this.timeline.setOrientationSetting(this.orientation);
    this.timeline.setAxisPlacement("horizontal", this.axisPlacement.horizontal);
    this.timeline.setAxisPlacement("vertical", this.axisPlacement.vertical);
    this.timeline.setLodEnabled(this.lodEnabled);
    this.timeline.setExplodeEnabled(this.explodeEnabled);
    this.renderControls();
  }

  setData(data, { filters = null, resetView = true } = {}) {
    const normalized = normalizeTimelineData(data, {
      defaultLanguage: this.language,
      languages: this.config.app.languages || [this.language]
    });
    this.dataset = normalized.dataset;
    this.records = normalized.records;
    this.facets = collectFacets(this.records, this.language, normalized.fallbackLanguage);
    this.filters = normalizeFilters(filters || {}, createDefaultFilters(this.records, this.facets));
    this.applyFilters({ preserveView: !resetView });
    return this;
  }

  setRecords(records, { dataset = null, filters = null, resetView = true } = {}) {
    const normalized = normalizeRecordsInput(records, this.language, dataset?.id || "");
    this.dataset = dataset || {
      id: "records",
      title: { [this.language]: "Timeline" },
      defaultLanguage: this.language
    };
    this.records = normalized;
    this.facets = collectFacets(this.records, this.language, this.dataset.defaultLanguage || this.language);
    this.filters = normalizeFilters(filters || {}, createDefaultFilters(this.records, this.facets));
    this.applyFilters({ preserveView: !resetView });
    return this;
  }

  setFilters(filters, { preserveView = true } = {}) {
    this.filters = normalizeFilters(filters, this.filters || createDefaultFilters(this.records, this.facets));
    this.applyFilters({ preserveView });
    return this;
  }

  resetFilters({ preserveView = false } = {}) {
    this.filters = createDefaultFilters(this.records, this.facets);
    this.applyFilters({ preserveView });
    return this;
  }

  applyFilters({ preserveView = true } = {}) {
    this.filteredRecords = filterRecords(this.records, this.filters);
    this.timeline.setRecords(this.filteredRecords, { resetView: !preserveView });
    if (!this.selected || !this.filteredRecords.some((record) => record.id === this.selected.id)) {
      this.selected = null;
      if (this.options.selectInitial && this.filteredRecords.length) {
        this.selected = this.filteredRecords.find((record) => record.__meta.importance >= 9) || this.filteredRecords[0];
      }
    }
    if (this.selected) this.timeline.select(this.selected.id, false);
    this.renderControls();
    this.options.onRecordsChange?.(this.filteredRecords, this);
    return this;
  }

  select(recordId, { emit = true } = {}) {
    const record = this.records.find((entry) => entry.id === recordId) || null;
    if (!record) return this;
    this.selected = record;
    this.timeline.select(record.id, false);
    this.renderControls();
    if (emit) this.emitSelect(record);
    return this;
  }

  fit(options) {
    this.timeline.fit(options);
    return this;
  }

  zoomBy(factor) {
    this.timeline.zoomBy(factor);
    return this;
  }

  setViewRange(start, end, options) {
    this.timeline.setViewRange(start, end, options);
    return this;
  }

  setOrientation(orientation) {
    this.orientation = orientation;
    this.timeline.setOrientationSetting(orientation);
    this.renderControls();
    this.track("orientation_change", { orientation });
    return this;
  }

  setAxisPlacement(orientation, placement) {
    this.axisPlacement[orientation] = placement;
    this.timeline.setAxisPlacement(orientation, placement);
    this.renderControls();
    this.track("timeline_setting_change", { setting: `axis-${orientation}`, value: placement });
    return this;
  }

  setLodEnabled(enabled) {
    this.lodEnabled = Boolean(enabled);
    this.timeline.setLodEnabled(this.lodEnabled);
    this.renderControls();
    this.track("timeline_setting_change", { setting: "lod", value: this.lodEnabled });
    return this;
  }

  setExplodeEnabled(enabled) {
    this.explodeEnabled = Boolean(enabled);
    this.timeline.setExplodeEnabled(this.explodeEnabled);
    this.renderControls();
    this.track("timeline_setting_change", { setting: "explode", value: this.explodeEnabled });
    return this;
  }

  setMeasurementOptions(options = {}) {
    this.config.timeline = this.config.timeline || {};
    this.config.timeline.measurement = mergeConfig(this.config.timeline.measurement || {}, options);
    this.timeline.setMeasurementOptions(this.config.timeline.measurement);
    this.track("timeline_setting_change", { setting: "measurement", value: { ...this.config.timeline.measurement } });
    return this;
  }

  setMeasurementEnabled(enabled) {
    return this.setMeasurementOptions({ enabled: Boolean(enabled) });
  }

  setLanguage(language, direction = dirForLanguage(language)) {
    this.language = language;
    this.direction = direction;
    this.t = this.options.translator || makeTranslator(language);
    this.root.lang = language;
    this.root.dir = direction;
    this.timeline.setTranslator(this.t);
    this.timeline.setLanguage(language, direction);
    this.facets = collectFacets(this.records, language, this.dataset?.defaultLanguage || "en");
    this.renderControls();
    return this;
  }

  setTheme(themeOrId) {
    const theme = typeof themeOrId === "string" ? getTheme(this.config, themeOrId) : themeOrId;
    this.themeId = theme?.id || this.themeId;
    this.applyTheme(theme);
    this.timeline.render();
    return this;
  }

  applyTheme(theme) {
    applyTheme(theme, this.root);
  }

  getState() {
    return {
      dataset: this.dataset,
      records: this.records,
      filteredRecords: this.filteredRecords,
      facets: this.facets,
      filters: this.filters,
      selected: this.selected,
      viewport: this.viewport,
      language: this.language,
      direction: this.direction,
      themeId: this.themeId,
      orientation: this.orientation,
      axisPlacement: { ...this.axisPlacement },
      lodEnabled: this.lodEnabled,
      explodeEnabled: this.explodeEnabled,
      measurement: { ...(this.config.timeline?.measurement || {}) }
    };
  }

  destroy() {
    this.timeline.destroy();
    this.root.removeEventListener("click", this.handleControlClick);
    this.root.removeEventListener("change", this.handleControlChange);
    this.root.remove();
  }

  handleTimelineSelect(record) {
    this.selected = record || null;
    this.renderControls();
    if (record) this.emitSelect(record);
  }

  emitSelect(record) {
    this.options.onSelect?.(record, this);
    this.track("record_select", {
      dataset_id: this.dataset?.id || "",
      record_id: record.id,
      record_type: record.recordType
    });
  }

  onControlClick(event) {
    const action = event.target.closest("[data-histui-action]")?.dataset.histuiAction;
    if (!action) return;
    if (action === "zoom-in") this.zoomBy(0.72);
    if (action === "zoom-out") this.zoomBy(1.35);
    if (action === "fit") this.fit();
    this.track("timeline_action", { action });
  }

  onControlChange(event) {
    const control = event.target.closest("[data-histui-control]");
    if (!control) return;
    const name = control.dataset.histuiControl;
    if (name === "orientation") this.setOrientation(control.value);
    if (name === "axis-horizontal") this.setAxisPlacement("horizontal", control.value);
    if (name === "axis-vertical") this.setAxisPlacement("vertical", control.value);
    if (name === "lod") this.setLodEnabled(control.checked);
    if (name === "explode") this.setExplodeEnabled(control.checked);
  }

  renderControls() {
    if (!this.head) return;
    if (!this.options.controls) {
      this.root.classList.add("has-hidden-controls");
      this.head.hidden = true;
      return;
    }
    this.root.classList.remove("has-hidden-controls");
    this.head.hidden = false;
    const fallback = this.dataset?.defaultLanguage || this.language;
    const title = this.options.title || textOf(this.dataset?.title || this.dataset?.label, this.language, fallback) || "Histui";
    const description = this.options.description || textOf(this.dataset?.description, this.language, fallback);
    const viewport = this.viewport || {
      total: this.filteredRecords.length,
      visible: 0,
      hidden: 0,
      span: 0,
      orientation: this.orientation
    };
    const spanYears = Math.max(1, Math.round(viewport.span || 0));

    this.head.innerHTML = `
      <div class="histui-timeline-title">
        <p class="histui-eyebrow">${escapeHtml(this.t("currentView", { count: this.filteredRecords.length, total: this.records.length }))}</p>
        <h2>${escapeHtml(title)}</h2>
        ${description ? `<p>${escapeHtml(description)}</p>` : ""}
      </div>
      <div class="histui-timeline-actions">
        <button class="histui-icon-button" type="button" data-histui-action="zoom-out" title="${escapeHtml(this.t("zoomOut"))}">-</button>
        <button class="histui-icon-button" type="button" data-histui-action="zoom-in" title="${escapeHtml(this.t("zoomIn"))}">+</button>
        <button class="histui-text-button" type="button" data-histui-action="fit">${escapeHtml(this.t("fit"))}</button>
        <label class="histui-select-field">
          <span>${escapeHtml(this.t("orientation"))}</span>
          <select data-histui-control="orientation">${this.renderOrientationOptions()}</select>
        </label>
        <label class="histui-select-field">
          <span>${escapeHtml(this.t("horizontal"))} ${escapeHtml(this.t("axis"))}</span>
          <select data-histui-control="axis-horizontal">${this.renderAxisOptions(this.axisPlacement.horizontal)}</select>
        </label>
        <label class="histui-select-field">
          <span>${escapeHtml(this.t("vertical"))} ${escapeHtml(this.t("axis"))}</span>
          <select data-histui-control="axis-vertical">${this.renderAxisOptions(this.axisPlacement.vertical)}</select>
        </label>
        <label class="histui-toggle-pill">
          <input type="checkbox" data-histui-control="lod"${this.lodEnabled ? " checked" : ""}>
          <span>${escapeHtml(this.t("lod"))}</span>
        </label>
        <label class="histui-toggle-pill">
          <input type="checkbox" data-histui-control="explode"${this.explodeEnabled ? " checked" : ""}>
          <span>${escapeHtml(this.t("explode"))}</span>
        </label>
        <span class="histui-viewport-chip">${escapeHtml(this.t("zoomLevel", { span: spanYears }))}</span>
      </div>
    `;
  }

  renderOrientationOptions() {
    return [
      ["auto", this.t("auto")],
      ["horizontal", this.t("horizontal")],
      ["vertical", this.t("vertical")]
    ].map(([value, label]) => {
      return `<option value="${escapeHtml(value)}"${this.orientation === value ? " selected" : ""}>${escapeHtml(label)}</option>`;
    }).join("");
  }

  renderAxisOptions(active) {
    return [
      ["center", this.t("middle")],
      ["side-start", this.t("sideStart")],
      ["side-end", this.t("sideEnd")]
    ].map(([value, label]) => {
      return `<option value="${escapeHtml(value)}"${active === value ? " selected" : ""}>${escapeHtml(label)}</option>`;
    }).join("");
  }

  initializeAnalytics() {
    const measurementId = this.options.analytics?.measurementId || this.config.analytics?.googleAnalyticsMeasurementId;
    initializeAnalytics({ measurementId, appName: this.config.app?.name || "Histui" });
  }

  track(name, params = {}) {
    const payload = {
      app_name: this.config.app?.name || "Histui",
      ...params
    };
    this.options.onTrack?.(name, payload, this);
    trackAnalyticsEvent(name, payload);
  }
}

export function normalizeTimelineData(data, datasetConfig = {}) {
  if (Array.isArray(data)) {
    const records = normalizeRecordsInput(data, datasetConfig.defaultLanguage || "en", datasetConfig.id || "");
    return {
      dataset: {
        id: datasetConfig.id || "records",
        title: datasetConfig.title || { [datasetConfig.defaultLanguage || "en"]: "Timeline" },
        defaultLanguage: datasetConfig.defaultLanguage || "en",
        languages: datasetConfig.languages || [datasetConfig.defaultLanguage || "en"]
      },
      records,
      fallbackLanguage: datasetConfig.defaultLanguage || "en"
    };
  }
  return normalizePastStruct(data, datasetConfig);
}

function normalizeRecordsInput(records, fallbackLanguage = "en", datasetId = "") {
  return records
    .map((record) => record.__meta ? record : normalizeRecord(record, fallbackLanguage, datasetId))
    .sort((a, b) => a.__meta.start - b.__meta.start || a.__meta.importance - b.__meta.importance);
}

function resolveContainer(container) {
  if (typeof container !== "string") {
    if (!container?.append) throw new Error("Histui container must be an element or selector.");
    return container;
  }
  const element = document.querySelector(container);
  if (!element) throw new Error(`Histui container not found: ${container}`);
  return element;
}

function mergeConfig(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) return override ?? base;
  if (!isPlainObject(base) || !isPlainObject(override)) return override ?? base;
  const merged = { ...base };
  for (const [key, value] of Object.entries(override)) {
    merged[key] = mergeConfig(base[key], value);
  }
  return merged;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
