const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const LEFT_MARGIN = 72;
const TOP_MARGIN = 770;
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
