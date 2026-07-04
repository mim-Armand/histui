export type HistuiOrientation = "auto" | "horizontal" | "vertical";
export type HistuiAxisPlacement = "center" | "side-start" | "side-end";

export interface HistuiTheme {
  id: string;
  label?: Record<string, string> | string;
  colors: Record<string, string>;
}

export interface HistuiConfig {
  app?: {
    name?: string;
    defaultLanguage?: string;
    languages?: string[];
    defaultTheme?: string;
    orientation?: HistuiOrientation;
    axisPlacement?: {
      horizontal?: HistuiAxisPlacement;
      vertical?: HistuiAxisPlacement;
    };
  };
  analytics?: {
    googleAnalyticsMeasurementId?: string;
  };
  timeline?: Record<string, unknown>;
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
  span: number;
  visible: number;
  hidden: number;
  total: number;
  lod: unknown;
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
  orientation: HistuiOrientation;
  axisPlacement: {
    horizontal: HistuiAxisPlacement;
    vertical: HistuiAxisPlacement;
  };
  lodEnabled: boolean;
  explodeEnabled: boolean;
}

export class HistuiTimeline<RecordType = any> {
  constructor(options: HistuiTimelineOptions<RecordType>);
  setData(data: unknown, options?: { filters?: HistuiFilters; resetView?: boolean }): this;
  setRecords(records: RecordType[], options?: { dataset?: unknown; filters?: HistuiFilters; resetView?: boolean }): this;
  setFilters(filters: HistuiFilters, options?: { preserveView?: boolean }): this;
  resetFilters(options?: { preserveView?: boolean }): this;
  select(recordId: string, options?: { emit?: boolean }): this;
  fit(options?: { animate?: boolean }): this;
  zoomBy(factor: number): this;
  setViewRange(start: number, end: number, options?: Record<string, unknown>): this;
  setOrientation(orientation: HistuiOrientation): this;
  setAxisPlacement(orientation: "horizontal" | "vertical", placement: HistuiAxisPlacement): this;
  setLodEnabled(enabled: boolean): this;
  setExplodeEnabled(enabled: boolean): this;
  setLanguage(language: string, direction?: "ltr" | "rtl"): this;
  setTheme(themeOrId: string | HistuiTheme): this;
  applyTheme(theme: HistuiTheme): void;
  getState(): HistuiState<RecordType>;
  destroy(): void;
}

export function createHistuiTimeline<RecordType = any>(options: HistuiTimelineOptions<RecordType>): HistuiTimeline<RecordType>;
export function normalizeTimelineData(data: unknown, datasetConfig?: Record<string, unknown>): unknown;
export function normalizePastStruct(document: unknown, datasetConfig?: Record<string, unknown>): unknown;
export function createDefaultFilters(records: any[], facets?: unknown): HistuiFilters;
export function filterRecords<RecordType = any>(records: RecordType[], filters: HistuiFilters): RecordType[];
export function normalizeFilters(filters?: HistuiFilters, baseFilters?: HistuiFilters): HistuiFilters;
export const DEFAULT_HISTUI_CONFIG: HistuiConfig;

