import { BRAND } from './brand.js';

const C = BRAND.colors;

// highlight = OATSIDE's yellow button look (yellow fill, black text, black border)
export const LIGHT = {
  dark: false,
  bg: C.grey,
  surface: '#ffffff',
  surfaceHover: '#fafafa',
  surfaceAlt: '#f7f7f7',
  border: '#e2e2e2',
  borderStrong: '#c9c9c9',
  textPrimary: C.ink,
  textSecondary: '#3d3d3d',
  textMuted: C.greyText,
  accent: C.blueText,
  accentStrong: C.blueText,
  accentLight: '#e8eff8',
  chart: C.blue,
  highlight: C.yellow, onHighlight: C.ink, highlightBorder: C.ink,
  good: '#2f6b3c', goodBg: '#ebf4ed', goodLine: C.green,
  bad: '#b23c35', badBg: '#fcedec', badLine: C.red,
  errorBg: '#fcedec', errorText: '#9b2f29', errorBorder: '#f3c4c1',
};

export const DARK = {
  dark: true,
  bg: '#121010',
  surface: C.inkSoft,
  surfaceHover: '#232020',
  surfaceAlt: '#161414',
  border: '#2e2a2a',
  borderStrong: '#433d3d',
  textPrimary: '#f5f5f5',
  textSecondary: '#c9c9c9',
  textMuted: '#959595',
  accent: '#9dbde6',
  accentStrong: '#9dbde6',
  accentLight: '#22303f',
  chart: '#7fa6d6',
  highlight: C.yellow, onHighlight: C.ink, highlightBorder: C.yellow,
  good: '#93cfa0', goodBg: 'rgba(118,167,128,0.16)', goodLine: C.green,
  bad: '#f19a94', badBg: 'rgba(219,91,84,0.16)', badLine: C.red,
  errorBg: '#3a1614', errorText: '#f4aaa5', errorBorder: '#6e2a26',
};

// Currencies with no minor unit in practice: show whole numbers
const ZERO_DECIMAL = new Set(['VND', 'IDR']);

// opts.code = false prints a money value without the currency code
export function fmt(value, type, currency, { code = true } = {}) {
  if (value == null || (typeof value === 'number' && !isFinite(value))) return '—';
  switch (type) {
    case 'currency': {
      const dp = ZERO_DECIMAL.has(currency) ? 0 : 2;
      const num = Number(value).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
      if (!code) return num;
      return currency ? `${currency} ${num}` : num;
    }
    case 'compact-currency':
      return value >= 1000
        ? `$${(value / 1000).toFixed(1)}k`
        : `$${value.toFixed(2)}`;
    case 'number':
      return Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 });
    case 'percent':
      return `${Number(value).toFixed(2)}%`;
    case 'roas':
      return `${Number(value).toFixed(2)}x`;
    case 'compact': {
      const n = Number(value);
      if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
      if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
      return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
    }
    default:
      return String(value);
  }
}
