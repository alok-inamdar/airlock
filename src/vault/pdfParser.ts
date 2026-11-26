/** Client-side PDF text extraction with scanned-PDF detection and a page cap. */

import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { logRequest } from "../services/telemetry";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export const PDF_PAGE_CAP = 15;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MIN_MEANINGFUL_CHARS = 40;

export interface PdfParseResult {
  text: string;
  pageCount: number;
  pagesProcessed: number;
  truncated: boolean;
  scanned: boolean;
  warnings: string[];
}

export async function parsePdfFile(file: File): Promise<PdfParseResult> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("This PDF is larger than 25 MB. Please paste the relevant text instead.");
  }
  const started = Date.now();

  try {
    const buffer = await file.arrayBuffer();
    const document = await pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
    }).promise;

    try {
      const pageCount = document.numPages;
      const pagesProcessed = Math.min(pageCount, PDF_PAGE_CAP);
      const pages: string[] = [];

      for (let pageNumber = 1; pageNumber <= pagesProcessed; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        let pageText = "";
        for (const item of content.items) {
          if (!("str" in item)) continue;
          pageText += item.str;
          pageText += item.hasEOL ? "\n" : " ";
        }
        pages.push(pageText.trim());
        page.cleanup();
      }

      const text = pages.join("\n\n");
      const meaningful = text.replace(/\s/g, "").length;
      const scanned = meaningful < MIN_MEANINGFUL_CHARS;
      const warnings: string[] = [];

      if (pageCount > PDF_PAGE_CAP) {
        warnings.push(
          `Only the first ${PDF_PAGE_CAP} of ${pageCount} pages were parsed. Split the PDF to audit the rest.`
        );
      }
      if (scanned) {
        warnings.push(
          "This PDF appears to be scanned or image-only. Airlock found almost no extractable text."
        );
      }

      logRequest({
        kind: "pdf_parse",
        label: "PDF parsed locally",
        detail: `${pagesProcessed}/${pageCount} pages · ${meaningful.toLocaleString()} chars · scanned=${scanned}`,
        bytes: file.size,
        durationMs: Date.now() - started,
        status: scanned ? "error" : "ok",
      });

      return {
        text: scanned ? "" : text,
        pageCount,
        pagesProcessed,
        truncated: pageCount > PDF_PAGE_CAP,
        scanned,
        warnings,
      };
    } finally {
      await document.destroy();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown PDF error";
    logRequest({
      kind: "pdf_parse",
      label: "PDF parse failed",
      detail: message,
      bytes: file.size,
      durationMs: Date.now() - started,
      status: "error",
    });
    if (/password/i.test(message)) {
      throw new Error("This PDF is password-protected. Remove the password or paste the text.");
    }
    throw new Error(
      "Airlock could not read this PDF. It may be corrupted or image-only. Try pasting the text instead."
    );
  }
}
