export function getDatasetBounds(records) {
  if (!records.length) {
    const year = new Date().getUTCFullYear();
    return { start: year - 10, end: year + 10 };
  }
  const starts = records.map((record) => record.__meta.start).filter(Number.isFinite);
  const ends = records.map((record) => record.__meta.end).filter(Number.isFinite);
  return {
    start: Math.min(...starts, ...ends),
    end: Math.max(...starts, ...ends)
  };
}

export function createDefaultFilters(records, facets = {}) {
  const bounds = getDatasetBounds(records);
  return {
    search: "",
    recordTypes: new Set((facets.recordTypes || []).map((item) => item.key)),
    types: new Set((facets.types || []).map((item) => item.key)),
    factuality: new Set((facets.factuality || []).map((item) => item.key)),
    confidence: new Set((facets.confidence || []).map((item) => item.key)),
    scopes: new Set((facets.scopes || []).map((item) => item.key)),
    categories: new Set((facets.categories || []).map((item) => item.key)),
    countries: new Set((facets.countries || []).map((item) => item.key)),
    minSignificance: 1,
    mediaOnly: false,
    uncertainOnly: false,
    fromYear: Math.floor(bounds.start),
    toYear: Math.ceil(bounds.end)
  };
}

export function normalizeFilters(filters = {}, baseFilters = {}) {
  const merged = { ...baseFilters, ...filters };
  for (const key of ["recordTypes", "types", "factuality", "confidence", "scopes", "categories", "countries"]) {
    if (Array.isArray(merged[key])) merged[key] = new Set(merged[key]);
    else if (!(merged[key] instanceof Set)) merged[key] = new Set(merged[key] ? [merged[key]] : []);
  }
  return merged;
}

export function filterRecords(records, filters) {
  if (!filters) return records;
  const query = String(filters.search || "").trim().toLocaleLowerCase();
  return records.filter((record) => {
    if (query && !record.__meta.searchText.includes(query)) return false;
    if (filters.recordTypes instanceof Set && !filters.recordTypes.has(record.recordType)) return false;
    if (record.type && filters.types instanceof Set && !filters.types.has(record.type)) return false;
    if (filters.factuality instanceof Set && !filters.factuality.has(record.factuality || "unknown")) return false;
    if (filters.confidence instanceof Set && !filters.confidence.has(record.__meta.confidence || "unknown")) return false;
    if (filters.scopes instanceof Set && !filters.scopes.has(record.__meta.scope || "local")) return false;
    if (record.__meta.categories.length && filters.categories instanceof Set && !record.__meta.categories.some((category) => filters.categories.has(category))) return false;
    if (record.__meta.countries.length && filters.countries instanceof Set && !record.__meta.countries.some((country) => filters.countries.has(country))) return false;
    if (record.__meta.importance < Number(filters.minSignificance || 1)) return false;
    if (filters.mediaOnly && !record.__meta.hasMedia) return false;
    if (filters.uncertainOnly && !record.__meta.temporalUncertainty) return false;
    if (Number.isFinite(filters.fromYear) && record.__meta.end < filters.fromYear) return false;
    if (Number.isFinite(filters.toYear) && record.__meta.start > filters.toYear) return false;
    return true;
  });
}
