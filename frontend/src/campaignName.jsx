// Helpers for long campaign names such as
//   VN_TikTok_OATSIDE_Awareness_CPM_Reach_2026_Deluxe-TopSearch-Phase1
// Naming convention: Market_Platform_Brand_Objective_Model_Goal_Year_Descriptor

// Split a name into its convention parts. Returns null when the name does not
// follow the convention (no 4-digit year segment after the first few parts).
export function parseCampaignName(name) {
  const parts = (name || '').split('_');
  const yearIdx = parts.findIndex((p, i) => i >= 3 && /^20\d\d$/.test(p));
  if (yearIdx < 0 || yearIdx === parts.length - 1) return null;
  return {
    objective: parts[3] || '',
    goal: yearIdx >= 6 ? parts[5] : '',
    year: parts[yearIdx],
    descriptor: parts.slice(yearIdx + 1).join(' '),
  };
}

// Render a long name so the browser can wrap it at "_" and "-" instead of
// cutting it off. <wbr> marks optional line-break points.
export function BreakableName({ name }) {
  const pieces = (name || '').split(/(?<=[_-])/);
  return pieces.map((p, i) => (
    <span key={i}>{p}{i < pieces.length - 1 && <wbr />}</span>
  ));
}
