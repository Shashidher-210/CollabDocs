import mammoth from "mammoth";
import { plainTextToTiptapDocument } from "@/lib/documents";

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_EXTRACTED_CHARACTERS = 500_000;

export type SupportedImportExtension = "txt" | "docx" | "pdf";

export type ImportValidationResult =
  | {
      success: true;
      title: string;
      extension: SupportedImportExtension;
      bytes: Uint8Array;
      text?: string;
    }
  | {
      success: false;
      status: 400 | 413;
      message: string;
    };

function getExtension(fileName: string): SupportedImportExtension | null {
  const extension = fileName.split(".").pop()?.toLowerCase();
  return extension === "txt" || extension === "docx" || extension === "pdf"
    ? extension
    : null;
}

export function validateImportFile({
  fileName,
  contentType,
  bytes,
}: {
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
}): ImportValidationResult {
  if (!fileName || /[\\/]/.test(fileName)) {
    return { success: false, status: 400, message: "Choose a valid document file." };
  }
  if (bytes.byteLength > MAX_IMPORT_BYTES) {
    return {
      success: false,
      status: 413,
      message: "Files must be 5 MB or smaller.",
    };
  }

  const extension = getExtension(fileName);
  if (!extension) {
    return {
      success: false,
      status: 400,
      message: "Supported formats are .txt, .docx, and text-based .pdf.",
    };
  }

  const header = new TextDecoder().decode(bytes.subarray(0, 8));
  if (extension === "pdf" && !header.startsWith("%PDF-")) {
    return { success: false, status: 400, message: "The PDF file is invalid." };
  }
  if (extension === "docx" && !header.startsWith("PK")) {
    return { success: false, status: 400, message: "The DOCX file is invalid." };
  }

  const allowedTypes: Record<SupportedImportExtension, string[]> = {
    txt: ["", "text/plain", "application/octet-stream"],
    docx: [
      "",
      "application/octet-stream",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    pdf: ["", "application/octet-stream", "application/pdf"],
  };
  if (!allowedTypes[extension].includes(contentType)) {
    return {
      success: false,
      status: 400,
      message: "The selected file type does not match its extension.",
    };
  }

  let text: string | undefined;
  if (extension === "txt") {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return {
        success: false,
        status: 400,
        message: "The text file must contain valid UTF-8.",
      };
    }
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text)) {
      return {
        success: false,
        status: 400,
        message: "The text file contains unsupported control characters.",
      };
    }
  }

  const title =
    fileName.slice(0, -(extension.length + 1)).trim().slice(0, 120) ||
    "Imported document";
  return { success: true, title, extension, bytes, text };
}

async function extractDocxText(bytes: Uint8Array) {
  const result = await mammoth.extractRawText({
    buffer: Buffer.from(bytes),
  });
  return result.value;
}

async function extractPdfText(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: bytes,
    useSystemFonts: false,
  });
  const document = await loadingTask.promise;

  try {
    if (document.numPages > 200) {
      throw new Error("PDF files must have 200 pages or fewer.");
    }

    const pages: string[] = [];
    let extractedLength = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items
        .filter((item) => "str" in item)
        .map((item) => {
          if (!("str" in item)) {
            return "";
          }
          return `${item.str}${item.hasEOL ? "\n" : " "}`;
        })
        .join("")
        .replace(/[ \t]+\n/g, "\n")
        .trim();
      if (pageText) {
        extractedLength += pageText.length + 2;
        if (extractedLength > MAX_EXTRACTED_CHARACTERS) {
          throw new Error("Extracted document text is too large to import.");
        }
        pages.push(pageText);
      }
      page.cleanup();
    }

    if (pages.length === 0) {
      throw new Error(
        "No selectable text was found. Scanned PDFs require OCR, which is not supported.",
      );
    }
    return pages.join("\n\n");
  } finally {
    await loadingTask.destroy();
  }
}

export async function extractImportContent(file: ImportValidationResult & {
  success: true;
}) {
  let text: string;
  try {
    if (file.extension === "txt") {
      text = file.text ?? "";
    } else if (file.extension === "docx") {
      text = await extractDocxText(file.bytes);
    } else {
      text = await extractPdfText(file.bytes);
    }
  } catch (error) {
    if (error instanceof Error) {
      if (
        error.message.startsWith("No selectable text") ||
        error.message.startsWith("PDF files must") ||
        error.message.startsWith("Extracted document text")
      ) {
        throw error;
      }
    }
    throw new Error("The selected document is invalid or could not be read.");
  }

  if (text.length > MAX_EXTRACTED_CHARACTERS) {
    throw new Error("Extracted document text is too large to import.");
  }
  if (!text.trim()) {
    throw new Error("No readable text was found in the selected document.");
  }

  return plainTextToTiptapDocument(text.replace(/\r\n?/g, "\n"));
}
