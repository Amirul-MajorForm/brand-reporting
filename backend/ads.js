// Top ads (per campaign): ad-level results plus a creative preview from TMR.
//
// Two separate TMR queries, so slow creative lookups never block the numbers:
//   stats:    ad_name + metrics (fast, like the daily trend). Feeds Top ads and
//             the Commerce Lens language split.
//   previews: ad_name + creative fields. TikTok looks up each ad's video, which
//             can take TMR past its 60s limit; if so the cards keep their
//             numbers and show "Preview not available".
//
// Meta:   thumbnail / image, MP4 video, a shareable preview link (fb.me) and
//         the ad's headline.
// TikTok: video cover image and a playable MP4.
// Google: not supported (search ads are text only).
//
// The image / video links are signed CDN URLs that expire (Meta after a few
// days, TikTok after about 24 hours), so they are cached briefly and never stored.

import { normalizeRow } from './tmr.js';

export const ADS_PLATFORMS = ['meta', 'tiktok'];

export const PREVIEW_DIMENSIONS = {
  meta: ['ad_name', 'fads_ad_creative_thumbnail_url', 'fads_ad_creative_image_url', 'fads_ad_creative_video_url',
         'fads_ad_preview_shareable_link', 'fads_ad_creative_title'],
  tiktok: ['ad_name', 'ttads_video_cover_url', 'ttads_video_preview_url'],
};

// TikTok GMV fields (ttads_gmv_*) must never be asked for per ad: TMR does not
// support GMV fields together with ad-level fields ("Fields from group
// gmv_campaigns cannot be selected with fields from group ad_dimensions"), and
// its run-query API does not reject that, it hangs until a 504 after 60s.
// GMV Max reports at campaign level only, so TikTok ads have no revenue here.
export const ADS_METRICS = {
  meta: ['amount_spent', 'impressions', 'clicks', 'fads_video_thruplay_watched_actions'],
  tiktok: ['amount_spent', 'impressions', 'clicks', 'ttads_video_play_actions'],
};

// Orders / revenue per ad, by source (Meta only; see above for TikTok)
export const ADS_REVENUE = {
  cpas: ['fads_collab_action_omni_purchase', 'fads_collab_ads_value_omni_purchase'],
  meta: ['fads_all_purchases', 'fads_purchase_conversions_all'],
};

export const isAdLevelSafe = metric => !/^ttads_gmv_/.test(metric);

// Creative text fields: carried through merges but never summed or used as keys
export const ADS_TEXT_FIELDS = [...new Set(Object.values(PREVIEW_DIMENSIONS).flat().filter(d => d !== 'ad_name'))];

// Only links to the platforms' own CDNs / preview hosts are passed to the
// browser (the page's Content-Security-Policy allows exactly these for images
// and video). Anything else is dropped.
const ALLOWED_HOSTS = [/\.fbcdn\.net$/, /^fb\.me$/, /(^|\.)facebook\.com$/, /\.tiktokcdn\.com$/, /\.tiktokcdn-us\.com$/];

export function safeUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 4000) return null;
  let url;
  try { url = new URL(value.trim()); } catch { return null; }
  if (url.protocol === 'http:') url.protocol = 'https:'; // TikTok sometimes returns http covers
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  return ALLOWED_HOSTS.some(re => re.test(url.hostname)) ? url.toString() : null;
}

// Language from the ad name: a code standing on its own, e.g.
// GIF_1126_NA_Prospecting_11.11_BM, GIF_Offer_NA_10.10 EN_PROSP, GIF_NA_10.10 Sale_BI.
// The last one in the name wins; the campaign name is the fallback.
export const LANGUAGES = {
  EN: 'English', BM: 'Bahasa Melayu', MS: 'Bahasa Melayu', BI: 'Bahasa Indonesia',
  ZH: 'Chinese', CN: 'Chinese', TH: 'Thai', VI: 'Vietnamese', TL: 'Filipino', FIL: 'Filipino', TAG: 'Taglish',
};
const LANG_ALIAS = { MS: 'BM', CN: 'ZH', FIL: 'TL' };
const LANG_RE = new RegExp(`(?:^|[_\\s.-])(${Object.keys(LANGUAGES).join('|')})(?=$|[_\\s.-])`, 'g');

export function languageOf(...names) {
  for (const name of names) {
    const found = [...String(name || '').toUpperCase().matchAll(LANG_RE)].map(m => m[1]);
    if (found.length) { const code = found[found.length - 1]; return LANG_ALIAS[code] || code; }
  }
  return null;
}

const text = (v, max = 160) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

// Totals per language across ALL ads of the campaign (not just the top ones)
function languageSummary(ads, campaign) {
  const by = new Map();
  for (const a of ads) {
    const code = languageOf(a.ad_name, campaign) || 'OTHER';
    const t = by.get(code) || { code, label: LANGUAGES[code] || 'No language tag', ads: 0, spend: 0, impressions: 0, clicks: 0, orders: 0, revenue: 0 };
    t.ads += 1;
    for (const k of ['spend', 'impressions', 'clicks', 'orders', 'revenue']) t[k] += a[k] || 0;
    by.set(code, t);
  }
  const totalSpend = [...by.values()].reduce((s, t) => s + t.spend, 0);
  return [...by.values()]
    .map(t => ({
      ...t,
      spendShare: totalSpend > 0 ? (t.spend / totalSpend) * 100 : null,
      ctr: t.impressions > 0 ? (t.clicks / t.impressions) * 100 : null,
      cpm: t.impressions > 0 ? (t.spend / t.impressions) * 1000 : null,
      roas: t.spend > 0 && t.revenue > 0 ? t.revenue / t.spend : null,
      cpa: t.spend > 0 && t.orders > 0 ? t.spend / t.orders : null,
    }))
    .sort((a, b) => (a.code === 'OTHER') - (b.code === 'OTHER') || b.spend - a.spend);
}

// Ad-level numbers, ranked by spend, plus the per-language summary
export function buildTopAds(rows, platform, { limit = 12, campaign = '' } = {}) {
  const byAd = new Map();
  for (const raw of rows || []) {
    const r = normalizeRow(raw);
    const name = text(r.ad_name, 300);
    if (!name) continue;
    const spend = parseFloat(r.spend) || 0;
    const ad = byAd.get(name) || {
      ad_name: name, spend: 0, impressions: 0, clicks: 0, video_views: 0, thruplays: 0, orders: 0, revenue: 0,
    };
    ad.spend += spend;
    ad.impressions += parseFloat(r.impressions) || 0;
    ad.clicks += parseFloat(r.clicks) || 0;
    ad.video_views += parseFloat(r.video_play_actions) || 0;
    ad.thruplays += parseFloat(r.video_thruplay_watched_actions) || 0;
    ad.orders += r.orders || 0;
    ad.revenue += r.revenue || 0;
    byAd.set(name, ad);
  }

  const ads = [...byAd.values()]
    .filter(a => a.spend > 0 || a.impressions > 0 || a.revenue > 0)
    .map(a => ({
      ...a,
      ctr: a.impressions > 0 ? (a.clicks / a.impressions) * 100 : null,
      cpm: a.impressions > 0 ? (a.spend / a.impressions) * 1000 : null,
      roas: a.spend > 0 && a.revenue > 0 ? a.revenue / a.spend : null,
      cpa: a.spend > 0 && a.orders > 0 ? a.spend / a.orders : null,
      video_views: a.video_views || null,
      thruplays: a.thruplays || null,
    }))
    .sort((a, b) => b.spend - a.spend || b.impressions - a.impressions);

  return { ads: ads.slice(0, limit), totalAds: ads.length, languages: languageSummary(ads, campaign) };
}

// Creative preview per ad name. Rows come back once per ad and creative (a
// dynamic-creative ad can have several); keep the first one with a picture.
export function buildPreviews(rows, platform) {
  const previews = {};
  for (const raw of rows || []) {
    const r = normalizeRow(raw);
    const name = text(r.ad_name, 300);
    if (!name) continue;
    const p = platform === 'meta'
      ? {
          image: safeUrl(r.ad_creative_thumbnail_url) || safeUrl(r.ad_creative_image_url),
          video: safeUrl(r.ad_creative_video_url),
          link: safeUrl(r.ad_preview_shareable_link),
          title: text(r.ad_creative_title),
        }
      : { image: safeUrl(r.video_cover_url), video: safeUrl(r.video_preview_url), link: null, title: null };
    const prev = previews[name];
    if (!prev?.image && (p.image || p.video || p.link || p.title)) previews[name] = { ...p, title: p.title || prev?.title || null };
    else if (prev && !prev.title && p.title) prev.title = p.title;
  }
  return previews;
}
