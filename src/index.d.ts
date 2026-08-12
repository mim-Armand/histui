export type HistuiOrientation = "auto" | "horizontal" | "vertical";
export type HistuiAxisPlacement = "center" | "side-start" | "side-end";
export type HistuiDisplayMode = "standard" | "broadcast";

export interface HistuiTheme {
  id: string;
  label?: Record<string, string> | string;
  colors: Record<string, string>;
}

export interface HistuiMeasurementConfig {
  enabled?: boolean;
  transient?: boolean;
  showOnChangeOnly?: boolean;
  visibleOnChangeOnly?: boolean;
  fadeOutMs?: number;
  hideAfterMs?: number;
  offsetPx?: number;
}

export type HistuiTimeBreakLabel = "gap" | "removed" | "both" | "range" | "none";

export interface HistuiTimeBreakConfig {
  enabled?: boolean;
  label?: HistuiTimeBreakLabel;
  /** Also cut stretches a single record runs across, such as a long quiet period. */
  breakOngoing?: boolean;
  minGapRatio?: number;
  minGapYears?: number;
  collapsedRatio?: number;
  contextRatio?: number;
  maxBreaks?: number;
  zoomSyncRatio?: number;
}

export interface HistuiTimelineConfig {
  minZoomSpanYears?: number;
  maxZoomMultiplier?: number;
  defaultPaddingRatio?: number;
  keyboardStepMs?: number;
  measurement?: HistuiMeasurementConfig;
  timeBreaks?: HistuiTimeBreakConfig;
  [key: string]: unknown;
}

export interface HistuiConfig {
  app?: {
    name?: string;
    defaultLanguage?: string;
    languages?: string[];
    defaultTheme?: string;
    displayMode?: HistuiDisplayMode;
    orientation?: HistuiOrientation;
    axisPlacement?: {
      horizontal?: HistuiAxisPlacement;
      vertical?: HistuiAxisPlacement;
    };
  };
  analytics?: {
    googleAnalyticsMeasurementId?: string;
  };
  timeline?: HistuiTimelineConfig;
  themes?: HistuiTheme[];
}

export interface HistuiFilters {
  search?: string;
  recordTypes?: string[] | Set<string>;
  types?: string[] | Set<string>;
  factuality?: string[] | Set<string>;
  confidence?: string[] | Set<string>;
  scopes?: string[] | Set<string>;
  categories?: string[] | Set<string>;
  countries?: string[] | Set<string>;
  minSignificance?: number;
  mediaOnly?: boolean;
  uncertainOnly?: boolean;
  fromYear?: number;
  toYear?: number;
}

export interface HistuiViewport {
  orientation: "horizontal" | "vertical";
  placement: HistuiAxisPlacement;
  start: number;
  end: number;
  span: number;
  compressedSpan: number;
  visible: number;
  hidden: number;
  total: number;
  lod: unknown;
  timeBreaksEnabled: boolean;
  breaks: number;
  breakCount: number;
  skippedYears: number;
}

export interface HistuiTimelineOptions<RecordType = any> {
  container: Element | string;
  data?: unknown;
  records?: RecordType[];
  dataset?: unknown;
  config?: HistuiConfig;
  language?: string;
  direction?: "ltr" | "rtl";
  translator?: (key: string, values?: Record<string, unknown>) => string;
  themeId?: string;
  theme?: HistuiTheme;
  title?: string;
  description?: string;
  displayMode?: HistuiDisplayMode;
  controls?: boolean;
  replace?: boolean;
  selectInitial?: boolean;
  selectedId?: string;
  filters?: HistuiFilters;
  orientation?: HistuiOrientation;
  axisPlacement?: {
    horizontal?: HistuiAxisPlacement;
    vertical?: HistuiAxisPlacement;
  };
  lodEnabled?: boolean;
  explodeEnabled?: boolean;
  timeBreaksEnabled?: boolean;
  timeBreaks?: HistuiTimeBreakConfig;
  measurement?: HistuiMeasurementConfig;
  analytics?: {
    measurementId?: string;
  };
  onSelect?: (record: RecordType, instance: HistuiTimeline<RecordType>) => void;
  onViewportChange?: (viewport: HistuiViewport, instance: HistuiTimeline<RecordType>) => void;
  onRecordsChange?: (records: RecordType[], instance: HistuiTimeline<RecordType>) => void;
  onTrack?: (name: string, payload: Record<string, unknown>, instance: HistuiTimeline<RecordType>) => void;
}

export interface HistuiState<RecordType = any> {
  dataset: unknown;
  records: RecordType[];
  filteredRecords: RecordType[];
  facets: unknown;
  filters: HistuiFilters;
  selected: RecordType | null;
  viewport: HistuiViewport | null;
  language: string;
  direction: string;
  themeId: string;
  displayMode: HistuiDisplayMode;
  orientation: HistuiOrientation;
  axisPlacement: {
    horizontal: HistuiAxisPlacement;
    vertical: HistuiAxisPlacement;
  };
  lodEnabled: boolean;
  explodeEnabled: boolean;
  timeBreaksEnabled: boolean;
  timeBreaks: HistuiTimeBreakConfig;
  measurement: HistuiMeasurementConfig;
}

export class HistuiTimeline<RecordType = any> {
  constructor(options: HistuiTimelineOptions<RecordType>);
  setData(data: unknown, options?: { filters?: HistuiFilters; resetView?: boolean }): this;
  setRecords(records: RecordType[], options?: { dataset?: unknown; filters?: HistuiFilters; resetView?: boolean }): this;
  setFilters(filters: HistuiFilters, options?: { preserveView?: boolean }): this;
  resetFilters(options?: { preserveView?: boolean }): this;
  select(recordId: string, options?: { emit?: boolean }): this;
  focusRecord(recordId: string, options?: { animate?: boolean; emit?: boolean }): this;
  stepSelection(direction?: number): this;
  fit(options?: { animate?: boolean }): this;
  zoomBy(factor: number): this;
  setViewRange(startYear: number, endYear: number, options?: Record<string, unknown>): this;
  setOrientation(orientation: HistuiOrientation): this;
  setAxisPlacement(orientation: "horizontal" | "vertical", placement: HistuiAxisPlacement): this;
  setLodEnabled(enabled: boolean): this;
  setExplodeEnabled(enabled: boolean): this;
  setTimeBreaksEnabled(enabled: boolean): this;
  setTimeBreakOptions(options: HistuiTimeBreakConfig): this;
  setMeasurementOptions(options: HistuiMeasurementConfig): this;
  setMeasurementEnabled(enabled: boolean): this;
  setDisplayMode(displayMode: HistuiDisplayMode): this;
  setBroadcastMode(enabled: boolean): this;
  setLanguage(language: string, direction?: "ltr" | "rtl"): this;
  setTheme(themeOrId: string | HistuiTheme): this;
  applyTheme(theme: HistuiTheme): void;
  getState(): HistuiState<RecordType>;
  destroy(): void;
}

export interface HistuiTimeScaleSegment {
  kind: "dense" | "break";
  id: string;
  startYear: number;
  endYear: number;
  yearSpan: number;
  /** Start of the empty stretch the segment stands for, before context is kept back. */
  gapStartYear: number;
  gapEndYear: number;
  gapYears: number;
  /** True when a record runs across the break instead of the years being empty. */
  ongoing: boolean;
  startUnit: number;
  endUnit: number;
  unitSpan: number;
  scale: number;
}

export interface HistuiTimeBreakEntry {
  id?: string;
  startYear: number;
  endYear: number;
  unitSpan: number;
  gapStartYear?: number;
  gapEndYear?: number;
  ongoing?: boolean;
}

export class TimeScale {
  constructor(domain: { start: number; end: number }, breaks?: HistuiTimeBreakEntry[]);
  static identity(domain: { start: number; end: number }): TimeScale;
  readonly domain: { start: number; end: number };
  readonly segments: HistuiTimeScaleSegment[];
  readonly breaks: HistuiTimeScaleSegment[];
  readonly span: number;
  readonly hasBreaks: boolean;
  readonly skippedYears: number;
  readonly unitDomain: { start: number; end: number };
  toUnit(year: number): number;
  toYear(unit: number): number;
  denseSpansForRange(unitStart: number, unitEnd: number): Array<{ unitStart: number; unitEnd: number; yearStart: number; yearEnd: number }>;
  breaksForRange(unitStart: number, unitEnd: number): HistuiTimeScaleSegment[];
}

export function buildTimeScale(
  records: any[],
  domain: { start: number; end: number },
  options?: HistuiTimeBreakConfig,
  context?: { viewSpan?: number }
): TimeScale;
export function normalizeTimeBreakOptions(options?: HistuiTimeBreakConfig): Required<HistuiTimeBreakConfig>;
export const DEFAULT_TIME_BREAK_OPTIONS: Required<HistuiTimeBreakConfig>;
export const TIME_BREAK_LABELS: HistuiTimeBreakLabel[];

export function createHistuiTimeline<RecordType = any>(options: HistuiTimelineOptions<RecordType>): HistuiTimeline<RecordType>;
export function normalizeTimelineData(data: unknown, datasetConfig?: Record<string, unknown>): unknown;
export function normalizePastStruct(document: unknown, datasetConfig?: Record<string, unknown>): unknown;
export function createDefaultFilters(records: any[], facets?: unknown): HistuiFilters;
export function filterRecords<RecordType = any>(records: RecordType[], filters: HistuiFilters): RecordType[];
export function normalizeFilters(filters?: HistuiFilters, baseFilters?: HistuiFilters): HistuiFilters;
export const DEFAULT_HISTUI_CONFIG: HistuiConfig;
