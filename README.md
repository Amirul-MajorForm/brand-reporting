# OATSIDE client dashboard

A read-only, password-protected paid media dashboard for OATSIDE, prepared by
MajorForm. It is a client-facing build of the internal MajorView dashboard
(`Amirul-MajorForm/optimisation-lens`), deployed as its own Railway service so
the two can change independently.

**What the client sees**
- **Brand Lens**: per market (SG, MY, PH, VN; ID and TH only when they have
  data), TikTok / Meta / Google KPI tiles and tables (Spend, Impr., Reach, Video
  Views, Clicks, CTR, CPM, CPC, CPLV for traffic campaigns, ThruPlay and CPTP for
  Meta views campaigns), plus **goal tracking** (actual vs goal, % above or
  below, trend vs the previous period).
- **Commerce Lens**: Meta CPAS and commerce campaigns (Spend, Revenue, ROAS,
  Orders, CPA, totals), and a monthly chart since `COMMERCE_TREND_START` in SGD
  with platform filters.
- **Daily trend chart** per campaign (CPM / CTR / CPLV, ROAS in Commerce Lens).
- **Top ads** per campaign (Meta and TikTok), in the same panel: the 12
  highest-spend ads with a creative preview (image, playable video, and for Meta
  a "view ad as it appears" link and the ad headline), plus spend, impressions,
  CTR, CPM and ThruPlays / video views (ROAS and orders in Commerce Lens).
  Loaded only when the tab is opened (one TMR request).
- Date presets: last 7/14/30/60/90 days, month / quarter to date, this month,
  last month, custom.

**Left out on purpose** (agency internal): Sales Lens, LOW SPEND tags, the
October ICD exception note, Opti Notes, pacing / budget columns, naming-rule
footnotes, "not counted" ad lists, sheet status / hidden-row warnings, FOREX
notes and raw error messages. Errors are shown as friendly messages; details go
to the Railway logs.

## Security model
- **Login**: one shared password (`DASHBOARD_PASSWORD`). Sessions are signed,
  httpOnly, SameSite=Lax cookies (Secure over HTTPS), valid 7 days by default.
  Changing the password or `SESSION_SECRET` signs everyone out. Sign-in is rate
  limited (5 failures per IP per 15 minutes, plus a global cap).
- **OATSIDE data only**: the team id and every TMR account id are hard-coded in
  `backend/tmr.js`. `queryTMR` refuses any request whose team or accounts are not
  on that allowlist. The browser never sends account ids, team ids or field
  lists; it only picks a date range, and (for trend charts) a campaign the
  dashboard itself listed. Goal rows are kept only when their Brand is OATSIDE.
- **No open endpoints**: every `/api` route except `/api/session`, `/api/login`
  and `/api/logout` needs a session; there are no proxy-style endpoints.
- **Headers**: strict CSP, `X-Frame-Options: DENY`, `nosniff`, `no-referrer`,
  HSTS over HTTPS, `noindex`. No CORS headers are sent, and `/api` requests from
  any other origin are refused.

## Deploy on Railway
1. New service from this repo (`Amirul-MajorForm/brand-reporting`).
   `railway.json` sets the build (`npm run build`), start (`npm start`) and the
   `/health` check.
2. Variables:

   | Variable | Required | Notes |
   |---|---|---|
   | `TMR_API_KEY` | yes | Server side only, never sent to the browser |
   | `DASHBOARD_PASSWORD` | yes | Shared with OATSIDE; 16+ characters |
   | `SESSION_SECRET` | yes | `openssl rand -hex 32` |
   | `APP_ORIGIN` | recommended | Public URL, e.g. `https://oatside.up.railway.app` |
   | `TMR_TEAM_ID` | no | Defaults to the MajorForm team |
   | `GOALS_SHEET_PUB_URL`, `GOALS_BRAND_GID`, `GOALS_FX_GID` | no | Defaults to the MajorPace sheet |
   | `COMMERCE_TREND_START` | no | Default `2026-01-01` |
   | `TMR_TIMEOUT_MS`, `SESSION_TTL_HOURS`, `LOGIN_MAX_FAILURES` | no | |

3. Generate a domain (Settings > Networking), then set `APP_ORIGIN` to it.
4. Run one instance only (rate limits, cache and the TMR queue are in memory).

## Before go-live
- [ ] **Publish only what the server needs from MajorPace.** The whole sheet is
      currently published to the web, including other clients. Prefer publishing
      a dedicated OATSIDE goals tab and the FOREX tab only (File > Share > Publish
      to web > select the tabs), then set `GOALS_SHEET_PUB_URL` / `GOALS_*_GID`.
- [ ] **TMR quota is shared** with the internal dashboard if both use the same
      team / key (15 run-query requests per minute). Each service queues its own
      requests, so heavy use of both at once can slow each other down.
- [ ] Branding uses the official OATSIDE logo (`frontend/public/logo-*.png`)
      and the oatside.com palette (black, `#F7DF53` yellow, `#487CBA` blue,
      `#F2F2F2` grey, red / green accents), all set in `frontend/src/brand.js`.
      Confirm with OATSIDE that they're happy with it. Their site's heading
      font (Recoleta) is a licensed font and is not used here.
- [ ] Choose a long password and share it with OATSIDE through a private channel.

## Known limitations
- Markets come from the **account** for Meta and TikTok rows (TMR's
  `account_id` / `advertiser_id` dimension), so a campaign named `ID_...` run
  from the SG Meta account shows under SG in SGD. If TMR ever rejects that
  dimension, the app falls back to the campaign-name prefix automatically (logged
  as `[TMR] retrying without ...`). Google is SG / VN only and uses the prefix.
- ID Meta CPAS bills in two currencies (IDR and SGD), so Commerce Lens shows two
  separate CPAS blocks for ID instead of one total.
- TikTok has no ThruPlay; TikTok views campaigns show a dash for ThruPlay / CPTP.
  TikTok also refuses Reach summed over more than one day, so TikTok Reach shows
  a dash for multi-day ranges.
- Ad preview links from TMR are signed CDN URLs that expire (Meta after a few
  days, TikTok after about 24 hours). They are fetched fresh with each load and
  never stored; a tab left open past expiry shows "Preview not available" until
  refreshed. Only https links on Meta / TikTok hosts are passed to the browser,
  and the page's CSP allows images and video from exactly those CDNs. Google has
  no Top ads (search ads are text only).
- Signing out clears the cookie in that browser; to end every session at once,
  change `SESSION_SECRET` (or the password).

## Development and tests
```bash
npm run build          # frontend + backend dependencies, frontend bundle
npm test               # API, login, isolation and security tests (fake TMR server)
npm run test:e2e       # Playwright checks at 1280px and 1440px (needs the build)
npm run dev            # local preview on fake data; prints URL and password
```
The fake TMR server (`tests/fake-tmr.js`) returns real-shaped numbers for every
OATSIDE account and also holds another client's accounts, so the tests can prove
those are never requested or returned.
