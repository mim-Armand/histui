export const DEFAULT_HISTUI_CONFIG = {
  app: {
    name: "Histui",
    defaultLanguage: "en",
    languages: ["en", "fa"],
    defaultTheme: "obsidian-lab",
    displayMode: "standard",
    orientation: "auto",
    axisPlacement: {
      horizontal: "center",
      vertical: "side-start"
    }
  },
  analytics: {
    googleAnalyticsMeasurementId: ""
  },
  timeline: {
    minZoomSpanYears: 2,
    maxZoomMultiplier: 2.5,
    defaultPaddingRatio: 0.08,
    inertia: {
      enabled: true,
      friction: 0.92,
      wheelFriction: 0.86,
      minVelocity: 0.02
    },
    navigator: {
      enabled: true,
      animationMs: 420,
      trackInsetPx: 18,
      minSelectionPixels: 10
    },
    measurement: {
      enabled: false,
      transient: false,
      fadeOutMs: 1200
    },
    lod: {
      enabled: true,
      thresholds: [
        { spanYears: 2600, minSignificance: 9, labelMode: "icon" },
        { spanYears: 1100, minSignificance: 8, labelMode: "short" },
        { spanYears: 450, minSignificance: 7, labelMode: "short" },
        { spanYears: 170, minSignificance: 5, labelMode: "standard" },
        { spanYears: 0, minSignificance: 1, labelMode: "full" }
      ]
    },
    explode: {
      enabled: false,
      maxVisible: 34,
      minVisible: 10,
      layers: 6,
      densityPixels: 8800,
      animationMs: 620
    }
  },
  themes: [
    {
      id: "obsidian-lab",
      label: {
        en: "Obsidian Lab",
        fa: "آزمایشگاه آبسیدین"
      },
      colors: {
        background: "#0f1412",
        surface: "#151b18",
        surfaceRaised: "#202821",
        panel: "#111714",
        text: "#edf2ea",
        muted: "#9ba89d",
        line: "#35433b",
        grid: "#26322c",
        accent: "#4fb7a5",
        accent2: "#d4b45f",
        accent3: "#f0705a",
        accent4: "#81c7d4",
        shadow: "rgba(0, 0, 0, 0.42)"
      }
    },
    {
      id: "museum-glass",
      label: {
        en: "Museum Glass",
        fa: "شیشه موزه"
      },
      colors: {
        background: "#f4f2ec",
        surface: "#fffdf8",
        surfaceRaised: "#ffffff",
        panel: "#ebe7dd",
        text: "#242820",
        muted: "#697163",
        line: "#cec7b8",
        grid: "#ded8cb",
        accent: "#257c78",
        accent2: "#a66b2c",
        accent3: "#b84740",
        accent4: "#4a7c9f",
        shadow: "rgba(67, 54, 32, 0.16)"
      }
    },
    {
      id: "graphite-citrus",
      label: {
        en: "Graphite Citrus",
        fa: "گرافیت مرکباتی"
      },
      colors: {
        background: "#191a18",
        surface: "#22231f",
        surfaceRaised: "#2d3029",
        panel: "#141512",
        text: "#f5f7ed",
        muted: "#a9b09d",
        line: "#474b3f",
        grid: "#33382e",
        accent: "#b5d342",
        accent2: "#42b6a3",
        accent3: "#e86f4f",
        accent4: "#f0bd52",
        shadow: "rgba(0, 0, 0, 0.38)"
      }
    }
  ]
};
