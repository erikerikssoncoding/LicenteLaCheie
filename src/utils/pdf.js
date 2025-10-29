const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const LEFT_MARGIN = 72;
const TOP_MARGIN = 770;
const BOTTOM_MARGIN = 72;
const LINE_HEIGHT = 12;
const MAX_LINE_LENGTH = 100;

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

  const pageContents = [];
  const startPageCommands = () => ['BT', '/F1 12 Tf', `${LINE_HEIGHT} TL`, `1 0 0 1 ${LEFT_MARGIN} ${TOP_MARGIN} Tm`];
  let currentCommands = startPageCommands();
  let currentLineCount = 0;

  const flushPage = () => {
    if (currentCommands.length > 0) {
      const commandsWithEnd = [...currentCommands, 'ET'];
      pageContents.push(commandsWithEnd.join('\n'));
      currentCommands = [];
    }
  };

  const startNewPage = () => {
    currentCommands = startPageCommands();
    currentLineCount = 0;
  };

  startNewPage();

  wrappedLines.forEach((line) => {
    if (currentLineCount > 0) {
      const nextLineY = TOP_MARGIN - currentLineCount * LINE_HEIGHT;
      if (nextLineY < BOTTOM_MARGIN) {
        flushPage();
        startNewPage();
      } else {
        currentCommands.push('T*');
      }
    }
    currentCommands.push(`(${escapePdfText(line)}) Tj`);
    currentLineCount += 1;
  });

  flushPage();

  const fontObjectNumber = 3 + pageContents.length * 2;

  let pdf = '%PDF-1.4\n';
  const offsets = [];

  const addObject = (index, body) => {
    const offset = Buffer.byteLength(pdf, 'utf8');
    offsets[index] = offset;
    pdf += `${index} 0 obj\n${body}\nendobj\n`;
  };

  addObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
  const kids = pageContents
    .map((_, pageIndex) => `${3 + pageIndex * 2} 0 R`)
    .join(' ');
  addObject(2, `<< /Type /Pages /Kids [${kids}] /Count ${pageContents.length} >>`);

  pageContents.forEach((content, pageIndex) => {
    const pageObjectNumber = 3 + pageIndex * 2;
    const contentObjectNumber = pageObjectNumber + 1;
    addObject(
      pageObjectNumber,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH.toFixed(2)} ${PAGE_HEIGHT.toFixed(
        2
      )}] /Contents ${contentObjectNumber} 0 R /Resources << /Font << /F1 ${fontObjectNumber} 0 R >> >> >>`
    );
    const contentBuffer = Buffer.from(content, 'utf8');
    const contentOffset = Buffer.byteLength(pdf, 'utf8');
    offsets[contentObjectNumber] = contentOffset;
    pdf += `${contentObjectNumber} 0 obj\n<< /Length ${contentBuffer.length} >>\nstream\n`;
    pdf += content;
    pdf += '\nendstream\nendobj\n';
  });

  addObject(fontObjectNumber, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += 'xref\n';
  const totalObjects = fontObjectNumber;
  pdf += `0 ${totalObjects + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= totalObjects; i += 1) {
    const offset = offsets[i] || 0;
    pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  }
  pdf += 'trailer\n';
  pdf += `<< /Size ${totalObjects + 1} /Root 1 0 R >>\n`;
  pdf += 'startxref\n';
  pdf += `${xrefOffset}\n`;
  pdf += '%%EOF';

  return Buffer.from(pdf, 'utf8');
}
