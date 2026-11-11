import { jsPDF } from "jspdf";
import { INSTALL_URL, outcomeTags, validDoiUrl, type ReportEntry, type ReportPayload, type ReportReference } from "./report";
import { plainTitle } from "./plain-title";
import { webUrl } from "./web-url";
import { t, uiLocale } from "./i18n";

type Rgb = [number, number, number];

const MAROON: Rgb = [133, 57, 83];
const INK: Rgb = [31, 35, 40];
const MUTED: Rgb = [95, 99, 104];
const RULE: Rgb = [232, 232, 232];

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM = PAGE_H - 56;

// The standard PDF fonts only carry Windows-1252 glyphs; anything else would print as garbage.
const WIN_ANSI_EXTRAS = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

function isWinAnsi(ch: string): boolean {
  const code = ch.codePointAt(0)!;
  return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRAS.has(ch);
}

const STROKED: Record<string, string> = {Ł: "L", ł: "l", Đ: "D", đ: "d", ı: "i", Ħ: "H", ħ: "h"};

export function pdfText(text: string): string {
  let out = "";
  for (const ch of text.replace(/\s+/g, " ")) {
    if (isWinAnsi(ch)) out += ch;
    else if (Object.hasOwn(STROKED, ch)) out += STROKED[ch];
    else {
      const base = ch.normalize("NFKD").replace(/[̀-ͯ]/g, "");
      out += [...base].every(isWinAnsi) && base ? base : "?";
    }
  }
  return out.trim();
}

export function reportPdfFilename(payload: ReportPayload): string {
  const title = pdfText(plainTitle(payload.title)).replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  const short = title.length > 80 ? `${title.slice(0, 80).trimEnd()}…` : title;
  return `ORE report – ${short || "article"}.pdf`;
}

function outcomeColours(outcome: string): {fill: Rgb; text: Rgb} {
  const o = outcome.toLowerCase();
  if (o.includes("success") || o.includes("replicated") || o === "yes") return {fill: [209, 250, 229], text: [6, 95, 70]};
  if (o.includes("fail") || o === "no") return {fill: [254, 226, 226], text: [153, 27, 27]};
  return {fill: [254, 248, 232], text: [184, 134, 11]};
}

class Layout {
  readonly doc = new jsPDF({unit: "pt", format: "a4"});
  y = MARGIN;

  ensure(height: number): void {
    if (this.y + height <= BOTTOM) return;
    this.doc.addPage();
    this.y = MARGIN;
  }

  font(style: "normal" | "bold", size: number, colour: Rgb, family = "helvetica"): void {
    this.doc.setFont(family, style);
    this.doc.setFontSize(size);
    this.doc.setTextColor(...colour);
  }

  lines(text: string, width = CONTENT_W): string[] {
    return this.doc.splitTextToSize(pdfText(text), width) as string[];
  }

  paragraph(text: string, size: number, opts: {url?: string | null; lineGap?: number; x?: number; width?: number} = {}): void {
    const x = opts.x ?? MARGIN;
    const lineHeight = size * (opts.lineGap ?? 1.3);
    for (const line of this.lines(text, opts.width ?? CONTENT_W - (x - MARGIN))) {
      this.ensure(lineHeight);
      this.doc.text(line, x, this.y + size * 0.8);
      if (opts.url) this.doc.link(x, this.y, this.doc.getTextWidth(line), lineHeight, {url: opts.url});
      this.y += lineHeight;
    }
  }

  rule(): void {
    this.doc.setDrawColor(...RULE);
    this.doc.setLineWidth(0.6);
    this.doc.line(MARGIN, this.y, PAGE_W - MARGIN, this.y);
  }
}

function masthead(l: Layout): void {
  l.doc.setFillColor(...MAROON);
  l.doc.rect(0, 0, PAGE_W, 40, "F");
  l.font("bold", 11, [255, 255, 255]);
  l.doc.text("FORRT ORE", MARGIN, 25);
  l.font("normal", 11, [255, 255, 255]);
  l.doc.text(pdfText(t("report.title", "Meta Report")), MARGIN + l.doc.getTextWidth("FORRT ORE ") + 6, 25);
  l.y = 64;
}

function heading(l: Layout, payload: ReportPayload): void {
  l.font("bold", 17, MAROON);
  l.paragraph(plainTitle(payload.title), 17, {url: webUrl(payload.sourceUrl), lineGap: 1.25});
  const byline = [payload.authors, payload.year ? String(payload.year) : null].filter(Boolean).join(" · ");
  if (byline) {
    l.y += 2;
    l.font("normal", 10, MUTED);
    l.paragraph(byline, 10);
  }
  if (payload.doi) {
    l.font("normal", 9, MUTED, "courier");
    l.paragraph(payload.doi, 9, {url: validDoiUrl(payload.doi)});
  }
  l.y += 10;
  l.rule();
  l.y += 16;
}

function notice(l: Layout, payload: ReportPayload): void {
  if (!payload.notice) return;
  const retracted = payload.notice.kind === "retraction";
  const fill: Rgb = retracted ? [253, 236, 239] : [255, 247, 237];
  const edge: Rgb = retracted ? [255, 23, 68] : [234, 88, 12];
  const ink: Rgb = retracted ? [163, 13, 45] : [154, 52, 18];
  const url = validDoiUrl(payload.notice.doi);
  l.ensure(34);
  l.doc.setFillColor(...fill);
  l.doc.rect(MARGIN, l.y, CONTENT_W, 30, "F");
  l.doc.setFillColor(...edge);
  l.doc.rect(MARGIN, l.y, 4, 30, "F");
  l.font("bold", 10.5, ink);
  const headline = retracted
    ? t("report.notice.retracted", "This article has been retracted.")
    : t("report.notice.concern", "This article has an expression of concern.");
  l.doc.text(pdfText(headline), MARGIN + 14, l.y + 19);
  if (url) {
    l.font("normal", 10, ink);
    const label = pdfText(t("report.pdf.readNotice", "Read the notice"));
    const width = l.doc.getTextWidth(label);
    l.doc.textWithLink(label, PAGE_W - MARGIN - 12 - width, l.y + 19, {url});
  }
  l.y += 44;
}

function stats(l: Layout, payload: ReportPayload): void {
  const items = [
    payload.replications.length
      ? {n: payload.replications.length, label: t("report.stat.replications", "{count, plural, one {Replication} other {Replications}}", {count: payload.replications.length})}
      : null,
    payload.reproductions.length
      ? {n: payload.reproductions.length, label: t("report.stat.reproductions", "{count, plural, one {Reproduction} other {Reproductions}}", {count: payload.reproductions.length})}
      : null,
    payload.originals.length
      ? {n: payload.originals.length, label: t("report.stat.originals", "{count, plural, one {Original study} other {Original studies}}", {count: payload.originals.length})}
      : null,
    payload.pubpeer?.comments
      ? {n: payload.pubpeer.comments, label: t("report.stat.pubpeerComments", "{count, plural, one {PubPeer comment} other {PubPeer comments}}", {count: payload.pubpeer.comments})}
      : null,
  ].filter((s): s is {n: number; label: string} => s !== null);
  if (items.length === 0) return;
  const gap = 10;
  const width = (CONTENT_W - gap * (items.length - 1)) / items.length;
  l.ensure(56);
  items.forEach((item, i) => {
    const x = MARGIN + i * (width + gap);
    l.doc.setFillColor(249, 240, 244);
    l.doc.setDrawColor(212, 165, 184);
    l.doc.setLineWidth(0.8);
    l.doc.roundedRect(x, l.y, width, 48, 6, 6, "FD");
    l.font("bold", 18, MAROON);
    l.doc.text(String(item.n), x + width / 2, l.y + 24, {align: "center"});
    l.font("normal", 8.5, [97, 45, 83]);
    l.doc.text(pdfText(item.label), x + width / 2, l.y + 38, {align: "center"});
  });
  l.y += 66;
}

function sectionHeading(l: Layout, title: string, count: number): void {
  l.ensure(48);
  l.rule();
  l.y += 18;
  l.font("bold", 9, MUTED);
  const label = pdfText(title.toLocaleUpperCase(uiLocale()));
  l.doc.text(label, MARGIN, l.y);
  l.font("bold", 9, MAROON);
  l.doc.text(String(count), MARGIN + l.doc.getTextWidth(`${label} `) + 2, l.y);
  l.y += 12;
}

function entry(l: Layout, item: ReportEntry): void {
  l.ensure(36);
  l.font("bold", 10.5, MAROON);
  l.paragraph(plainTitle(item.title), 10.5, {url: webUrl(item.url) ?? validDoiUrl(item.doi)});
  let x = MARGIN;
  for (const tag of item.outcome ? outcomeTags(item.outcome) : []) {
    const label = pdfText(tag);
    const tone = outcomeColours(tag);
    l.font("bold", 7.5, tone.text);
    const width = l.doc.getTextWidth(label) + 10;
    l.ensure(14);
    l.doc.setFillColor(...tone.fill);
    l.doc.roundedRect(x, l.y + 1, width, 11, 5, 5, "F");
    l.doc.text(label, x + 5, l.y + 9);
    x += width + 6;
  }
  const meta = [item.authors, item.year ? String(item.year) : null, item.journal].filter(Boolean).join(" · ");
  const doiUrl = validDoiUrl(item.doi);
  if (meta || doiUrl) {
    l.font("normal", 8.5, MUTED);
    const width = PAGE_W - MARGIN - x;
    const metaLines = meta ? l.lines(meta, width) : [];
    metaLines.forEach((line, i) => {
      if (i > 0) {
        l.y += 12;
        l.ensure(12);
      }
      l.doc.text(line, x, l.y + 9);
    });
    if (doiUrl && item.doi) {
      const doiLabel = pdfText(`doi:${item.doi}`);
      const last = metaLines.at(-1);
      const doiX = last ? x + l.doc.getTextWidth(`${last} · `) : x;
      if (doiX + l.doc.getTextWidth(doiLabel) <= PAGE_W - MARGIN) {
        if (last) l.doc.text(" · ", x + l.doc.getTextWidth(last), l.y + 9);
        l.doc.textWithLink(doiLabel, doiX, l.y + 9, {url: doiUrl});
      } else {
        for (const [i, line] of l.lines(doiLabel, width).entries()) {
          if (i > 0 || last) {
            l.y += 12;
            l.ensure(12);
          }
          l.doc.textWithLink(line, x, l.y + 9, {url: doiUrl});
        }
      }
    }
    l.y += 12;
  } else if (item.outcome) {
    l.y += 12;
  }
  l.y += 8;
}

function referenceTags(reference: ReportReference): string[] {
  const tags: string[] = [];
  if (reference.replications) {
    tags.push(t("report.tag.replications", "{count, plural, one {# replication} other {# replications}}", {count: reference.replications}));
  }
  if (reference.reproductions) {
    tags.push(t("report.tag.reproductions", "{count, plural, one {# reproduction} other {# reproductions}}", {count: reference.reproductions}));
  }
  if (reference.inAtlas) tags.push(t("report.tag.inAtlas", "In the Atlas"));
  if (reference.notice === "retraction") tags.push(t("report.tag.retracted", "Retracted"));
  // i18n: tag on a reference with an expression of concern; keep short
  if (reference.notice === "concern") tags.push(t("report.tag.concern", "Concern"));
  if (reference.comments) {
    tags.push(t("report.tag.pubpeerComments", "{count, plural, one {# PubPeer comment} other {# PubPeer comments}}", {count: reference.comments}));
  }
  return tags;
}

function reference(l: Layout, item: ReportReference): void {
  l.ensure(34);
  l.font("bold", 10.5, MAROON);
  l.paragraph(plainTitle(item.title), 10.5, {url: validDoiUrl(item.doi)});
  l.font("normal", 8.5, item.notice === "retraction" ? [163, 13, 45] : MUTED);
  l.paragraph(referenceTags(item).join(" · "), 8.5);
  l.y += 8;
}

function colophon(l: Layout, payload: ReportPayload): void {
  l.ensure(56);
  l.rule();
  l.y += 16;
  const date = new Date(payload.generated).toLocaleDateString(uiLocale(), {dateStyle: "long"});
  l.font("normal", 8.5, MUTED);
  l.paragraph(
    `${t("report.pdf.compiled", "Compiled by FORRT ORE on {date} from the FORRT Replication Database, Retraction Watch, Unpaywall and PubPeer.", {date})} ` +
    t("report.colophon.caveat", "Replication evidence is a starting point for judgement, not a verdict."),
    8.5,
  );
  l.font("normal", 8.5, MAROON);
  l.paragraph(INSTALL_URL, 8.5, {url: INSTALL_URL});
}

function pageNumbers(l: Layout): void {
  const pages = l.doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    l.doc.setPage(page);
    l.font("normal", 8, MUTED);
    l.doc.text(pdfText(t("report.pdf.pageFooter", "FORRT ORE Meta Report · page {page} of {pages}", {page, pages})), PAGE_W / 2, PAGE_H - 28, {align: "center"});
  }
}

export function buildReportPdf(payload: ReportPayload): ArrayBuffer {
  const l = new Layout();
  l.doc.setProperties({title: pdfText(t("report.pdf.docTitle", "{title} — FORRT ORE Meta Report", {title: plainTitle(payload.title)})), creator: "FORRT ORE"});
  masthead(l);
  heading(l, payload);
  notice(l, payload);
  stats(l, payload);
  const sections: Array<[string, ReportEntry[]]> = [
    [t("report.section.replications", "Replications"), payload.replications],
    [t("report.section.reproductions", "Reproductions"), payload.reproductions],
    [t("report.section.originals", "Original papers"), payload.originals],
  ];
  for (const [title, entries] of sections) {
    if (entries.length === 0) continue;
    sectionHeading(l, title, entries.length);
    for (const item of entries) entry(l, item);
  }
  const flagged = payload.references.filter((r) => referenceTags(r).length > 0);
  if (flagged.length > 0) {
    sectionHeading(l, t("report.section.flaggedRefs", "Flagged references"), flagged.length);
    for (const item of flagged) reference(l, item);
  }
  colophon(l, payload);
  pageNumbers(l);
  return l.doc.output("arraybuffer");
}
