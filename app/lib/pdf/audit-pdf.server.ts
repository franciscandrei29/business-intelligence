import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import type { AuditMetrics, DomainScore } from '~/lib/audit/metrics.server';

const FONTS_DIR = path.join(process.cwd(), 'app/fonts');
const FONT_REGULAR = path.join(FONTS_DIR, 'Inter-Regular.ttf');
const FONT_BOLD = path.join(FONTS_DIR, 'Inter-Bold.ttf');
const FONT_SEMIBOLD = path.join(FONTS_DIR, 'Inter-SemiBold.ttf');

// Kimono BI brand palette
const BLACK = '#0a0a0a';
const WHITE = '#FFFFFF';
const OFF_WHITE = '#FAFAFA';
const ACCENT = '#FF5A1F';
const ACCENT_LIGHT = '#FFE8DC';
const MUTED = '#525252';
const BORDER = '#e5e5e5';

const DOMAIN_TITLES: Record<string, string> = {
  revenue: '1. Venit și Creștere',
  catalog: '2. Produse și Catalog',
  customers: '3. Clienți și Retenție',
  inventory: '4. Stocuri și Supply Chain',
  traffic: '5. Trafic și Conversie',
  profitability: '6. Profitabilitate',
  operations: '7. Operațiuni',
  automation: '8. AI și Automatizare',
};

const STATUS_COLORS: Record<DomainScore['status'], string> = {
  excellent: '#16a34a',
  good: '#2563eb',
  warning: '#d97706',
  critical: '#dc2626',
  unavailable: '#94a3b8',
};

const STATUS_LABELS: Record<DomainScore['status'], string> = {
  excellent: 'EXCELENT',
  good: 'BUN',
  warning: 'ATENȚIE',
  critical: 'CRITIC',
  unavailable: 'INDISPONIBIL',
};

const GRADE_COLOR: Record<string, string> = {
  A: '#16a34a', B: '#2563eb', C: '#d97706', D: '#dc2626', F: '#991b1b',
};

export interface AuditCommentary {
  executiveSummary: string;
  domainNotes: Record<string, string>;
  recommendations: string[];
}

function registerFonts(doc: PDFKit.PDFDocument) {
  if (fs.existsSync(FONT_REGULAR)) doc.registerFont('Body', FONT_REGULAR);
  if (fs.existsSync(FONT_BOLD)) doc.registerFont('Bold', FONT_BOLD);
  if (fs.existsSync(FONT_SEMIBOLD)) doc.registerFont('SemiBold', FONT_SEMIBOLD);
}

export function buildAuditPdf(metrics: AuditMetrics, commentary: AuditCommentary): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: `BI Audit — ${metrics.store.name}`,
        Author: 'Kimono BI',
        Subject: 'Business Intelligence Audit Report',
        CreationDate: metrics.generatedAt,
      },
    });

    registerFonts(doc);

    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ============ COVER ============
    doc.rect(0, 0, 595, 842).fill(BLACK);
    doc.rect(0, 0, 595, 8).fill(ACCENT);

    doc.fillColor(WHITE).font('Bold').fontSize(11).text('KIMONO BI', 50, 60);
    doc.font('Body').fontSize(9).fillColor('#a3a3a3').text('Business Intelligence Platform', 50, 78);

    doc.fillColor(WHITE).font('Bold').fontSize(56).text('BI Audit', 50, 260);
    doc.font('Body').fontSize(14).fillColor('#d4d4d4').text('Raport complet de sănătate a magazinului', 50, 340);

    // Store info
    doc.font('Bold').fontSize(10).fillColor(ACCENT).text('MAGAZIN', 50, 450, { characterSpacing: 2 });
    doc.font('Bold').fontSize(20).fillColor(WHITE).text(metrics.store.name, 50, 468);
    doc.font('Body').fontSize(10).fillColor('#a3a3a3').text(`${metrics.store.platform}  ·  ${metrics.store.domain}`, 50, 494);

    doc.font('Bold').fontSize(10).fillColor(ACCENT).text('GENERAT', 50, 540, { characterSpacing: 2 });
    doc.font('Body').fontSize(13).fillColor(WHITE).text(metrics.generatedAt.toLocaleString('ro-RO', { dateStyle: 'long', timeStyle: 'short' }), 50, 558);

    // Big score circle
    const cx = 440, cy = 500, r = 90;
    doc.circle(cx, cy, r).lineWidth(10).stroke(GRADE_COLOR[metrics.overall.grade]);
    doc.fillColor(GRADE_COLOR[metrics.overall.grade]).font('Bold').fontSize(64)
      .text(String(metrics.overall.score), cx - 55, cy - 40, { width: 110, align: 'center' });
    doc.fillColor('#d4d4d4').font('Bold').fontSize(11)
      .text(`GRAD ${metrics.overall.grade}`, cx - 55, cy + 34, { width: 110, align: 'center', characterSpacing: 2 });

    doc.font('Body').fontSize(9).fillColor('#737373')
      .text('Raport generat automat de Kimono BI', 50, 790);

    // ============ EXECUTIVE SUMMARY ============
    doc.addPage();
    drawPageHeader(doc, 'Executive Summary', metrics);

    doc.moveDown(1.5);
    doc.font('Bold').fontSize(16).fillColor(BLACK).text('Verdict');
    doc.moveDown(0.3);
    doc.font('Body').fontSize(11).fillColor('#262626').text(metrics.overall.verdict, { width: 495, lineGap: 3 });

    doc.moveDown(1.2);
    doc.font('Bold').fontSize(14).fillColor(BLACK).text('Analiză AI');
    doc.moveDown(0.3);
    doc.font('Body').fontSize(10).fillColor('#262626').text(commentary.executiveSummary, { width: 495, lineGap: 3 });

    // Score overview
    doc.moveDown(1.5);
    doc.font('Bold').fontSize(14).fillColor(BLACK).text('Scor pe domenii');
    doc.moveDown(0.5);

    const domainKeys = Object.keys(metrics.domains) as Array<keyof typeof metrics.domains>;
    let y = doc.y;
    for (const key of domainKeys) {
      const d = metrics.domains[key];
      if (y > 750) { doc.addPage(); drawPageHeader(doc, 'Executive Summary (continuare)', metrics); y = doc.y + 20; }

      doc.rect(50, y, 495, 32).lineWidth(1.5).stroke(BLACK);
      doc.fillColor(BLACK).font('SemiBold').fontSize(10.5).text(DOMAIN_TITLES[key], 62, y + 11, { width: 280, ellipsis: true });

      const barX = 355, barW = 130, barY = y + 14;
      doc.rect(barX, barY, barW, 6).fill('#e5e5e5');
      doc.rect(barX, barY, (barW * d.score) / 100, 6).fill(STATUS_COLORS[d.status]);

      doc.fillColor(BLACK).font('Bold').fontSize(13).text(`${d.score}`, 495, y + 10, { width: 40, align: 'right' });
      y += 38;
    }

    // ============ DOMAIN PAGES ============
    for (const key of domainKeys) {
      doc.addPage();
      drawPageHeader(doc, DOMAIN_TITLES[key], metrics);
      drawDomainDetail(doc, key, metrics.domains[key], commentary.domainNotes[key] || '');
    }

    // ============ RECOMMENDATIONS ============
    if (commentary.recommendations.length > 0) {
      doc.addPage();
      drawPageHeader(doc, 'Recomandări prioritizate', metrics);
      doc.moveDown(0.5);
      doc.font('Body').fontSize(10).fillColor(MUTED)
        .text('Acțiuni concrete extrase din datele magazinului, sortate după impact așteptat.', { width: 495, lineGap: 2 });
      doc.moveDown(1);

      commentary.recommendations.forEach((rec, i) => {
        if (doc.y > 740) { doc.addPage(); drawPageHeader(doc, 'Recomandări (continuare)', metrics); doc.moveDown(1); }
        const yStart = doc.y;

        // Badge (28x28 orange box with number)
        doc.rect(50, yStart, 28, 28).fill(ACCENT);
        doc.fillColor(WHITE).font('Bold').fontSize(14).text(String(i + 1), 50, yStart + 7, { width: 28, align: 'center' });

        // Recommendation text — starts aligned with top of badge
        doc.fillColor(BLACK).font('Body').fontSize(11).text(rec, 90, yStart + 6, { width: 455, lineGap: 3 });

        // Advance to max of text bottom and badge bottom
        const textBottom = doc.y;
        const badgeBottom = yStart + 28;
        doc.y = Math.max(textBottom, badgeBottom) + 14;
      });

      doc.moveDown(2);
      doc.font('Body').fontSize(8).fillColor('#a3a3a3')
        .text('Raport generat automat pe baza datelor sincronizate în Kimono BI. Acuratețea recomandărilor depinde de calitatea și cantitatea datelor disponibile.', { width: 495, align: 'center' });
    }

    doc.end();
  });
}

function drawPageHeader(doc: PDFKit.PDFDocument, title: string, m: AuditMetrics) {
  doc.rect(0, 0, 595, 80).fill(BLACK);
  doc.rect(0, 76, 595, 4).fill(ACCENT);

  doc.fillColor(WHITE).font('Bold').fontSize(10).text('KIMONO BI  ·  BI AUDIT', 50, 24, { characterSpacing: 1 });
  doc.font('Body').fontSize(9).fillColor('#a3a3a3').text(`${m.store.name}  ·  ${m.generatedAt.toLocaleDateString('ro-RO')}`, 50, 42);
  doc.fillColor(ACCENT).font('Bold').fontSize(10).text(`SCOR ${m.overall.score}/100 (${m.overall.grade})`, 400, 32, { width: 145, align: 'right', characterSpacing: 1 });

  doc.fillColor(BLACK).font('Bold').fontSize(24).text(title, 50, 110);
  doc.moveTo(50, 150).lineTo(545, 150).lineWidth(2).stroke(BLACK);
  doc.y = 165;
}

function drawDomainDetail(doc: PDFKit.PDFDocument, key: string, d: DomainScore, commentary: string) {
  // Score block
  doc.rect(50, 165, 170, 100).fill(STATUS_COLORS[d.status]);
  doc.fillColor(WHITE).font('Bold').fontSize(54).text(String(d.score), 50, 182, { width: 170, align: 'center' });
  doc.font('Bold').fontSize(10).text(STATUS_LABELS[d.status], 50, 242, { width: 170, align: 'center', characterSpacing: 2 });

  // Metrics list
  doc.fillColor(BLACK);
  let yy = 170;
  doc.font('Bold').fontSize(11).text('METRICI CHEIE', 240, yy, { characterSpacing: 1 });
  yy += 22;
  for (const m of d.metrics) {
    doc.font('Body').fontSize(9).fillColor(MUTED).text(m.label, 240, yy, { width: 200 });
    doc.font('Bold').fontSize(11).fillColor(BLACK).text(String(m.value), 440, yy - 2, { width: 105, align: 'right' });
    if (m.hint) {
      doc.font('Body').fontSize(8).fillColor('#737373').text(m.hint, 240, yy + 12, { width: 305 });
      yy += 28;
    } else {
      yy += 18;
    }
  }

  // AI commentary
  const commentaryY = Math.max(yy, 280) + 24;
  doc.font('Bold').fontSize(13).fillColor(BLACK).text('Observații AI', 50, commentaryY);
  doc.font('Body').fontSize(10).fillColor('#262626').text(commentary || 'Fără observații specifice pentru acest domeniu.', 50, commentaryY + 22, { width: 495, lineGap: 3 });
}
