/**
 * pdfParser.js – Client-side PDF → plain text extraction using pdfjs-dist.
 *
 * Runs entirely in the browser (no server upload required).
 * Returns a single concatenated string of all pages' text content.
 */

import * as pdfjs from 'pdfjs-dist';

// Point the worker at the bundled worker file shipped with pdfjs-dist.
// Vite will resolve this as a URL via the `?url` import.
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

/**
 * extractTextFromPDF
 * Accepts a File object (application/pdf) and returns the full plain text.
 *
 * @param {File} file  A PDF File object from an <input type="file"> element
 * @returns {Promise<{ text: string, pageCount: number, error: string|null }>}
 */
export async function extractTextFromPDF(file) {
  try {
    // Read the file as an ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();

    // Load the PDF document with resilient options
    const loadingTask = pdfjs.getDocument({
      data: arrayBuffer,
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
    });
    const pdf = await loadingTask.promise;

    const pageCount = pdf.numPages;
    const pageTexts = [];

    // Extract text from each page sequentially with layout preservation
    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      const items = (textContent.items || []).filter(item => 'str' in item);
      if (items.length === 0) {
        pageTexts.push('');
        continue;
      }

      let lastY = null;
      let lastX = null;
      let pageText = '';

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const text = item.str;
        if (!text) continue;

        const currentY = item.transform ? item.transform[5] : null;
        const currentX = item.transform ? item.transform[4] : null;

        if (lastY !== null && currentY !== null) {
          const dy = Math.abs(currentY - lastY);
          // If Y position changed significantly or EOL flag set, insert newline
          if (dy > 6 || item.hasEOL) {
            // Larger vertical jump indicates a section or paragraph gap
            if (dy > 14) {
              if (!pageText.endsWith('\n\n')) {
                pageText += pageText.endsWith('\n') ? '\n' : '\n\n';
              }
            } else {
              if (!pageText.endsWith('\n')) {
                pageText += '\n';
              }
            }
            lastX = null;
          } else if (lastX !== null && currentX !== null) {
            // Same line: check horizontal gap between tokens
            const gap = currentX - lastX;
            if (gap > 2 && !pageText.endsWith(' ') && !text.startsWith(' ')) {
              pageText += ' ';
            }
          }
        }

        pageText += text;
        lastY = currentY;
        lastX = currentX !== null && typeof item.width === 'number' ? currentX + item.width : currentX;
      }

      pageTexts.push(pageText.trim());
    }

    const text = pageTexts.filter(Boolean).join('\n\n');

    if (!text.trim()) {
      return {
        text: '',
        pageCount,
        error: 'No readable text found in PDF. The file may be image-based or encrypted.',
      };
    }

    return { text, pageCount, error: null };
  } catch (err) {
    console.error('[pdfParser] Failed to parse PDF:', err);
    return {
      text: '',
      pageCount: 0,
      error: `Failed to parse PDF: ${err?.message ?? 'Unknown error'}`,
    };
  }
}

/**
 * isValidPDFFile – Quick guard to check file type before attempting parse.
 * @param {File} file
 * @returns {boolean}
 */
export function isValidPDFFile(file) {
  return (
    file instanceof File &&
    (file.type === 'application/pdf' || file.name?.toLowerCase().endsWith('.pdf'))
  );
}
