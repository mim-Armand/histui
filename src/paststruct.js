export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function textOf(value, language, fallback = "en") {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value[language]) return value[language];
  const baseLanguage = language.split("-")[0];
  if (value[baseLanguage]) return value[baseLanguage];
  if (value[fallback]) return value[fallback];
  if (value.en) return value.en;
  const first = Object.values(value).find((entry) => typeof entry === "string" && entry.trim());
  return first || "";
}

export function collectLanguageText(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(collectLanguageText).join(" ");
  if (typeof value === "object") {
    return Object.values(value).map(collectLanguageText).join(" ");
  }
  return String(value);
}

export function parseEDTFDate(value) {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  const normalized = trimmed.replace(/[?~%]$/, "");
  const match = normalized.match(/^([+-]?)([0-9X]{4,6})(?:-([0-9X]{2})(?:-([0-9X]{2}))?)?$/);
  if (!match) return null;

  const sign = match[1] === "-" ? -1 : 1;
  const yearDigits = match[2].replaceAll("X", "0");
  let year = sign * Number.parseInt(yearDigits, 10);
  if (!Number.isFinite(year)) return null;

  const month = match[3] && !match[3].includes("X") ? Number.parseInt(match[3], 10) : 1;
  const day = match[4] && !match[4].includes("X") ? Number.parseInt(match[4], 10) : 1;
  const monthOffset = Number.isFinite(month) ? Math.max(0, Math.min(11, month - 1)) / 12 : 0;
  const dayOffset = Number.isFinite(day) ? Math.max(0, Math.min(30, day - 1)) / 365 : 0;

  return {
    raw: value,
    year,
    month,
    day,
    value: year + monthOffset + dayOffset,
    approximate: /[~%]$/.test(trimmed),
    uncertain: /[?%]$/.test(trimmed),
    precision: match[4] ? "day" : match[3] ? "month" : value.includes("X") ? "approximate" : "year"
  };
}

export function formatYear(year, language = "en", t) {
  if (!Number.isFinite(year)) return "";
  const rounded = Math.trunc(year);
  const numberFormatter = new Intl.NumberFormat(language, { useGrouping: false });
  if (rounded <= 0) {
    const bceYear = Math.abs(rounded) + 1;
    return `${numberFormatter.format(bceYear)} ${t ? t("bce") : "BCE"}`;
  }
  return `${numberFormatter.format(rounded)} ${t ? t("ce") : "CE"}`;
}

export function formatEDTFToken(value, language = "en", t) {
  const parsed = parseEDTFDate(value);
  if (!parsed) return value || "";
  const prefix = parsed.approximate ? `${t ? t("circa") : "c."} ` : "";
  const clean = value.replace(/[?~%]$/, "");
  const parts = clean.split("-");
  const yearToken = parts[0] === "" ? `-${parts[1]}` : parts[0];
  const year = parsed.year;

  if (parsed.precision === "day" && parsed.year > 0 && !clean.includes("X")) {
    const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
    return `${prefix}${new Intl.DateTimeFormat(language, {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC"
    }).format(date)}`;
  }

  if (parsed.precision === "month" && parsed.year > 0 && !clean.includes("X")) {
    const date = new Date(Date.UTC(parsed.year, parsed.month - 1, 1));
    return `${prefix}${new Intl.DateTimeFormat(language, {
      year: "numeric",
      month: "short",
      timeZone: "UTC"
    }).format(date)}`;
  }

  if (yearToken.includes("X")) return `${prefix}${yearToken}`;
  return `${prefix}${formatYear(year, language, t)}`;
}

export function primaryAttestation(record) {
  const dates = record.temporal?.dates || [];
  return [...dates].sort((a, b) => (a.rank || 99) - (b.rank || 99))[0] || null;
}

export function attestationRange(attestation) {
  const date = attestation?.date || {};
  const start = parseEDTFDate(date.from || date.earliestFrom || date.latestFrom);
  const explicitEnd = date.to || date.latestTo || date.earliestTo;
  const currentYear = new Date().getUTCFullYear();
  const end = date.ongoing
    ? { raw: "present", year: currentYear, value: currentYear }
    : parseEDTFDate(explicitEnd || date.from || date.latestFrom || date.earliestFrom);

  if (!start && !end) return { start: 0, end: 0 };
  const startValue = start?.value ?? end.value;
  const endValue = Math.max(end?.value ?? startValue, startValue);
  return { start: startValue, end: endValue };
}

export function formatExtent(attestation, language = "en", fallback = "en", t) {
  if (!attestation?.date) return "";
  const date = attestation.date;
  const start = formatEDTFToken(date.from || date.earliestFrom || date.latestFrom, language, t);
  const endToken = date.ongoing ? (t ? t("ongoing") : "present") : date.to || date.latestTo || date.earliestTo;
  const end = endToken && endToken !== date.from ? formatEDTFToken(endToken, language, t) : "";
  const circa = date.circa && !String(date.from || "").endsWith("~") ? `${t ? t("circa") : "c."} ` : "";
  const original = attestation.original?.text ? textOf(attestation.original.text, language, fallback) : attestation.original?.value || "";
  const range = end ? `${circa}${start} - ${end}` : `${circa}${start}`;
  return original ? `${range} (${original})` : range;
}

export function normalizePastStruct(document, datasetConfig = {}) {
  const isDataset = Boolean(document.records);
  const dataset = isDataset
    ? document.dataset
    : {
        id: document.id,
        title: document.label,
        defaultLanguage: datasetConfig.defaultLanguage || "en",
        languages: datasetConfig.languages || ["en"]
      };
  const records = isDataset ? document.records : [document];
  const fallbackLanguage = dataset.defaultLanguage || datasetConfig.defaultLanguage || "en";

  const normalized = records
    .map((record) => normalizeRecord(record, fallbackLanguage, dataset.id))
    .sort((a, b) => a.__meta.start - b.__meta.start || a.__meta.importance - b.__meta.importance);

  return {
    paststructVersion: document.paststructVersion || "1.0",
    dataset,
    records: normalized,
    fallbackLanguage
  };
}

export function normalizeRecord(record, fallbackLanguage = "en", datasetId = "") {
  const attestations = (record.temporal?.dates || []).map((attestation) => {
    const range = attestationRange(attestation);
    return { ...attestation, __range: range };
  });
  const preferred = [...attestations].sort((a, b) => (a.rank || 99) - (b.rank || 99))[0] || null;
  const range = preferred?.__range || { start: 0, end: 0 };
  const scale = record.significance?.scale || 10;
  const value = record.significance?.value || Math.max(4, record.recordType === "event" ? 5 : 6);
  const importance = Math.max(1, Math.min(10, Math.round((value / scale) * 10)));
  const categories = (record.categories || []).map((category) => [category.main, category.sub].filter(Boolean).join(" / "));
  const countries = [...new Set((record.places || []).map((place) => place.modernCountry).filter(Boolean))];
  const confidence = preferred?.confidence || "unknown";
  const temporalUncertainty = confidence !== "certain" || Boolean(preferred?.date?.circa) || /[?~%]/.test(preferred?.date?.from || "");

  const searchText = [
    collectLanguageText(record.label),
    collectLanguageText(record.description),
    collectLanguageText(record.notes),
    collectLanguageText(record.keywords),
    collectLanguageText(record.funFacts),
    collectLanguageText(record.entities),
    collectLanguageText(record.places),
    record.id,
    record.recordType,
    record.type,
    record.factuality,
    categories.join(" "),
    countries.join(" ")
  ].join(" ").toLocaleLowerCase();

  return {
    ...record,
    temporal: {
      ...record.temporal,
      dates: attestations
    },
    __meta: {
      datasetId,
      fallbackLanguage,
      preferred,
      start: range.start,
      end: Math.max(range.end, range.start),
      duration: Math.max(0, range.end - range.start),
      importance,
      confidence,
      scope: record.significance?.scope || "local",
      categories,
      countries,
      hasMedia: Boolean(record.media?.length),
      temporalUncertainty,
      searchText
    }
  };
}

export function collectFacets(records, language = "en", fallback = "en") {
  const facets = {
    recordTypes: new Map(),
    types: new Map(),
    factuality: new Map(),
    confidence: new Map(),
    scopes: new Map(),
    categories: new Map(),
    countries: new Map()
  };

  function add(map, key, label = key) {
    if (!key) return;
    const entry = map.get(key) || { key, label, count: 0 };
    entry.count += 1;
    map.set(key, entry);
  }

  for (const record of records) {
    add(facets.recordTypes, record.recordType);
    add(facets.types, record.type);
    add(facets.factuality, record.factuality || "unknown");
    add(facets.confidence, record.__meta.confidence || "unknown");
    add(facets.scopes, record.__meta.scope || "local");
    for (const category of record.__meta.categories) add(facets.categories, category);
    for (const country of record.__meta.countries) add(facets.countries, country);
  }

  return Object.fromEntries(
    Object.entries(facets).map(([key, value]) => {
      return [
        key,
        [...value.values()].sort((a, b) => {
          if (b.count !== a.count) return b.count - a.count;
          return a.label.localeCompare(b.label, language);
        })
      ];
    })
  );
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function compactLabel(value) {
  return String(value || "")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
