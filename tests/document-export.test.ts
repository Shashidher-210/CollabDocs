import { describe, expect, it } from "vitest";
import { tiptapToMarkdown } from "@/lib/document-export";

describe("Tiptap Markdown export", () => {
  it("preserves headings, inline marks, links, lists, and paragraphs", () => {
    const markdown = tiptapToMarkdown({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Overview" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Bold", marks: [{ type: "bold" }] },
            { type: "text", text: " and " },
            {
              type: "text",
              text: "linked",
              marks: [
                { type: "link", attrs: { href: "https://example.com" } },
              ],
            },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "First item" }],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(markdown).toBe(
      "## Overview\n\n**Bold** and [linked](https://example.com)\n\n- First item",
    );
  });

  it("does not export unsafe link protocols", () => {
    expect(
      tiptapToMarkdown({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "unsafe",
                marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
              },
            ],
          },
        ],
      }),
    ).toBe("unsafe");
  });
});
