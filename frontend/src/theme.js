import { BRAND } from './brand.js';

const C = BRAND.colors;

export const LIGHT = {
  dark: false,
  bg: '#f7f3ee',
  surface: '#ffffff',
  surfaceHover: '#fbf8f4',
  surfaceAlt: '#f2ece5',
  border: '#e6ddd3',
  borderStrong: '#d3c6b8',
  textPrimary: '#241a13',
  textSecondary: '#5b4c40',
  textMuted: '#8a7b6e',
  accent: C.primary,
  accentStrong: C.primaryDark,
  accentLight: C.primarySoft,
  chart: C.primary,
  good: '#047857', goodBg: '#ecfdf5',
  bad: '#b91c1c', badBg: '#fef2f2',
  errorBg: '#fee2e2', errorText: '#991b1b', errorBorder: '#fecaca',
};

export const DARK = {
  dark: true,
  bg: '#16110d',
  surface: '#211913',
  surfaceHover: '#2a2019',
  surfaceAlt: '#1c1510',
  border: '#33281f',
  borderStrong: '#45372b',
  textPrimary: '#f5efe8',
  textSecondary: '#cbbcae',
  textMuted: '#93816f',
  accent: C.primaryOnDark,
  accentStrong: C.primaryOnDark,
  accentLight: '#3a2b20',
  chart: C.primaryOnDark,
  good: '#34d399', goodBg: 'rgba(52,211,153,0.12)',
  bad: '#f87171', badBg: 'rgba(248,113,113,0.12)',
  errorBg: '#3b0a0a', errorText: '#fca5a5', errorBorder: '#7f1d1d',
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
