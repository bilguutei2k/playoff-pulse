// Turns an injury report PDF into positioned text for the pure parser. Kept apart
// because it needs the PDF library, which only scripts may import.

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  parseReportPages,
  type ParsedReport,
  type PdfTextItem,
} from "../../src/lib/live-data/nba-reports";

export async function readReportPages(data: Uint8Array): Promise<PdfTextItem[][]> {
  const task = getDocument({ data, useSystemFonts: true, verbosity: 0 });
  const document = await task.promise;
  const pages: PdfTextItem[][] = [];
  for (let number = 1; number <= document.numPages; number += 1) {
    const page = await document.getPage(number);
    const content = await page.getTextContent();
    const items: PdfTextItem[] = [];
    for (const item of content.items) {
      if ("str" in item && item.str.trim() !== "") {
        items.push({ text: item.str, x: item.transform[4], y: item.transform[5] });
      }
    }
    pages.push(items);
  }
  await task.destroy();
  return pages;
}

export async function parseReportPdf(data: Uint8Array): Promise<ParsedReport> {
  return parseReportPages(await readReportPages(data));
}
