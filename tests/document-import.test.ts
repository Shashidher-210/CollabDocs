import { describe, expect, it } from "vitest";
import {
  extractImportContent,
  MAX_IMPORT_BYTES,
  validateImportFile,
} from "@/lib/document-import";

function validate(
  fileName: string,
  bytes: Uint8Array,
  contentType = "",
) {
  return validateImportFile({ fileName, bytes, contentType });
}

describe("document import validation", () => {
  it("accepts UTF-8 text, DOCX ZIP, and PDF signatures", () => {
    expect(
      validate(
        "notes.txt",
        new TextEncoder().encode("paragraph"),
        "text/plain",
      ),
    ).toMatchObject({ success: true, extension: "txt", title: "notes" });
    expect(
      validate(
        "report.docx",
        new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toMatchObject({ success: true, extension: "docx", title: "report" });
    expect(
      validate(
        "report.pdf",
        new TextEncoder().encode("%PDF-1.7"),
        "application/pdf",
      ),
    ).toMatchObject({ success: true, extension: "pdf", title: "report" });
  });

  it("rejects unsupported, mismatched, and invalid-format files", () => {
    expect(validate("report.doc", new Uint8Array([0x50, 0x4b]))).toMatchObject({
      success: false,
      status: 400,
    });
    expect(
      validate("report.docx", new TextEncoder().encode("not a zip file")),
    ).toMatchObject({ success: false, status: 400 });
    expect(
      validate("report.pdf", new TextEncoder().encode("%PDF-1.7"), "text/plain"),
    ).toMatchObject({ success: false, status: 400 });
  });

  it("rejects oversized files and invalid UTF-8 text", () => {
    expect(
      validate("large.pdf", new Uint8Array(MAX_IMPORT_BYTES + 1)),
    ).toMatchObject({ success: false, status: 413 });
    expect(
      validate("invalid.txt", new Uint8Array([0xff, 0xfe])),
    ).toMatchObject({ success: false, status: 400 });
  });

  it("extracts selectable text from a text-based PDF", async () => {
    const stream =
      "BT /F1 18 Tf 72 720 Td (PDF import works) Tj ET";
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    ];
    let pdf = "%PDF-1.7\n";
    const offsets = [0];
    for (const [index, object] of objects.entries()) {
      offsets.push(Buffer.byteLength(pdf));
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    }
    const xrefOffset = Buffer.byteLength(pdf);
    pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
    pdf += offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
      .join("");
    pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

    const file = validate("notes.pdf", new TextEncoder().encode(pdf), "application/pdf");
    expect(file.success).toBe(true);
    if (!file.success) {
      throw new Error(file.message);
    }
    const content = await extractImportContent(file);
    expect(content.content?.[0]?.content?.[0]?.text).toContain(
      "PDF import works",
    );
  }, 15_000);
});
