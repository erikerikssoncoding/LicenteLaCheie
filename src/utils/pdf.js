const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const LEFT_MARGIN = 72;
const TOP_MARGIN = 770;
const MAX_LINE_LENGTH = 100;
const PDF_MARGIN_MM = { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' };
const VIEWPORT = { width: 1240, height: 1754, deviceScaleFactor: 2 };

let browserPromise = null;
let puppeteerModulePromise = null;

const CONTRACT_BASE_STYLES = `
  @page {
    size: A4;
    margin: 20mm 15mm;
  }
  body {
    margin: 0;
    padding: 0;
    background: #ffffff;
    color: #212529;
    font-family: 'Helvetica Neue', Arial, Helvetica, sans-serif;
  }
  .pdf-wrapper {
    padding: 0;
    position: relative;
  }
  .contract-document {
    max-width: 720px;
    margin: 0 auto;
    font-family: 'Helvetica Neue', Arial, Helvetica, sans-serif;
  }
  .contract-document__header {
    padding-top: 20px;
  }
  .copy-label {
    position: absolute;
    top: 0;
    right: 0;
    font-size: 10px;
    color: #6c757d;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    text-align: right;
  }
  .contract-document h1 {
    font-size: 24px;
    margin-bottom: 8px;
  }
  .contract-document__body h2 {
    font-size: 18px;
    margin-top: 24px;
    margin-bottom: 8px;
  }
  .contract-document__body p,
  .contract-document__body li {
    font-size: 14px;
    line-height: 1.6;
  }
  .contract-document__signatures {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: flex-start;
    gap: 24px;
    margin-top: 32px;
  }
  .signature-block {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  .signature-block:first-child {
    align-items: flex-start;
    text-align: left;
  }
  .signature-block:last-child {
    align-items: flex-end;
    text-align: right;
  }
  .signature-box {
    border: 1px dashed #6c757d;
    border-radius: 12px;
    min-height: 120px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f8f9fa;
    padding: 12px;
    width: 100%;
    margin: 12px 0;
  }
  .signature-placeholder {
    color: #6c757d;
    letter-spacing: 0.1em;
  }
  .signature-image {
    max-width: 160px;
    max-height: 90px;
    object-fit: contain;
  }
  img {
    max-width: 100%;
    height: auto;
  }
  strong {
    font-weight: 600;
  }
`;

const FOOTER_TEMPLATE = `
<style>
  .pdf-footer {
    width: 100%;
    margin: 0 auto;
    padding-bottom: 8px;
    font-size: 10px;
    font-family: 'Helvetica Neue', Arial, Helvetica, sans-serif;
    color: #6c757d;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    text-align: center;
  }
</style>
<div class="pdf-footer">
  Pagina <span class="pageNumber"></span> din <span class="totalPages"></span>
</div>`;

async function getPuppeteer() {
  if (!puppeteerModulePromise) {
    puppeteerModulePromise = import('puppeteer').catch((error) => {
      puppeteerModulePromise = null;
      throw new Error(`PUPPETEER_IMPORT_FAILED: ${error.message}`);
    });
  }
  const module = await puppeteerModulePromise;
  return module.default || module;
}

async function getBrowser() {
  if (!browserPromise) {
    const puppeteer = await getPuppeteer();
    browserPromise = puppeteer
      .launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=medium', '--disable-dev-shm-usage']
      })
      .catch((error) => {
        browserPromise = null;
        throw error;
      });

    const cleanup = () => {
      if (!browserPromise) {
        return;
      }
      browserPromise
        .then((browser) => browser?.close?.())
        .catch(() => {})
        .finally(() => {
          browserPromise = null;
        });
    };
    process.once('exit', cleanup);
  }
  return browserPromise;
}

function buildHtmlDocument(content, { copyLabel } = {}) {
  return `<!DOCTYPE html>
  <html lang="ro">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <style>
        ${CONTRACT_BASE_STYLES}
      </style>
    </head>
  <body>
    <div class="pdf-wrapper">
      ${copyLabel ? `<div class="copy-label">${copyLabel}</div>` : ''}
      ${content || ''}
    </div>
  </body>
  </html>`;
}

export async function createPdfBufferFromHtml(html, options = {}) {
  if (html === null || html === undefined) {
    throw new Error('HTML_CONTENT_MISSING');
  }
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport(VIEWPORT);
    await page.setContent(buildHtmlDocument(String(html), options), { waitUntil: 'networkidle0' });
    await page.emulateMediaType('screen');
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: PDF_MARGIN_MM,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: FOOTER_TEMPLATE
    });
    const buffer = Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
    return buffer;
  } finally {
    await page.close();
  }
}

function escapePdfText(text) {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function wrapLine(line, maxLength) {
  if (!line) {
    return [''];
  }
  const segments = [];
  let remaining = line;
  while (remaining.length > maxLength) {
    let splitIndex = remaining.lastIndexOf(' ', maxLength);
    if (splitIndex <= 0) {
      splitIndex = maxLength;
    }
    segments.push(remaining.slice(0, splitIndex).trimEnd());
    remaining = remaining.slice(splitIndex).trimStart();
  }
  segments.push(remaining);
  return segments;
}

function normalizeText(text) {
  return text
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[\r\t]+/g, ' ')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/[\u007f-\u009f]/g, '');
}

export function createPdfBufferFromText(text) {
  const normalized = normalizeText(text || '');
  const wrappedLines = normalized
    .split('\n')
    .flatMap((line) => wrapLine(line, MAX_LINE_LENGTH));

  const commands = ['BT', '/F1 12 Tf', '12 TL', `1 0 0 1 ${LEFT_MARGIN} ${TOP_MARGIN} Tm`];
  wrappedLines.forEach((line, index) => {
    if (index > 0) {
      commands.push('T*');
    }
    commands.push(`(${escapePdfText(line)}) Tj`);
  });
  commands.push('ET');
  const content = commands.join('\n');
  const contentBuffer = Buffer.from(content, 'utf8');

  let pdf = '%PDF-1.4\n';
  const offsets = [];

  const addObject = (index, body) => {
    const offset = Buffer.byteLength(pdf, 'utf8');
    offsets[index] = offset;
    pdf += `${index} 0 obj\n${body}\nendobj\n`;
  };

  addObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
  addObject(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  addObject(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH.toFixed(2)} ${PAGE_HEIGHT.toFixed(
      2
    )}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`
  );
  const offset4 = Buffer.byteLength(pdf, 'utf8');
  offsets[4] = offset4;
  pdf += `4 0 obj\n<< /Length ${contentBuffer.length} >>\nstream\n`;
  pdf += content;
  pdf += '\nendstream\nendobj\n';
  addObject(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += 'xref\n';
  pdf += '0 6\n';
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= 5; i += 1) {
    const offset = offsets[i] || 0;
    pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  }
  pdf += 'trailer\n';
  pdf += '<< /Size 6 /Root 1 0 R >>\n';
  pdf += 'startxref\n';
  pdf += `${xrefOffset}\n`;
  pdf += '%%EOF';

  return Buffer.from(pdf, 'utf8');
}
