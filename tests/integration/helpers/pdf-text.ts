import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * Reads a generated PDF back the way a viewer (or a customer's Ctrl+F) does:
 * page count plus the extracted text of each page, via PDF.js. Proves that
 * text is real, selectable text with correct Unicode (Cyrillic, ₸) rather
 * than drawn outlines or an image.
 */
export interface PdfText {
  pages: string[];
  /** All pages, whitespace collapsed to single spaces — for phrase search
   * across wrapped lines. */
  flat: string;
  numPages: number;
}

export async function readPdfText(bytes: Uint8Array): Promise<PdfText> {
  // PDF.js may transfer/detach the buffer it is given — always pass a copy.
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  const pdf = await task.promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(
      content.items
        .map((item) => ('str' in item ? `${item.str}${item.hasEOL ? '\n' : ''}` : ''))
        .join(''),
    );
  }
  const numPages = pdf.numPages;
  await task.destroy();
  return {
    pages,
    flat: pages.join('\n').replace(/\s+/g, ' '),
    numPages,
  };
}

/** Raw PDF syntax as latin1 — for asserting the file contains no active
 * content (JavaScript, launch/URI actions, embedded files). */
export function pdfSyntax(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1');
}
