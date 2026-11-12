import { plainTextToTiptapDocument } from "@/lib/documents";

export const MAX_TEXT_IMPORT_BYTES = 1024 * 1024;

export type TextImportErrorCode =
  | "invalid-file"
  | "invalid-type"
  | "file-too-large"
  | "invalid-encoding"
  | "invalid-content";

export type TextImportResult =
  | { success: true; title: string; content: ReturnType<typeof plainTextToTiptapDocument> }
  | { success: false; code: TextImportErrorCode; message: string };

export function validateTextImport({
  fileName,
  contentType,
  bytes,
}: {
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
}): TextImportResult {
  if (!fileName || /[\\/]/.test(fileName)) {
    return { success: false, code: "invalid-file", message: "Choose a valid text file." };
  }

  if (!fileName.toLowerCase().endsWith(".txt")) {
    return { success: false, code: "invalid-type", message: "Only .txt files can be imported." };
  }

  if (
    contentType &&
    contentType !== "text/plain" &&
    contentType !== "application/octet-stream"
  ) {
    return {
      success: false,
      code: "invalid-type",
      message: "The selected file must be a plain-text file.",
    };
  }

  if (bytes.byteLength > MAX_TEXT_IMPORT_BYTES) {
    return {
      success: false,
      code: "file-too-large",
      message: "Text files must be 1 MB or smaller.",
    };
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return {
      success: false,
      code: "invalid-encoding",
      message: "The file must contain valid UTF-8 text.",
    };
  }

  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text)) {
    return {
      success: false,
      code: "invalid-content",
      message: "The file contains unsupported control characters.",
    };
  }

  const normalizedText = text.replace(/\r\n?/g, "\n");
  const title =
    fileName.replace(/\.txt$/i, "").trim().slice(0, 120) ||
    "Imported document";

  return {
    success: true,
    title,
    content: plainTextToTiptapDocument(normalizedText),
  };
}
