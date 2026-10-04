import type { ReactNode } from "react";

const inline = (s: string): ReactNode[] =>
  s.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith("`") ? <code key={i}>{p.slice(1, -1)}</code> : p.startsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : p,
  );

/** Small markdown subset: headings, bullets, numbered lists, quotes, code spans, bold. */
export default function Markdown({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    out.push(<Tag key={out.length}>{list.items.map((it, i) => <li key={i}>{inline(it)}</li>)}</Tag>);
    list = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const h = /^(#{1,4})\s+(.*)/.exec(line);
    const b = /^\s*[-*]\s+(.*)/.exec(line);
    const n = /^\s*\d+\.\s+(.*)/.exec(line);
    if (h) { flush(); const L = Math.min(h[1].length + 1, 5); const T = `h${L}` as "h2"; out.push(<T key={out.length}>{inline(h[2])}</T>); }
    else if (b || n) { const ordered = Boolean(n); if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; } list.items.push((b ?? n)![1]); }
    else if (line.startsWith(">")) { flush(); out.push(<blockquote key={out.length}>{inline(line.replace(/^>\s?/, ""))}</blockquote>); }
    else if (!line.trim()) flush();
    else { flush(); out.push(<p key={out.length}>{inline(line)}</p>); }
  }
  flush();
  return <div className="md">{out}</div>;
}
