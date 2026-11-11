// All requests are same-origin; the session lives in an httpOnly cookie the
// browser sends automatically. A 401 anywhere means the session ended.
let onUnauthorized = () => {};
export const setUnauthorizedHandler = fn => { onUnauthorized = fn; };

const FALLBACK = "We couldn't load this data right now. Please try again in a few minutes.";

async function request(path, { signal, method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method, signal, credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error('Could not reach the dashboard. Check your connection and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/login') onUnauthorized();
  if (!res.ok) throw Object.assign(new Error(data.error || FALLBACK), { status: res.status });
  return data;
}

function withRange(path, { dateRange, startDate, endDate }, extra = {}) {
  const params = new URLSearchParams({ dateRange: String(dateRange), ...extra });
  if (startDate && endDate) {
    params.set('startDate', startDate);
    params.set('endDate', endDate);
  }
  return `${path}?${params}`;
}

export const fetchSession = () => request('/api/session');
export const login = password => request('/api/login', { method: 'POST', body: { password } });
export const logout = () => request('/api/logout', { method: 'POST', body: {} });

// Brand Lens: brand accounts (plus _Sales_ / _Conversion_ campaigns split out for Commerce Lens)
export const fetchDashboard = (params, signal) => request(withRange('/api/dashboard', params), { signal });

// Brand Lens goal tracking for this range
export const fetchGoals = (params, signal, { trend = false } = {}) =>
  request(withRange('/api/goals', params, trend ? { trend: '1' } : {}), { signal });

// Campaign trend chart: daily data for one campaign, requested only when opened
export const fetchTrend = (params, { campaign, platform, lens, lpv = false, rev = false }, signal) =>
  request(withRange('/api/trend', params, { campaign, platform, lens, ...(lpv ? { lpv: '1' } : {}), ...(rev ? { rev: '1' } : {}) }), { signal });

// Top ads with creative previews for one campaign (Meta / TikTok), on demand
export const fetchAds = (params, { campaign, platform, lens, rev = false }, signal) =>
  request(withRange('/api/ads', params, { campaign, platform, lens, ...(rev ? { rev: '1' } : {}) }), { signal });

// Commerce Lens header chart: monthly totals since the start of the year
export const fetchCommerceMonthly = signal => request('/api/commerce/monthly', { signal });

// Commerce Lens: Meta CPAS accounts, only requested when the tab is opened
export const fetchCommerce = (params, signal) => request(withRange('/api/commerce', params), { signal });
