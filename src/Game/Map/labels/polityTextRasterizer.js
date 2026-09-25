const GENERIC_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "emoji",
  "math",
  "fangsong",
]);

const quoteFontFamily = (family) => {
  const value = String(family ?? "").trim();
  if (!value) return "";
  if (GENERIC_FAMILIES.has(value.toLowerCase())) return value;
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
};

export const buildFontFamilyCss = (families = []) => (
  families.map(quoteFontFamily).filter(Boolean).join(", ") || "serif"
);

export const waitForFontStack = async ({ families, sampleText = "RUSSIAN FEDERATION", sizePx = 128 }) => {
  if (typeof document === "undefined" || !document.fonts) return;
  const familyCss = buildFontFamilyCss(families);
  const shorthand = `${Math.max(12, Number(sizePx) || 128)}px ${familyCss}`;
  try {
    await Promise.race([
      document.fonts.load(shorthand, sampleText),
      new Promise((resolve) => setTimeout(resolve, 1200)),
    ]);
  } catch {
    // The browser will use the same fallback stack during canvas shaping.
  }
};

// Where the text sits and how big its canvas is, from the font's metrics alone.
const layoutPolityText = ({
  text,
  fontFamilies,
  fontSizePx = 128,
  fontWeight = 400,
  fontStyle = "normal",
  letterSpacingEm = 0.06,
  haloWidthPx = 5,
  paddingPx = 12,
} = {}) => {
  if (typeof document === "undefined") {
    throw new Error("Polity text rasterization requires a browser canvas.");
  }

  const value = String(text ?? "").trim();
  if (!value) throw new Error("Polity text rasterization requires non-empty text.");

  const familyCss = buildFontFamilyCss(fontFamilies);
  const fontSize = Math.max(16, Number(fontSizePx) || 128);
  const haloWidth = Math.max(0, Number(haloWidthPx) || 0);
  const padding = Math.max(4, Number(paddingPx) || 0) + haloWidth * 2;
  const font = `${fontStyle} ${fontWeight} ${fontSize}px ${familyCss}`;

  const probe = document.createElement("canvas");
  const probeContext = probe.getContext("2d");
  if (!probeContext) throw new Error("Canvas2D is unavailable for polity text rasterization.");
  probeContext.font = font;
  probeContext.fontKerning = "normal";
  if ("letterSpacing" in probeContext) {
    probeContext.letterSpacing = `${Number(letterSpacingEm) || 0}em`;
  }

  const metrics = probeContext.measureText(value);
  const letterSpacingPx = Math.max(0, Number(letterSpacingEm) || 0) * fontSize;
  const fallbackSpacing = "letterSpacing" in probeContext ? 0 : Math.max(0, value.length - 1) * letterSpacingPx;
  const width = Math.max(1, metrics.width + fallbackSpacing);
  const ascent = metrics.actualBoundingBoxAscent || fontSize * 0.78;
  const descent = metrics.actualBoundingBoxDescent || fontSize * 0.22;
  const canvasWidth = Math.ceil(width + padding * 2);
  const canvasHeight = Math.ceil(ascent + descent + padding * 2);

  return {
    value,
    haloWidth,
    metrics: {
      width: canvasWidth,
      height: canvasHeight,
      contentWidth: width,
      contentHeight: ascent + descent,
      fontSizePx: fontSize,
      paddingPx: padding,
      ascent,
      descent,
      aspectRatio: canvasWidth / Math.max(1, canvasHeight),
      familyCss,
      font,
    },
  };
};

// A label's size without its pixels, which is all its layout needs. The pixels
// are drawn when the label is first uploaded (polityTextRasterLifetime.js), so a
// label that never comes into view never costs any: on a phone, most of them.
export const measurePolityText = (options = {}) => ({ canvas: null, ...layoutPolityText(options).metrics });

export const rasterizePolityText = (options = {}) => {
  const { value, haloWidth, metrics } = layoutPolityText(options);
  const {
    letterSpacingEm = 0.06,
    fillStyle = "rgba(255, 52, 214, 1)",
    haloStyle = "rgba(0, 0, 0, 0.95)",
  } = options;

  const canvas = document.createElement("canvas");
  canvas.width = metrics.width;
  canvas.height = metrics.height;

  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("Canvas2D is unavailable for polity text rasterization.");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = metrics.font;
  context.fontKerning = "normal";
  if ("letterSpacing" in context) {
    context.letterSpacing = `${Number(letterSpacingEm) || 0}em`;
  }
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  context.lineJoin = "round";
  context.miterLimit = 2;

  const x = metrics.paddingPx;
  const y = metrics.paddingPx + metrics.ascent;
  if (haloWidth > 0) {
    context.strokeStyle = haloStyle;
    context.lineWidth = haloWidth * 2;
    context.strokeText(value, x, y);
  }
  context.fillStyle = fillStyle;
  context.fillText(value, x, y);

  return { canvas, ...metrics };
};
