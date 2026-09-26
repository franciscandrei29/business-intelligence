import PDFDocument from 'pdfkit';
import type { NarrativeMetrics } from '~/lib/narrative/metrics.server';

export interface NarrativeContent {
  headline: string; // 1-sentence summary
  whatHappened: string; // paragraph
  whyItMatters: string; // paragraph
  actions: string[]; // 3-5 actionable items
  risks: string[]; // 2-4 risks to monitor
  opportunities: string[]; // 2-4 opportunities
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f59e0b',
  medium: '#3b82f6',
  low: '#22c55e',
};

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
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.rect(0, 0, 595, 120).fill('#6366f1');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11).text('KIMONO BI · AI Insights', 50, 30);
    doc.font('Helvetica').fontSize(9).fillColor('#e0e7ff').text(`${metrics.store.name}  ·  saptamana ${fmtD(metrics.period.weekStart)} – ${fmtD(metrics.period.weekEnd)}`, 50, 48);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(24).text(content.headline || 'Raport saptamanal', 50, 75, { width: 495 });

    doc.y = 150;
    doc.fillColor('#000000');

    // KPI cards row
    const kpiY = doc.y;
    drawKpi(doc, 50, kpiY, 'Venit', `${metrics.revenue.thisWeek.toLocaleString('ro-RO')} RON`, metrics.revenue.changePct, metrics.revenue.prevWeek);
    drawKpi(doc, 215, kpiY, 'Comenzi', String(metrics.revenue.ordersThis), pctChange(metrics.revenue.ordersThis, metrics.revenue.ordersPrev), metrics.revenue.ordersPrev);
    drawKpi(doc, 380, kpiY, 'AOV', `${Math.round(metrics.revenue.aovThis).toLocaleString('ro-RO')} RON`, pctChange(metrics.revenue.aovThis, metrics.revenue.aovPrev), Math.round(metrics.revenue.aovPrev));
    doc.y = kpiY + 85;

    // What happened
    section(doc, 'Ce s-a intamplat');
    doc.font('Helvetica').fontSize(10).fillColor('#334155').text(content.whatHappened, { width: 495, lineGap: 2 });
    doc.moveDown(1);

    section(doc, 'De ce conteaza');
    doc.font('Helvetica').fontSize(10).fillColor('#334155').text(content.whyItMatters, { width: 495, lineGap: 2 });
    doc.moveDown(1);

    // Top products
    if (metrics.topProducts.length > 0) {
      if (doc.y > 680) doc.addPage();
      section(doc, 'Top produse saptamana aceasta');
      for (const p of metrics.topProducts.slice(0, 6)) {
        if (doc.y > 780) { doc.addPage(); }
        doc.font('Helvetica').fontSize(10).fillColor('#0f172a').text(`•  ${p.title}`, 60, doc.y, { width: 380, continued: false });
        const yBack = doc.y - 12;
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f172a').text(`${p.units} buc`, 440, yBack, { width: 55, align: 'right' });
        doc.font('Helvetica').fontSize(9).fillColor('#64748b').text(`${p.revenue.toLocaleString('ro-RO')} RON`, 495, yBack, { width: 50, align: 'right' });
        doc.moveDown(0.2);
      }
      doc.moveDown(0.5);
    }

    // Inventory alerts / worst products
    if (metrics.worstProducts.length > 0) {
      if (doc.y > 700) doc.addPage();
      section(doc, 'Produse fara stoc cu vanzari recente');
      for (const w of metrics.worstProducts) {
        doc.font('Helvetica').fontSize(10).fillColor('#0f172a').text(`•  ${w.title}`, 60, doc.y, { width: 380 });
        const yBack = doc.y - 12;
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#dc2626').text(`~${w.lostRevenue.toLocaleString('ro-RO')} RON/sapt pierdut`, 380, yBack, { width: 165, align: 'right' });
        doc.moveDown(0.2);
      }
      doc.moveDown(0.5);
    }

    // Actions
    if (content.actions.length > 0) {
      if (doc.y > 650) doc.addPage();
      section(doc, 'Actiuni pentru saptamana aceasta');
      content.actions.forEach((a, i) => {
        if (doc.y > 780) doc.addPage();
        doc.circle(60, doc.y + 6, 8).fill('#22c55e');
        doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8).text(String(i + 1), 57, doc.y + 2, { width: 6, align: 'center' });
        doc.fillColor('#0f172a').font('Helvetica').fontSize(10).text(a, 80, doc.y, { width: 465, lineGap: 2 });
        doc.moveDown(0.5);
      });
      doc.moveDown(0.5);
    }

    // Risks & Opportunities
    if (content.risks.length > 0 || content.opportunities.length > 0) {
      if (doc.y > 650) doc.addPage();
      const col1X = 50, col2X = 305, colW = 240;
      const startY = doc.y;

      if (content.risks.length > 0) {
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#dc2626').text('Riscuri de monitorizat', col1X, startY);
        doc.y = startY + 18;
        for (const r of content.risks) {
          doc.font('Helvetica').fontSize(9).fillColor('#334155').text(`•  ${r}`, col1X, doc.y, { width: colW, lineGap: 2 });
          doc.moveDown(0.3);
        }
      }
      if (content.opportunities.length > 0) {
        const before = doc.y;
        doc.y = startY;
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#16a34a').text('Oportunitati', col2X, doc.y);
        doc.y = startY + 18;
        for (const o of content.opportunities) {
          doc.font('Helvetica').fontSize(9).fillColor('#334155').text(`•  ${o}`, col2X, doc.y, { width: colW, lineGap: 2 });
          doc.moveDown(0.3);
        }
        doc.y = Math.max(before, doc.y);
      }
      doc.moveDown(1);
    }

    // Footer
    doc.font('Helvetica-Oblique').fontSize(8).fillColor('#94a3b8')
      .text(`Generat de Kimono BI · ${new Date().toLocaleString('ro-RO')}`, 50, 810, { width: 495, align: 'center' });

    doc.end();
  });
}

function section(doc: PDFKit.PDFDocument, title: string) {
  doc.font('Helvetica-Bold').fontSize(14).fillColor('#0f172a').text(title, 50, doc.y);
  doc.moveTo(50, doc.y + 3).lineTo(545, doc.y + 3).lineWidth(0.5).stroke('#e2e8f0');
  doc.moveDown(0.6);
}

function drawKpi(doc: PDFKit.PDFDocument, x: number, y: number, label: string, value: string, changePct: number, prev: number) {
  doc.rect(x, y, 155, 75).fill('#f8fafc').stroke('#e2e8f0');
  doc.font('Helvetica').fontSize(9).fillColor('#64748b').text(label.toUpperCase(), x + 12, y + 10);
  doc.font('Helvetica-Bold').fontSize(18).fillColor('#0f172a').text(value, x + 12, y + 25);
  const color = changePct >= 0 ? '#16a34a' : '#dc2626';
  const sign = changePct >= 0 ? '+' : '';
  doc.font('Helvetica-Bold').fontSize(9).fillColor(color).text(`${sign}${changePct.toFixed(1)}%`, x + 12, y + 52);
  doc.font('Helvetica').fontSize(8).fillColor('#94a3b8').text(`vs ${typeof prev === 'number' ? prev.toLocaleString('ro-RO') : prev} prev`, x + 50, y + 52);
}

function pctChange(cur: number, prev: number): number {
  return prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : 0;
}

function fmtD(d: Date): string {
  return d.toLocaleDateString('ro-RO', { day: '2-digit', month: 'short' });
}
