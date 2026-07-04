import { textOf } from "./paststruct.js";

export function getTheme(config, themeId) {
  return config.themes?.find((theme) => theme.id === themeId) || config.themes?.[0] || null;
}

export function applyTheme(theme, target = document.documentElement) {
  if (!theme || !target) return;
  target.dataset.theme = theme.id;
  for (const [key, value] of Object.entries(theme.colors || {})) {
    target.style.setProperty(`--${toKebab(key)}`, value);
  }
  target.style.setProperty("--type-event", "var(--accent3)");
  target.style.setProperty("--type-process", "var(--accent)");
  target.style.setProperty("--type-period", "var(--accent2)");
  target.style.setProperty("--type-phenomenon", "var(--accent4)");
  target.style.setProperty("--type-structure", "var(--accent2)");
}

export function localizedThemeLabel(theme, language) {
  return textOf(theme?.label, language, "en") || theme?.id || "";
}

function toKebab(value) {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

