import { useEffect, useState } from 'react';

// Branded loading screen (styles in index.html, shared with the static first
// paint). Shown while the session is checked and until the first numbers
// arrive after sign-in. The message changes if the wait gets long.
const MESSAGES = [
  [0, 'Loading your dashboard'],
  [4000, 'Pulling the latest numbers from Meta, TikTok and Google'],
  [12000, 'Almost there. Longer date ranges can take a little longer'],
];

export default function Splash({ leaving = false }) {
  const [message, setMessage] = useState(MESSAGES[0][1]);
  useEffect(() => {
    const timers = MESSAGES.slice(1).map(([ms, text]) => setTimeout(() => setMessage(text), ms));
    return () => timers.forEach(clearTimeout);
  }, []);
  return (
    <div className={`os-splash${leaving ? ' os-splash--leaving' : ''}`} role="status" aria-live="polite" aria-busy={!leaving} data-testid="splash">
      <div className="os-logo" aria-hidden="true"><div className="os-logo-fill" /></div>
      <p key={message} className="os-splash-msg">{message}</p>
    </div>
  );
}
