import { readFile } from 'node:fs/promises';
import { getDocumentProxy, extractText } from 'unpdf';
import type { PdfExtract, PdfInspector } from '../ports/latex.js';

// Single seam for turning a PDF on disk into text + a page count. The structure
// checker uses it today; a future ATS scorer can reuse the same extraction so
// both see exactly the same text.
export async function extractPdf(path: string): Promise<PdfExtract> {
  const buf = await readFile(path);
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  return { text, totalPages };
}

// The unpdf-backed PdfInspector the pipeline injects.
export class UnpdfInspector implements PdfInspector {
  extract(path: string): Promise<PdfExtract> {
    return extractPdf(path);
  }
}
