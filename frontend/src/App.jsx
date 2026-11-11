import { useState, useEffect, useCallback, useRef } from 'react';
import { DARK, LIGHT } from './theme.js';
import { fetchDashboard, fetchCommerce, fetchGoals, fetchCommerceMonthly, fetchSession, logout, setUnauthorizedHandler } from './api.js';
import { resolvePreset } from './dateRanges.js';
import Header from './components/Header.jsx';
import CampaignTable from './components/CampaignTable.jsx';
import CommerceLens from './components/CommerceLens.jsx';
import GoalTracker from './components/GoalTracker.jsx';
import TrendPanel from './components/TrendPanel.jsx';
import Sidebar from './components/Sidebar.jsx';
import Login from './components/Login.jsx';
import Splash from './components/Splash.jsx';

// The loading screen stays up until the first numbers arrive, but never longer
// than this (the tables then show their own loading placeholders)
const SPLASH_MAX_MS = 20000;
const SPLASH_FADE_MS = 350;

const MARKET_CODES = (...sources) => Object.assign({}, ...sources.map(s => s?.markets || {}));

// Light theme by default; the viewer's choice is remembered on this device only
function useDarkMode() {
  const [darkMode, setDarkMode] = useState(() => {
    try { return localStorage.getItem('os_theme') === 'dark'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('os_theme', darkMode ? 'dark' : 'light'); } catch { /* storage unavailable */ }
    document.documentElement.dataset.theme = darkMode ? 'dark' : 'light';
  }, [darkMode]);
  return [darkMode, setDarkMode];
}

// Sign-in gate: nothing but the login form renders (and no data endpoint is
// called) until the server confirms the session.
export default function App() {
  const [darkMode, setDarkMode] = useDarkMode();
  const [auth, setAuth] = useState('checking'); // checking | in | out
  const theme = darkMode ? DARK : LIGHT;

  useEffect(() => {
    setUnauthorizedHandler(() => setAuth('out'));
    fetchSession().then(r => setAuth(r.authenticated ? 'in' : 'out')).catch(() => setAuth('out'));
  }, []);

  const handleLogout = useCallback(async () => {
    try { await logout(); } catch { /* signed out locally anyway */ }
    setAuth('out');
  }, []);

  if (auth === 'checking') return <Splash />;
  if (auth === 'out') return <Login theme={theme} onSuccess={() => setAuth('in')} />;
  return <Dashboard darkMode={darkMode} setDarkMode={setDarkMode} onLogout={handleLogout} />;
}

function Dashboard({ darkMode, setDarkMode, onLogout }) {
  const [market, setMarket] = useState('sg');
  const [dateRange, setDateRange] = useState('7');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [fetchParams, setFetchParams] = useState({ dateRange: '7', startDate: '', endDate: '' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('brand');
  // Campaign trend chart: { campaign, platform, lens, currency } of the campaign being viewed
  const [trendTarget, setTrendTarget] = useState(null);
  const closeTrend = useCallback(() => setTrendTarget(null), []);
  // Commerce Lens data is only fetched once the tab is opened
  const [commerce, setCommerce] = useState(null); // { params, data }
  const [commerceLoading, setCommerceLoading] = useState(false);
  const [commerceError, setCommerceError] = useState(null);
  // Commerce monthly chart: since the start of the year, not tied to the date filter
  const [commerceMonthly, setCommerceMonthly] = useState({ data: null, loading: false, error: null, requested: false });
  // Goal tracking (Brand Lens) — loaded per date range, after/alongside brand data
  const [goals, setGoals] = useState(null); // { params, data }
  const [goalsLoading, setGoalsLoading] = useState(false);
  const [goalsError, setGoalsError] = useState(null);

  const theme = darkMode ? DARK : LIGHT;

  // Loading screen until the first brand data (or an error) arrives
  const [splash, setSplash] = useState('shown'); // shown | leaving | gone
  const firstLoadDone = data != null || error != null;
  useEffect(() => {
    if (splash !== 'shown') return undefined;
    if (firstLoadDone) { setSplash('leaving'); return undefined; }
    const t = setTimeout(() => setSplash('leaving'), SPLASH_MAX_MS);
    return () => clearTimeout(t);
  }, [firstLoadDone, splash]);
  useEffect(() => {
    if (splash !== 'leaving') return undefined;
    const t = setTimeout(() => setSplash('gone'), SPLASH_FADE_MS);
    return () => clearTimeout(t);
  }, [splash]);

  // First day of the selected range (YYYY-MM-DD), for "vs previous month" labels
  function computeRangeStart(params) {
    if (params.startDate) return params.startDate;
    const days = parseInt(params.dateRange);
    if (!days) return null;
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days)).toISOString().slice(0, 10);
  }

  function computeDateLabel(params) {
    if (params.startDate && params.endDate) {
      return `${fmtDateStr(params.startDate)} – ${fmtDateStr(params.endDate)}`;
    }
    const days = parseInt(params.dateRange);
    if (!days) return '';
    const now = new Date();
    const endUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
    const startUTC = new Date(Date.UTC(endUTC.getUTCFullYear(), endUTC.getUTCMonth(), endUTC.getUTCDate() - days + 1));
    return `${fmtDate(startUTC)} – ${fmtDate(endUTC)}`;
  }

  function fmtDate(d) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }

  function fmtDateStr(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }

  const dateLabel = computeDateLabel(fetchParams);

  const handleMarketChange = (val) => {
    setMarket(val);
    // No fetch — market switching is client-side filtering
  };

  const handleDateRangeChange = (val) => {
    setDateRange(val);
    if (val === 'custom') return;
    const preset = resolvePreset(val);
    setFetchParams(preset ? { dateRange: val, ...preset } : { dateRange: val, startDate: '', endDate: '' });
  };

  const handleApplyCustom = () => {
    if (customStart && customEnd && customStart <= customEnd) {
      setFetchParams({ dateRange: 'custom', startDate: customStart, endDate: customEnd });
    }
  };

  const abortRef = useRef(null);

  const load = useCallback(async () => {
    // Cancel any in-flight request before starting a new one
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      const result = await fetchDashboard(fetchParams, controller.signal);
      setData(result);
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [fetchParams]);

  useEffect(() => { load(); }, [load]);

  const commerceAbortRef = useRef(null);

  const loadCommerce = useCallback(async () => {
    if (commerceAbortRef.current) commerceAbortRef.current.abort();
    const controller = new AbortController();
    commerceAbortRef.current = controller;

    setCommerceLoading(true);
    setCommerceError(null);
    try {
      const result = await fetchCommerce(fetchParams, controller.signal);
      setCommerce({ params: fetchParams, data: result });
    } catch (e) {
      if (e.name !== 'AbortError') setCommerceError(e.message);
    } finally {
      if (commerceAbortRef.current === controller) setCommerceLoading(false);
    }
  }, [fetchParams]);

  // Fetch commerce data when the tab is open and we don't have it for this date range yet
  useEffect(() => {
    if (activeTab === 'commerce' && commerce?.params !== fetchParams) loadCommerce();
  }, [activeTab, fetchParams, commerce, loadCommerce]);

  const goalsAbortRef = useRef(null);

  const loadGoals = useCallback(async () => {
    if (goalsAbortRef.current) goalsAbortRef.current.abort();
    const controller = new AbortController();
    goalsAbortRef.current = controller;

    // Step 1: goals vs target (fast, uses the same data as the tables)
    setGoalsLoading(true);
    setGoalsError(null);
    try {
      const result = await fetchGoals(fetchParams, controller.signal);
      setGoals({ params: fetchParams, data: result });
    } catch (e) {
      if (e.name !== 'AbortError') setGoalsError(e.message);
      if (goalsAbortRef.current === controller) setGoalsLoading(false);
      return;
    }
    if (goalsAbortRef.current === controller) setGoalsLoading(false);

    // Step 2: previous-period trend (slower), fills in when ready
    try {
      const withTrend = await fetchGoals(fetchParams, controller.signal, { trend: true });
      if (goalsAbortRef.current === controller) setGoals({ params: fetchParams, data: withTrend });
    } catch (e) {
      if (e.name !== 'AbortError' && goalsAbortRef.current === controller) {
        setGoals(g => g && { ...g, data: { ...g.data, previousError: e.message } });
      }
    }
  }, [fetchParams]);

  useEffect(() => {
    if (activeTab === 'brand' && goals?.params !== fetchParams) loadGoals();
  }, [activeTab, fetchParams, goals, loadGoals]);

  const loadCommerceMonthly = useCallback(async () => {
    setCommerceMonthly(m => ({ ...m, loading: true, error: null, requested: true }));
    try {
      const data = await fetchCommerceMonthly();
      setCommerceMonthly({ data, loading: false, error: null, requested: true });
    } catch (e) {
      setCommerceMonthly(m => ({ ...m, loading: false, error: e.message }));
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'commerce' && !commerceMonthly.requested) loadCommerceMonthly();
  }, [activeTab, commerceMonthly.requested, loadCommerceMonthly]);

  const handleRefresh = () => {
    load();
    if (activeTab === 'brand') loadGoals();
    if (activeTab === 'commerce') loadCommerce();
  };

  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      overflow: 'hidden',
      fontFamily: "'DM Sans', sans-serif",
      color: theme.textPrimary,
      transition: 'background 0.25s, color 0.25s',
    }}>
      <style>{`
        @keyframes kpi-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>

      {splash !== 'gone' && <Splash leaving={splash === 'leaving'} />}

      <Sidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        darkMode={darkMode}
        onToggleDark={() => setDarkMode(d => !d)}
        onLogout={onLogout}
      />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: theme.bg }}>
        {/* Derive the current market's slice from the full all-markets response */}
      {(() => {
        const marketData = data?.markets?.[market] ?? null;
        const marketName = data?.markets?.[market]?.marketName || '';
        // Markets with at least one campaign in the current pull (ID/TH only show when present)
        const commerceData = commerce?.params === fetchParams ? commerce.data : null;
        const hasBrand = m => ['tiktok', 'meta', 'google'].some(p => m?.[p]?.campaigns?.length > 0);
        const hasCommerceCampaigns = m => ['tiktok', 'meta', 'google'].some(p => m?.commerceCampaigns?.[p]?.campaigns?.length > 0);
        const activeMarkets = new Set(
          Object.keys(MARKET_CODES(data, commerceData)).filter(code => activeTab === 'commerce'
            ? (commerceData?.markets?.[code]?.cpas?.length > 0 || hasCommerceCampaigns(data?.markets?.[code]))
            : hasBrand(data?.markets?.[code]))
        );
        const isCommerce = activeTab === 'commerce';
        const shownError = isCommerce ? (commerceError || error) : error;
        return (
          <>
            <Header
              theme={theme}
              darkMode={darkMode}
              market={market}
              onMarketChange={handleMarketChange}
              marketName={marketName}
              activeMarkets={activeMarkets}
              dateRange={dateRange}
              onDateRangeChange={handleDateRangeChange}
              customStart={customStart}
              customEnd={customEnd}
              onCustomStartChange={setCustomStart}
              onCustomEndChange={setCustomEnd}
              onApplyCustom={handleApplyCustom}
              dateLabel={dateLabel}
              onRefresh={handleRefresh}
              refreshing={isCommerce ? (loading || commerceLoading) : loading}
            />

            <main style={{ flex: 1, overflowY: 'auto', padding: '20px 20px 64px' }}>
              {shownError && (
                <div role="alert" style={{
                  background: theme.errorBg,
                  color: theme.errorText,
                  border: `1px solid ${theme.errorBorder}`,
                  padding: '12px 16px', borderRadius: 10, marginBottom: 20, fontSize: 14,
                }}>
                  {shownError}
                </div>
              )}

              {activeTab === 'brand' && (
                <>
                  <GoalTracker
                    theme={theme}
                    darkMode={darkMode}
                    goals={goals?.params === fetchParams ? goals.data?.markets?.[market] : null}
                    loading={goalsLoading}
                    error={goalsError}
                    previousRange={goals?.data?.previousRange}
                    previousError={goals?.data?.previousError}
                    marketName={marketName}
                    trendLoaded={goals?.params === fetchParams && !!goals.data?.trendLoaded}
                  />
                  <CampaignTable theme={theme} data={marketData} loading={loading} onTrend={setTrendTarget} />
                </>
              )}

              {isCommerce && (
                <CommerceLens
                  theme={theme}
                  commerce={commerceData?.markets?.[market]}
                  campaigns={marketData?.commerceCampaigns}
                  loading={commerceLoading || loading}
                  onTrend={setTrendTarget}
                  darkMode={darkMode}
                  marketName={marketName}
                  market={market}
                  rangeStart={computeRangeStart(fetchParams)}
                  monthly={{
                    ...commerceMonthly,
                    data: commerceMonthly.data && {
                      ...commerceMonthly.data,
                      series: commerceMonthly.data.markets?.[market] || [],
                    },
                  }}
                />
              )}

            </main>

            {trendTarget && (
              <TrendPanel
                target={trendTarget}
                params={fetchParams}
                goals={goals?.params === fetchParams ? goals.data?.markets?.[market] : null}
                theme={theme}
                darkMode={darkMode}
                onClose={closeTrend}
              />
            )}
          </>
        );
      })()}
      </div>
    </div>
  );
}
