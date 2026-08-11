import { clamp } from "./paststruct.js";

export const TIME_BREAK_LABELS = ["gap", "removed", "both", "range", "none"];

export const DEFAULT_TIME_BREAK_OPTIONS = {
  enabled: false,
  label: "gap",
  minGapRatio: 0.12,
  minGapYears: 0,
  collapsedRatio: 0.022,
  contextRatio: 0.12,
  maxBreaks: 240,
  zoomSyncRatio: 0.18
};

export function normalizeTimeBreakOptions(options = {}) {
  const numberOr = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
  return {
    enabled: options.enabled === true,
    label: TIME_BREAK_LABELS.includes(options.label) ? options.label : DEFAULT_TIME_BREAK_OPTIONS.label,
    minGapRatio: clamp(numberOr(options.minGapRatio, DEFAULT_TIME_BREAK_OPTIONS.minGapRatio), 0.01, 0.9),
    minGapYears: Math.max(0, numberOr(options.minGapYears, DEFAULT_TIME_BREAK_OPTIONS.minGapYears)),
    collapsedRatio: clamp(numberOr(options.collapsedRatio, DEFAULT_TIME_BREAK_OPTIONS.collapsedRatio), 0.002, 0.2),
    contextRatio: clamp(numberOr(options.contextRatio, DEFAULT_TIME_BREAK_OPTIONS.contextRatio), 0, 0.45),
    maxBreaks: Math.max(1, Math.round(numberOr(options.maxBreaks, DEFAULT_TIME_BREAK_OPTIONS.maxBreaks))),
    zoomSyncRatio: clamp(numberOr(options.zoomSyncRatio, DEFAULT_TIME_BREAK_OPTIONS.zoomSyncRatio), 0.02, 2)
  };
}

/**
 * Monotonic piecewise-linear mapping between real years and axis units.
 *
 * Dense segments keep a 1:1 year-to-unit scale, so every existing viewport
 * calculation (zoom span, tick steps, level of detail) keeps working in years.
 * Break segments squeeze an empty year range into a much smaller unit range,
 * which is what removes the long empty stretches from the timeline.
 */
export class TimeScale {
  constructor(domain, breaks = []) {
    const start = Number.isFinite(domain?.start) ? domain.start : 0;
    const end = Number.isFinite(domain?.end) && domain.end > start ? domain.end : start + 1;
    this.domain = { start, end };
    this.segments = [];
    this.breaks = [];

    let unit = 0;
    let cursor = start;

    for (const entry of breaks) {
      const breakStart = Math.max(cursor, Number(entry.startYear));
      const breakEnd = Math.min(end, Number(entry.endYear));
      const unitSpan = Number(entry.unitSpan);
      const yearSpan = breakEnd - breakStart;
      if (!(yearSpan > 0) || !(unitSpan > 0) || unitSpan >= yearSpan) continue;

      if (breakStart > cursor) {
        unit = this.pushSegment("dense", cursor, breakStart, unit, breakStart - cursor);
      }
      const segment = this.pushSegmentEntry("break", breakStart, breakEnd, unit, unitSpan, {
        id: entry.id,
        gapStartYear: entry.gapStartYear,
        gapEndYear: entry.gapEndYear
      });
      unit = segment.endUnit;
      cursor = breakEnd;
      this.breaks.push(segment);
    }

    if (cursor < end) {
      unit = this.pushSegment("dense", cursor, end, unit, end - cursor);
    }

    this.span = unit;
    this.hasBreaks = this.breaks.length > 0;
    this.skippedYears = this.breaks.reduce((total, segment) => total + segment.yearSpan - segment.unitSpan, 0);
  }

  static identity(domain) {
    return new TimeScale(domain, []);
  }

  pushSegment(kind, startYear, endYear, startUnit, unitSpan) {
    return this.pushSegmentEntry(kind, startYear, endYear, startUnit, unitSpan).endUnit;
  }

  pushSegmentEntry(kind, startYear, endYear, startUnit, unitSpan, meta = {}) {
    const yearSpan = endYear - startYear;
    // A break keeps a little context on each side, so the segment is shorter than the
    // empty stretch it stands for; both spans are kept because labels can report either.
    const gapStartYear = Number.isFinite(meta.gapStartYear) ? meta.gapStartYear : startYear;
    const gapEndYear = Number.isFinite(meta.gapEndYear) ? meta.gapEndYear : endYear;
    const segment = {
      kind,
      id: meta.id || `${kind}:${Math.round(startYear)}:${Math.round(endYear)}`,
      startYear,
      endYear,
      yearSpan,
      gapStartYear,
      gapEndYear,
      gapYears: gapEndYear - gapStartYear,
      startUnit,
      endUnit: startUnit + unitSpan,
      unitSpan,
      scale: yearSpan > 0 ? unitSpan / yearSpan : 1
    };
    this.segments.push(segment);
    return segment;
  }

  get unitDomain() {
    return { start: 0, end: this.span };
  }

  toUnit(year) {
    if (!Number.isFinite(year)) return 0;
    const segments = this.segments;
    if (!segments.length) return year - this.domain.start;

    const first = segments[0];
    if (year <= first.startYear) return first.startUnit + (year - first.startYear);
    const last = segments[segments.length - 1];
    if (year >= last.endYear) return last.endUnit + (year - last.endYear);

    const segment = this.segmentAt(year, "startYear", "endYear");
    return segment.startUnit + (year - segment.startYear) * segment.scale;
  }

  toYear(unit) {
    if (!Number.isFinite(unit)) return this.domain.start;
    const segments = this.segments;
    if (!segments.length) return this.domain.start + unit;

    const first = segments[0];
    if (unit <= first.startUnit) return first.startYear + (unit - first.startUnit);
    const last = segments[segments.length - 1];
    if (unit >= last.endUnit) return last.endYear + (unit - last.endUnit);

    const segment = this.segmentAt(unit, "startUnit", "endUnit");
    if (!(segment.scale > 0)) return segment.startYear;
    return segment.startYear + (unit - segment.startUnit) / segment.scale;
  }

  segmentAt(value, startKey, endKey) {
    return this.segments[this.indexAt(value, startKey, endKey)];
  }

  indexAt(value, startKey, endKey) {
    const segments = this.segments;
    let low = 0;
    let high = segments.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (value > segments[middle][endKey]) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  /**
   * Dense stretches inside a unit range, used for axis ticks and axis lines.
   * The outermost dense segments are treated as unbounded so panning past the
   * dataset padding still draws a continuous ruler.
   */
  denseSpansForRange(unitStart, unitEnd) {
    if (!(unitEnd > unitStart)) return [];
    const segments = this.segments;
    if (!segments.length) {
      return [{ unitStart, unitEnd, yearStart: this.toYear(unitStart), yearEnd: this.toYear(unitEnd) }];
    }

    const spans = [];
    const lastIndex = segments.length - 1;
    // Walk only the segments the range touches, so a long break list stays cheap per frame.
    const first = unitStart <= segments[0].startUnit ? 0 : this.indexAt(unitStart, "startUnit", "endUnit");
    for (let index = first; index <= lastIndex; index += 1) {
      const segment = segments[index];
      if (index > 0 && segment.startUnit >= unitEnd) break;
      if (segment.kind !== "dense") continue;
      const from = index === 0 ? -Infinity : segment.startUnit;
      const to = index === lastIndex ? Infinity : segment.endUnit;
      const start = Math.max(from, unitStart);
      const end = Math.min(to, unitEnd);
      if (!(end > start)) continue;
      spans.push({
        unitStart: start,
        unitEnd: end,
        yearStart: this.toYear(start),
        yearEnd: this.toYear(end)
      });
    }
    return spans;
  }

  breaksForRange(unitStart, unitEnd) {
    return this.breaks.filter((segment) => segment.endUnit >= unitStart && segment.startUnit <= unitEnd);
  }
}

/**
 * Builds the mapping for a given zoom level.
 *
 * `viewSpan` is how many units currently fit in the frame. Because dense segments
 * are 1:1, it doubles as "how many dense years the viewer can see", which is what
 * makes a gap feel long or short: 300 empty years are nothing across a millennium
 * and half the screen across a century. Every threshold is therefore a fraction of
 * `viewSpan`, so zooming in re-cuts the axis instead of reopening the empty runs.
 */
export function buildTimeScale(records, domain, options = {}, { viewSpan } = {}) {
  const settings = normalizeTimeBreakOptions(options);
  const identity = TimeScale.identity(domain);
  if (!settings.enabled || !records?.length) return identity;

  const domainSpan = domain.end - domain.start;
  if (!(domainSpan > 0)) return identity;

  const intervals = coverageIntervals(records);
  if (intervals.length < 2) return identity;

  const frame = Number.isFinite(viewSpan) && viewSpan > 0 ? Math.min(viewSpan, domainSpan) : domainSpan;
  const minGapYears = Math.max(settings.minGapYears, frame * settings.minGapRatio);
  const gaps = [];
  for (let index = 1; index < intervals.length; index += 1) {
    const startYear = intervals[index - 1].end;
    const endYear = intervals[index].start;
    const years = endYear - startYear;
    // The id names the gap itself, not the collapsed segment, so it survives the
    // rebuilds that follow every zoom change and keeps expanded gaps expanded.
    if (years >= minGapYears) {
      gaps.push({ id: `gap:${Math.round(startYear)}:${Math.round(endYear)}`, startYear, endYear, years });
    }
  }
  if (!gaps.length) return identity;

  const selected = gaps
    .slice()
    .sort((a, b) => b.years - a.years)
    .slice(0, settings.maxBreaks)
    .sort((a, b) => a.startYear - b.startYear);

  const collapsedUnits = frame * settings.collapsedRatio;
  const maxContextYears = frame * 0.03;

  const breaks = [];
  for (const gap of selected) {
    const context = Math.min(gap.years * settings.contextRatio, maxContextYears);
    const startYear = gap.startYear + context;
    const endYear = gap.endYear - context;
    const unitSpan = Math.min(collapsedUnits, (endYear - startYear) * 0.75);
    if (!(unitSpan > 0)) continue;
    breaks.push({
      id: gap.id,
      startYear,
      endYear,
      unitSpan,
      gapStartYear: gap.startYear,
      gapEndYear: gap.endYear
    });
  }
  if (!breaks.length) return identity;

  const scale = new TimeScale(domain, breaks);
  return scale.hasBreaks ? scale : identity;
}

function coverageIntervals(records) {
  const ranges = [];
  for (const record of records) {
    const start = record?.__meta?.start;
    if (!Number.isFinite(start)) continue;
    const end = record.__meta.end;
    ranges.push({ start, end: Number.isFinite(end) ? Math.max(end, start) : start });
  }
  ranges.sort((a, b) => a.start - b.start);

  const merged = [];
  for (const range of ranges) {
    const current = merged[merged.length - 1];
    if (current && range.start <= current.end) {
      current.end = Math.max(current.end, range.end);
      continue;
    }
    merged.push({ ...range });
  }
  return merged;
}
