import PDFDocument from 'pdfkit';
import type { AuditMetrics, DomainScore } from '~/lib/audit/metrics.server';

const DOMAIN_TITLES: Record<string, string> = {
  revenue: '1. Venit si Crestere',
  catalog: '2. Produse si Catalog',
  customers: '3. Clienti si Retentie',
  inventory: '4. Stocuri si Supply Chain',
  traffic: '5. Trafic si Conversie',
  profitability: '6. Profitabilitate',
  operations: '7. Operatiuni',
  automation: '8. AI si Automatizare',
};

const STATUS_COLORS: Record<DomainScore['status'], string> = {
  excellent: '#22c55e',
  good: '#3b82f6',
  warning: '#f59e0b',
  critical: '#ef4444',
  unavailable: '#94a3b8',
};

const STATUS_LABELS: Record<DomainScore['status'], string> = {
  excellent: 'Excelent',
  good: 'Bun',
  warning: 'Atentie',
  critical: 'Critic',
  unavailable: 'Indisponibil',
};

const GRADE_COLOR: Record<string, string> = {
  A: '#16a34a', B: '#2563eb', C: '#d97706', D: '#dc2626', F: '#991b1b',
};

export interface AuditCommentary {
  executiveSummary: string;
  domainNotes: Record<string, string>; // domain key -> AI commentary (1-2 paragraphs)
  recommendations: string[]; // 5-8 prioritized action items
}

export function buildAuditPdf(
  metrics: AuditMetrics,
  commentary: AuditCommentary,
): Promise<Buffer> {
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

    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ============ COVER ============
    doc.rect(0, 0, 595, 842).fill('#0f172a');
    doc.fillColor('#ffffff');
    doc.font('Helvetica-Bold').fontSize(11).text('KIMONO BI', 50, 60);
    doc.font('Helvetica').fontSize(9).fillColor('#94a3b8').text('Business Intelligence Platform', 50, 76);

    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(42).text('BI Audit', 50, 260);
    doc.font('Helvetica').fontSize(14).fillColor('#cbd5e1').text('Raport complet de sanatate a magazinului', 50, 320);

    doc.fontSize(11).fillColor('#94a3b8').text('Magazin', 50, 440);
    doc.fontSize(18).fillColor('#ffffff').font('Helvetica-Bold').text(metrics.store.name, 50, 456);
    doc.font('Helvetica').fontSize(10).fillColor('#94a3b8').text(`${metrics.store.platform}  ·  ${metrics.store.domain}`, 50, 480);

    doc.fontSize(11).fillColor('#94a3b8').text('Generat', 50, 520);
    doc.fontSize(13).fillColor('#ffffff').text(metrics.generatedAt.toLocaleString('ro-RO', { dateStyle: 'long', timeStyle: 'short' }), 50, 536);

    // Big score circle
    const cx = 430, cy = 490, r = 80;
    doc.circle(cx, cy, r).lineWidth(8).stroke(GRADE_COLOR[metrics.overall.grade]);
    doc.fillColor(GRADE_COLOR[metrics.overall.grade]).font('Helvetica-Bold').fontSize(56)
      .text(String(metrics.overall.score), cx - 45, cy - 34, { width: 90, align: 'center' });
    doc.fillColor('#94a3b8').font('Helvetica').fontSize(11)
      .text(`Grad ${metrics.overall.grade}`, cx - 45, cy + 32, { width: 90, align: 'center' });

    doc.fontSize(9).fillColor('#64748b').text('Raport generat automat de Kimono BI', 50, 790);

    // ============ EXECUTIVE SUMMARY ============
    doc.addPage();
    drawPageHeader(doc, 'Executive Summary', metrics);

    doc.moveDown(1.5);
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#0f172a').text('Verdict');
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(11).fillColor('#334155').text(metrics.overall.verdict, { width: 495 });

    doc.moveDown(1);
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#0f172a').text('Analiza AI');
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(10).fillColor('#334155').text(commentary.executiveSummary, { width: 495, lineGap: 2 });

    // Domain score overview
    doc.moveDown(1.5);
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#0f172a').text('Scor pe domenii');
    doc.moveDown(0.5);

    const domainKeys = Object.keys(metrics.domains) as Array<keyof typeof metrics.domains>;
    let y = doc.y;
    for (const key of domainKeys) {
      const d = metrics.domains[key];
      if (y > 730) { doc.addPage(); drawPageHeader(doc, 'Executive Summary (continuare)', metrics); y = doc.y + 20; }

      doc.rect(50, y, 495, 28).lineWidth(0.5).stroke('#e2e8f0');
      doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(10).text(DOMAIN_TITLES[key], 60, y + 9, { width: 280, ellipsis: true });

      // Score bar
      const barX = 350, barW = 130, barY = y + 11;
      doc.rect(barX, barY, barW, 6).fill('#e2e8f0');
      doc.rect(barX, barY, (barW * d.score) / 100, 6).fill(STATUS_COLORS[d.status]);

      doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(11).text(`${d.score}`, 495, y + 8, { width: 40, align: 'right' });
      y += 32;
    }

    // ============ DOMAIN DETAIL PAGES ============
    for (const key of domainKeys) {
      doc.addPage();
      drawPageHeader(doc, DOMAIN_TITLES[key], metrics);
      drawDomainDetail(doc, key, metrics.domains[key], commentary.domainNotes[key] || '');
    }

    // ============ RECOMMENDATIONS ============
    doc.addPage();
    drawPageHeader(doc, 'Recomandari prioritizate', metrics);
    doc.moveDown(1);
    doc.font('Helvetica').fontSize(10).fillColor('#64748b')
      .text('Actiuni concrete extrase din datele magazinului si interpretate de AI, sortate dupa impact asteptat.', { width: 495 });
    doc.moveDown(1);

    commentary.recommendations.forEach((rec, i) => {
      const yStart = doc.y;
      if (yStart > 730) { doc.addPage(); drawPageHeader(doc, 'Recomandari (continuare)', metrics); doc.moveDown(1); }

      doc.circle(60, doc.y + 7, 10).fill('#0f172a');
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9).text(String(i + 1), 55, doc.y + 3, { width: 10, align: 'center' });

      doc.fillColor('#0f172a').font('Helvetica').fontSize(11).text(rec, 85, yStart, { width: 460, lineGap: 2 });
      doc.moveDown(0.8);
    });

    // Footer on last page
    doc.moveDown(2);
    doc.font('Helvetica-Oblique').fontSize(9).fillColor('#94a3b8')
      .text('Acest raport a fost generat automat pe baza datelor sincronizate in Kimono BI. Acuratetea recomandarilor depinde de calitatea si cantitatea datelor disponibile.', { width: 495 });

    doc.end();
  });
}

function drawPageHeader(doc: PDFKit.PDFDocument, title: string, m: AuditMetrics) {
  doc.rect(0, 0, 595, 70).fill('#0f172a');
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10).text('KIMONO BI · BI Audit', 50, 22);
  doc.font('Helvetica').fontSize(9).fillColor('#94a3b8').text(`${m.store.name}  ·  ${m.generatedAt.toLocaleDateString('ro-RO')}`, 50, 38);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9).text(`Scor general: ${m.overall.score}/100 (${m.overall.grade})`, 400, 30, { width: 145, align: 'right' });

  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(22).text(title, 50, 95);
  doc.moveTo(50, 130).lineTo(545, 130).lineWidth(0.5).stroke('#e2e8f0');
  doc.fillColor('#000000');
  doc.y = 145;
}

function drawDomainDetail(doc: PDFKit.PDFDocument, key: string, d: DomainScore, commentary: string) {
  // Score badge
  doc.rect(50, 145, 160, 90).fill(STATUS_COLORS[d.status]);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(48).text(String(d.score), 50, 160, { width: 160, align: 'center' });
  doc.font('Helvetica').fontSize(11).text(`${STATUS_LABELS[d.status].toUpperCase()}`, 50, 215, { width: 160, align: 'center' });

  // Metrics list
  doc.fillColor('#0f172a');
  let yy = 150;
  doc.font('Helvetica-Bold').fontSize(11).text('Metrici cheie', 230, yy);
  yy += 18;
  for (const m of d.metrics) {
    doc.font('Helvetica').fontSize(9).fillColor('#64748b').text(m.label, 230, yy, { width: 200 });
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a').text(String(m.value), 430, yy - 2, { width: 115, align: 'right' });
    if (m.hint) {
      doc.font('Helvetica-Oblique').fontSize(8).fillColor('#94a3b8').text(m.hint, 230, yy + 11, { width: 315 });
      yy += 26;
    } else {
      yy += 16;
    }
  }

  // AI commentary
  doc.y = Math.max(yy, 260) + 20;
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#0f172a').text('Observatii AI', 50);
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(10).fillColor('#334155').text(commentary || 'Fara observatii pentru acest domeniu.', 50, doc.y, { width: 495, lineGap: 2 });
}
