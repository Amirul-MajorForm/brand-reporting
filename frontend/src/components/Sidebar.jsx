import { BRAND } from '../brand.js';

// Sidebar colours are always dark regardless of light/dark mode
const C = BRAND.colors;
const S = {
  bg: C.sidebar,
  hover: C.sidebarHover,
  active: C.sidebarActive,
  border: C.sidebarBorder,
  text: C.sidebarText,
  textActive: '#ffffff',
  label: C.sidebarLabel,
  accent: C.yellow,
};

// Brand Lens: megaphone (awareness / brand campaigns)
const ICON_BRAND = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 11v2a1 1 0 0 0 1 1h3l6 4V6L7 10H4a1 1 0 0 0-1 1z"/>
    <path d="M16.5 8.5a5 5 0 0 1 0 7"/>
    <path d="M19 6a8.5 8.5 0 0 1 0 12"/>
  </svg>
);

// Commerce Lens: shopping bag (marketplace / sales campaigns)
const ICON_COMMERCE = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
    <path d="M3 6h18"/>
    <path d="M16 10a4 4 0 0 1-8 0"/>
  </svg>
);

const ICON_MOON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  </svg>
);

const ICON_SUN = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="5"/>
    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
  </svg>
);

const ICON_LOGOUT = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
    <path d="M16 17l5-5-5-5"/>
    <path d="M21 12H9"/>
  </svg>
);

const TABS = [
  { id: 'brand',    label: 'Brand Lens',    icon: ICON_BRAND },
  { id: 'commerce', label: 'Commerce Lens', icon: ICON_COMMERCE },
];

// The OATSIDE logo, white on dark backgrounds and black on light ones
export function Wordmark({ width = 132, onDark = true }) {
  return (
    <img src={onDark ? BRAND.logo.onDark : BRAND.logo.onLight} alt={BRAND.client}
      width={width} height={Math.round(width / BRAND.logo.aspect)} style={{ display: 'block' }} />
  );
}

function FooterButton({ onClick, icon, label }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 9,
        border: 'none', cursor: 'pointer', background: 'transparent', color: S.text, textAlign: 'left',
        fontSize: 13.5, fontFamily: "'DM Sans', sans-serif", transition: 'background 0.12s, color 0.12s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = S.hover; e.currentTarget.style.color = '#fff'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = S.text; }}
    >
      <span style={{ flexShrink: 0, opacity: 0.8 }}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

export default function Sidebar({ activeTab, onTabChange, darkMode, onToggleDark, onLogout }) {
  return (
    <nav aria-label="Main" style={{
      width: 208,
      flexShrink: 0,
      background: S.bg,
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      position: 'sticky',
      top: 0,
      zIndex: 100,
      borderRight: `1px solid ${S.border}`,
    }}>
      <div style={{ padding: '24px 20px 20px', borderBottom: `1px solid ${S.border}` }}>
        <Wordmark />
        <div style={{ fontSize: 11.5, color: S.label, marginTop: 8 }}>{BRAND.product}</div>
      </div>

      <div style={{ flex: 1, padding: '20px 12px', overflowY: 'auto' }}>
        {TABS.map(tab => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              aria-current={isActive ? 'page' : undefined}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px',
                borderRadius: 9, border: 'none', cursor: 'pointer',
                background: isActive ? S.active : 'transparent',
                color: isActive ? S.textActive : S.text,
                textAlign: 'left', fontSize: 13.5, fontWeight: isActive ? 600 : 400,
                fontFamily: "'DM Sans', sans-serif", marginBottom: 2,
                boxShadow: isActive ? `inset 3px 0 0 ${S.accent}` : 'none',
                transition: 'background 0.12s, color 0.12s',
              }}
              onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = S.hover; e.currentTarget.style.color = '#fff'; } }}
              onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = S.text; } }}
            >
              <span style={{ flexShrink: 0, opacity: isActive ? 1 : 0.75 }}>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      <div style={{ padding: '14px 12px', borderTop: `1px solid ${S.border}`, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <FooterButton onClick={onToggleDark} icon={darkMode ? ICON_SUN : ICON_MOON} label={darkMode ? 'Light mode' : 'Dark mode'} />
        <FooterButton onClick={onLogout} icon={ICON_LOGOUT} label="Sign out" />
        <div style={{ fontSize: 11, color: S.label, padding: '10px 12px 2px' }}>{BRAND.preparedBy}</div>
      </div>
    </nav>
  );
}
