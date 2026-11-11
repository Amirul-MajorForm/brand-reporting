// Top ads (per campaign): ad-level results plus a creative preview from TMR.
//
// Meta:   thumbnail / image, MP4 video, a shareable preview link (fb.me) and
//         the ad's headline.
// TikTok: video cover image and a playable MP4.
// Google: not supported (search ads are text only).
//
// The image / video links are signed CDN URLs that expire (Meta after a few
// days, TikTok after about 24 hours), so they are only cached as long as the
// rest of the data (5 minutes) and never stored.

import { normalizeRow } from './tmr.js';

export const ADS_PLATFORMS = ['meta', 'tiktok'];

export const ADS_DIMENSIONS = {
  meta: ['ad_name', 'fads_ad_creative_thumbnail_url', 'fads_ad_creative_image_url', 'fads_ad_creative_video_url',
         'fads_ad_preview_shareable_link', 'fads_ad_creative_title'],
  tiktok: ['ad_name', 'ttads_video_cover_url', 'ttads_video_preview_url'],
};

export const ADS_METRICS = {
  meta: ['amount_spent', 'impressions', 'clicks', 'fads_video_thruplay_watched_actions'],
  tiktok: ['amount_spent', 'impressions', 'clicks', 'ttads_video_play_actions', 'ttads_gmv_cost'],
};

// Creative text fields: carried through merges but never summed or used as keys
export const ADS_TEXT_FIELDS = [...new Set(Object.values(ADS_DIMENSIONS).flat().filter(d => d !== 'ad_name'))];

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

const text = (v, max = 160) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

// Rows come back once per ad and creative (a dynamic-creative ad can have
// several); merge them per ad name, keeping the first creative with a picture.
export function buildTopAds(rows, platform, { limit = 12 } = {}) {
  const byAd = new Map();
  for (const raw of rows || []) {
    const r = normalizeRow(raw);
    const name = text(r.ad_name, 300);
    if (!name) continue;
    const spend = parseFloat(r.spend) || 0;
    const ad = byAd.get(name) || {
      ad_name: name, spend: 0, impressions: 0, clicks: 0, video_views: 0, thruplays: 0, orders: 0, revenue: 0,
      preview: null,
    };
    ad.spend += spend;
    ad.impressions += parseFloat(r.impressions) || 0;
    ad.clicks += parseFloat(r.clicks) || 0;
    ad.video_views += parseFloat(r.video_play_actions) || 0;
    ad.thruplays += parseFloat(r.video_thruplay_watched_actions) || 0;
    ad.orders += r.orders || 0;
    ad.revenue += r.revenue || 0;

    const preview = platform === 'meta'
      ? {
          image: safeUrl(r.ad_creative_thumbnail_url) || safeUrl(r.ad_creative_image_url),
          video: safeUrl(r.ad_creative_video_url),
          link: safeUrl(r.ad_preview_shareable_link),
          title: text(r.ad_creative_title),
        }
      : { image: safeUrl(r.video_cover_url), video: safeUrl(r.video_preview_url), link: null, title: null };
    if (!ad.preview?.image && (preview.image || preview.video || preview.link)) ad.preview = preview;
    else if (ad.preview && !ad.preview.title && preview.title) ad.preview.title = preview.title;
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

  return { ads: ads.slice(0, limit), totalAds: ads.length };
}
