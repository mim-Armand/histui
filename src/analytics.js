let analyticsReady = false;

export function initializeAnalytics({ measurementId, appName = "Histui" } = {}) {
  const id = String(measurementId || "").trim();
  if (!id || analyticsReady || typeof window === "undefined") return;

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    window.dataLayer.push(arguments);
  };
  window.gtag("js", new Date());
  window.gtag("config", id, { app_name: appName });

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.append(script);
  analyticsReady = true;
}

export function trackAnalyticsEvent(name, params = {}) {
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;
  window.gtag("event", name, params);
}

