// Writes one market's weekly commentary with Claude, from the facts built in
// facts.js. Server side only: the API key never reaches the browser, and the
// browser can only ask for a (re)draft of a fixed prompt, never send its own.

import Anthropic from '@anthropic-ai/sdk';

export const MODEL = process.env.COMMENTARY_MODEL || 'claude-opus-5-5';

// Adapted from MajorForm's weekly-commentary template
const SYSTEM = `You write the weekly paid media commentary for one market of a client's performance dashboard (client: OATSIDE, prepared by the MajorForm agency). It is read by the client.

You receive JSON facts for last week (Monday-Sunday) and the week before, per section (each platform's brand campaigns, Meta CPAS, and sales & conversion campaigns), with every value, % change and 12-week average already computed. Use only these numbers. Never calculate new numbers, never estimate, never invent campaigns, ads, audiences, budgets or causes that the facts do not support. If something is not in the facts, do not mention it.

Write in Markdown with exactly this structure, leaving out any section that has no data:

### Executive summary
- Bullet points only. Factual, objective statements. No emotional or subjective language (never "strong week", "mixed results", "encouraging").
- First bullet: total brand spend and total commerce spend this week with their week-on-week change, from the "figures" block (all in S$).
- Then one bullet per campaign type and platform, with volume (impressions, landing page views, video views or orders) and the primary metric in the form "CPM decreased by 12% from S$5.20 to S$4.58".

### Brand
#### <Platform>
One block per campaign (or per group of campaigns of the same type when there are many small ones):
**<Campaign type> — <short campaign label from the end of the name>**
- **Spend:** S$X → S$Y (▲/▼ X% WoW)
- **<Primary metric>:** S$X → S$Y (▲/▼ X% WoW) | 12-week avg: S$Z
- **CTR / Frequency:** X% / X.Xx  (frequency for Meta only)

Then 2-3 sentences interpreting the numbers: compare the primary metric with its 12-week average, call out the "noteworthy" flags, and give a likely cause only when the facts point to one (e.g. frequency above 3.0 suggests creative fatigue; a spend change of more than 20%). Assess each campaign only against its own history, never against a campaign with a different objective.

### Commerce
Same block format per Meta CPAS block and per sales & conversion section, with Spend, Revenue, ROAS, Orders and CPA.

Rules:
- Numbers: always "increased/decreased by X% from Y to Z", never a percentage on its own. Use "held flat" when the change is under 2%. Use the direction field (▲ ▼ —) as given.
- Currency: write amounts with the section's currency_symbol (S$, RM, ₱, ₫, Rp, ฿), never the code (never "SGD"). VND and IDR have no decimals.
- Volume: always give a volume next to a cost metric.
- Primary metrics: CPM (awareness), CPLV = cost per landing page view (traffic), CPV = cost per view, where views are 6-second views on TikTok and ThruPlays on Meta (views campaigns), ROAS / CPA (sales). CTR for Google traffic.
- A campaign with no delivery last week is new or restarted: describe it on its own, without a week-on-week comparison.
- Keep it concise: the whole commentary should read in about a minute.
- Do not add recommendations, greetings, a title, a sign-off or notes about the data source.`;

let client = null;
const getClient = () => (client ||= new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  ...(process.env.ANTHROPIC_BASE_URL ? { baseURL: process.env.ANTHROPIC_BASE_URL } : {}),
  maxRetries: 2,
  timeout: 5 * 60 * 1000,
}));

export const writerConfigured = () => !!process.env.ANTHROPIC_API_KEY;

export async function writeCommentary(facts) {
  if (!writerConfigured()) throw Object.assign(new Error('ANTHROPIC_API_KEY is not set'), { code: 'not_configured' });
  // Server-side fallback: if this model declines, the API re-runs the request on
  // a suitable fallback model within the same call
  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high' },
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: `Facts for ${facts.market}, week of ${facts.week.this_week.startDate} to ${facts.week.this_week.endDate} vs ${facts.week.last_week.startDate} to ${facts.week.last_week.endDate}:\n\n${JSON.stringify(facts, null, 1)}`,
    }],
  });
  if (response.stop_reason === 'refusal') {
    throw Object.assign(new Error(`Claude declined to write this commentary (${response.stop_details?.category || 'no category'})`), { code: 'refusal' });
  }
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  if (!text) throw Object.assign(new Error(`Empty commentary (stop reason ${response.stop_reason})`), { code: 'empty' });
  if (response.stop_reason === 'max_tokens') console.warn('[commentary] output hit max_tokens; text may be cut short');
  return { text, model: response.model || MODEL };
}
