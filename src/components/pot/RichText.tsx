import type { ReactNode } from "react";

/**
 * Deterministic inline formatting for assistant replies: **bold**, `code`,
 * "- " bullets and blank-line paragraphs. Plain React nodes, no HTML string,
 * no dependency: a small model's markdown shows up as styled text instead of
 * literal asterisks, and can never inject markup.
 */
function inline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      nodes.push(
        <strong key={`${keyBase}-b${i}`} className="font-semibold">
          {tok.slice(2, -2)}
        </strong>,
      );
    } else {
      nodes.push(
        <code key={`${keyBase}-c${i}`} className="doodle-inset num px-1 text-[0.92em]">
          {tok.slice(1, -1)}
        </code>,
      );
    }
    last = m.index + tok.length;
    i += 1;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function RichText({ text, className }: { text: string; className?: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let list: ReactNode[] = [];
  const flush = (key: number) => {
    if (list.length > 0) {
      blocks.push(
        <ul key={`ul${key}`} className="my-1 grid gap-0.5 pl-4 list-disc marker:text-ink-faint">
          {list}
        </ul>,
      );
      list = [];
    }
  };
  lines.forEach((ln, i) => {
    const bullet = ln.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      list.push(<li key={i}>{inline(bullet[1], `l${i}`)}</li>);
      return;
    }
    flush(i);
    if (ln.trim() === "") {
      blocks.push(<div key={i} aria-hidden className="h-2" />);
      return;
    }
    blocks.push(<p key={i}>{inline(ln, `p${i}`)}</p>);
  });
  flush(lines.length);
  return <div className={`grid ${className ?? ""}`}>{blocks}</div>;
}
