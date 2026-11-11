// Security headers and same-origin enforcement for the client dashboard.

// APP_ORIGIN (e.g. https://oatside.up.railway.app) pins the one origin allowed
// to call the API. Without it, the origin is taken from the request's own host
// (Railway forwards X-Forwarded-Proto / Host), which still blocks other sites.
const APP_ORIGIN = (process.env.APP_ORIGIN || '').replace(/\/+$/, '');

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // React inline style attributes and the small <style> blocks need inline styles
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

export function securityHeaders(req, res, next) {
  res.set({
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Robots-Tag': 'noindex, nofollow',
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

export function ownOrigin(req) {
  return APP_ORIGIN || `${req.protocol}://${req.get('host')}`;
}

// Browsers send Origin on every cross-origin request and on same-origin
// POSTs; reject any request whose Origin (or Referer, as a fallback) is not
// this app. Requests without either (curl, same-origin GETs) are allowed
// through to the auth check.
export function sameOriginOnly(req, res, next) {
  const origin = req.get('origin');
  const referer = req.get('referer');
  let from = origin;
  if (!from && referer) { try { from = new URL(referer).origin; } catch { from = 'invalid'; } }
  if (from && from !== ownOrigin(req)) {
    console.warn(`[security] blocked ${req.method} ${req.path} from origin ${from}`);
    return res.status(403).json({ error: 'Forbidden.' });
  }
  // State-changing requests must say where they came from
  if (req.method !== 'GET' && req.method !== 'HEAD' && !from) {
    return res.status(403).json({ error: 'Forbidden.' });
  }
  next();
}
