import { jsPDF } from "jspdf";

// jsPDF's built-in fonts are Latin-1 only, so swap the characters it cannot draw.
const ascii = (s: string) => s
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/→/g, "->").replace(/≥/g, ">=").replace(/≤/g, "<=")
  .replace(/[·•]/g, "-").replace(/…/g, "...").replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ]/g, "?");

/** Render the report's markdown subset (headings, bullets, quotes, paragraphs) to a paged PDF and download it. */
export function downloadReportPdf(markdown: string, title: string, fileName = "forensic-report.pdf") {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const M = 56, maxW = W - M * 2;
  let y = M;
  const need = (h: number) => { if (y + h > H - M) { doc.addPage(); y = M; } };
  const write = (text: string, size: number, style: "normal" | "bold" | "italic", indent = 0, gap = 4, color: [number, number, number] = [30, 38, 50]) => {
    doc.setFont("helvetica", style); doc.setFontSize(size); doc.setTextColor(...color);
    const lines = doc.splitTextToSize(ascii(text), maxW - indent) as string[];
    for (const l of lines) { need(size * 1.35); doc.text(l, M + indent, y); y += size * 1.35; }
    y += gap;
  };
  const strip = (s: string) => s.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");

  doc.setFillColor(15, 43, 70); doc.rect(0, 0, W, 8, "F");
  write(title, 20, "bold", 0, 2, [15, 43, 70]);
  write(`Generated ${new Date().toLocaleString()} by the Swarm Evidence Graph studio`, 9, "normal", 0, 12, [100, 112, 128]);
  for (const raw of markdown.split("\n")) {
    const line = raw.trimEnd();
    const h = /^(#{1,4})\s+(.*)/.exec(line);
    if (h) { const lvl = h[1].length; y += lvl <= 2 ? 8 : 4; write(strip(h[2]), lvl === 1 ? 17 : lvl === 2 ? 14 : 12, "bold", 0, 4, [15, 43, 70]); continue; }
    const b = /^\s*[-*]\s+(.*)/.exec(line), n = /^\s*(\d+)\.\s+(.*)/.exec(line);
    if (b) { write("- " + strip(b[1]), 10.5, "normal", 12, 2); continue; }
    if (n) { write(`${n[1]}. ${strip(n[2])}`, 10.5, "normal", 12, 2); continue; }
    if (line.startsWith(">")) { write(strip(line.replace(/^>\s?/, "")), 10, "italic", 14, 6, [107, 75, 0]); continue; }
    if (!line.trim()) { y += 4; continue; }
    write(strip(line), 10.5, "normal", 0, 5);
  }
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) { doc.setPage(i); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(140, 150, 160); doc.text(`Page ${i} of ${pages}`, W - M, H - 24, { align: "right" }); }
  doc.save(fileName);
}
