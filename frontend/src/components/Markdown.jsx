// Minimal, safe Markdown for the weekly commentary: headings (### / ####),
// bullet lists (- or *), **bold**, *italic*, --- rules and paragraphs.
// Builds React elements only (no HTML injection), so edited text is safe.

function inline(text, keyBase) {
  const parts = String(text).split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g);
  return parts.map((p, i) => {
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={`${keyBase}-${i}`}>{p.slice(2, -2)}</strong>;
    if (/^\*[^*].*\*$/.test(p)) return <em key={`${keyBase}-${i}`}>{p.slice(1, -1)}</em>;
    return p;
  });
}

export default function Markdown({ text, theme }) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const blocks = [];
  let para = [], list = [];
  const flushPara = () => { if (para.length) blocks.push({ type: 'p', text: para.join(' ') }); para = []; };
  const flushList = () => { if (list.length) blocks.push({ type: 'ul', items: list }); list = []; };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushPara(); flushList(); continue; }
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { flushPara(); flushList(); blocks.push({ type: m[1].length <= 3 ? 'h3' : 'h4', text: m[2] }); continue; }
    if (/^(-{3,}|\*{3,})$/.test(line)) { flushPara(); flushList(); blocks.push({ type: 'hr' }); continue; }
    if ((m = line.match(/^[-*•]\s+(.*)$/))) { flushPara(); list.push(m[1]); continue; }
    if ((m = line.match(/^>\s?(.*)$/))) { flushList(); para.push(m[1]); continue; }
    flushList(); para.push(line);
  }
  flushPara(); flushList();

  const h3 = { fontSize: 14, fontWeight: 700, color: theme.textPrimary, margin: '18px 0 6px', fontFamily: "'Space Grotesk', sans-serif", letterSpacing: '0.01em' };
  return (
    <div style={{ fontSize: 13.5, lineHeight: 1.6, color: theme.textSecondary }}>
      {blocks.map((b, i) => {
        if (b.type === 'h3') return <h3 key={i} style={{ ...h3, ...(i === 0 ? { marginTop: 0 } : {}) }}>{inline(b.text, i)}</h3>;
        if (b.type === 'h4') return <h4 key={i} style={{ ...h3, fontSize: 13, margin: '14px 0 4px', color: theme.textPrimary }}>{inline(b.text, i)}</h4>;
        if (b.type === 'hr') return <hr key={i} style={{ border: 'none', borderTop: `1px solid ${theme.border}`, margin: '14px 0' }} />;
        if (b.type === 'ul') return (
          <ul key={i} style={{ margin: '4px 0 10px', paddingLeft: 20 }}>
            {b.items.map((it, j) => <li key={j} style={{ margin: '2px 0' }}>{inline(it, `${i}-${j}`)}</li>)}
          </ul>
        );
        return <p key={i} style={{ margin: '4px 0 10px' }}>{inline(b.text, i)}</p>;
      })}
    </div>
  );
}
