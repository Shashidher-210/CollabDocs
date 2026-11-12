import { describe, expect, it } from "vitest";
import {
  MAX_TEXT_IMPORT_BYTES,
  validateTextImport,
} from "@/lib/text-import";

function validate(
  fileName: string,
  text: string,
  contentType = "text/plain",
) {
  return validateTextImport({
    fileName,
    contentType,
    bytes: new TextEncoder().encode(text),
  });
}

describe("plain text import validation", () => {
  it("converts UTF-8 lines to paragraph nodes and derives a title", () => {
    const result = validate("meeting-notes.txt", "First line\r\nSecond line\n");

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.title).toBe("meeting-notes");
    expect(result.content).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "First line" }] },
        { type: "paragraph", content: [{ type: "text", text: "Second line" }] },
        { type: "paragraph" },
      ],
    });
  });

  it("rejects non-text file extensions and MIME types", () => {
    expect(validate("notes.pdf", "not a text file")).toMatchObject({
      success: false,
      code: "invalid-type",
    });
    expect(
      validate("notes.txt", "not plain text", "application/pdf"),
    ).toMatchObject({ success: false, code: "invalid-type" });
  });

  it("rejects files larger than 1 MB", () => {
    const result = validateTextImport({
      fileName: "large.txt",
      contentType: "text/plain",
      bytes: new Uint8Array(MAX_TEXT_IMPORT_BYTES + 1),
    });

    expect(result).toMatchObject({ success: false, code: "file-too-large" });
  });

  it("rejects invalid UTF-8 and unsupported control characters", () => {
    expect(
      validateTextImport({
        fileName: "bad.txt",
        contentType: "text/plain",
        bytes: new Uint8Array([0xc3, 0x28]),
      }),
    ).toMatchObject({ success: false, code: "invalid-encoding" });
    expect(validate("bad.txt", "text\u0000hidden")).toMatchObject({
      success: false,
      code: "invalid-content",
    });
  });
});
