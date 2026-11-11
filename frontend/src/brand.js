// OATSIDE branding, all in one place. Colours are taken from oatside.com's own
// stylesheet; the logo is the official wordmark (frontend/public/logo-*.png).
// Everything else (theme.js, sidebar, header, login, charts) reads from here.

export const BRAND = {
  client: 'OATSIDE',
  product: 'Performance Dashboard',
  preparedBy: 'Prepared by MajorForm',
  logo: {
    onDark: '/logo-white.png',
    onLight: '/logo-black.png',
    aspect: 738 / 131, // width / height of the logo files
  },
  colors: {
    // oatside.com palette
    ink: '#000000',        // text, borders, logo
    inkSoft: '#1a1818',    // near-black used on the site
    yellow: '#F7DF53',     // signature button / highlight (black text, black border)
    blue: '#487CBA',       // primary button
    red: '#DB5B54',
    green: '#76A780',
    orange: '#C97840',
    pink: '#F0BEC8',
    grey: '#F2F2F2',       // footer / secondary button background
    greyText: '#707070',   // footer text

    // Derived for this dashboard
    blueText: '#35659F',   // blue darkened to pass WCAG AA as small text on white
    sidebar: '#1a1818',
    sidebarHover: '#262323',
    sidebarActive: '#302c2c',
    sidebarBorder: '#2a2626',
    sidebarText: '#c4c0bc',
    sidebarLabel: '#8c8884',
  },
};
