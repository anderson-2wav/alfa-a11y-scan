#!/usr/bin/env node
/**
 * Calculate WCAG contrast ratio between two hex colors.
 * Uses the same algorithm as Siteimprove Alfa (WCAG 2.x, IEC 61966-2-1 sRGB).
 *
 * Usage:
 *   node scripts/color-contrast.js <color1> <color2>
 *
 * Examples:
 *   node scripts/color-contrast.js "#ffffff" "#767676"
 *   node scripts/color-contrast.js fff 333333
 */

function parseHex(hex) {
  const h = hex.replace(/^#/, "");
  if (!/^([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(h)) {
    throw new Error(`Invalid hex color: "${hex}"`);
  }
  const full = h.length === 3
    ? h.split("").map((c) => c + c).join("")
    : h;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

// IEC 61966-2-1 sRGB linearisation — matches Alfa's implementation
function toLinear(channel) {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance({ r, g, b }) {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function contrastRatio(hex1, hex2) {
  const l1 = relativeLuminance(parseHex(hex1));
  const l2 = relativeLuminance(parseHex(hex2));
  const lighter = Math.max(l1, l2);
  const darker  = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function wcagRating(ratio, large = false) {
  if (large) {
    if (ratio >= 4.5) return "AAA";
    if (ratio >= 3.0) return "AA";
    return "Fail";
  }
  if (ratio >= 7.0) return "AAA";
  if (ratio >= 4.5) return "AA";
  if (ratio >= 3.0) return "AA Large / AAA Large — Fail for normal text";
  return "Fail";
}

const [, , hex1, hex2] = process.argv;

if (!hex1 || !hex2) {
  console.error("Usage: node scripts/color-contrast.js <color1> <color2>");
  process.exit(1);
}

let ratio;
try {
  ratio = contrastRatio(hex1, hex2);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

console.log(`Color 1:        #${hex1.replace(/^#/, "").toUpperCase()}`);
console.log(`Color 2:        #${hex2.replace(/^#/, "").toUpperCase()}`);
console.log(`Contrast ratio: ${ratio.toFixed(2)}:1`);
console.log(`Normal text:    ${wcagRating(ratio, false)}`);
console.log(`Large text:     ${wcagRating(ratio, true)}  (18pt+ or 14pt+ bold)`);
