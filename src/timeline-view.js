import {
  clamp,
  compactLabel,
  escapeHtml,
  formatExtent,
  formatYear,
  textOf
} from "./paststruct.js";

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
    this.domain = { start: -100, end: 100 };
    this.extent = { start: -100, end: 100 };
    this.view = { start: -100, end: 100 };
    this.pointer = null;
    this.zoomPointer = null;
    this.kineticVelocity = 0;
    this.wheelVelocity = 0;
    this.animationFrame = 0;
    this.viewportAnimationFrame = 0;
    this.viewportAnimation = null;
    this.motionTimer = 0;
    this.explodeAnimationTimer = 0;
    this.lastFrame = 0;
    this.lastMetrics = null;
    this.lastItems = { all: [], display: [], hidden: [] };
    this.lastClusters = [];
    this.suppressStageClick = false;
    this.clusterTooltip = document.createElement("div");
    this.clusterTooltip.className = "cluster-tooltip";
    this.clusterTooltip.hidden = true;
    this.stage.append(this.clusterTooltip);
    this.stage.classList.toggle("is-explode-mode", this.explodeEnabled);
    this.setupZoomBar();

    this.boundRender = () => this.render();
    this.boundAnimate = (time) => this.animate(time);
    this.boundAnimateViewport = (time) => this.animateViewport(time);

    this.stage.addEventListener("wheel", (event) => this.handleWheel(event), { passive: false });
    this.stage.addEventListener("pointerdown", (event) => this.handlePointerDown(event));
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

  setRecords(records, { resetView = false } = {}) {
    this.records = records;
    this.idMap = new Map(records.map((record) => [record.id, record]));
    this.hoveredClusterId = null;
    this.expandedCluster = null;
    this.computeDomain();
    if (resetView || !records.some((record) => record.id === this.selectedId)) {
      this.fit();
    } else {
      this.clampView();
      this.render();
    }
  }

  select(recordId, emit = false) {
    this.selectedId = recordId;
    this.render();
    if (emit) this.onSelect?.(this.idMap.get(recordId) || null);
  }

  setHovered(recordId, { source = "timeline" } = {}) {
    const nextId = recordId && this.idMap.has(recordId) ? recordId : null;
    const nextClusterId = null;
    if (nextId === this.hoveredId && nextClusterId === this.hoveredClusterId) return;
    const needsCardRender = source === "timeline" || (nextId && !this.hasRenderedCard(nextId));
    this.hoveredId = nextId;
    this.hoveredClusterId = nextClusterId;
    this.updateHoverCursor();
    this.render({ renderCards: needsCardRender });
    if (!needsCardRender) this.updateCardHighlightClasses();
  }

  setHoveredCluster(clusterId) {
    const nextId = clusterId && this.lastClusters.some((cluster) => cluster.id === clusterId) ? clusterId : null;
    if (nextId === this.hoveredClusterId && !this.hoveredId) return;
    this.hoveredId = null;
    this.hoveredClusterId = nextId;
    this.updateHoverCursor();
    this.render({ renderCards: false });
  }

  updateHoverCursor() {
    this.stage.classList.toggle("has-hit-hover", Boolean(this.hoveredId || this.hoveredClusterId));
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
    const span = Math.max(1, this.domain.end - this.domain.start);
    this.setViewRange(this.domain.start, this.domain.end || this.domain.start + span, { animate, motion: false });
  }

  computeDomain() {
    if (!this.records.length) {
      const now = new Date().getUTCFullYear();
      this.extent = { start: now - 10, end: now + 10 };
      this.domain = { start: now - 10, end: now + 10 };
      return;
    }

    const starts = this.records.map((record) => record.__meta.start).filter(Number.isFinite);
    const ends = this.records.map((record) => record.__meta.end).filter(Number.isFinite);
    const min = Math.min(...starts, ...ends);
    const max = Math.max(...starts, ...ends);
    const rawSpan = Math.max(1, max - min);
    const paddingRatio = this.config.timeline?.defaultPaddingRatio ?? 0.08;
    const padding = Math.max(rawSpan * paddingRatio, Math.min(25, rawSpan));
    this.extent = {
      start: min,
      end: max || min + rawSpan
    };
    this.domain = {
      start: min - padding,
      end: max + padding
    };
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

  handleStageClick(event) {
    if (this.suppressStageClick) return;
    if (event.target.closest("[data-record-id], button, input, select, textarea, a")) return;
    const hit = this.hitTestEvent(event);
    if (hit?.cluster) {
      this.expandCluster(hit.cluster);
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
    const metrics = this.measure();
    const spanPixels = metrics.axisLength || 1;
    const panStep = spanPixels * 0.08;

    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      this.zoomBy(0.72);
    } else if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      this.zoomBy(1.35);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      this.panByPixels(panStep, metrics);
    } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      this.panByPixels(-panStep, metrics);
    } else if (event.key === "Home") {
      event.preventDefault();
      this.fit();
    }
  }

  handleZoomPointerDown(event) {
    if (!this.zoomBar || !this.records.length || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.cancelViewportAnimation();
    this.zoomBar.focus({ preventScroll: true });
    this.zoomBar.setPointerCapture(event.pointerId);

    const metrics = this.measureZoomBar();
    const year = this.zoomClientToYear(event, metrics);
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
      startYear: year,
      currentYear: year,
      initialRange: currentRange,
      moved: false
    };
    this.kineticVelocity = 0;
    this.wheelVelocity = 0;
    this.zoomBar.classList.add("is-interacting", mode === "select" ? "is-selecting" : `is-${mode}`);

    if (mode === "select") this.updateZoomSelection(year, year, metrics);
    else this.hideZoomSelection();
  }

  handleZoomPointerMove(event) {
    if (!this.zoomPointer || this.zoomPointer.id !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();

    const metrics = this.measureZoomBar();
    const year = this.zoomClientToYear(event, metrics);
    const pointer = this.zoomPointer;
    const bounds = this.getNavigatorDomain();
    const minSpan = this.config.timeline?.minZoomSpanYears || 2;
    pointer.currentYear = year;
    pointer.moved = pointer.moved || Math.abs(this.zoomYearToAxis(year, metrics) - this.zoomYearToAxis(pointer.startYear, metrics)) > 2;

    if (pointer.mode === "select") {
      this.updateZoomSelection(pointer.startYear, year, metrics);
      return;
    }

    if (pointer.mode === "pan") {
      const span = pointer.initialRange.end - pointer.initialRange.start;
      const delta = year - pointer.startYear;
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
      const nextStart = clamp(year, bounds.start, fixedEnd - minSpan);
      this.setViewRange(nextStart, fixedEnd, { clampTo: "navigator" });
      return;
    }

    if (pointer.mode === "end") {
      const fixedStart = pointer.initialRange.start;
      const nextEnd = clamp(year, fixedStart + minSpan, bounds.end);
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
      const startPx = this.zoomYearToAxis(pointer.startYear, metrics);
      const endPx = this.zoomYearToAxis(pointer.currentYear, metrics);
      const minPixels = this.config.timeline?.navigator?.minSelectionPixels ?? 10;
      this.hideZoomSelection();
      if (Math.abs(endPx - startPx) >= minPixels) {
        const nextStart = Math.min(pointer.startYear, pointer.currentYear);
        const nextEnd = Math.max(pointer.startYear, pointer.currentYear);
        this.setViewRange(nextStart, nextEnd, { animate: true, clampTo: "navigator" });
      }
    }
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
    const focusYear = this.view.start + fraction * span;

    const nextStart = focusYear - fraction * nextSpan;
    this.setViewRange(nextStart, nextStart + nextSpan);
  }

  zoomNavigatorRange(factor) {
    const range = this.getNavigatorViewRange();
    const center = (range.start + range.end) / 2;
    const nextSpan = (range.end - range.start) * factor;
    this.setViewRange(center - nextSpan / 2, center + nextSpan / 2, { animate: true, clampTo: "navigator" });
  }

  setViewRange(start, end, { animate = false, clampTo = "domain", motion = true } = {}) {
    const target = this.normalizeViewRange(start, end, clampTo);
    if (animate) {
      this.animateViewTo(target.start, target.end, clampTo);
      return;
    }

    this.cancelViewportAnimation();
    this.clearExpandedCluster({ render: false });
    if (motion) this.markViewportMoving();
    this.view = target;
    if (clampTo !== "navigator") this.clampView();
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

  animateViewTo(start, end, clampTo = "navigator") {
    this.cancelViewportAnimation();
    this.clearExpandedCluster({ render: false });
    this.kineticVelocity = 0;
    this.wheelVelocity = 0;
    const target = this.normalizeViewRange(start, end, clampTo);
    this.markViewportMoving((this.config.timeline?.navigator?.animationMs ?? 420) + 120);
    this.viewportAnimation = {
      from: { ...this.view },
      to: target,
      startTime: 0,
      duration: this.config.timeline?.navigator?.animationMs ?? 420
    };
    this.viewportAnimationFrame = requestAnimationFrame(this.boundAnimateViewport);
  }

  animateViewport(time) {
    if (!this.viewportAnimation) return;
    if (!this.viewportAnimation.startTime) this.viewportAnimation.startTime = time;
    const { from, to, startTime, duration } = this.viewportAnimation;
    const progress = clamp((time - startTime) / Math.max(1, duration), 0, 1);
    const eased = easeOutCubic(progress);
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

  yearToAxis(year, metrics) {
    const span = this.view.end - this.view.start;
    return metrics.axisStart + ((year - this.view.start) / span) * metrics.axisLength;
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
    this.renderClusterTooltip(metrics);
    this.renderZoomBar(colors);
    if (renderCards) this.renderCards(metrics, items.display);
    else this.updateCardHighlightClasses();
    this.renderHint(metrics, items);
    this.stage.dataset.orientation = metrics.orientation;

    this.onViewportChange?.({
      orientation: metrics.orientation,
      placement: metrics.placement,
      span: this.view.end - this.view.start,
      visible: items.display.length,
      hidden: items.hidden.length,
      total: this.records.length,
      lod: items.lod
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
    this.updateZoomWindow(metrics);
    if (this.zoomPointer?.mode === "select") {
      this.updateZoomSelection(this.zoomPointer.startYear, this.zoomPointer.currentYear, metrics);
    }

    this.zoomLabelStart.textContent = formatYear(metrics.domain.start, this.language, this.t);
    this.zoomLabelEnd.textContent = formatYear(metrics.domain.end, this.language, this.t);
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
      const x = this.zoomYearToAxis(tick, metrics);
      ctx.beginPath();
      ctx.moveTo(x, baseline - 18);
      ctx.lineTo(x, baseline + 18);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawZoomEvents(ctx, metrics, colors) {
    const range = this.getNavigatorViewRange();
    const viewStart = Math.min(range.start, range.end);
    const viewEnd = Math.max(range.start, range.end);
    const baseline = metrics.axisY;

    ctx.save();
    const sorted = [...this.records].sort((a, b) => a.__meta.importance - b.__meta.importance);
    for (const record of sorted) {
      const start = clamp(record.__meta.start, metrics.domain.start, metrics.domain.end);
      const end = clamp(record.__meta.end, metrics.domain.start, metrics.domain.end);
      const x = this.zoomYearToAxis(start, metrics);
      const endX = this.zoomYearToAxis(end, metrics);
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
    const left = this.zoomYearToAxis(range.start, metrics);
    const right = this.zoomYearToAxis(range.end, metrics);
    const width = Math.max(12, right - left);
    this.zoomWindow.style.left = `${left}px`;
    this.zoomWindow.style.width = `${width}px`;
    this.zoomWindowLabel.textContent = `${formatYear(range.start, this.language, this.t)} - ${formatYear(range.end, this.language, this.t)}`;
  }

  updateZoomSelection(startYear, endYear, metrics = this.measureZoomBar()) {
    if (!this.zoomSelection) return;
    const start = this.zoomYearToAxis(startYear, metrics);
    const end = this.zoomYearToAxis(endYear, metrics);
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

  zoomYearToAxis(year, metrics = this.measureZoomBar()) {
    const fraction = clamp((year - metrics.domain.start) / Math.max(1, metrics.domain.end - metrics.domain.start), 0, 1);
    return metrics.axisStart + fraction * metrics.axisLength;
  }

  zoomAxisToYear(axis, metrics = this.measureZoomBar()) {
    const fraction = clamp((axis - metrics.axisStart) / Math.max(1, metrics.axisLength), 0, 1);
    return metrics.domain.start + fraction * (metrics.domain.end - metrics.domain.start);
  }

  zoomClientToYear(event, metrics = this.measureZoomBar()) {
    const rect = this.zoomBar.getBoundingClientRect();
    return this.zoomAxisToYear(event.clientX - rect.left, metrics);
  }

  computeItems(metrics) {
    const span = this.view.end - this.view.start;
    const lod = this.getLod(span);
    const minSignificance = this.lodEnabled ? lod.minSignificance : 1;
    const activeClusterIds = this.getActiveClusterRecordIds();
    const all = this.records
      .filter((record) => record.__meta.end >= this.view.start && record.__meta.start <= this.view.end)
      .map((record) => ({
        record,
        axis: this.yearToAxis(record.__meta.start, metrics),
        endAxis: this.yearToAxis(record.__meta.end, metrics),
        importance: record.__meta.importance,
        selected: record.id === this.selectedId,
        hovered: record.id === this.hoveredId,
        clusterHighlighted: activeClusterIds.has(record.id)
      }))
      .filter((item) => item.axis > metrics.axisStart - 80 && item.axis < metrics.axisEnd + 80);

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

    ctx.save();
    ctx.lineWidth = 1;
    ctx.font = "11px var(--mono-font)";
    ctx.textBaseline = metrics.orientation === "horizontal" ? "top" : "middle";

    drawTicks(ctx, metrics, this.view, minorStep, colors.grid, 0.28, null);
    drawTicks(ctx, metrics, this.view, step, colors.grid, 0.55, (tick, axisPosition) => {
      ctx.save();
      ctx.fillStyle = colors.muted;
      ctx.globalAlpha = 0.82;
      const label = formatYear(tick, this.language, this.t);
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
    });

    ctx.strokeStyle = colors.line;
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    if (metrics.orientation === "horizontal") {
      ctx.moveTo(metrics.axisStart, axis);
      ctx.lineTo(metrics.axisEnd, axis);
    } else {
      ctx.moveTo(axis, metrics.axisStart);
      ctx.lineTo(axis, metrics.axisEnd);
    }
    ctx.stroke();
    ctx.restore();
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
    const span = Math.max(1, Math.round(this.view.end - this.view.start));
    const status = this.t("statusReady", {
      visible: items.display.length,
      hidden: items.hidden.length
    }) + ` · ${this.t("zoomLevel", { span })}`;
    this.hint.textContent = this.expandedCluster
      ? `${this.t("clusterExpanded", { count: this.expandedCluster.recordIds.length })} · ${status}`
      : status;
  }

  readColors() {
    const styles = getComputedStyle(this.themeRoot || document.documentElement);
    return {
      background: styles.getPropertyValue("--background").trim(),
      text: styles.getPropertyValue("--text").trim(),
      muted: styles.getPropertyValue("--muted").trim(),
      line: styles.getPropertyValue("--line").trim(),
      grid: styles.getPropertyValue("--grid").trim(),
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
    return hit ? { record: hit.record, item: hit } : null;
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
    this.clusterTooltip?.remove();
    this.animationFrame = 0;
    this.viewportAnimationFrame = 0;
    this.motionTimer = 0;
    this.explodeAnimationTimer = 0;
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

function easeOutCubic(value) {
  return 1 - Math.pow(1 - value, 3);
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

function drawTicks(ctx, metrics, view, step, color, alpha, labeler) {
  if (!Number.isFinite(step) || step <= 0) return;
  const first = Math.ceil(view.start / step) * step;
  const axis = metrics.axisCoordinate;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 1;

  for (let tick = first; tick <= view.end + step * 0.5; tick += step) {
    const axisPosition = metrics.axisStart + ((tick - view.start) / (view.end - view.start)) * metrics.axisLength;
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
