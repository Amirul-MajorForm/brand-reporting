import { useState } from 'react';
import { login } from '../api.js';
import { BRAND } from '../brand.js';
import { Wordmark } from './Sidebar.jsx';

export default function Login({ theme, onSuccess }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async e => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(password);
      setPassword('');
      onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: theme.bg }}>
      <form onSubmit={submit} style={{
        width: 'min(380px, 100%)', background: theme.surface, border: `1px solid ${theme.border}`,
        borderRadius: 16, padding: '32px 28px', boxShadow: '0 12px 40px rgba(42,31,23,0.08)',
      }}>
        <div style={{ background: BRAND.colors.sidebar, borderRadius: 12, padding: '18px 20px', marginBottom: 24 }}>
          <Wordmark size={22} />
          <div style={{ fontSize: 12, color: BRAND.colors.sidebarText, marginTop: 8 }}>{BRAND.product}</div>
        </div>
        <label htmlFor="password" style={{ display: 'block', fontSize: 13, fontWeight: 600, color: theme.textPrimary, marginBottom: 6 }}>
          Password
        </label>
        <input
          id="password" type="password" autoComplete="current-password" autoFocus required
          value={password} onChange={e => setPassword(e.target.value)}
          aria-invalid={!!error} aria-describedby={error ? 'login-error' : undefined}
          style={{
            width: '100%', padding: '10px 12px', fontSize: 14, borderRadius: 9,
            border: `1px solid ${error ? theme.bad : theme.borderStrong}`, background: theme.surface,
            color: theme.textPrimary, fontFamily: "'DM Sans', sans-serif", outlineColor: theme.accent,
          }}
        />
        {error && <div id="login-error" role="alert" style={{ fontSize: 13, color: theme.errorText, marginTop: 8 }}>{error}</div>}
        <button type="submit" disabled={busy || !password} style={{
          width: '100%', marginTop: 18, padding: '11px 14px', fontSize: 14, fontWeight: 600, borderRadius: 9,
          border: 'none', background: theme.accent, color: theme.dark ? theme.bg : '#fff',
          cursor: busy || !password ? 'not-allowed' : 'pointer', opacity: busy || !password ? 0.6 : 1,
          fontFamily: "'DM Sans', sans-serif",
        }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <div style={{ fontSize: 11.5, color: theme.textMuted, textAlign: 'center', marginTop: 20 }}>{BRAND.preparedBy}</div>
      </form>
    </div>
  );
}
