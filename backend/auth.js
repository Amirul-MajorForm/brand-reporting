// Login for the client dashboard. Two shared passwords, two roles:
//   DASHBOARD_PASSWORD -> 'client'  (OATSIDE: view only)
//   EDITOR_PASSWORD    -> 'editor'  (MajorForm: also drafts / edits / publishes commentary)
//
// Sessions are stateless signed cookies, so they survive Railway restarts and
// redeploys without a database:
//   cookie value = <role>.<expiresAt>.<HMAC-SHA256(role + expiresAt + password fingerprint)>
// Changing either password or SESSION_SECRET signs everyone out.
// The cookie is httpOnly, SameSite=Lax, and Secure whenever the request came in
// over HTTPS (Railway terminates TLS and sets X-Forwarded-Proto).

import { createHmac, createHash, randomBytes, timingSafeEqual } from 'crypto';

export const COOKIE_NAME = 'os_session';
const SESSION_HOURS = Number(process.env.SESSION_TTL_HOURS) || 24 * 7;

const PASSWORD = process.env.DASHBOARD_PASSWORD || '';
const EDITOR_PASSWORD = process.env.EDITOR_PASSWORD || '';
export const ROLES = ['client', 'editor'];
let SECRET = process.env.SESSION_SECRET || '';
if (!SECRET) {
  SECRET = randomBytes(32).toString('hex');
  console.warn('[auth] SESSION_SECRET is not set: using a random one, so everyone is signed out on every restart. Set SESSION_SECRET in Railway.');
}
if (!PASSWORD) console.error('[auth] DASHBOARD_PASSWORD is not set: nobody can sign in until it is.');
else if (PASSWORD.length < 12) console.warn('[auth] DASHBOARD_PASSWORD is shorter than 12 characters; use a longer one.');
if (EDITOR_PASSWORD && EDITOR_PASSWORD === PASSWORD) console.error('[auth] EDITOR_PASSWORD equals DASHBOARD_PASSWORD: editor sign-in is disabled until they differ.');

const sha256 = s => createHash('sha256').update(String(s)).digest();
const PASSWORD_FINGERPRINT = sha256(`pw:${PASSWORD}|${EDITOR_PASSWORD}`).toString('hex');

function sign(role, expiresAt) {
  return createHmac('sha256', SECRET).update(`${role}.${expiresAt}.${PASSWORD_FINGERPRINT}`).digest('base64url');
}

function safeEqual(a, b) {
  // Hash first so the comparison is constant-time whatever the lengths
  return timingSafeEqual(sha256(a), sha256(b));
}

// Returns the role for a correct password, or null. Both comparisons always
// run, so timing does not reveal which password matched.
export function checkPassword(candidate) {
  if (typeof candidate !== 'string' || candidate.length > 512) return null;
  const isClient = !!PASSWORD && safeEqual(candidate, PASSWORD);
  const isEditor = !!EDITOR_PASSWORD && EDITOR_PASSWORD !== PASSWORD && safeEqual(candidate, EDITOR_PASSWORD);
  return isEditor ? 'editor' : isClient ? 'client' : null;
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// The session's role ('client' | 'editor'), or null when not signed in
export function sessionRole(req) {
  if (!PASSWORD && !EDITOR_PASSWORD) return null;
  const value = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!value) return null;
  const [role, exp, sig] = value.split('.');
  const expiresAt = Number(exp);
  if (!ROLES.includes(role) || !Number.isFinite(expiresAt) || expiresAt < Date.now() || !sig) return null;
  if (role === 'editor' && (!EDITOR_PASSWORD || EDITOR_PASSWORD === PASSWORD)) return null;
  if (role === 'client' && !PASSWORD) return null;
  return safeEqual(sig, sign(role, expiresAt)) ? role : null;
}

export const isAuthenticated = req => sessionRole(req) != null;

function cookieAttributes(req, maxAgeSeconds) {
  return [
    'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`,
    ...(req.secure ? ['Secure'] : []),
  ].join('; ');
}

export function setSessionCookie(req, res, role) {
  const expiresAt = Date.now() + SESSION_HOURS * 3600 * 1000;
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${role}.${expiresAt}.${sign(role, expiresAt)}; ${cookieAttributes(req, SESSION_HOURS * 3600)}`);
}

export function clearSessionCookie(req, res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; ${cookieAttributes(req, 0)}`);
}

// Every /api route except the login endpoints goes through this
export function requireAuth(req, res, next) {
  const role = sessionRole(req);
  if (role) { req.role = role; return next(); }
  res.status(401).json({ error: 'Please sign in.' });
}

// MajorForm-only routes (commentary drafts and edits)
export function requireEditor(req, res, next) {
  if (sessionRole(req) === 'editor') return next();
  res.status(403).json({ error: 'Only MajorForm editors can do this.' });
}

// ---------------------------------------------------------------- rate limiting
// Failed sign-ins per IP: LOGIN_MAX_FAILURES per LOGIN_WINDOW_MS, then locked
// until the window passes. Plus a global cap so a botnet spread over many IPs
// still cannot guess quickly. In memory: resets on restart, which is acceptable
// for one instance.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = Number(process.env.LOGIN_MAX_FAILURES) || 5;
const GLOBAL_MAX_FAILURES = 100;
const failures = new Map(); // ip -> [timestamps]
let globalFailures = [];

const prune = list => list.filter(t => Date.now() - t < LOGIN_WINDOW_MS);

export function loginBlocked(ip) {
  globalFailures = prune(globalFailures);
  const mine = prune(failures.get(ip) || []);
  if (mine.length) failures.set(ip, mine); else failures.delete(ip);
  if (mine.length >= LOGIN_MAX_FAILURES || globalFailures.length >= GLOBAL_MAX_FAILURES) {
    const oldest = Math.min(...(mine.length >= LOGIN_MAX_FAILURES ? mine : globalFailures));
    return Math.ceil((oldest + LOGIN_WINDOW_MS - Date.now()) / 1000);
  }
  return 0;
}

export function recordFailure(ip) {
  failures.set(ip, [...prune(failures.get(ip) || []), Date.now()]);
  globalFailures.push(Date.now());
  // Bound memory if many IPs try
  if (failures.size > 10000) failures.delete(failures.keys().next().value);
}

export function clearFailures(ip) {
  failures.delete(ip);
}
