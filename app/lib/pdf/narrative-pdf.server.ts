import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import type { NarrativeMetrics } from '~/lib/narrative/metrics.server';

const FONTS_DIR = path.join(process.cwd(), 'app/fonts');
const FONT_REGULAR = path.join(FONTS_DIR, 'Inter-Regular.ttf');
const FONT_BOLD = path.join(FONTS_DIR, 'Inter-Bold.ttf');
const FONT_SEMIBOLD = path.join(FONTS_DIR, 'Inter-SemiBold.ttf');

const BLACK = '#0a0a0a';
const WHITE = '#FFFFFF';
const OFF_WHITE = '#FAFAFA';
const ACCENT = '#FF5A1F';
const ACCENT_LIGHT = '#FFE8DC';
const MUTED = '#525252';
const SUCCESS = '#16a34a';
const DANGER = '#dc2626';

export interface NarrativeContent {
  headline: string;
  whatHappened: string;
  whyItMatters: string;
  actions: string[];
  risks: string[];
  opportunities: string[];
}

function registerFonts(doc: PDFKit.PDFDocument) {
  if (fs.existsSync(FONT_REGULAR)) doc.registerFont('Body', FONT_REGULAR);
  if (fs.existsSync(FONT_BOLD)) doc.registerFont('Bold', FONT_BOLD);
  if (fs.existsSync(FONT_SEMIBOLD)) doc.registerFont('SemiBold', FONT_SEMIBOLD);
}

export function buildNarrativePdf(metrics: NarrativeMetrics, content: NarrativeContent): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: `AI Insights — ${metrics.store.name}`,
        Author: 'Kimono BI',
        Subject: 'Raport narativ saptamanal',
        CreationDate: new Date(),
      },
    });
    registerFonts(doc);

    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ============ HEADER ============
    doc.rect(0, 0, 595, 180).fill(BLACK);
    doc.rect(0, 176, 595, 4).fill(ACCENT);

    doc.fillColor(ACCENT).font('Bold').fontSize(10).text('KIMONO BI  ·  AI INSIGHTS', 50, 30, { characterSpacing: 2 });
    doc.font('Body').fontSize(10).fillColor('#d4d4d4').text(`${metrics.store.name}  ·  săptămâna ${fmtD(metrics.period.weekStart)} – ${fmtD(metrics.period.weekEnd)}`, 50, 52);
    doc.fillColor(WHITE).font('Bold').fontSize(26).text(content.headline || 'Raport săptămânal', 50, 80, { width: 495, lineGap: 4 });

    doc.y = 210;
    doc.fillColor(BLACK);

    // ============ KPIs ============
    const kpiY = doc.y;
    drawKpi(doc, 50, kpiY, 'VENIT', `${metrics.revenue.thisWeek.toLocaleString('ro-RO')} RON`, metrics.revenue.changePct, `${metrics.revenue.prevWeek.toLocaleString('ro-RO')}`);
    drawKpi(doc, 215, kpiY, 'COMENZI', String(metrics.revenue.ordersThis), pctChange(metrics.revenue.ordersThis, metrics.revenue.ordersPrev), String(metrics.revenue.ordersPrev));
    drawKpi(doc, 380, kpiY, 'AOV', `${Math.round(metrics.revenue.aovThis).toLocaleString('ro-RO')} RON`, pctChange(metrics.revenue.aovThis, metrics.revenue.aovPrev), `${Math.round(metrics.revenue.aovPrev)}`);
    doc.y = kpiY + 100;

    // ============ WHAT HAPPENED ============
    section(doc, 'Ce s-a întâmplat');
    doc.font('Body').fontSize(10).fillColor('#262626').text(content.whatHappened || '—', { width: 495, lineGap: 3 });
    doc.moveDown(1);

    section(doc, 'De ce contează');
    doc.font('Body').fontSize(10).fillColor('#262626').text(content.whyItMatters || '—', { width: 495, lineGap: 3 });
    doc.moveDown(1);

    // ============ TOP PRODUCTS ============
    if (metrics.topProducts.length > 0) {
      if (doc.y > 650) doc.addPage();
      section(doc, 'Top produse săptămâna aceasta');
      for (const p of metrics.topProducts.slice(0, 6)) {
        if (doc.y > 780) doc.addPage();
        doc.font('Body').fontSize(10).fillColor(BLACK).text(`•  ${p.title}`, 60, doc.y, { width: 360, continued: false });
        const yBack = doc.y - 13;
        doc.font('Bold').fontSize(10).fillColor(BLACK).text(`${p.units} buc`, 420, yBack, { width: 60, align: 'right' });
        doc.font('Body').fontSize(9).fillColor(MUTED).text(`${p.revenue.toLocaleString('ro-RO')} RON`, 480, yBack, { width: 65, align: 'right' });
        doc.moveDown(0.3);
      }
      doc.moveDown(0.5);
    }

    // ============ WORST PRODUCTS ============
    if (metrics.worstProducts.length > 0) {
      if (doc.y > 680) doc.addPage();
      section(doc, 'Produse fără stoc cu vânzări recente');
      for (const w of metrics.worstProducts) {
        if (doc.y > 780) doc.addPage();
        doc.font('Body').fontSize(10).fillColor(BLACK).text(`•  ${w.title}`, 60, doc.y, { width: 380 });
        const yBack = doc.y - 13;
        doc.font('Bold').fontSize(10).fillColor(DANGER).text(`-${w.lostRevenue.toLocaleString('ro-RO')} RON/sapt`, 440, yBack, { width: 105, align: 'right' });
        doc.moveDown(0.3);
      }
      doc.moveDown(0.5);
    }

    // ============ ACTIONS ============
    if (content.actions.length > 0) {
      if (doc.y > 620) doc.addPage();
      section(doc, 'Acțiuni pentru săptămâna aceasta');
      content.actions.forEach((a, i) => {
        if (doc.y > 760) doc.addPage();
        const yy = doc.y;
        doc.rect(50, yy, 24, 24).fill(ACCENT);
        doc.fillColor(WHITE).font('Bold').fontSize(12).text(String(i + 1), 50, yy + 5, { width: 24, align: 'center' });
        doc.fillColor(BLACK).font('Body').fontSize(10).text(a, 86, yy + 4, { width: 460, lineGap: 3 });
        const textBottom = doc.y;
        doc.y = Math.max(textBottom, yy + 24) + 10;
      });
      doc.moveDown(0.5);
    }

    // ============ RISKS & OPPORTUNITIES ============
    if (content.risks.length > 0 || content.opportunities.length > 0) {
      if (doc.y > 620) doc.addPage();
      const col1X = 50, col2X = 305, colW = 240;
      const startY = doc.y;

      if (content.risks.length > 0) {
        doc.font('Bold').fontSize(12).fillColor(DANGER).text('Riscuri de monitorizat', col1X, startY);
        doc.y = startY + 20;
        for (const r of content.risks) {
          doc.font('Body').fontSize(9).fillColor('#262626').text(`•  ${r}`, col1X, doc.y, { width: colW, lineGap: 3 });
          doc.moveDown(0.4);
        }
      }
      const afterRisks = doc.y;
      if (content.opportunities.length > 0) {
        doc.y = startY;
        doc.font('Bold').fontSize(12).fillColor(SUCCESS).text('Oportunități', col2X, doc.y);
        doc.y = startY + 20;
        for (const o of content.opportunities) {
          doc.font('Body').fontSize(9).fillColor('#262626').text(`•  ${o}`, col2X, doc.y, { width: colW, lineGap: 3 });
          doc.moveDown(0.4);
        }
        doc.y = Math.max(afterRisks, doc.y);
      }
      doc.moveDown(1);
    }

    // Footer
    doc.font('Body').fontSize(8).fillColor('#a3a3a3')
      .text(`Generat de Kimono BI  ·  ${new Date().toLocaleString('ro-RO')}`, 50, Math.max(doc.y, 780), { width: 495, align: 'center' });

    doc.end();
  });
}

function section(doc: PDFKit.PDFDocument, title: string) {
  const y = doc.y;
  doc.font('Bold').fontSize(14).fillColor(BLACK).text(title, 50, y);
  doc.moveTo(50, doc.y + 4).lineTo(545, doc.y + 4).lineWidth(1.5).stroke(BLACK);
  doc.moveDown(0.6);
}

function drawKpi(doc: PDFKit.PDFDocument, x: number, y: number, label: string, value: string, changePct: number, prev: string) {
  doc.rect(x, y, 155, 85).fill(WHITE).lineWidth(2).stroke(BLACK);
  doc.font('Bold').fontSize(9).fillColor(ACCENT).text(label, x + 12, y + 12, { characterSpacing: 2 });
  doc.font('Bold').fontSize(18).fillColor(BLACK).text(value, x + 12, y + 30);
  const color = changePct >= 0 ? SUCCESS : DANGER;
  const sign = changePct >= 0 ? '+' : '';
  doc.font('Bold').fontSize(10).fillColor(color).text(`${sign}${changePct.toFixed(1)}%`, x + 12, y + 58);
  doc.font('Body').fontSize(8).fillColor(MUTED).text(`vs ${prev} prev`, x + 60, y + 60);
}

function pctChange(cur: number, prev: number): number {
  return prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : 0;
}

function fmtD(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('ro-RO', { day: '2-digit', month: 'short' });
}
