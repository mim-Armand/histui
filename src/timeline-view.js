import {
  clamp,
  compactLabel,
  escapeHtml,
  formatExtent,
  formatYear,
  textOf
} from "./paststruct.js";
import { TimeScale, buildTimeScale, normalizeTimeBreakOptions } from "./time-scale.js";

const TYPE_SHAPES = {
  event: "circle",
  process: "capsule",
  period: "diamond",
  phenomenon: "hex",
  structure: "square"
};

const TYPE_VARIABLES = {
  event: "--type-event",
  process: "--type-process",
  period: "--type-period",
  phenomenon: "--type-phenomenon",
  structure: "--type-structure"
};

const MIN_BREAK_BAND_PX = 15;

export class TimelineView {
  constructor({ stage, canvas, cards, hint, zoomBar, themeRoot, config, t, language, direction, onSelect, onViewportChange }) {
    this.stage = stage;
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.cards = cards;
    this.hint = hint;
    this.zoomBar = zoomBar;
    this.themeRoot = themeRoot || stage.closest(".histui-timeline") || document.documentElement;
    this.config = config;
    this.t = t;
    this.language = language;
    this.direction = direction;
    this.onSelect = onSelect;
    this.onViewportChange = onViewportChange;

    this.records = [];
    this.idMap = new Map();
    this.selectedId = null;
    this.hoveredId = null;
    this.hoveredClusterId = null;
    this.expandedCluster = null;
    this.orientationSetting = config.app?.orientation || "auto";
    this.axisPlacement = {
      horizontal: config.app?.axisPlacement?.horizontal || "center",
      vertical: config.app?.axisPlacement?.vertical || "side-start"
    };
    this.lodEnabled = config.timeline?.lod?.enabled !== false;
    this.explodeEnabled = config.timeline?.explode?.enabled === true;
    this.timeBreaksEnabled = config.timeline?.timeBreaks?.enabled === true;
    this.yearDomain = { start: -100, end: 100 };
    this.yearExtent = { start: -100, end: 100 };
    this.timeScale = TimeScale.identity(this.yearDomain);
    this.expandedBreakIds = new Set();
    this.hoveredBreakId = null;
    this.breakCatalog = [];
    this.lastBreaks = [];
    this.breakMarksKey = "";
    // The view span the break map was cut for, so zoom changes can re-cut it.
    this.scaleViewSpan = 0;
    this.rescalingTimeScale = false;
    // domain, extent and view are axis units, not years: identical to years while
    // no break is active, compressed across empty stretches once breaks exist.
    this.domain = this.timeScale.unitDomain;
    this.extent = this.timeScale.unitDomain;
    this.view = this.timeScale.unitDomain;
    this.pointer = null;
    this.zoomPointer = null;
    this.kineticVelocity = 0;
    this.wheelVelocity = 0;
    this.animationFrame = 0;
    this.viewportAnimationFrame = 0;
    this.viewportAnimation = null;
    this.motionTimer = 0;
    this.explodeAnimationTimer = 0;
    this.measurementFadeTimer = 0;
    this.lastMeasurementKey = "";
    this.suppressMeasurementChange = false;
    this.lastFrame = 0;
    this.lastMetrics = null;
    this.lastItems = { all: [], display: [], hidden: [] };
    this.lastClusters = [];
    this.suppressStageClick = false;
    this.clusterTooltip = document.createElement("div");
    this.clusterTooltip.className = "cluster-tooltip";
    this.clusterTooltip.hidden = true;
    this.stage.append(this.clusterTooltip);
    this.breakTooltip = document.createElement("div");
    this.breakTooltip.className = "cluster-tooltip break-tooltip";
    this.breakTooltip.hidden = true;
    this.stage.append(this.breakTooltip);
    this.breakLayer = document.createElement("div");
    this.breakLayer.className = "histui-break-marks";
    this.stage.append(this.breakLayer);
    this.setupBreakLayer();
    this.setupMeasurementLine();
    this.stage.classList.toggle("is-explode-mode", this.explodeEnabled);
    this.setupZoomBar();

    this.boundRender = () => this.render();
    this.boundAnimate = (time) => this.animate(time);
    this.boundAnimateViewport = (time) => this.animateViewport(time);

    this.stage.addEventListener("wheel", (event) => this.handleWheel(event), { passive: false });
    this.stage.addEventListener("pointerdown", (event) => {
      this.claimKeyboardFocus();
      this.handlePointerDown(event);
    });
    this.stage.addEventListener("pointermove", (event) => this.handlePointerMove(event));
    this.stage.addEventListener("pointerup", (event) => this.handlePointerUp(event));
    this.stage.addEventListener("pointercancel", (event) => this.handlePointerUp(event));
    this.stage.addEventListener("pointerleave", () => this.setHovered(null, { source: "timeline" }));
    this.stage.addEventListener("mousemove", (event) => {
      if (!this.pointer && !event.target.closest("[data-record-id]")) this.handleTimelineHover(event);
    });
    this.stage.addEventListener("mouseleave", () => this.setHovered(null, { source: "timeline" }));
    this.stage.addEventListener("click", (event) => this.handleStageClick(event));
    this.stage.addEventListener("keydown", (event) => this.handleKeydown(event));
    this.cards.addEventListener("pointerdown", (event) => {
      if (event.target.closest("[data-record-id]")) event.stopPropagation();
    });
    this.cards.addEventListener("pointerup", (event) => {
      if (event.target.closest("[data-record-id]")) event.stopPropagation();
    });
    this.cards.addEventListener("pointerover", (event) => {
      const card = event.target.closest("[data-record-id]");
      if (!card) return;
      this.setHovered(card.dataset.recordId, { source: "card" });
    });
    this.cards.addEventListener("mouseover", (event) => {
      const card = event.target.closest("[data-record-id]");
      if (!card) return;
      this.setHovered(card.dataset.recordId, { source: "card" });
    });
    this.cards.addEventListener("pointerout", (event) => {
      const card = event.target.closest("[data-record-id]");
      if (!card || card.contains(event.relatedTarget)) return;
      this.setHovered(null, { source: "card" });
    });
    this.cards.addEventListener("mouseout", (event) => {
      const card = event.target.closest("[data-record-id]");
      if (!card || card.contains(event.relatedTarget)) return;
      this.setHovered(null, { source: "card" });
    });
    this.cards.addEventListener("click", (event) => {
      const card = event.target.closest("[data-record-id]");
      if (!card) return;
      event.preventDefault();
      event.stopPropagation();
      this.claimKeyboardFocus();
      const record = this.idMap.get(card.dataset.recordId);
      if (record) {
        if (this.expandedCluster && !this.expandedCluster.recordIds.includes(record.id)) {
          this.clearExpandedCluster({ render: false });
        }
        this.select(record.id, true);
      }
    });

    this.resizeObserver = new ResizeObserver(this.boundRender);
    this.resizeObserver.observe(this.stage);
    if (this.zoomBar) this.resizeObserver.observe(this.zoomBar);
  }

  setupZoomBar() {
    if (!this.zoomBar) return;
    const navigator = this.config.timeline?.navigator || {};
    if (navigator.enabled === false) {
      this.zoomBar.hidden = true;
      return;
    }

    this.zoomBar.dataset.zoomControl = "true";
    this.zoomBar.tabIndex = 0;
    this.zoomBar.setAttribute("role", "group");
    this.zoomBar.setAttribute("aria-label", this.t("timelineOverview"));
    this.zoomBar.innerHTML = `
      <canvas class="zoom-bar-canvas" aria-hidden="true"></canvas>
      <div class="zoom-window" data-zoom-role="window" aria-label="${escapeHtml(this.t("zoomWindow"))}">
        <span class="zoom-window-label" aria-hidden="true"></span>
        <button class="zoom-handle zoom-handle-start" type="button" data-zoom-role="handle-start" aria-label="${escapeHtml(this.t("from"))}"></button>
        <button class="zoom-handle zoom-handle-end" type="button" data-zoom-role="handle-end" aria-label="${escapeHtml(this.t("to"))}"></button>
      </div>
      <div class="zoom-selection" aria-label="${escapeHtml(this.t("zoomSelection"))}" hidden></div>
      <div class="zoom-labels" aria-hidden="true">
        <span class="zoom-label-start"></span>
        <span class="zoom-label-end"></span>
      </div>
    `;
    this.zoomCanvas = this.zoomBar.querySelector(".zoom-bar-canvas");
    this.zoomCtx = this.zoomCanvas.getContext("2d");
    this.zoomWindow = this.zoomBar.querySelector(".zoom-window");
    this.zoomWindowLabel = this.zoomBar.querySelector(".zoom-window-label");
    this.zoomSelection = this.zoomBar.querySelector(".zoom-selection");
    this.zoomLabelStart = this.zoomBar.querySelector(".zoom-label-start");
    this.zoomLabelEnd = this.zoomBar.querySelector(".zoom-label-end");

    this.zoomBar.addEventListener("pointerdown", (event) => this.handleZoomPointerDown(event));
    this.zoomBar.addEventListener("pointermove", (event) => this.handleZoomPointerMove(event));
    this.zoomBar.addEventListener("pointerup", (event) => this.handleZoomPointerUp(event));
    this.zoomBar.addEventListener("pointercancel", (event) => this.handleZoomPointerUp(event));
    this.zoomBar.addEventListener("keydown", (event) => this.handleZoomKeydown(event));
  }

  setupBreakLayer() {
    const idOf = (event) => event.target.closest("[data-break-id]")?.dataset.breakId || null;
    this.breakLayer.addEventListener("pointerover", (event) => this.setHoveredBreak(idOf(event)));
    this.breakLayer.addEventListener("pointerout", (event) => {
      const mark = event.target.closest("[data-break-id]");
      if (!mark || mark.contains(event.relatedTarget)) return;
      this.setHoveredBreak(null);
    });
    this.breakLayer.addEventListener("mouseleave", () => this.setHoveredBreak(null));
    this.breakLayer.addEventListener("click", (event) => {
      const id = idOf(event);
      if (!id) return;
      event.preventDefault();
      event.stopPropagation();
      this.toggleTimeBreak(id);
    });
  }

  setupMeasurementLine() {
    this.measurementLine = document.createElement("div");
    this.measurementLine.className = "histui-measurement-line";
    this.measurementLine.hidden = true;
    this.measurementLine.setAttribute("aria-hidden", "true");
    this.measurementLine.innerHTML = `
      <span class="histui-measurement-rule" aria-hidden="true">
        <span class="histui-measurement-arrow histui-measurement-arrow-start"></span>
        <span class="histui-measurement-arrow histui-measurement-arrow-end"></span>
      </span>
      <span class="histui-measurement-label"></span>
    `;
    this.measurementLabel = this.measurementLine.querySelector(".histui-measurement-label");
    this.stage.append(this.measurementLine);
  }

  setTranslator(t) {
    this.t = t;
    if (this.zoomBar) {
      this.zoomBar.setAttribute("aria-label", this.t("timelineOverview"));
    }
  }

  setLanguage(language, direction) {
    this.language = language;
    this.direction = direction;
    if (this.zoomBar) {
      this.zoomBar.setAttribute("aria-label", this.t("timelineOverview"));
      this.zoomWindow?.setAttribute("aria-label", this.t("zoomWindow"));
      this.zoomSelection?.setAttribute("aria-label", this.t("zoomSelection"));
      this.zoomBar.querySelector(".zoom-handle-start")?.setAttribute("aria-label", this.t("from"));
      this.zoomBar.querySelector(".zoom-handle-end")?.setAttribute("aria-label", this.t("to"));
    }
    this.render();
  }

  setOrientationSetting(value) {
    this.orientationSetting = value;
    this.render();
  }

  setAxisPlacement(orientation, value) {
    this.axisPlacement[orientation] = value;
    this.render();
  }

  setLodEnabled(value) {
    this.lodEnabled = value;
    this.clearExpandedCluster({ render: false });
    this.render();
  }

  setExplodeEnabled(value) {
    const nextValue = Boolean(value);
    if (nextValue === this.explodeEnabled) return;
    this.explodeEnabled = nextValue;
    this.clearExpandedCluster({ render: false });
    this.stage.classList.toggle("is-explode-mode", this.explodeEnabled);
    this.stage.classList.add("is-exploding");

    if (this.explodeAnimationTimer) window.clearTimeout(this.explodeAnimationTimer);
    this.explodeAnimationTimer = window.setTimeout(() => {
      this.explodeAnimationTimer = 0;
      this.stage.classList.remove("is-exploding");
      this.render();
    }, (this.config.timeline?.explode?.animationMs ?? 620) + 180);

    this.render();
  }

  setTimeBreaksEnabled(value) {
    const nextValue = Boolean(value);
    if (nextValue === this.timeBreaksEnabled) return;
    this.timeBreaksEnabled = nextValue;
    this.config.timeline = this.config.timeline || {};
    this.config.timeline.timeBreaks = {
      ...(this.config.timeline.timeBreaks || {}),
      enabled: nextValue
    };
    this.expandedBreakIds.clear();
    this.rebuildTimeScale();
  }

  setTimeBreakOptions(options = {}) {
    this.config.timeline = this.config.timeline || {};
    this.config.timeline.timeBreaks = {
      ...(this.config.timeline.timeBreaks || {}),
      ...options
    };
    this.timeBreaksEnabled = this.config.timeline.timeBreaks.enabled === true;
    this.expandedBreakIds.clear();
    this.rebuildTimeScale();
  }

  getTimeBreakOptions() {
    return normalizeTimeBreakOptions({
      ...(this.config.timeline?.timeBreaks || {}),
      enabled: this.timeBreaksEnabled
    });
  }

  setMeasurementOptions(options = {}) {
    this.config.timeline = this.config.timeline || {};
    this.config.timeline.measurement = {
      ...(this.config.timeline.measurement || {}),
      ...options
    };
    this.lastMeasurementKey = "";
    if (!this.getMeasurementConfig().enabled) this.hideMeasurementLine({ immediate: true });
    this.render();
  }

  setRecords(records, { resetView = false } = {}) {
    this.suppressMeasurementChange = true;
    const previousYears = this.records.length ? this.getViewYearRange() : null;
    this.records = records;
    this.idMap = new Map(records.map((record) => [record.id, record]));
    this.hoveredClusterId = null;
    this.hoveredBreakId = null;
    this.expandedCluster = null;
    this.expandedBreakIds.clear();
    this.scaleViewSpan = 0;
    this.computeDomain();
    if (resetView || !records.some((record) => record.id === this.selectedId)) {
      this.fit();
      return;
    }
    if (previousYears) this.view = this.unitRangeForYears(previousYears.start, previousYears.end);
    this.clampView();
    this.syncTimeScaleForZoom();
    this.render();
  }

  select(recordId, emit = false) {
    this.selectedId = recordId;
    this.render();
    if (emit) this.onSelect?.(this.idMap.get(recordId) || null);
  }

  recordsInTimeOrder() {
    return [...this.records].sort((a, b) =>
      a.__meta.start - b.__meta.start
      || a.__meta.end - b.__meta.end
      || String(a.id).localeCompare(String(b.id)));
  }

  /**
   * Selects the record before or after the current one and travels to it. Without a
   * selection the walk starts from whatever sits at the centre of the frame, so the
   * first press moves to the neighbouring record rather than jumping to the dataset edge.
   */
  stepRecord(direction = 1) {
    if (!this.records.length) return null;
    const ordered = this.recordsInTimeOrder();
    const step = direction >= 0 ? 1 : -1;
    let index = this.selectedId ? ordered.findIndex((record) => record.id === this.selectedId) : -1;

    if (index >= 0) {
      index = clamp(index + step, 0, ordered.length - 1);
    } else {
      const centerYear = this.timeScale.toYear((this.view.start + this.view.end) / 2);
      index = step > 0
        ? ordered.findIndex((record) => record.__meta.start > centerYear)
        : ordered.findLastIndex((record) => record.__meta.start < centerYear);
      if (index < 0) index = step > 0 ? ordered.length - 1 : 0;
    }

    const record = ordered[index];
    if (!record) return null;
    this.focusRecord(record.id, { emit: true });
    return record;
  }

  /**
   * Centres a record, keeping the current zoom unless the record is too long to fit.
   */
  focusRecord(recordId, { animate = true, emit = false } = {}) {
    const record = this.idMap.get(recordId);
    if (!record) return false;

    const span = Math.max(1, this.view.end - this.view.start);
    const startUnit = this.timeScale.toUnit(record.__meta.start);
    const endUnit = this.timeScale.toUnit(record.__meta.end);
    const center = (startUnit + endUnit) / 2;
    const recordSpan = Math.max(0, endUnit - startUnit);
    const targetSpan = recordSpan > span * 0.7 ? recordSpan * 1.45 : span;
    const travel = Math.abs(center - (this.view.start + this.view.end) / 2) / span;
    const base = this.config.timeline?.keyboardStepMs ?? 460;

    this.selectedId = recordId;
    this.setViewRange(center - targetSpan / 2, center + targetSpan / 2, {
      animate,
      clampTo: "domain",
      easing: "in-out",
      duration: base * clamp(0.7 + travel, 0.7, 2.1)
    });
    if (emit) this.onSelect?.(record);
    return true;
  }

  setHovered(recordId, { source = "timeline" } = {}) {
    const nextId = recordId && this.idMap.has(recordId) ? recordId : null;
    const nextClusterId = null;
    if (nextId === this.hoveredId && nextClusterId === this.hoveredClusterId && !this.hoveredBreakId) return;
    const needsCardRender = source === "timeline" || (nextId && !this.hasRenderedCard(nextId));
    this.hoveredId = nextId;
    this.hoveredClusterId = nextClusterId;
    this.hoveredBreakId = null;
    this.updateHoverCursor();
    this.render({ renderCards: needsCardRender });
    if (!needsCardRender) this.updateCardHighlightClasses();
  }

  setHoveredCluster(clusterId) {
    const nextId = clusterId && this.lastClusters.some((cluster) => cluster.id === clusterId) ? clusterId : null;
    if (nextId === this.hoveredClusterId && !this.hoveredId && !this.hoveredBreakId) return;
    this.hoveredId = null;
    this.hoveredClusterId = nextId;
    this.hoveredBreakId = null;
    this.updateHoverCursor();
    this.render({ renderCards: false });
  }

  setHoveredBreak(breakId) {
    const nextId = breakId && this.lastBreaks.some((entry) => entry.id === breakId) ? breakId : null;
    if (nextId === this.hoveredBreakId && !this.hoveredId && !this.hoveredClusterId) return;
    this.hoveredId = null;
    this.hoveredClusterId = null;
    this.hoveredBreakId = nextId;
    this.updateHoverCursor();
    this.render({ renderCards: false });
  }

  updateHoverCursor() {
    this.stage.classList.toggle("has-hit-hover", Boolean(this.hoveredId || this.hoveredClusterId || this.hoveredBreakId));
  }

  hasRenderedCard(recordId) {
    return [...this.cards.querySelectorAll("[data-record-id]")].some((card) => card.dataset.recordId === recordId);
  }

  zoomBy(factor) {
    const metrics = this.measure();
    const center = metrics.orientation === "horizontal" ? metrics.width / 2 : metrics.height / 2;
    this.zoomAtPoint(factor, center, metrics);
  }

  fit({ animate = false } = {}) {
    // Fitting makes the frame the whole domain, and the domain depends on how much of
    // the frame each gap takes, so let the two settle before moving the view.
    if (!this.rescalingTimeScale) {
      this.rescalingTimeScale = true;
      for (let pass = 0; pass < 3; pass += 1) {
        if (!this.rescaleForZoom(this.domain.end - this.domain.start)) break;
      }
      this.rescalingTimeScale = false;
    }
    const span = Math.max(1, this.domain.end - this.domain.start);
    this.setViewRange(this.domain.start, this.domain.end || this.domain.start + span, {
      animate,
      motion: false,
      sync: false
    });
  }

  computeDomain() {
    if (!this.records.length) {
      const now = new Date().getUTCFullYear();
      this.yearExtent = { start: now - 10, end: now + 10 };
      this.yearDomain = { start: now - 10, end: now + 10 };
      this.applyTimeScale(TimeScale.identity(this.yearDomain));
      return;
    }

    const starts = this.records.map((record) => record.__meta.start).filter(Number.isFinite);
    const ends = this.records.map((record) => record.__meta.end).filter(Number.isFinite);
    const min = Math.min(...starts, ...ends);
    const max = Math.max(...starts, ...ends);
    const rawSpan = Math.max(1, max - min);
    this.yearExtent = {
      start: min,
      end: max || min + rawSpan
    };
    // The scale spans the records only; padding is added in axis units so it stays
    // proportional to the drawn axis instead of to the raw (possibly mostly empty) years.
    this.yearDomain = { ...this.yearExtent };
    this.applyTimeScale(this.createTimeScale());
  }

  createTimeScale(viewSpan = this.scaleViewSpan) {
    const options = this.getTimeBreakOptions();
    if (!options.enabled) {
      this.breakCatalog = [];
      return TimeScale.identity(this.yearDomain);
    }

    const scale = buildTimeScale(this.records, this.yearDomain, options, { viewSpan });
    this.breakCatalog = scale.breaks.map((segment) => ({
      id: segment.id,
      startYear: segment.startYear,
      endYear: segment.endYear,
      unitSpan: segment.unitSpan
    }));
    for (const id of [...this.expandedBreakIds]) {
      if (!this.breakCatalog.some((entry) => entry.id === id)) this.expandedBreakIds.delete(id);
    }
    if (!this.expandedBreakIds.size) return scale;
    return new TimeScale(this.yearDomain, this.breakCatalog.filter((entry) => !this.expandedBreakIds.has(entry.id)));
  }

  applyTimeScale(scale) {
    this.timeScale = scale;
    this.extent = {
      start: scale.toUnit(this.yearExtent.start),
      end: scale.toUnit(this.yearExtent.end)
    };
    const span = Math.max(1, this.extent.end - this.extent.start);
    const paddingRatio = this.config.timeline?.defaultPaddingRatio ?? 0.08;
    const padding = Math.max(span * paddingRatio, Math.min(25, span));
    this.domain = {
      start: this.extent.start - padding,
      end: this.extent.end + padding
    };
  }

  rebuildTimeScale({ animate = false } = {}) {
    const previousYears = this.records.length ? this.getViewYearRange() : null;
    // Enabling breaks or changing their options keeps the visible years and cuts the
    // axis for the zoom the viewer is already at.
    const frame = this.scaleFrameFor(this.view.end - this.view.start);
    this.applyTimeScale(this.createTimeScale(frame));
    this.scaleViewSpan = this.timeBreaksEnabled ? frame : 0;
    this.hoveredBreakId = null;
    if (!previousYears) {
      this.fit();
      return;
    }
    const target = this.unitRangeForYears(previousYears.start, previousYears.end);
    if (animate) {
      this.setViewRange(target.start, target.end, { animate: true });
      return;
    }
    this.view = target;
    this.clampView();
    this.syncTimeScaleForZoom();
    this.render();
  }

  // The deepest allowed zoom is also the finest the axis is ever cut, which keeps a
  // request for a mostly empty range from chasing an ever smaller frame.
  scaleFrameFor(viewSpan) {
    return Math.max(viewSpan, this.config.timeline?.minZoomSpanYears || 2);
  }

  /**
   * Re-cuts the axis for a new zoom level. The unit span is kept, so the pixels per
   * dense year stay put and the frame simply reaches further once a gap collapses;
   * `anchorYear` stays at `anchorFraction` of the frame so the point under the
   * cursor (or the centre) does not slide while the map changes underneath.
   */
  rescaleForZoom(viewSpan, { anchorYear = null, anchorFraction = 0.5 } = {}) {
    if (!this.timeBreaksEnabled || !this.records.length || !(viewSpan > 0)) return false;
    const frame = this.scaleFrameFor(viewSpan);
    const previous = this.scaleViewSpan;
    const tolerance = 1 + this.getTimeBreakOptions().zoomSyncRatio;
    if (previous > 0 && frame < previous * tolerance && frame > previous / tolerance) return false;

    const anchor = Number.isFinite(anchorYear)
      ? anchorYear
      : this.timeScale.toYear((this.view.start + this.view.end) / 2);
    this.applyTimeScale(this.createTimeScale(frame));
    this.scaleViewSpan = frame;
    const start = this.timeScale.toUnit(anchor) - anchorFraction * viewSpan;
    this.view = { start, end: start + viewSpan };
    this.clampView();
    return true;
  }

  /**
   * Settles the map against the current zoom. Collapsing gaps shortens the domain,
   * which can clamp the view and change the zoom again, so a few passes run until
   * the span stops moving.
   */
  syncTimeScaleForZoom(anchor) {
    if (this.rescalingTimeScale) return false;
    // A navigator drag reads positions in units it captured when the gesture started,
    // so the axis waits until the handle is released before it is re-cut.
    if (this.zoomPointer) return false;
    this.rescalingTimeScale = true;
    let changed = false;
    try {
      for (let pass = 0; pass < 3; pass += 1) {
        if (!this.rescaleForZoom(this.view.end - this.view.start, pass === 0 ? anchor : undefined)) break;
        changed = true;
      }
    } finally {
      this.rescalingTimeScale = false;
    }
    return changed;
  }

  getViewYearRange() {
    return {
      start: this.timeScale.toYear(this.view.start),
      end: this.timeScale.toYear(this.view.end)
    };
  }

  unitRangeForYears(startYear, endYear) {
    return {
      start: this.timeScale.toUnit(startYear),
      end: this.timeScale.toUnit(endYear)
    };
  }

  setViewYearRange(startYear, endYear, options) {
    // Cutting the axis changes how many units those years take, which changes the zoom
    // the map should be cut for, so let the two settle before placing the view.
    for (let pass = 0; pass < 3; pass += 1) {
      const range = this.unitRangeForYears(startYear, endYear);
      if (!this.rescaleForZoom(range.end - range.start)) break;
    }
    const range = this.unitRangeForYears(startYear, endYear);
    this.setViewRange(range.start, range.end, { ...options, sync: false });
  }

  handleWheel(event) {
    event.preventDefault();
    const metrics = this.measure();
    const pointer = this.pointerToAxis(event, metrics);
    const delta = normalizeWheelDelta(event);

    if (event.ctrlKey || event.metaKey || event.altKey) {
      const factor = Math.exp(delta.y * 0.0017);
      this.zoomAtPoint(factor, pointer, metrics);
      return;
    }

    const axisDelta = metrics.orientation === "horizontal"
      ? Math.abs(delta.x) > Math.abs(delta.y) ? delta.x : delta.y
      : delta.y;
    const contentDelta = -axisDelta;
    this.panByPixels(contentDelta, metrics);
    this.wheelVelocity += contentDelta * 0.12;
    this.startAnimation();
  }

  handlePointerDown(event) {
    if (event.target.closest("[data-record-id], button, input, select, textarea, a")) return;
    this.stage.setPointerCapture(event.pointerId);
    const metrics = this.measure();
    const axis = this.pointerToAxis(event, metrics);
    this.pointer = {
      id: event.pointerId,
      axis,
      lastAxis: axis,
      lastTime: performance.now(),
      velocity: 0,
      moved: false
    };
    this.kineticVelocity = 0;
    this.stage.classList.add("is-dragging");
  }

  handlePointerMove(event) {
    if (!this.pointer) {
      if (!event.target.closest("[data-record-id]")) this.handleTimelineHover(event);
      return;
    }
    if (this.pointer.id !== event.pointerId) return;
    const metrics = this.measure();
    const axis = this.pointerToAxis(event, metrics);
    const now = performance.now();
    const delta = axis - this.pointer.lastAxis;
    const elapsed = Math.max(1, now - this.pointer.lastTime);

    if (Math.abs(delta) > 0.4) {
      this.pointer.moved = true;
      this.panByPixels(delta, metrics);
      this.pointer.velocity = delta / elapsed;
    }

    this.pointer.lastAxis = axis;
    this.pointer.lastTime = now;
  }

  handlePointerUp(event) {
    if (!this.pointer || this.pointer.id !== event.pointerId) return;
    this.stage.releasePointerCapture(event.pointerId);
    if (this.pointer.moved) {
      this.suppressStageClick = true;
      window.setTimeout(() => {
        this.suppressStageClick = false;
      }, 0);
    }
    this.kineticVelocity = this.pointer.moved ? this.pointer.velocity : 0;
    this.pointer = null;
    this.stage.classList.remove("is-dragging");
    this.startAnimation();
  }

  /**
   * Parks focus on the stage so the arrow keys keep stepping. Selecting a record
   * re-renders the cards, which removes the focused card button and would otherwise
   * drop focus back to the document.
   */
  claimKeyboardFocus() {
    if (document.activeElement === this.stage) return;
    this.stage.focus({ preventScroll: true });
  }

  handleStageClick(event) {
    if (this.suppressStageClick) return;
    if (event.target.closest("[data-record-id], button, input, select, textarea, a")) return;
    const hit = this.hitTestEvent(event);
    if (hit?.cluster) {
      this.expandCluster(hit.cluster);
      return;
    }
    if (hit?.break) {
      this.toggleTimeBreak(hit.break.id);
      return;
    }
    if (hit?.record) {
      if (this.expandedCluster && !this.expandedCluster.recordIds.includes(hit.record.id)) {
        this.clearExpandedCluster({ render: false });
      }
      this.select(hit.record.id, true);
      return;
    }
    this.clearExpandedCluster();
  }

  handleTimelineHover(event) {
    const hit = this.hitTestEvent(event);
    if (hit?.cluster) {
      this.setHoveredCluster(hit.cluster.id);
      return;
    }
    if (hit?.break) {
      this.setHoveredBreak(hit.break.id);
      return;
    }
    this.setHovered(hit?.record?.id || null, { source: "timeline" });
  }

  hitTestEvent(event) {
    const rect = this.stage.getBoundingClientRect();
    const point = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
    return this.hitTestPoint(point, this.measure());
  }

  handleKeydown(event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const metrics = this.measure();

    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      this.zoomBy(0.72);
      return;
    }
    if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      this.zoomBy(1.35);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      this.fit({ animate: true });
      return;
    }

    const back = event.key === "ArrowLeft" || event.key === "ArrowUp";
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    if (!back && !forward) return;
    event.preventDefault();

    // Plain arrows hop between records; Shift keeps the older nudge-the-viewport pan.
    if (event.shiftKey) {
      const panStep = (metrics.axisLength || 1) * 0.08;
      this.panByPixels(back ? panStep : -panStep, metrics);
      return;
    }
    if (this.cards.contains(document.activeElement)) this.claimKeyboardFocus();
    this.stepRecord(back ? -1 : 1);
  }

  handleZoomPointerDown(event) {
    if (!this.zoomBar || !this.records.length || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.cancelViewportAnimation();
    this.zoomBar.focus({ preventScroll: true });
    this.zoomBar.setPointerCapture(event.pointerId);

    const metrics = this.measureZoomBar();
    const unit = this.zoomClientToUnit(event, metrics);
    const role = event.target.closest("[data-zoom-role]")?.dataset.zoomRole || "select";
    const currentRange = this.getNavigatorViewRange();
    const mode = role === "handle-start"
      ? "start"
      : role === "handle-end"
        ? "end"
        : "select";

    this.zoomPointer = {
      id: event.pointerId,
      mode,
      startUnit: unit,
      currentUnit: unit,
      initialRange: currentRange,
      moved: false
    };
    this.kineticVelocity = 0;
    this.wheelVelocity = 0;
    this.zoomBar.classList.add("is-interacting", mode === "select" ? "is-selecting" : `is-${mode}`);

    if (mode === "select") this.updateZoomSelection(unit, unit, metrics);
    else this.hideZoomSelection();
  }

  handleZoomPointerMove(event) {
    if (!this.zoomPointer || this.zoomPointer.id !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();

    const metrics = this.measureZoomBar();
    const unit = this.zoomClientToUnit(event, metrics);
    const pointer = this.zoomPointer;
    const bounds = this.getNavigatorDomain();
    const minSpan = this.config.timeline?.minZoomSpanYears || 2;
    pointer.currentUnit = unit;
    pointer.moved = pointer.moved || Math.abs(this.zoomUnitToAxis(unit, metrics) - this.zoomUnitToAxis(pointer.startUnit, metrics)) > 2;

    if (pointer.mode === "select") {
      this.updateZoomSelection(pointer.startUnit, unit, metrics);
      return;
    }

    if (pointer.mode === "pan") {
      const span = pointer.initialRange.end - pointer.initialRange.start;
      const delta = unit - pointer.startUnit;
      let nextStart = pointer.initialRange.start + delta;
      let nextEnd = pointer.initialRange.end + delta;
      if (span >= bounds.end - bounds.start) {
        nextStart = bounds.start;
        nextEnd = bounds.end;
      } else if (nextStart < bounds.start) {
        nextEnd += bounds.start - nextStart;
        nextStart = bounds.start;
      } else if (nextEnd > bounds.end) {
        nextStart -= nextEnd - bounds.end;
        nextEnd = bounds.end;
      }
      this.setViewRange(nextStart, nextEnd, { clampTo: "navigator" });
      return;
    }

    if (pointer.mode === "start") {
      const fixedEnd = pointer.initialRange.end;
      const nextStart = clamp(unit, bounds.start, fixedEnd - minSpan);
      this.setViewRange(nextStart, fixedEnd, { clampTo: "navigator" });
      return;
    }

    if (pointer.mode === "end") {
      const fixedStart = pointer.initialRange.start;
      const nextEnd = clamp(unit, fixedStart + minSpan, bounds.end);
      this.setViewRange(fixedStart, nextEnd, { clampTo: "navigator" });
    }
  }

  handleZoomPointerUp(event) {
    if (!this.zoomPointer || this.zoomPointer.id !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    this.zoomBar.releasePointerCapture(event.pointerId);

    const pointer = this.zoomPointer;
    const metrics = this.measureZoomBar();
    this.zoomPointer = null;
    this.zoomBar.classList.remove("is-interacting", "is-selecting", "is-start", "is-end", "is-pan");

    if (pointer.mode === "select") {
      const startPx = this.zoomUnitToAxis(pointer.startUnit, metrics);
      const endPx = this.zoomUnitToAxis(pointer.currentUnit, metrics);
      const minPixels = this.config.timeline?.navigator?.minSelectionPixels ?? 10;
      this.hideZoomSelection();
      if (Math.abs(endPx - startPx) >= minPixels) {
        const nextStart = Math.min(pointer.startUnit, pointer.currentUnit);
        const nextEnd = Math.max(pointer.startUnit, pointer.currentUnit);
        this.setViewRange(nextStart, nextEnd, { animate: true, clampTo: "navigator" });
      }
      return;
    }

    if (this.syncTimeScaleForZoom()) this.render();
  }

  handleZoomKeydown(event) {
    if (!this.records.length) return;
    const range = this.getNavigatorViewRange();
    const span = range.end - range.start;
    const step = span * (event.shiftKey ? 0.25 : 0.08);

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      this.setViewRange(range.start - step, range.end - step, { clampTo: "navigator" });
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      this.setViewRange(range.start + step, range.end + step, { clampTo: "navigator" });
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      this.zoomNavigatorRange(0.72);
    } else if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      this.zoomNavigatorRange(1.35);
    } else if (event.key === "Home") {
      event.preventDefault();
      this.setViewRange(this.extent.start, this.extent.end, { animate: true, clampTo: "navigator" });
    }
  }

  startAnimation() {
    if (this.animationFrame) return;
    this.lastFrame = 0;
    this.animationFrame = requestAnimationFrame(this.boundAnimate);
  }

  markViewportMoving(duration = 180) {
    this.stage.classList.add("is-viewport-moving");
    if (this.motionTimer) window.clearTimeout(this.motionTimer);
    this.motionTimer = window.setTimeout(() => {
      this.motionTimer = 0;
      this.stage.classList.remove("is-viewport-moving");
    }, duration);
  }

  animate(time) {
    const inertia = this.config.timeline?.inertia || {};
    const enabled = inertia.enabled !== false;
    const friction = inertia.friction ?? 0.92;
    const wheelFriction = inertia.wheelFriction ?? 0.86;
    const minVelocity = inertia.minVelocity ?? 0.02;
    const elapsed = this.lastFrame ? Math.min(34, time - this.lastFrame) : 16;
    this.lastFrame = time;

    if (enabled && Math.abs(this.kineticVelocity) > minVelocity) {
      this.panByPixels(this.kineticVelocity * elapsed, this.measure());
      this.kineticVelocity *= Math.pow(friction, elapsed / 16);
    } else {
      this.kineticVelocity = 0;
    }

    if (enabled && Math.abs(this.wheelVelocity) > minVelocity) {
      this.panByPixels(this.wheelVelocity, this.measure());
      this.wheelVelocity *= Math.pow(wheelFriction, elapsed / 16);
    } else {
      this.wheelVelocity = 0;
    }

    if (Math.abs(this.kineticVelocity) > minVelocity || Math.abs(this.wheelVelocity) > minVelocity) {
      this.animationFrame = requestAnimationFrame(this.boundAnimate);
    } else {
      this.animationFrame = 0;
    }
  }

  panByPixels(deltaPixels, metrics = this.measure()) {
    this.cancelViewportAnimation();
    this.markViewportMoving();
    const span = this.view.end - this.view.start;
    const years = deltaPixels / Math.max(1, metrics.axisLength) * span;
    this.view.start -= years;
    this.view.end -= years;
    this.clampView();
    this.render();
  }

  zoomAtPoint(factor, axisPoint, metrics = this.measure()) {
    this.cancelViewportAnimation();
    this.clearExpandedCluster({ render: false });
    const span = this.view.end - this.view.start;
    const minSpan = this.config.timeline?.minZoomSpanYears || 2;
    const domainSpan = Math.max(1, this.domain.end - this.domain.start);
    const maxSpan = domainSpan * (this.config.timeline?.maxZoomMultiplier || 2.5);
    const nextSpan = clamp(span * factor, minSpan, maxSpan);
    const fraction = clamp((axisPoint - metrics.axisStart) / Math.max(1, metrics.axisLength), 0, 1);
    const focusUnit = this.view.start + fraction * span;

    const nextStart = focusUnit - fraction * nextSpan;
    this.setViewRange(nextStart, nextStart + nextSpan, {
      anchor: { anchorYear: this.timeScale.toYear(focusUnit), anchorFraction: fraction }
    });
  }

  zoomNavigatorRange(factor) {
    const range = this.getNavigatorViewRange();
    const center = (range.start + range.end) / 2;
    const nextSpan = (range.end - range.start) * factor;
    this.setViewRange(center - nextSpan / 2, center + nextSpan / 2, { animate: true, clampTo: "navigator" });
  }

  /**
   * `sync: false` is for callers that already settled the break map and want the view
   * placed exactly as asked, instead of having the zoom sync trade the freed pixels
   * for a wider reach.
   */
  setViewRange(start, end, { animate = false, clampTo = "domain", motion = true, anchor, duration, easing, sync = true } = {}) {
    const target = this.normalizeViewRange(start, end, clampTo);
    if (animate) {
      this.animateViewTo(target.start, target.end, { clampTo, duration, easing, anchor, sync });
      return;
    }

    this.cancelViewportAnimation();
    this.clearExpandedCluster({ render: false });
    if (motion) this.markViewportMoving();
    this.view = target;
    if (clampTo !== "navigator") this.clampView();
    if (sync) this.syncTimeScaleForZoom(anchor);
    this.render();
  }

  normalizeViewRange(start, end, clampTo = "domain") {
    const bounds = clampTo === "navigator" ? this.getNavigatorDomain() : this.domain;
    const boundsSpan = Math.max(1, bounds.end - bounds.start);
    const minSpan = Math.min(this.config.timeline?.minZoomSpanYears || 2, boundsSpan);
    let nextStart = Math.min(start, end);
    let nextEnd = Math.max(start, end);

    if (!Number.isFinite(nextStart) || !Number.isFinite(nextEnd)) {
      nextStart = bounds.start;
      nextEnd = bounds.end;
    }

    let span = nextEnd - nextStart;
    if (span < minSpan) {
      const center = (nextStart + nextEnd) / 2;
      nextStart = center - minSpan / 2;
      nextEnd = center + minSpan / 2;
      span = minSpan;
    }

    if (span >= boundsSpan) {
      return { start: bounds.start, end: bounds.end };
    }

    if (nextStart < bounds.start) {
      nextEnd += bounds.start - nextStart;
      nextStart = bounds.start;
    }
    if (nextEnd > bounds.end) {
      nextStart -= nextEnd - bounds.end;
      nextEnd = bounds.end;
    }

    return { start: nextStart, end: nextEnd };
  }

  animateViewTo(start, end, { clampTo = "navigator", duration, easing = "out", anchor, sync = true } = {}) {
    this.cancelViewportAnimation();
    this.clearExpandedCluster({ render: false });
    this.kineticVelocity = 0;
    this.wheelVelocity = 0;
    const target = this.normalizeViewRange(start, end, clampTo);
    const span = duration ?? this.config.timeline?.navigator?.animationMs ?? 420;
    this.markViewportMoving(span + 120);
    this.viewportAnimation = {
      from: { ...this.view },
      to: target,
      startTime: 0,
      duration: span,
      ease: easing === "in-out" ? easeInOutCubic : easeOutCubic,
      anchor,
      sync
    };
    this.viewportAnimationFrame = requestAnimationFrame(this.boundAnimateViewport);
  }

  animateViewport(time) {
    if (!this.viewportAnimation) return;
    if (!this.viewportAnimation.startTime) this.viewportAnimation.startTime = time;
    const { from, to, startTime, duration, ease, anchor, sync } = this.viewportAnimation;
    const progress = clamp((time - startTime) / Math.max(1, duration), 0, 1);
    const eased = ease(progress);
    this.view = {
      start: from.start + (to.start - from.start) * eased,
      end: from.end + (to.end - from.end) * eased
    };
    this.render();

    if (progress < 1) {
      this.viewportAnimationFrame = requestAnimationFrame(this.boundAnimateViewport);
      return;
    }

    this.viewportAnimationFrame = 0;
    this.viewportAnimation = null;
    this.view = to;
    // Re-cut the axis once the motion settles rather than mid-flight, so an animated
    // zoom never changes the geometry it is animating through.
    if (sync) this.syncTimeScaleForZoom(anchor);
    this.render();
  }

  cancelViewportAnimation() {
    if (this.viewportAnimationFrame) cancelAnimationFrame(this.viewportAnimationFrame);
    this.viewportAnimationFrame = 0;
    this.viewportAnimation = null;
  }

  clampView() {
    const span = Math.max(0.001, this.view.end - this.view.start);
    const minSpan = this.config.timeline?.minZoomSpanYears || 2;
    const domainSpan = Math.max(1, this.domain.end - this.domain.start);
    const maxSpan = domainSpan * (this.config.timeline?.maxZoomMultiplier || 2.5);
    let nextSpan = clamp(span, minSpan, maxSpan);
    const center = (this.view.start + this.view.end) / 2;
    this.view.start = center - nextSpan / 2;
    this.view.end = center + nextSpan / 2;

    if (nextSpan >= domainSpan) {
      const domainCenter = (this.domain.start + this.domain.end) / 2;
      this.view.start = domainCenter - nextSpan / 2;
      this.view.end = domainCenter + nextSpan / 2;
      return;
    }

    if (this.view.start < this.domain.start) {
      this.view.end += this.domain.start - this.view.start;
      this.view.start = this.domain.start;
    }
    if (this.view.end > this.domain.end) {
      this.view.start -= this.view.end - this.domain.end;
      this.view.end = this.domain.end;
    }
  }

  pointerToAxis(event, metrics) {
    const rect = this.stage.getBoundingClientRect();
    return metrics.orientation === "horizontal" ? event.clientX - rect.left : event.clientY - rect.top;
  }

  measure() {
    const rect = this.stage.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const orientation = this.orientationSetting === "auto"
      ? width >= height ? "horizontal" : "vertical"
      : this.orientationSetting;
    const margin = orientation === "horizontal"
      ? clamp(width * 0.06, 42, 92)
      : clamp(height * 0.055, 42, 82);
    const axisLength = Math.max(1, (orientation === "horizontal" ? width : height) - margin * 2);
    const placement = this.axisPlacement[orientation] || "center";
    const sideOffset = 74;
    const axisCoordinate = getAxisCoordinate({
      orientation,
      placement,
      width,
      height,
      direction: this.direction,
      sideOffset
    });

    const metrics = {
      width,
      height,
      orientation,
      placement,
      margin,
      axisStart: margin,
      axisEnd: margin + axisLength,
      axisLength,
      axisCoordinate
    };
    this.lastMetrics = metrics;
    return metrics;
  }

  unitToAxis(unit, metrics) {
    const span = this.view.end - this.view.start;
    return metrics.axisStart + ((unit - this.view.start) / span) * metrics.axisLength;
  }

  axisToUnit(axis, metrics) {
    const span = this.view.end - this.view.start;
    return this.view.start + ((axis - metrics.axisStart) / Math.max(1, metrics.axisLength)) * span;
  }

  yearToAxis(year, metrics) {
    return this.unitToAxis(this.timeScale.toUnit(year), metrics);
  }

  render({ renderCards = true } = {}) {
    const metrics = this.measure();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const pixelWidth = Math.floor(metrics.width * dpr);
    const pixelHeight = Math.floor(metrics.height * dpr);

    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
      this.canvas.style.width = `${metrics.width}px`;
      this.canvas.style.height = `${metrics.height}px`;
    }

    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.clearRect(0, 0, metrics.width, metrics.height);

    const colors = this.readColors();
    const items = this.computeItems(metrics);
    this.applyExplodeLayout(metrics, items.display);
    this.lastItems = items;
    this.lastClusters = [];
    this.drawGrid(metrics, colors);
    this.drawSpans(metrics, colors, items.all);
    this.drawRelationships(metrics, colors, items.all);
    this.drawCardConnectors(metrics, colors, items.display);
    this.drawMarkers(metrics, colors, items.all, items.display);
    this.drawClusters(metrics, colors, items.hidden);
    this.drawTimeBreaks(metrics, colors);
    this.renderBreakMarks();
    this.renderClusterTooltip(metrics);
    this.renderBreakTooltip(metrics);
    this.renderZoomBar(colors);
    this.renderMeasurementLine(metrics);
    if (renderCards) this.renderCards(metrics, items.display);
    else this.updateCardHighlightClasses();
    this.renderHint(metrics, items);
    this.stage.dataset.orientation = metrics.orientation;
    this.stage.classList.toggle("has-time-breaks", this.lastBreaks.length > 0);

    const viewYears = this.getViewYearRange();
    this.onViewportChange?.({
      orientation: metrics.orientation,
      placement: metrics.placement,
      start: viewYears.start,
      end: viewYears.end,
      span: viewYears.end - viewYears.start,
      compressedSpan: this.view.end - this.view.start,
      visible: items.display.length,
      hidden: items.hidden.length,
      total: this.records.length,
      lod: items.lod,
      timeBreaksEnabled: this.timeBreaksEnabled,
      breaks: this.lastBreaks.length,
      breakCount: this.timeScale.breaks.length,
      skippedYears: this.lastBreaks.reduce((total, entry) => total + entry.skippedYears, 0)
    });
  }

  renderZoomBar(colors = this.readColors()) {
    if (!this.zoomBar || !this.zoomCanvas || this.zoomBar.hidden) return;
    const metrics = this.measureZoomBar();
    if (metrics.width <= 1 || metrics.height <= 1) return;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const pixelWidth = Math.floor(metrics.width * dpr);
    const pixelHeight = Math.floor(metrics.height * dpr);
    if (this.zoomCanvas.width !== pixelWidth || this.zoomCanvas.height !== pixelHeight) {
      this.zoomCanvas.width = pixelWidth;
      this.zoomCanvas.height = pixelHeight;
      this.zoomCanvas.style.width = `${metrics.width}px`;
      this.zoomCanvas.style.height = `${metrics.height}px`;
    }

    const ctx = this.zoomCtx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, metrics.width, metrics.height);
    this.zoomBar.dataset.orientation = "horizontal";

    this.drawZoomGrid(ctx, metrics, colors);
    this.drawZoomEvents(ctx, metrics, colors);
    this.drawZoomBreaks(ctx, metrics, colors);
    this.updateZoomWindow(metrics);
    if (this.zoomPointer?.mode === "select") {
      this.updateZoomSelection(this.zoomPointer.startUnit, this.zoomPointer.currentUnit, metrics);
    }

    this.zoomLabelStart.textContent = formatYear(this.timeScale.toYear(metrics.domain.start), this.language, this.t);
    this.zoomLabelEnd.textContent = formatYear(this.timeScale.toYear(metrics.domain.end), this.language, this.t);
  }

  drawZoomGrid(ctx, metrics, colors) {
    const span = metrics.domain.end - metrics.domain.start;
    const step = chooseTickStep(span, metrics.axisLength);
    const baseline = metrics.axisY;

    ctx.save();
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(metrics.axisStart, baseline);
    ctx.lineTo(metrics.axisEnd, baseline);
    ctx.stroke();

    ctx.strokeStyle = colors.grid;
    ctx.globalAlpha = 0.44;
    const first = Math.ceil(metrics.domain.start / step) * step;
    for (let tick = first; tick <= metrics.domain.end + step * 0.5; tick += step) {
      const x = this.zoomUnitToAxis(tick, metrics);
      ctx.beginPath();
      ctx.moveTo(x, baseline - 18);
      ctx.lineTo(x, baseline + 18);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawZoomBreaks(ctx, metrics, colors) {
    if (!this.timeScale.hasBreaks) return;
    const baseline = metrics.axisY;
    ctx.save();
    for (const segment of this.timeScale.breaks) {
      const start = this.zoomUnitToAxis(segment.startUnit, metrics);
      const end = this.zoomUnitToAxis(segment.endUnit, metrics);
      const center = (start + end) / 2;
      const width = Math.max(end - start, 5);

      ctx.fillStyle = colors.panel || colors.background;
      ctx.globalAlpha = 0.92;
      ctx.fillRect(center - width / 2, baseline - 20, width, 40);

      ctx.strokeStyle = colors.accent2;
      ctx.globalAlpha = 0.62;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      for (const edge of [center - width / 2, center + width / 2]) {
        ctx.beginPath();
        ctx.moveTo(edge, baseline - 19);
        ctx.lineTo(edge, baseline + 19);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  drawZoomEvents(ctx, metrics, colors) {
    const range = this.getNavigatorViewRange();
    const viewStart = this.timeScale.toYear(Math.min(range.start, range.end));
    const viewEnd = this.timeScale.toYear(Math.max(range.start, range.end));
    const baseline = metrics.axisY;

    ctx.save();
    const sorted = [...this.records].sort((a, b) => a.__meta.importance - b.__meta.importance);
    for (const record of sorted) {
      const start = clamp(this.timeScale.toUnit(record.__meta.start), metrics.domain.start, metrics.domain.end);
      const end = clamp(this.timeScale.toUnit(record.__meta.end), metrics.domain.start, metrics.domain.end);
      const x = this.zoomUnitToAxis(start, metrics);
      const endX = this.zoomUnitToAxis(end, metrics);
      const color = this.colorForRecord(record, colors);
      const insideView = record.__meta.end >= viewStart && record.__meta.start <= viewEnd;
      const selected = record.id === this.selectedId;
      const height = clamp(5 + record.__meta.importance * 1.55, 9, 25);

      if (Math.abs(endX - x) > 2.5) {
        ctx.strokeStyle = color;
        ctx.lineWidth = selected ? 3 : clamp(record.__meta.importance * 0.35, 1.2, 4);
        ctx.globalAlpha = selected ? 0.95 : insideView ? 0.42 : 0.18;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(x, baseline);
        ctx.lineTo(endX, baseline);
        ctx.stroke();
      }

      ctx.strokeStyle = selected ? colors.text : color;
      ctx.lineWidth = selected ? 2.4 : clamp(record.__meta.importance * 0.16, 1, 2.2);
      ctx.globalAlpha = selected ? 1 : insideView ? 0.88 : 0.42;
      ctx.shadowColor = selected ? color : "transparent";
      ctx.shadowBlur = selected ? 10 : 0;
      ctx.beginPath();
      ctx.moveTo(x, baseline - height / 2);
      ctx.lineTo(x, baseline + height / 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  updateZoomWindow(metrics = this.measureZoomBar()) {
    if (!this.zoomWindow) return;
    const range = this.getNavigatorViewRange();
    const left = this.zoomUnitToAxis(range.start, metrics);
    const right = this.zoomUnitToAxis(range.end, metrics);
    const width = Math.max(12, right - left);
    this.zoomWindow.style.left = `${left}px`;
    this.zoomWindow.style.width = `${width}px`;
    const startYear = this.timeScale.toYear(range.start);
    const endYear = this.timeScale.toYear(range.end);
    this.zoomWindowLabel.textContent = `${formatYear(startYear, this.language, this.t)} - ${formatYear(endYear, this.language, this.t)}`;
  }

  updateZoomSelection(startUnit, endUnit, metrics = this.measureZoomBar()) {
    if (!this.zoomSelection) return;
    const start = this.zoomUnitToAxis(startUnit, metrics);
    const end = this.zoomUnitToAxis(endUnit, metrics);
    const left = Math.min(start, end);
    const width = Math.max(1, Math.abs(end - start));
    this.zoomSelection.style.left = `${left}px`;
    this.zoomSelection.style.width = `${width}px`;
    this.zoomSelection.hidden = false;
  }

  hideZoomSelection() {
    if (this.zoomSelection) this.zoomSelection.hidden = true;
  }

  measureZoomBar() {
    const rect = this.zoomBar?.getBoundingClientRect?.() || { width: 1, height: 1 };
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const inset = clamp(this.config.timeline?.navigator?.trackInsetPx ?? width * 0.035, 12, Math.max(12, width / 3));
    const axisStart = inset;
    const axisEnd = Math.max(axisStart + 1, width - inset);
    const domain = this.getNavigatorDomain();
    return {
      width,
      height,
      axisStart,
      axisEnd,
      axisLength: Math.max(1, axisEnd - axisStart),
      axisY: clamp(height * 0.48, 26, height - 24),
      domain
    };
  }

  getNavigatorDomain() {
    const start = Number.isFinite(this.extent.start) ? this.extent.start : this.domain.start;
    const end = Number.isFinite(this.extent.end) ? this.extent.end : this.domain.end;
    if (end <= start) return { start, end: start + 1 };
    return { start, end };
  }

  getNavigatorViewRange() {
    const bounds = this.getNavigatorDomain();
    const start = clamp(this.view.start, bounds.start, bounds.end);
    const end = clamp(this.view.end, bounds.start, bounds.end);
    if (end - start >= 1) return { start, end };
    const center = clamp((this.view.start + this.view.end) / 2, bounds.start, bounds.end);
    const minSpan = Math.min(this.config.timeline?.minZoomSpanYears || 2, bounds.end - bounds.start);
    return this.normalizeViewRange(center - minSpan / 2, center + minSpan / 2, "navigator");
  }

  zoomUnitToAxis(unit, metrics = this.measureZoomBar()) {
    const fraction = clamp((unit - metrics.domain.start) / Math.max(1, metrics.domain.end - metrics.domain.start), 0, 1);
    return metrics.axisStart + fraction * metrics.axisLength;
  }

  zoomAxisToUnit(axis, metrics = this.measureZoomBar()) {
    const fraction = clamp((axis - metrics.axisStart) / Math.max(1, metrics.axisLength), 0, 1);
    return metrics.domain.start + fraction * (metrics.domain.end - metrics.domain.start);
  }

  zoomClientToUnit(event, metrics = this.measureZoomBar()) {
    const rect = this.zoomBar.getBoundingClientRect();
    return this.zoomAxisToUnit(event.clientX - rect.left, metrics);
  }

  computeItems(metrics) {
    const span = this.view.end - this.view.start;
    const lod = this.getLod(span);
    const minSignificance = this.lodEnabled ? lod.minSignificance : 1;
    const activeClusterIds = this.getActiveClusterRecordIds();
    const viewYears = this.getViewYearRange();
    const all = this.records
      .filter((record) => record.__meta.end >= viewYears.start && record.__meta.start <= viewYears.end)
      .map((record) => ({
        record,
        axis: this.yearToAxis(record.__meta.start, metrics),
        endAxis: this.yearToAxis(record.__meta.end, metrics),
        importance: record.__meta.importance,
        selected: record.id === this.selectedId,
        hovered: record.id === this.hoveredId,
        clusterHighlighted: activeClusterIds.has(record.id)
      }))
      // Spans are kept when any part of them reaches the frame, so a long period
      // that starts far off-screen (or behind a collapsed gap) still renders.
      .filter((item) => Math.max(item.axis, item.endAxis) > metrics.axisStart - 80
        && Math.min(item.axis, item.endAxis) < metrics.axisEnd + 80);

    const spacing = this.cardSpacingFor(lod.labelMode);
    const occupied = [];
    const display = [];
    let hidden = [];
    const ranked = [...all].sort((a, b) => {
      if (a.selected !== b.selected) return a.selected ? -1 : 1;
      if (a.hovered !== b.hovered) return a.hovered ? -1 : 1;
      if (b.importance !== a.importance) return b.importance - a.importance;
      return a.record.__meta.start - b.record.__meta.start;
    });

    for (const item of ranked) {
      const importantEnough = item.importance >= minSignificance || item.selected;
      const hasRoom = !occupied.some((axis) => Math.abs(axis - item.axis) < spacing);
      if (!this.lodEnabled || item.selected || item.hovered || (importantEnough && hasRoom)) {
        display.push(item);
        occupied.push(item.axis);
      } else {
        hidden.push(item);
      }
    }

    if (this.expandedCluster?.recordIds?.length) {
      const expandedIds = new Set(this.expandedCluster.recordIds);
      const remainingHidden = [];
      let expandedOrder = 0;
      for (const item of hidden) {
        if (expandedIds.has(item.record.id)) {
          item.expandedClusterId = this.expandedCluster.id;
          item.expandedOrder = expandedOrder;
          item.expandedCount = this.expandedCluster.recordIds.length;
          expandedOrder += 1;
          display.push(item);
        } else {
          remainingHidden.push(item);
        }
      }
      hidden = remainingHidden;
    }

    if (this.explodeEnabled) {
      const capacity = this.explodeCapacity(metrics);
      const mustShow = display.filter((item) => item.selected || item.hovered);
      const mustShowIds = new Set(mustShow.map((item) => item.record.id));
      const rankedDisplay = display
        .filter((item) => !mustShowIds.has(item.record.id))
        .sort((a, b) => b.importance - a.importance || a.record.__meta.start - b.record.__meta.start);
      const keptDisplay = [...mustShow, ...rankedDisplay.slice(0, Math.max(0, capacity - mustShow.length))];
      const keptIds = new Set(keptDisplay.map((item) => item.record.id));
      const displayOverflow = display.filter((item) => !keptIds.has(item.record.id));
      const extraCapacity = Math.max(0, capacity - keptDisplay.length);
      const extraHidden = hidden
        .slice()
        .sort((a, b) => b.importance - a.importance || a.record.__meta.start - b.record.__meta.start)
        .slice(0, extraCapacity);
      const extraHiddenIds = new Set(extraHidden.map((item) => item.record.id));

      display.splice(0, display.length, ...keptDisplay, ...extraHidden);
      hidden = [
        ...displayOverflow,
        ...hidden.filter((item) => !extraHiddenIds.has(item.record.id))
      ];
    }

    display.sort((a, b) => a.record.__meta.start - b.record.__meta.start);
    if (this.explodeEnabled) {
      display.forEach((item, index) => {
        item.exploded = true;
        item.explodedIndex = index;
        item.explodedCount = display.length;
      });
    }
    return { all, display, hidden, lod };
  }

  explodeCapacity(metrics) {
    const explode = this.config.timeline?.explode || {};
    const maxVisible = Math.max(1, explode.maxVisible ?? 34);
    const minVisible = Math.min(maxVisible, Math.max(1, explode.minVisible ?? 10));
    const densityPixels = Math.max(4200, explode.densityPixels ?? 8800);
    const byArea = Math.floor((metrics.width * metrics.height) / densityPixels);
    const cardWidth = this.explodeCardWidth(metrics);
    const cardHeight = this.explodeCardHeight(metrics);
    const lanes = metrics.orientation === "horizontal"
      ? this.horizontalExplodeLanes(metrics, cardHeight)
      : this.verticalExplodeLanes(metrics, cardWidth);
    const perLane = metrics.orientation === "horizontal"
      ? Math.floor(metrics.width / (cardWidth + 12))
      : Math.floor(metrics.height / (cardHeight + 12));
    const laneCapacity = Math.max(1, lanes.length * Math.max(1, perLane));
    const safeMinimum = Math.min(minVisible, laneCapacity);
    return clamp(Math.min(byArea, laneCapacity), safeMinimum, maxVisible);
  }

  getLod(span) {
    const thresholds = this.config.timeline?.lod?.thresholds || [];
    const fallback = { spanYears: 0, minSignificance: 1, labelMode: "full" };
    return thresholds.find((threshold) => span >= threshold.spanYears) || fallback;
  }

  cardSpacingFor(labelMode) {
    if (!this.lodEnabled) return 190;
    if (labelMode === "icon") return 84;
    if (labelMode === "short") return 128;
    if (labelMode === "standard") return 172;
    return 216;
  }

  drawGrid(metrics, colors) {
    const ctx = this.ctx;
    const span = this.view.end - this.view.start;
    const step = chooseTickStep(span, metrics.axisLength);
    const minorStep = step / 5;
    const axis = metrics.axisCoordinate;
    const spans = this.timeScale.denseSpansForRange(this.view.start, this.view.end);
    const project = (year) => this.yearToAxis(year, metrics);
    const bands = this.breakBandRanges(metrics);

    ctx.save();
    ctx.lineWidth = 1;
    ctx.font = "11px var(--mono-font)";
    ctx.textBaseline = metrics.orientation === "horizontal" ? "top" : "middle";

    const labeler = (tick, axisPosition) => {
      const label = formatYear(tick, this.language, this.t);
      const reach = metrics.orientation === "horizontal" ? ctx.measureText(label).width / 2 + 5 : 9;
      const hidden = bands.some((band) => axisPosition + reach > band.from - 4 && axisPosition - reach < band.to + 4);
      if (hidden) return;
      ctx.save();
      ctx.fillStyle = colors.muted;
      ctx.globalAlpha = 0.82;
      if (metrics.orientation === "horizontal") {
        const labelY = axis + (metrics.placement === "side-end" ? -28 : 18);
        ctx.textAlign = "center";
        ctx.fillText(label, axisPosition, labelY);
      } else {
        const labelX = axis + (metrics.placement === "side-end" ? -18 : 18) * (this.direction === "rtl" ? -1 : 1);
        ctx.textAlign = labelX < axis ? "right" : "left";
        ctx.fillText(label, labelX, axisPosition);
      }
      ctx.restore();
    };

    for (const denseSpan of spans) {
      drawTicks(ctx, metrics, denseSpan, minorStep, colors.grid, 0.28, project, null);
      drawTicks(ctx, metrics, denseSpan, step, colors.grid, 0.55, project, labeler);
    }

    ctx.strokeStyle = colors.line;
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = 1.4;
    for (const denseSpan of spans) {
      const from = clamp(this.unitToAxis(denseSpan.unitStart, metrics), metrics.axisStart, metrics.axisEnd);
      const to = clamp(this.unitToAxis(denseSpan.unitEnd, metrics), metrics.axisStart, metrics.axisEnd);
      if (to - from < 0.5) continue;
      ctx.beginPath();
      if (metrics.orientation === "horizontal") {
        ctx.moveTo(from, axis);
        ctx.lineTo(to, axis);
      } else {
        ctx.moveTo(axis, from);
        ctx.lineTo(axis, to);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  breakBandRanges(metrics) {
    if (!this.timeBreaksEnabled) return [];
    return this.timeScale.breaksForRange(this.view.start, this.view.end).map((segment) => {
      const start = this.unitToAxis(segment.startUnit, metrics);
      const end = this.unitToAxis(segment.endUnit, metrics);
      const center = (start + end) / 2;
      const width = Math.max(end - start, MIN_BREAK_BAND_PX);
      return { from: center - width / 2, to: center + width / 2 };
    });
  }

  drawTimeBreaks(metrics, colors) {
    this.lastBreaks = [];
    if (!this.timeBreaksEnabled) return;
    const entries = [
      ...this.timeScale.breaksForRange(this.view.start, this.view.end).map((segment) => ({
        kind: "collapsed",
        id: segment.id,
        startYear: segment.startYear,
        endYear: segment.endYear,
        years: Math.max(1, Math.round(segment.yearSpan - segment.unitSpan)),
        startAxis: this.unitToAxis(segment.startUnit, metrics),
        endAxis: this.unitToAxis(segment.endUnit, metrics)
      })),
      ...this.breakCatalog
        .filter((entry) => this.expandedBreakIds.has(entry.id))
        .map((entry) => ({
          kind: "expanded",
          id: entry.id,
          startYear: entry.startYear,
          endYear: entry.endYear,
          years: Math.max(1, Math.round(entry.endYear - entry.startYear)),
          startAxis: this.yearToAxis(entry.startYear, metrics),
          endAxis: this.yearToAxis(entry.endYear, metrics)
        }))
    ];
    if (!entries.length) return;

    const horizontal = metrics.orientation === "horizontal";
    const reach = clamp((horizontal ? metrics.height : metrics.width) * 0.3, 48, 190);
    const obstacles = this.cardBoxes(metrics);

    for (const entry of entries) {
      const collapsed = entry.kind === "collapsed";
      const center = (entry.startAxis + entry.endAxis) / 2;
      const width = collapsed ? Math.max(entry.endAxis - entry.startAxis, MIN_BREAK_BAND_PX) : entry.endAxis - entry.startAxis;
      const from = collapsed ? center - width / 2 : entry.startAxis;
      const to = collapsed ? center + width / 2 : entry.endAxis;
      if (to < metrics.axisStart - 16 || from > metrics.axisEnd + 16) continue;

      const visibleFrom = Math.max(from, metrics.axisStart + 4);
      const visibleTo = Math.min(to, metrics.axisEnd - 4);
      const anchor = visibleTo > visibleFrom ? clamp(center, visibleFrom, visibleTo) : center;
      const resolved = {
        ...entry,
        from,
        to,
        axis: anchor,
        highlighted: entry.id === this.hoveredBreakId
      };
      resolved.label = this.breakChipLabel(resolved);
      resolved.chip = this.placeBreakChip(metrics, resolved, obstacles);
      obstacles.push(resolved.chip);
      resolved.bbox = collapsed
        ? horizontal
          ? {
              left: from - 9,
              right: to + 9,
              top: metrics.axisCoordinate - reach,
              bottom: metrics.axisCoordinate + reach
            }
          : {
              left: metrics.axisCoordinate - reach,
              right: metrics.axisCoordinate + reach,
              top: from - 9,
              bottom: to + 9
            }
        : null;
      this.drawBreakMark(metrics, colors, resolved);
      this.lastBreaks.push(resolved);
    }
  }

  /**
   * Boxes the visible cards will occupy, so a break chip can dodge them. Cards are
   * laid out after the canvas pass, so the placement is recomputed here instead of
   * measuring the DOM, which would force a reflow on every frame.
   */
  cardBoxes(metrics) {
    const mode = this.getLod(this.view.end - this.view.start).labelMode;
    const compact = this.lodEnabled && (mode === "icon" || mode === "short");
    return (this.lastItems?.display || []).map((item, index) => {
      const placement = this.cardPlacement(metrics, item, index, compact);
      const left = placement.shiftX === "-100%"
        ? placement.x - placement.width
        : placement.shiftX === "-50%"
          ? placement.x - placement.width / 2
          : placement.x;
      const top = placement.y - placement.height / 2;
      return { left, right: left + placement.width, top, bottom: top + placement.height };
    });
  }

  placeBreakChip(metrics, entry, obstacles) {
    const width = entry.label.length * 6.6 + 40;
    const height = 27;
    let position = this.breakLabelAnchor(metrics, entry, 0);
    for (let rank = 1; rank <= 6 && obstacles.some((box) => boxOverlapsChip(box, position, width, height)); rank += 1) {
      position = this.breakLabelAnchor(metrics, entry, rank);
    }
    return {
      x: position.x,
      y: position.y,
      left: position.x - width / 2,
      right: position.x + width / 2,
      top: position.y - height / 2,
      bottom: position.y + height / 2
    };
  }

  renderBreakMarks() {
    if (!this.breakLayer) return;
    if (!this.lastBreaks.length) {
      if (this.breakMarksKey) {
        this.breakLayer.replaceChildren();
        this.breakMarksKey = "";
      }
      return;
    }

    // Rebuild only when the set of breaks changes; position and highlight updates
    // happen in place so panning and hovering never replace a node under the pointer.
    const key = this.lastBreaks.map((entry) => `${entry.id}:${entry.kind}:${entry.label}`).join("|");
    if (key !== this.breakMarksKey) {
      this.breakMarksKey = key;
      this.breakLayer.innerHTML = this.lastBreaks.map((entry) => {
        const collapsed = entry.kind === "collapsed";
        const description = `${this.t("timeBreakYears", { years: formatCount(entry.years, this.language) })} · ${this.t(collapsed ? "timeBreakHint" : "timeBreakCollapseHint")}`;
        return `
          <button class="histui-break-mark ${collapsed ? "is-collapsed" : "is-expanded"}" type="button" data-break-id="${escapeHtml(entry.id)}" aria-label="${escapeHtml(description)}" style="--x:${Math.round(entry.chip.x)}px;--y:${Math.round(entry.chip.y)}px;">
            <span class="histui-break-glyph" aria-hidden="true">${collapsed ? "⌇" : "⤢"}</span>
            <span>${escapeHtml(entry.label)}</span>
          </button>
        `;
      }).join("");
    }

    for (const mark of this.breakLayer.children) {
      const entry = this.lastBreaks.find((candidate) => candidate.id === mark.dataset.breakId);
      if (!entry) continue;
      mark.style.setProperty("--x", `${Math.round(entry.chip.x)}px`);
      mark.style.setProperty("--y", `${Math.round(entry.chip.y)}px`);
      mark.classList.toggle("is-hovered", entry.highlighted);
    }
  }

  breakChipLabel(entry) {
    const years = formatCompactCount(entry.years, this.language);
    return entry.kind === "collapsed"
      ? this.t("timeBreakSkipped", { years })
      : this.t("timeBreakEmpty", { years });
  }

  drawBreakMark(metrics, colors, entry) {
    const ctx = this.ctx;
    const horizontal = metrics.orientation === "horizontal";
    const axis = metrics.axisCoordinate;
    const cross = horizontal ? metrics.height : metrics.width;
    const collapsed = entry.kind === "collapsed";
    const accent = entry.highlighted ? colors.accent2 : collapsed ? colors.line : colors.grid;
    const fade = (color, peak) => crossFadeGradient(ctx, { horizontal, cross, axis, color, peak });
    const band = (color) => {
      ctx.fillStyle = color;
      if (horizontal) ctx.fillRect(entry.from, 0, entry.to - entry.from, cross);
      else ctx.fillRect(0, entry.from, cross, entry.to - entry.from);
    };

    ctx.save();
    if (collapsed) {
      band(fade(colors.background, 0.97));
      band(fade(entry.highlighted ? colors.accent2 : colors.grid, entry.highlighted ? 0.2 : 0.12));
    } else if (entry.highlighted) {
      band(fade(colors.accent2, 0.08));
    }

    ctx.strokeStyle = fade(accent, entry.highlighted ? 0.95 : collapsed ? 0.7 : 0.45);
    ctx.lineWidth = entry.highlighted ? 1.8 : 1.2;
    ctx.lineJoin = "round";
    if (collapsed) {
      drawZigzag(ctx, { horizontal, edge: entry.from, cross, amplitude: 3.2, wave: 11 });
      drawZigzag(ctx, { horizontal, edge: entry.to, cross, amplitude: 3.2, wave: 11 });
    } else {
      ctx.setLineDash([4, 6]);
      for (const edge of [entry.from, entry.to]) {
        if (edge < metrics.axisStart - 8 || edge > metrics.axisEnd + 8) continue;
        ctx.beginPath();
        if (horizontal) {
          ctx.moveTo(edge, 0);
          ctx.lineTo(edge, cross);
        } else {
          ctx.moveTo(0, edge);
          ctx.lineTo(cross, edge);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    if (collapsed) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = entry.highlighted ? colors.accent2 : colors.accent4;
      ctx.lineWidth = entry.highlighted ? 2.2 : 1.6;
      const reach = 9;
      ctx.beginPath();
      if (horizontal) {
        ctx.moveTo(entry.from, axis - reach);
        ctx.lineTo(entry.from, axis + reach);
        ctx.moveTo(entry.to, axis - reach);
        ctx.lineTo(entry.to, axis + reach);
      } else {
        ctx.moveTo(axis - reach, entry.from);
        ctx.lineTo(axis + reach, entry.from);
        ctx.moveTo(axis - reach, entry.to);
        ctx.lineTo(axis + reach, entry.to);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  breakLabelAnchor(metrics, entry, rank = 0) {
    const axis = metrics.axisCoordinate;
    const tier = Math.ceil(rank / 2);
    const mirrored = rank % 2 === 1;
    if (metrics.orientation === "horizontal") {
      // Odd ranks mirror the chip across the axis, even ranks push it further out.
      // Either way it stays on the band, which spans the whole frame.
      const side = (metrics.placement === "side-end" ? 1 : -1) * (mirrored ? -1 : 1);
      const distance = 32 + (mirrored ? tier - 1 : tier) * 30;
      return {
        x: clamp(entry.axis, 58, Math.max(58, metrics.width - 58)),
        y: clamp(axis + side * distance, 16, Math.max(16, metrics.height - 16))
      };
    }
    // Vertical layout keeps the chip on the axis itself: the axis is visibly cut
    // there and the card lanes start further out, so nothing important is covered.
    return {
      x: clamp(axis, 46, Math.max(46, metrics.width - 46)),
      y: clamp(entry.axis + (mirrored ? -1 : 1) * tier * 30, 14, Math.max(14, metrics.height - 14))
    };
  }

  toggleTimeBreak(breakId) {
    if (!breakId || !this.breakCatalog.some((entry) => entry.id === breakId)) return;
    if (this.expandedBreakIds.has(breakId)) this.expandedBreakIds.delete(breakId);
    else this.expandedBreakIds.add(breakId);
    this.hoveredBreakId = null;
    this.rebuildTimeScale({ animate: true });
  }

  drawSpans(metrics, colors, items) {
    const ctx = this.ctx;
    const axis = metrics.axisCoordinate;
    ctx.save();
    for (const item of sortHighlightLast(items)) {
      const durationPixels = Math.abs(item.endAxis - item.axis);
      if (durationPixels < 6) continue;
      const color = this.colorForRecord(item.record, colors);
      const highlighted = item.selected || item.hovered || item.clusterHighlighted;
      ctx.strokeStyle = color;
      ctx.lineWidth = highlighted
        ? clamp(item.importance * 0.9, 5, 13)
        : clamp(item.importance * 0.65, 3, 9);
      ctx.globalAlpha = item.selected ? 0.88 : highlighted ? 0.82 : (this.hoveredId || this.hoveredClusterId) ? 0.16 : 0.34;
      ctx.lineCap = "round";
      ctx.shadowColor = highlighted ? color : "transparent";
      ctx.shadowBlur = highlighted ? 18 : 0;
      ctx.beginPath();
      if (metrics.orientation === "horizontal") {
        ctx.moveTo(item.axis, axis);
        ctx.lineTo(item.endAxis, axis);
      } else {
        ctx.moveTo(axis, item.axis);
        ctx.lineTo(axis, item.endAxis);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  drawRelationships(metrics, colors, items) {
    const ctx = this.ctx;
    const axis = metrics.axisCoordinate;
    const visibleById = new Map(items.map((item) => [item.record.id, item]));
    ctx.save();
    ctx.strokeStyle = colors.accent4;
    ctx.lineWidth = 0.9;
    ctx.globalAlpha = 0.2;

    for (const item of sortHighlightLast(items)) {
      for (const relationship of item.record.relationships || []) {
        const target = visibleById.get(relationship.target);
        if (!target) continue;
        const highlighted = item.record.id === this.hoveredId ||
          target.record.id === this.hoveredId ||
          item.clusterHighlighted ||
          target.clusterHighlighted;
        const distance = Math.abs(target.axis - item.axis);
        if (distance < 18) continue;
        const bow = clamp(distance * 0.16, 22, 82);
        ctx.strokeStyle = highlighted ? this.colorForRecord(item.record, colors) : colors.accent4;
        ctx.lineWidth = highlighted ? 1.8 : 0.9;
        ctx.globalAlpha = highlighted ? 0.62 : (this.hoveredId || this.hoveredClusterId) ? 0.1 : 0.2;
        ctx.beginPath();
        if (metrics.orientation === "horizontal") {
          const direction = target.axis > item.axis ? 1 : -1;
          const y = axis + (item.importance % 2 ? -bow : bow);
          ctx.moveTo(item.axis, axis);
          ctx.quadraticCurveTo((item.axis + target.axis) / 2, y, target.axis - direction * 4, axis);
        } else {
          const direction = target.axis > item.axis ? 1 : -1;
          const x = axis + (item.importance % 2 ? -bow : bow);
          ctx.moveTo(axis, item.axis);
          ctx.quadraticCurveTo(x, (item.axis + target.axis) / 2, axis, target.axis - direction * 4);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawCardConnectors(metrics, colors, displayItems) {
    if (!displayItems.length) return;
    const ctx = this.ctx;
    const mode = this.getLod(this.view.end - this.view.start).labelMode;
    const compact = this.lodEnabled && (mode === "icon" || mode === "short");

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    sortHighlightLast(displayItems).forEach((item) => {
      const index = displayItems.indexOf(item);
      const placement = this.cardPlacement(metrics, item, index, compact);
      const color = this.colorForRecord(item.record, colors);
      const markerSize = clamp(4 + item.importance * 0.75, 7, 14);
      const marker = metrics.orientation === "horizontal"
        ? { x: item.axis, y: metrics.axisCoordinate }
        : { x: metrics.axisCoordinate, y: item.axis };
      const path = connectorPath(metrics, marker, placement, markerSize);
      const highlighted = item.selected || item.hovered || item.clusterHighlighted;
      const exploded = this.explodeEnabled && item.exploded;

      ctx.strokeStyle = color;
      ctx.lineWidth = highlighted ? 2.8 : exploded ? 1.55 : 1.35;
      ctx.globalAlpha = item.selected ? 0.9 : highlighted ? 0.86 : (this.hoveredId || this.hoveredClusterId) ? 0.18 : exploded ? 0.58 : 0.5;
      ctx.shadowColor = highlighted ? color : "transparent";
      ctx.shadowBlur = highlighted ? 16 : 0;
      ctx.setLineDash(item.record.__meta.temporalUncertainty ? [5, 5] : exploded ? [7, 5] : []);
      ctx.beginPath();
      ctx.moveTo(path.start.x, path.start.y);
      for (const point of path.midpoints) ctx.lineTo(point.x, point.y);
      ctx.lineTo(path.end.x, path.end.y);
      ctx.stroke();

      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.globalAlpha = highlighted ? 0.98 : (this.hoveredId || this.hoveredClusterId) ? 0.3 : 0.68;
      ctx.beginPath();
      ctx.arc(path.end.x, path.end.y, item.selected ? 3.6 : 2.8, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.restore();
  }

  drawMarkers(metrics, colors, all, display) {
    const ctx = this.ctx;
    const axis = metrics.axisCoordinate;
    const displayed = new Set(display.map((item) => item.record.id));

    ctx.save();
    for (const item of sortHighlightLast(all)) {
      const color = this.colorForRecord(item.record, colors);
      const highlighted = item.selected || item.hovered || item.clusterHighlighted;
      const size = clamp(4 + item.importance * 0.75, 7, 14) + (highlighted ? 3 : 0);
      const x = metrics.orientation === "horizontal" ? item.axis : axis;
      const y = metrics.orientation === "horizontal" ? axis : item.axis;
      ctx.globalAlpha = highlighted ? 1 : displayed.has(item.record.id) ? ((this.hoveredId || this.hoveredClusterId) ? 0.42 : 0.96) : ((this.hoveredId || this.hoveredClusterId) ? 0.16 : 0.38);
      drawMarker(ctx, x, y, size, TYPE_SHAPES[item.record.recordType] || "circle", color, highlighted);
    }
    ctx.restore();
  }

  drawClusters(metrics, colors, hidden) {
    this.lastClusters = [];
    if (!hidden.length || !this.lodEnabled) return;
    const clusters = this.buildClusters(metrics, hidden);
    this.lastClusters = clusters;

    const ctx = this.ctx;
    ctx.save();
    ctx.font = "11px var(--mono-font)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (const cluster of clusters) {
      const highlighted = cluster.id === this.hoveredClusterId || cluster.id === this.expandedCluster?.id;
      const anchor = metrics.orientation === "horizontal"
        ? { x: cluster.axis, y: metrics.axisCoordinate }
        : { x: metrics.axisCoordinate, y: cluster.axis };
      const edge = metrics.orientation === "horizontal"
        ? { x: cluster.x + cluster.width / 2, y: cluster.side > 0 ? cluster.y : cluster.y + cluster.height }
        : { x: cluster.side > 0 ? cluster.x : cluster.x + cluster.width, y: cluster.y + cluster.height / 2 };

      ctx.strokeStyle = highlighted ? colors.accent2 : colors.line;
      ctx.lineWidth = highlighted ? 1.4 : 0.9;
      ctx.globalAlpha = highlighted ? 0.78 : 0.42;
      ctx.setLineDash(highlighted ? [] : [3, 5]);
      ctx.beginPath();
      ctx.moveTo(anchor.x, anchor.y);
      ctx.lineTo(edge.x, edge.y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = highlighted ? colorMixFallback(colors.accent2, colors.surfaceRaised) : colors.surfaceRaised;
      ctx.strokeStyle = highlighted ? colors.accent2 : colors.line;
      ctx.lineWidth = highlighted ? 2 : 1;
      ctx.globalAlpha = highlighted ? 1 : this.hoveredClusterId ? 0.45 : 0.9;
      ctx.shadowColor = highlighted ? colors.accent2 : "transparent";
      ctx.shadowBlur = highlighted ? 18 : 0;
      ctx.beginPath();
      roundedRect(ctx, cluster.x, cluster.y, cluster.width, cluster.height, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = highlighted ? colors.background : colors.accent2;
      ctx.globalAlpha = 1;
      ctx.fillText(cluster.label, cluster.x + cluster.width / 2, cluster.y + cluster.height / 2 + 0.5);
    }
    ctx.restore();
  }

  buildClusters(metrics, hidden) {
    const buckets = new Map();
    for (const item of hidden) {
      const key = Math.round(item.axis / 96);
      const bucket = buckets.get(key) || { key, count: 0, axis: 0, maxImportance: 0, items: [] };
      bucket.count += 1;
      bucket.axis += item.axis;
      bucket.maxImportance = Math.max(bucket.maxImportance, item.importance);
      bucket.items.push(item);
      buckets.set(key, bucket);
    }

    return [...buckets.values()].map((bucket) => {
      const axis = bucket.axis / bucket.count;
      const label = `+${bucket.count}`;
      const width = 28 + label.length * 5;
      const height = 22;
      const side = clusterSideFor(metrics, bucket.key);
      const offset = 28 + bucket.maxImportance * 1.35;
      const x = metrics.orientation === "horizontal" ? axis - width / 2 : metrics.axisCoordinate + side * offset - width / 2;
      const y = metrics.orientation === "horizontal" ? metrics.axisCoordinate + side * offset - height / 2 : axis - height / 2;
      const recordIds = bucket.items.map((item) => item.record.id).sort();
      return {
        id: `cluster:${bucket.key}:${recordIds.join("|")}`,
        key: bucket.key,
        label,
        count: bucket.count,
        axis,
        x,
        y,
        width,
        height,
        side,
        maxImportance: bucket.maxImportance,
        items: bucket.items,
        recordIds,
        bbox: {
          left: x - 8,
          right: x + width + 8,
          top: y - 8,
          bottom: y + height + 8
        }
      };
    });
  }

  renderClusterTooltip(metrics) {
    const cluster = this.lastClusters.find((entry) => entry.id === this.hoveredClusterId);
    if (!cluster) {
      this.clusterTooltip.hidden = true;
      return;
    }

    const fallback = this.records[0]?.__meta?.fallbackLanguage || "en";
    const titles = cluster.items
      .slice()
      .sort((a, b) => b.importance - a.importance || a.record.__meta.start - b.record.__meta.start)
      .slice(0, 3)
      .map((item) => textOf(item.record.label, this.language, item.record.__meta.fallbackLanguage || fallback));
    const extra = Math.max(0, cluster.count - titles.length);
    const titleList = titles.map((title) => `<li>${escapeHtml(title)}</li>`).join("");
    const more = extra ? `<li>${escapeHtml(`+${extra}`)}</li>` : "";

    this.clusterTooltip.innerHTML = `
      <strong>${escapeHtml(cluster.label)} ${escapeHtml(this.t("hiddenEvents"))}</strong>
      <ul>${titleList}${more}</ul>
      <span>${escapeHtml(this.t("clusterHint"))}</span>
    `;

    const centerX = cluster.x + cluster.width / 2;
    const centerY = cluster.y + cluster.height / 2;
    const left = clamp(centerX, 118, Math.max(118, metrics.width - 118));
    const placeBelow = centerY < 118;
    const top = placeBelow ? centerY + 28 : centerY - 18;
    this.clusterTooltip.style.left = `${left}px`;
    this.clusterTooltip.style.top = `${top}px`;
    this.clusterTooltip.dataset.placement = placeBelow ? "below" : "above";
    this.clusterTooltip.hidden = false;
  }

  renderBreakTooltip(metrics) {
    const entry = this.lastBreaks.find((candidate) => candidate.id === this.hoveredBreakId);
    if (!entry) {
      this.breakTooltip.hidden = true;
      return;
    }

    const collapsed = entry.kind === "collapsed";
    const range = `${formatYear(entry.startYear, this.language, this.t)} - ${formatYear(entry.endYear, this.language, this.t)}`;
    this.breakTooltip.innerHTML = `
      <strong>${escapeHtml(this.t(collapsed ? "timeBreakTitle" : "timeBreakOpenTitle"))}</strong>
      <ul>
        <li>${escapeHtml(this.t("timeBreakYears", { years: formatCount(entry.years, this.language) }))}</li>
        <li>${escapeHtml(range)}</li>
      </ul>
      <span>${escapeHtml(this.t(collapsed ? "timeBreakHint" : "timeBreakCollapseHint"))}</span>
    `;

    const chip = entry.chip || { left: entry.axis, right: entry.axis, top: 0, bottom: 0 };
    const centerX = (chip.left + chip.right) / 2;
    const centerY = (chip.top + chip.bottom) / 2;
    const left = clamp(centerX, 128, Math.max(128, metrics.width - 128));
    const placeBelow = centerY < 132;
    const top = placeBelow ? centerY + 22 : centerY - 16;
    this.breakTooltip.style.left = `${left}px`;
    this.breakTooltip.style.top = `${top}px`;
    this.breakTooltip.dataset.placement = placeBelow ? "below" : "above";
    this.breakTooltip.hidden = false;
  }

  renderMeasurementLine(metrics) {
    if (!this.measurementLine || !this.measurementLabel) return;
    const measurement = this.getMeasurementConfig();
    this.stage.classList.toggle("has-measurement-line", measurement.enabled);

    if (!measurement.enabled || metrics.axisLength < 80) {
      this.hideMeasurementLine({ immediate: true });
      return;
    }

    const viewYears = this.getViewYearRange();
    const span = Math.max(1, Math.round(viewYears.end - viewYears.start));
    this.measurementLabel.textContent = this.t("zoomLevel", { span });
    this.measurementLine.dataset.orientation = metrics.orientation;
    this.measurementLine.hidden = false;

    if (metrics.orientation === "horizontal") {
      const y = this.measurementCoordinate(metrics, measurement);
      this.measurementLine.style.left = `${metrics.axisStart}px`;
      this.measurementLine.style.top = `${y - 16}px`;
      this.measurementLine.style.width = `${metrics.axisLength}px`;
      this.measurementLine.style.height = "32px";
    } else {
      const x = this.measurementCoordinate(metrics, measurement);
      this.measurementLine.style.left = `${x - 16}px`;
      this.measurementLine.style.top = `${metrics.axisStart}px`;
      this.measurementLine.style.width = "32px";
      this.measurementLine.style.height = `${metrics.axisLength}px`;
    }

    if (!measurement.transient) {
      this.showMeasurementLine({ persistent: true });
      return;
    }

    const key = [
      metrics.orientation,
      Math.round(this.view.start * 1000) / 1000,
      Math.round(this.view.end * 1000) / 1000,
      metrics.axisLength
    ].join(":");

    if (!this.lastMeasurementKey || this.suppressMeasurementChange) {
      this.lastMeasurementKey = key;
      this.suppressMeasurementChange = false;
      this.hideMeasurementLine();
      return;
    }

    if (key !== this.lastMeasurementKey) {
      this.lastMeasurementKey = key;
      this.showMeasurementLine({ fadeOutMs: measurement.fadeOutMs });
    }
  }

  getMeasurementConfig() {
    const measurement = this.config.timeline?.measurement || {};
    const fadeOutMs = Number(measurement.fadeOutMs ?? measurement.hideAfterMs ?? 1200);
    return {
      enabled: measurement.enabled === true,
      transient: measurement.transient === true ||
        measurement.showOnChangeOnly === true ||
        measurement.visibleOnChangeOnly === true,
      fadeOutMs: Number.isFinite(fadeOutMs) ? Math.max(0, fadeOutMs) : 1200,
      offsetPx: Number.isFinite(Number(measurement.offsetPx)) ? Number(measurement.offsetPx) : null
    };
  }

  measurementCoordinate(metrics, measurement) {
    const offset = clamp(measurement.offsetPx ?? 32, 20, 110);
    if (metrics.orientation === "horizontal") {
      if (metrics.placement === "side-start") return clamp(metrics.axisCoordinate + offset, 18, metrics.height - 18);
      if (metrics.placement === "side-end") return clamp(metrics.axisCoordinate - offset, 18, metrics.height - 18);
      return clamp(offset, 18, metrics.height - 18);
    }

    if (metrics.placement === "center") {
      const side = this.direction === "rtl" ? -1 : 1;
      return clamp(metrics.axisCoordinate + side * offset, 18, metrics.width - 18);
    }

    const side = metrics.axisCoordinate < metrics.width / 2 ? 1 : -1;
    return clamp(metrics.axisCoordinate + side * offset, 18, metrics.width - 18);
  }

  showMeasurementLine({ persistent = false, fadeOutMs = 1200 } = {}) {
    if (!this.measurementLine) return;
    const wasHidden = this.measurementLine.hidden;
    this.measurementLine.hidden = false;
    if (wasHidden) void this.measurementLine.offsetWidth;
    this.measurementLine.classList.add("is-visible");
    if (this.measurementFadeTimer) window.clearTimeout(this.measurementFadeTimer);
    this.measurementFadeTimer = 0;
    if (persistent) return;
    this.measurementFadeTimer = window.setTimeout(() => {
      this.measurementFadeTimer = 0;
      this.hideMeasurementLine();
    }, fadeOutMs);
  }

  hideMeasurementLine({ immediate = false } = {}) {
    if (!this.measurementLine) return;
    if (this.measurementFadeTimer) window.clearTimeout(this.measurementFadeTimer);
    this.measurementFadeTimer = 0;
    this.measurementLine.classList.remove("is-visible");
    if (immediate) this.measurementLine.hidden = true;
  }

  renderCards(metrics, displayItems) {
    const axis = metrics.axisCoordinate;
    const mode = this.getLod(this.view.end - this.view.start).labelMode;
    const compact = this.lodEnabled && (mode === "icon" || mode === "short");
    const explodeAnimationMs = this.config.timeline?.explode?.animationMs ?? 620;
    const html = displayItems.map((item, index) => {
      const record = item.record;
      const title = textOf(record.label, this.language, record.__meta.fallbackLanguage);
      const description = textOf(record.description, this.language, record.__meta.fallbackLanguage);
      const date = formatExtent(record.__meta.preferred, this.language, record.__meta.fallbackLanguage, this.t);
      const colorVar = TYPE_VARIABLES[record.recordType] || "--accent";
      const placement = this.cardPlacement(metrics, item, index, compact);
      const selected = item.selected ? " is-selected" : "";
      const hovered = item.hovered ? " is-hovered" : "";
      const expanded = item.expandedClusterId ? " is-cluster-expanded" : "";
      const exploded = item.exploded ? " is-exploded" : "";
      const exploding = item.exploded && this.stage.classList.contains("is-exploding") ? " is-exploding-card" : "";
      const motion = this.stage.classList.contains("is-viewport-moving") || this.stage.classList.contains("is-dragging")
        ? " is-motion-card"
        : "";
      const cardMode = item.exploded ? "short" : mode;
      const compactCard = item.exploded || compact;
      const descriptionHtml = compactCard ? "" : `<p>${escapeHtml(description)}</p>`;
      const mediaBadge = record.__meta.hasMedia ? `<span class="card-chip">${escapeHtml(this.t("media"))}</span>` : "";
      const uncertainty = record.__meta.temporalUncertainty ? `<span class="card-chip">${escapeHtml(record.__meta.confidence)}</span>` : "";
      const emoji = record.emoji ? `<span class="card-emoji" aria-hidden="true">${escapeHtml(record.emoji)}</span>` : "";
      const zIndex = 10 + record.__meta.importance + (item.expandedClusterId ? 36 : 0) + (item.exploded ? 22 + (item.explodeDepth || 0) * 3 : 0);
      return `
        <button class="event-card mode-${escapeHtml(cardMode)} type-${escapeHtml(record.recordType)}${selected}${hovered}${expanded}${exploded}${exploding}${motion}" data-record-id="${escapeHtml(record.id)}" style="--x:${placement.x}px;--y:${placement.y}px;--shift-x:${placement.shiftX};--shift-y:${placement.shiftY};--record-color:var(${colorVar});--card-z:${escapeHtml(String(zIndex))};--card-width:${placement.width}px;--card-max-height:${placement.height}px;--explode-from-x:${placement.explodeFromX || 0}px;--explode-from-y:${placement.explodeFromY || 0}px;--explode-over-x:${placement.explodeOverX || 0}px;--explode-over-y:${placement.explodeOverY || 0}px;--explode-delay:${placement.explodeDelay || 0}ms;--explode-duration:${explodeAnimationMs}ms;">
          <span class="card-date">${escapeHtml(date)}</span>
          <span class="card-title">${emoji}<span>${escapeHtml(title)}</span></span>
          <span class="card-meta">
            <span>${escapeHtml(compactLabel(record.recordType))}</span>
            <span>${escapeHtml(String(record.__meta.importance))}/10</span>
            ${mediaBadge}
            ${uncertainty}
          </span>
          ${descriptionHtml}
        </button>
      `;
    }).join("");
    this.cards.innerHTML = html;
  }

  applyExplodeLayout(metrics, displayItems) {
    for (const item of displayItems) {
      item.explodePlacement = null;
      item.explodeDepth = 0;
    }
    if (!this.explodeEnabled || !displayItems.length) return;

    const cardWidth = this.explodeCardWidth(metrics);
    const cardHeight = this.explodeCardHeight(metrics);
    const lanes = metrics.orientation === "horizontal"
      ? this.horizontalExplodeLanes(metrics, cardHeight)
      : this.verticalExplodeLanes(metrics, cardWidth);
    if (!lanes.length) return;

    const sorted = [...displayItems].sort((a, b) => a.record.__meta.start - b.record.__meta.start || b.importance - a.importance);
    const axisMin = metrics.orientation === "horizontal" ? cardWidth / 2 + 14 : cardHeight / 2 + 14;
    const axisMax = metrics.orientation === "horizontal" ? metrics.width - cardWidth / 2 - 14 : metrics.height - cardHeight / 2 - 14;
    const intervalSize = metrics.orientation === "horizontal" ? cardWidth : cardHeight;
    const markerFor = (item) => metrics.orientation === "horizontal"
      ? { x: item.axis, y: metrics.axisCoordinate }
      : { x: metrics.axisCoordinate, y: item.axis };

    sorted.forEach((item, index) => {
      const base = clamp(item.axis, axisMin, axisMax);
      const slotCount = Math.max(2, Math.floor((axisMax - axisMin) / (intervalSize + 10)) + 1);
      const slotOffsets = Array.from({ length: slotCount }, (_, slotIndex) => {
        const slotCenter = axisMin + ((axisMax - axisMin) * slotIndex) / Math.max(1, slotCount - 1);
        return slotCenter - base;
      }).sort((a, b) => Math.abs(a) - Math.abs(b));
      const offsets = slotOffsets;
      const laneStart = index % lanes.length;
      const orderedLanes = [...lanes.slice(laneStart), ...lanes.slice(0, laneStart)];
      let best = null;

      for (const lane of orderedLanes) {
        for (const offset of offsets) {
          const center = clamp(base + offset, axisMin, axisMax);
          const start = center - intervalSize / 2;
          const end = center + intervalSize / 2;
          const overlap = intervalOverlap(lane.occupied, start, end);
          const score = overlap * 240 + lane.occupied.length * 18 + lane.depth * 9 + Math.abs(center - base) * 0.12;
          if (!best || score < best.score) {
            best = { lane, center, start, end, score };
          }
        }
      }

      if (!best) return;
      best.lane.occupied.push([best.start, best.end]);
      const marker = markerFor(item);
      const x = metrics.orientation === "horizontal" ? best.center : best.lane.coordinate;
      const y = metrics.orientation === "horizontal" ? best.lane.coordinate : best.center;
      const fromX = marker.x - x;
      const fromY = marker.y - y;
      item.explodeDepth = best.lane.depth;
      item.explodePlacement = {
        x,
        y,
        width: cardWidth,
        height: cardHeight,
        side: best.lane.side,
        shiftX: metrics.orientation === "horizontal" ? "-50%" : best.lane.side > 0 ? "0%" : "-100%",
        shiftY: "-50%",
        explodeFromX: Math.round(fromX),
        explodeFromY: Math.round(fromY),
        explodeOverX: Math.round(-fromX * 0.045),
        explodeOverY: Math.round(-fromY * 0.045),
        explodeDelay: Math.min(360, index * 18)
      };
    });
  }

  horizontalExplodeLanes(metrics, cardHeight) {
    const explode = this.config.timeline?.explode || {};
    const maxLayers = Math.max(1, Math.round(explode.layers ?? 6));
    const lanes = [];
    const firstOffset = Math.max(46, cardHeight * 0.6);
    const step = cardHeight;
    const canPlace = (y) => y >= cardHeight / 2 + 6 && y <= metrics.height - cardHeight / 2 - 6;
    const pushLane = (side, depth) => {
      const y = metrics.axisCoordinate + side * (firstOffset + (depth - 1) * step);
      if (!canPlace(y)) return;
      lanes.push({ side, depth, coordinate: y, occupied: [] });
    };

    for (let depth = 1; depth <= maxLayers; depth += 1) {
      if (metrics.placement === "center") {
        pushLane(depth % 2 ? -1 : 1, depth);
        pushLane(depth % 2 ? 1 : -1, depth);
      } else {
        pushLane(metrics.placement === "side-end" ? -1 : 1, depth);
      }
    }

    return lanes;
  }

  verticalExplodeLanes(metrics, cardWidth) {
    const explode = this.config.timeline?.explode || {};
    const maxLayers = Math.max(1, Math.round(explode.layers ?? 6));
    const lanes = [];
    const gap = 18;
    const firstOffset = Math.max(76, cardWidth * 0.42);
    const step = cardWidth + gap;
    const contentSide = metrics.axisCoordinate < metrics.width / 2 ? 1 : -1;
    const canPlace = (x, side) => side > 0
      ? x >= 14 && x + cardWidth <= metrics.width - 14
      : x <= metrics.width - 14 && x - cardWidth >= 14;
    const pushLane = (side, depth) => {
      const x = metrics.axisCoordinate + side * (firstOffset + (depth - 1) * step);
      if (!canPlace(x, side)) return;
      lanes.push({ side, depth, coordinate: x, occupied: [] });
    };

    for (let depth = 1; depth <= maxLayers; depth += 1) {
      if (metrics.placement === "center") {
        pushLane(depth % 2 ? -1 : 1, depth);
        pushLane(depth % 2 ? 1 : -1, depth);
      } else {
        pushLane(contentSide, depth);
      }
    }

    return lanes;
  }

  explodeCardWidth(metrics) {
    if (metrics.orientation === "horizontal") return clamp(metrics.width * 0.16, 136, 190);
    return clamp(metrics.width * 0.22, 120, 176);
  }

  explodeCardHeight(metrics) {
    return metrics.orientation === "horizontal" ? 78 : 76;
  }

  updateCardHighlightClasses() {
    const cards = this.cards.querySelectorAll("[data-record-id]");
    for (const card of cards) {
      const highlighted = card.dataset.recordId === this.hoveredId;
      card.classList.toggle("is-hovered", highlighted);
    }
  }

  cardPlacement(metrics, item, index, compact) {
    if (item.explodePlacement) return item.explodePlacement;
    const offset = compact ? 88 : 128;
    const cardWidth = Math.min(compact ? 206 : 284, Math.max(152, metrics.width - 32));
    const cardHeight = compact ? 104 : 188;
    const expandedNudge = Number.isFinite(item.expandedOrder)
      ? (item.expandedOrder - ((item.expandedCount || 1) - 1) / 2) * 42
      : 0;
    if (metrics.orientation === "horizontal") {
      let side = 1;
      if (metrics.placement === "center") side = index % 2 === 0 ? -1 : 1;
      if (metrics.placement === "side-start") side = 1;
      if (metrics.placement === "side-end") side = -1;
      const x = clamp(item.axis + expandedNudge, cardWidth / 2 + 14, metrics.width - cardWidth / 2 - 14);
      const y = clamp(metrics.axisCoordinate + side * offset, 62, metrics.height - 62);
      return { x, y, width: cardWidth, height: cardHeight, side, shiftX: "-50%", shiftY: "-50%" };
    }

    let side = this.direction === "rtl" ? -1 : 1;
    if (metrics.placement === "center") side = index % 2 === 0 ? -1 : 1;
    if (metrics.placement === "side-start") side = metrics.axisCoordinate < metrics.width / 2 ? 1 : -1;
    if (metrics.placement === "side-end") side = metrics.axisCoordinate < metrics.width / 2 ? 1 : -1;
    const desiredX = metrics.axisCoordinate + side * offset;
    const x = side > 0
      ? clamp(desiredX, 16, metrics.width - cardWidth - 16)
      : clamp(desiredX, cardWidth + 16, metrics.width - 16);
    const y = clamp(item.axis + expandedNudge, 48, metrics.height - 48);
    return {
      x,
      y,
      width: cardWidth,
      height: cardHeight,
      side,
      shiftX: side > 0 ? "0%" : "-100%",
      shiftY: "-50%"
    };
  }

  renderHint(metrics, items) {
    const viewYears = this.getViewYearRange();
    const span = Math.max(1, Math.round(viewYears.end - viewYears.start));
    const collapsed = this.lastBreaks.filter((entry) => entry.kind === "collapsed").length;
    const status = this.t("statusReady", {
      visible: items.display.length,
      hidden: items.hidden.length
    }) + ` · ${this.t("zoomLevel", { span })}`;
    const breakNote = collapsed
      ? ` · ${this.t(collapsed === 1 ? "timeBreakStatusOne" : "timeBreakStatus", { count: collapsed })}`
      : "";
    this.hint.textContent = (this.expandedCluster
      ? `${this.t("clusterExpanded", { count: this.expandedCluster.recordIds.length })} · ${status}`
      : status) + breakNote;
  }

  readColors() {
    const styles = getComputedStyle(this.themeRoot || document.documentElement);
    return {
      background: styles.getPropertyValue("--background").trim(),
      text: styles.getPropertyValue("--text").trim(),
      muted: styles.getPropertyValue("--muted").trim(),
      line: styles.getPropertyValue("--line").trim(),
      grid: styles.getPropertyValue("--grid").trim(),
      panel: styles.getPropertyValue("--panel").trim(),
      surfaceRaised: styles.getPropertyValue("--surface-raised").trim(),
      accent: styles.getPropertyValue("--accent").trim(),
      accent2: styles.getPropertyValue("--accent2").trim(),
      accent3: styles.getPropertyValue("--accent3").trim(),
      accent4: styles.getPropertyValue("--accent4").trim(),
      event: styles.getPropertyValue("--type-event").trim(),
      process: styles.getPropertyValue("--type-process").trim(),
      period: styles.getPropertyValue("--type-period").trim(),
      phenomenon: styles.getPropertyValue("--type-phenomenon").trim(),
      structure: styles.getPropertyValue("--type-structure").trim()
    };
  }

  colorForRecord(record, colors) {
    return colors[record.recordType] || colors.accent;
  }

  getActiveClusterRecordIds() {
    const ids = new Set(this.expandedCluster?.recordIds || []);
    const cluster = this.lastClusters.find((entry) => entry.id === this.hoveredClusterId);
    if (cluster) {
      for (const id of cluster.recordIds) ids.add(id);
    }
    return ids;
  }

  hitTestPoint(point, metrics) {
    for (const cluster of this.lastClusters || []) {
      if (
        point.x >= cluster.bbox.left &&
        point.x <= cluster.bbox.right &&
        point.y >= cluster.bbox.top &&
        point.y <= cluster.bbox.bottom
      ) {
        return { cluster };
      }
    }

    const items = this.lastItems?.all?.length ? this.lastItems.all : this.computeItems(metrics).all;
    const candidates = [];
    for (const item of items) {
      const marker = metrics.orientation === "horizontal"
        ? { x: item.axis, y: metrics.axisCoordinate }
        : { x: metrics.axisCoordinate, y: item.axis };
      const markerDistance = distance(point, marker);
      const markerRadius = clamp(4 + item.importance * 0.75, 9, 17) + 8;
      if (markerDistance <= markerRadius) {
        candidates.push({ item, distance: markerDistance, kind: "marker" });
        continue;
      }

      const spanDistance = metrics.orientation === "horizontal"
        ? distanceToSegment(point, { x: item.axis, y: metrics.axisCoordinate }, { x: item.endAxis, y: metrics.axisCoordinate })
        : distanceToSegment(point, { x: metrics.axisCoordinate, y: item.axis }, { x: metrics.axisCoordinate, y: item.endAxis });
      const durationPixels = Math.abs(item.endAxis - item.axis);
      if (durationPixels >= 6 && spanDistance <= 10) {
        candidates.push({ item, distance: spanDistance + 4, kind: "span" });
      }
    }

    const displayItems = this.lastItems?.display || [];
    const mode = this.getLod(this.view.end - this.view.start).labelMode;
    const compact = this.lodEnabled && (mode === "icon" || mode === "short");
    displayItems.forEach((item, index) => {
      const marker = metrics.orientation === "horizontal"
        ? { x: item.axis, y: metrics.axisCoordinate }
        : { x: metrics.axisCoordinate, y: item.axis };
      const placement = this.cardPlacement(metrics, item, index, compact);
      const markerSize = clamp(4 + item.importance * 0.75, 7, 14);
      const path = connectorPath(metrics, marker, placement, markerSize);
      const points = [path.start, ...path.midpoints, path.end];
      let connectorDistance = Infinity;
      for (let index = 0; index < points.length - 1; index += 1) {
        connectorDistance = Math.min(connectorDistance, distanceToSegment(point, points[index], points[index + 1]));
      }
      if (connectorDistance <= 8) candidates.push({ item, distance: connectorDistance + 2, kind: "connector" });
    });

    candidates.sort((a, b) => a.distance - b.distance || b.item.importance - a.item.importance);
    const hit = candidates[0]?.item;
    if (hit) return { record: hit.record, item: hit };

    for (const entry of this.lastBreaks) {
      if (
        entry.bbox &&
        point.x >= entry.bbox.left &&
        point.x <= entry.bbox.right &&
        point.y >= entry.bbox.top &&
        point.y <= entry.bbox.bottom
      ) {
        return { break: entry };
      }
    }
    return null;
  }

  expandCluster(cluster) {
    this.expandedCluster = {
      id: cluster.id,
      recordIds: cluster.recordIds
    };
    this.hoveredClusterId = null;
    this.updateHoverCursor();
    this.render();
  }

  clearExpandedCluster({ render = true } = {}) {
    if (!this.expandedCluster) return;
    this.expandedCluster = null;
    if (render) this.render();
  }

  destroy() {
    this.resizeObserver?.disconnect();
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    if (this.viewportAnimationFrame) cancelAnimationFrame(this.viewportAnimationFrame);
    if (this.motionTimer) window.clearTimeout(this.motionTimer);
    if (this.explodeAnimationTimer) window.clearTimeout(this.explodeAnimationTimer);
    if (this.measurementFadeTimer) window.clearTimeout(this.measurementFadeTimer);
    this.clusterTooltip?.remove();
    this.breakTooltip?.remove();
    this.breakLayer?.remove();
    this.measurementLine?.remove();
    this.animationFrame = 0;
    this.viewportAnimationFrame = 0;
    this.motionTimer = 0;
    this.explodeAnimationTimer = 0;
    this.measurementFadeTimer = 0;
  }
}

function getAxisCoordinate({ orientation, placement, width, height, direction, sideOffset }) {
  if (orientation === "horizontal") {
    if (placement === "side-start") return sideOffset;
    if (placement === "side-end") return height - sideOffset;
    return height / 2;
  }

  if (placement === "side-start") return direction === "rtl" ? width - sideOffset : sideOffset;
  if (placement === "side-end") return direction === "rtl" ? sideOffset : width - sideOffset;
  return width / 2;
}

function clusterSideFor(metrics, key) {
  if (metrics.orientation === "horizontal") {
    if (metrics.placement === "side-start") return 1;
    if (metrics.placement === "side-end") return -1;
    return key % 2 === 0 ? -1 : 1;
  }

  if (metrics.placement === "center") return key % 2 === 0 ? -1 : 1;
  return metrics.axisCoordinate < metrics.width / 2 ? 1 : -1;
}

function sortHighlightLast(items) {
  return [...items].sort((a, b) => {
    const aHighlighted = a.selected || a.hovered || a.clusterHighlighted;
    const bHighlighted = b.selected || b.hovered || b.clusterHighlighted;
    if (aHighlighted !== bHighlighted) return aHighlighted ? 1 : -1;
    return a.importance - b.importance;
  });
}

function intervalOverlap(intervals, start, end) {
  return intervals.reduce((total, interval) => {
    return total + Math.max(0, Math.min(end, interval[1]) - Math.max(start, interval[0]));
  }, 0);
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distance(point, start);
  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
  return distance(point, {
    x: start.x + t * dx,
    y: start.y + t * dy
  });
}

function colorMixFallback(primary, fallback) {
  return primary || fallback;
}

function crossFadeGradient(ctx, { horizontal, cross, axis, color, peak }) {
  const gradient = horizontal
    ? ctx.createLinearGradient(0, 0, 0, cross)
    : ctx.createLinearGradient(0, 0, cross, 0);
  const plateau = cross * 0.34;
  const edge = cross * 0.86;
  const at = (pixels) => clamp(pixels / Math.max(1, cross), 0, 1);
  const stops = [
    [at(axis - edge), 0],
    [at(axis - plateau), peak],
    [at(axis), peak],
    [at(axis + plateau), peak],
    [at(axis + edge), 0]
  ];
  let previous = -1;
  for (const [offset, alpha] of stops) {
    const position = Math.max(offset, previous);
    gradient.addColorStop(position, withAlpha(color, alpha));
    previous = position;
  }
  return gradient;
}

function boxOverlapsChip(box, position, width, height) {
  return (
    Math.abs(box.left + box.right - 2 * position.x) < width + (box.right - box.left) &&
    Math.abs(box.top + box.bottom - 2 * position.y) < height + (box.bottom - box.top) + 4
  );
}

function drawZigzag(ctx, { horizontal, edge, cross, amplitude, wave }) {
  const steps = Math.max(4, Math.round(cross / wave));
  const step = cross / steps;
  ctx.beginPath();
  for (let index = 0; index <= steps; index += 1) {
    const along = index * step;
    const offset = index % 2 === 0 ? -amplitude : amplitude;
    const x = horizontal ? edge + offset : along;
    const y = horizontal ? along : edge + offset;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function withAlpha(color, alpha) {
  const value = String(color || "").trim();
  const safeAlpha = clamp(alpha, 0, 1);
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const digits = hex[1].length === 3 ? hex[1].split("").map((digit) => digit + digit).join("") : hex[1];
    const red = Number.parseInt(digits.slice(0, 2), 16);
    const green = Number.parseInt(digits.slice(2, 4), 16);
    const blue = Number.parseInt(digits.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${safeAlpha})`;
  }
  const rgb = value.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const parts = rgb[1].split(/[,/\s]+/).filter(Boolean).slice(0, 3);
    if (parts.length === 3) return `rgba(${parts.join(", ")}, ${safeAlpha})`;
  }
  return value;
}

function formatCount(value, language = "en") {
  try {
    return new Intl.NumberFormat(language).format(value);
  } catch {
    return String(value);
  }
}

function formatCompactCount(value, language = "en") {
  if (value < 1000) return formatCount(value, language);
  try {
    return new Intl.NumberFormat(language, { notation: "compact", maximumFractionDigits: 1 }).format(value);
  } catch {
    return formatCount(value, language);
  }
}

function easeOutCubic(value) {
  return 1 - Math.pow(1 - value, 3);
}

function easeInOutCubic(value) {
  return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function normalizeWheelDelta(event) {
  const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 120 : 1;
  return {
    x: event.deltaX * multiplier,
    y: event.deltaY * multiplier
  };
}

function chooseTickStep(span, pixels) {
  const target = Math.max(1, pixels / 115);
  const raw = Math.max(0.0001, span / target);
  const power = 10 ** Math.floor(Math.log10(raw));
  const multiples = [1, 2, 5, 10];
  return multiples.find((multiple) => raw <= multiple * power) * power;
}

function drawTicks(ctx, metrics, denseSpan, step, color, alpha, project, labeler) {
  if (!Number.isFinite(step) || step <= 0) return;
  const first = Math.ceil(denseSpan.yearStart / step) * step;
  const axis = metrics.axisCoordinate;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 1;

  for (let tick = first; tick <= denseSpan.yearEnd + step * 1e-6; tick += step) {
    const axisPosition = project(tick);
    if (axisPosition < metrics.axisStart - 2 || axisPosition > metrics.axisEnd + 2) continue;
    ctx.beginPath();
    if (metrics.orientation === "horizontal") {
      ctx.moveTo(axisPosition, 0);
      ctx.lineTo(axisPosition, metrics.height);
    } else {
      ctx.moveTo(0, axisPosition);
      ctx.lineTo(metrics.width, axisPosition);
    }
    ctx.stroke();

    if (labeler) {
      ctx.globalAlpha = 1;
      const tickLength = 8;
      ctx.beginPath();
      if (metrics.orientation === "horizontal") {
        ctx.moveTo(axisPosition, axis - tickLength);
        ctx.lineTo(axisPosition, axis + tickLength);
      } else {
        ctx.moveTo(axis - tickLength, axisPosition);
        ctx.lineTo(axis + tickLength, axisPosition);
      }
      ctx.stroke();
      labeler(Math.round(tick), axisPosition);
      ctx.globalAlpha = alpha;
    }
  }
  ctx.restore();
}

function drawMarker(ctx, x, y, size, shape, color, selected) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = selected ? "#ffffff" : color;
  ctx.lineWidth = selected ? 2.4 : 1;
  ctx.shadowColor = selected ? "rgba(255,255,255,0.28)" : "rgba(0,0,0,0.25)";
  ctx.shadowBlur = selected ? 18 : 8;
  ctx.beginPath();

  if (shape === "square") {
    roundedRect(ctx, x - size, y - size, size * 2, size * 2, 3);
  } else if (shape === "diamond") {
    ctx.moveTo(x, y - size * 1.25);
    ctx.lineTo(x + size * 1.25, y);
    ctx.lineTo(x, y + size * 1.25);
    ctx.lineTo(x - size * 1.25, y);
    ctx.closePath();
  } else if (shape === "hex") {
    for (let index = 0; index < 6; index += 1) {
      const angle = Math.PI / 6 + index * Math.PI / 3;
      const px = x + Math.cos(angle) * size * 1.15;
      const py = y + Math.sin(angle) * size * 1.15;
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  } else if (shape === "capsule") {
    roundedRect(ctx, x - size * 1.45, y - size * 0.78, size * 2.9, size * 1.56, size);
  } else {
    ctx.arc(x, y, size, 0, Math.PI * 2);
  }

  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function connectorPath(metrics, marker, placement, markerSize) {
  const inset = 18;
  const side = placement.side || 1;

  if (metrics.orientation === "horizontal") {
    const cardLeft = placement.x - placement.width / 2;
    const cardRight = placement.x + placement.width / 2;
    const end = {
      x: clamp(marker.x, cardLeft + inset, cardRight - inset),
      y: placement.y - side * (placement.height / 2 + 1)
    };
    const start = {
      x: marker.x,
      y: marker.y + side * (markerSize + 6)
    };
    const jointY = start.y + side * Math.max(18, Math.min(44, Math.abs(end.y - start.y) * 0.48));
    return {
      start,
      end,
      midpoints: [
        { x: start.x, y: jointY },
        { x: end.x, y: jointY }
      ]
    };
  }

  const cardLeft = side > 0 ? placement.x : placement.x - placement.width;
  const cardRight = side > 0 ? placement.x + placement.width : placement.x;
  const cardTop = placement.y - placement.height / 2;
  const cardBottom = placement.y + placement.height / 2;
  const end = {
    x: side > 0 ? cardLeft - 1 : cardRight + 1,
    y: clamp(marker.y, cardTop + inset, cardBottom - inset)
  };
  const start = {
    x: marker.x + side * (markerSize + 6),
    y: marker.y
  };
  const jointX = start.x + side * Math.max(18, Math.min(44, Math.abs(end.x - start.x) * 0.48));
  return {
    start,
    end,
    midpoints: [
      { x: jointX, y: start.y },
      { x: jointX, y: end.y }
    ]
  };
}

function roundedRect(ctx, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  ctx.moveTo(x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  ctx.lineTo(x + width, y + height - safeRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  ctx.lineTo(x + safeRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  ctx.lineTo(x, y + safeRadius);
  ctx.quadraticCurveTo(x, y, x + safeRadius, y);
}
