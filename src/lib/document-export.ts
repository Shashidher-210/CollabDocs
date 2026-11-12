import type { JSONContent } from "@tiptap/react";

function renderInline(node: JSONContent): string {
  if (node.type === "hardBreak") {
    return "  \n";
  }
  if (node.type !== "text") {
    return (node.content ?? []).map(renderInline).join("");
  }

  let text = node.text ?? "";
  for (const mark of node.marks ?? []) {
    if (mark.type === "bold") {
      text = `**${text}**`;
    } else if (mark.type === "italic") {
      text = `*${text}*`;
    } else if (mark.type === "strike") {
      text = `~~${text}~~`;
    } else if (mark.type === "code") {
      text = `\`${text.replace(/`/g, "\\`")}\``;
    } else if (mark.type === "underline") {
      text = `<u>${text}</u>`;
    } else if (mark.type === "link") {
      const href =
        typeof mark.attrs?.href === "string" &&
        /^https?:\/\//i.test(mark.attrs.href)
          ? mark.attrs.href
          : "";
      text = href ? `[${text}](${href})` : text;
    }
  }
  return text;
}

function renderBlocks(node: JSONContent): string {
  const children = node.content ?? [];
  if (node.type === "text" || node.type === "hardBreak") {
    return renderInline(node);
  }
  if (node.type === "doc") {
    return children.map(renderBlocks).filter(Boolean).join("\n\n");
  }
  if (node.type === "paragraph") {
    return children.map(renderInline).join("");
  }
  if (node.type === "heading") {
    const level =
      typeof node.attrs?.level === "number"
        ? Math.min(6, Math.max(1, node.attrs.level))
        : 1;
    return `${"#".repeat(level)} ${children.map(renderInline).join("")}`;
  }
  if (node.type === "bulletList" || node.type === "orderedList") {
    return children
      .map((item, index) => {
        const prefix =
          node.type === "bulletList" ? "- " : `${index + 1}. `;
        const body = (item.content ?? [])
          .map(renderBlocks)
          .filter(Boolean)
          .join("\n");
        return `${prefix}${body.replace(/\n/g, "\n  ")}`;
      })
      .join("\n");
  }
  if (node.type === "blockquote") {
    return children
      .map(renderBlocks)
      .join("\n\n")
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
  }
  if (node.type === "codeBlock") {
    return `\`\`\`\n${children.map(renderInline).join("")}\n\`\`\``;
  }
  if (node.type === "horizontalRule") {
    return "---";
  }
  return children.map(renderBlocks).filter(Boolean).join("\n\n");
}

export function tiptapToMarkdown(document: JSONContent): string {
  return renderBlocks(document).trim();
}
