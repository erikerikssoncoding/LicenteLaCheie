export function htmlToPlainText(html) {
  if (!html) {
    return '';
  }

  return (
    html
      .replace(/\r\n/g, '\n')
      .replace(/<\s*br\s*\/?\s*>/gi, '\n')
      .replace(/<\s*\/p\s*>/gi, '\n\n')
      .replace(/<\s*h[1-6][^>]*>/gi, '')
      .replace(/<\s*\/h[1-6]\s*>/gi, '\n\n')
      .replace(/<\s*li\s*>/gi, '\u2022 ')
      .replace(/<\s*\/li\s*>/gi, '\n')
      .replace(/<\s*\/ul\s*>/gi, '\n')
      .replace(/<\s*\/ol\s*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}
