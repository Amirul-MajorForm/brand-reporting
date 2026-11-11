// OATSIDE branding, all in one place. PLACEHOLDER values: swap in the real
// logo (public/logo.svg) and brand colours when OATSIDE's assets arrive.
// Everything else (theme.js, sidebar, header, login, charts) reads from here.

export const BRAND = {
  client: 'OATSIDE',
  product: 'Performance Dashboard',
  preparedBy: 'Prepared by MajorForm',
  // Set to '/logo.svg' (put the file in frontend/public) to replace the wordmark
  logoUrl: null,
  colors: {
    primary: '#7a4a22',       // warm oat brown: buttons, active states, chart lines
    primaryDark: '#5c3616',   // hover / gradient end
    primaryOnDark: '#e2b98c', // primary used on dark backgrounds
    primarySoft: '#f3e8dc',   // tinted backgrounds (active filters, badges)
    sidebar: '#2a1f17',       // sidebar background (always dark)
    sidebarHover: '#3a2b20',
    sidebarActive: '#4a3627',
    sidebarBorder: '#3a2b20',
    sidebarText: '#cdb9a6',
    sidebarLabel: '#8c7764',
  },
};
