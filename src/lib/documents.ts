import { z } from "zod";
import type { JSONContent } from "@tiptap/react";

const textLimit = 500_000;
const nodeLimit = 20_000;
const depthLimit = 50;

export const documentIdSchema = z.string().uuid();

export const createDocumentSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  content: z.unknown().optional(),
});

export const updateDocumentSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    content: z.unknown().optional(),
    revision: z.number().int().min(1),
  })
  .refine(
    (value) => value.title !== undefined || value.content !== undefined,
    "Provide a title or content to update",
  );

const blockNodeTypes = new Set([
  "blockquote",
  "bulletList",
  "codeBlock",
  "heading",
  "horizontalRule",
  "orderedList",
  "paragraph",
]);
const inlineNodeTypes = new Set(["hardBreak", "text"]);
const markTypes = new Set(["bold", "code", "italic", "link", "strike", "underline"]);

export function isTiptapDocument(value: unknown): value is JSONContent {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (value as Record<string, unknown>).type !== "doc" ||
    !Array.isArray((value as Record<string, unknown>).content)
  ) {
    return false;
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return false;
  }
  if (serialized.length > textLimit) {
    return false;
  }

  const pending: Array<{
    node: unknown;
    parentType: string;
    depth: number;
  }> = (value as { content: unknown[] }).content.map((node) => ({
    node,
    parentType: "doc",
    depth: 1,
  }));
  let nodeCount = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) {
      return false;
    }

    nodeCount += 1;
    if (
      nodeCount > nodeLimit ||
      current.depth > depthLimit ||
      typeof current.node !== "object" ||
      current.node === null ||
      Array.isArray(current.node)
    ) {
      return false;
    }

    const node = current.node as Record<string, unknown>;
    if (
      typeof node.type !== "string" ||
      (node.attrs !== undefined &&
        (typeof node.attrs !== "object" ||
          node.attrs === null ||
          Array.isArray(node.attrs))) ||
      (node.text !== undefined && typeof node.text !== "string") ||
      (node.content !== undefined && !Array.isArray(node.content)) ||
      (node.marks !== undefined && !Array.isArray(node.marks))
    ) {
      return false;
    }

    if (
      (current.parentType === "doc" && !blockNodeTypes.has(node.type)) ||
      (current.parentType === "paragraph" &&
        !inlineNodeTypes.has(node.type)) ||
      (current.parentType === "heading" &&
        !inlineNodeTypes.has(node.type)) ||
      (current.parentType === "codeBlock" && node.type !== "text") ||
      (current.parentType === "bulletList" &&
        node.type !== "listItem") ||
      (current.parentType === "orderedList" &&
        node.type !== "listItem") ||
      ((current.parentType === "blockquote" ||
        current.parentType === "listItem") &&
        !blockNodeTypes.has(node.type))
    ) {
      return false;
    }

    if (
      (node.type === "text" && typeof node.text !== "string") ||
      (node.type !== "text" && node.text !== undefined) ||
      (inlineNodeTypes.has(node.type) && node.content !== undefined) ||
      (node.type === "horizontalRule" && node.content !== undefined) ||
      (!blockNodeTypes.has(node.type) &&
        !inlineNodeTypes.has(node.type) &&
        node.type !== "listItem")
    ) {
      return false;
    }

    if (
      node.type === "heading" &&
      node.attrs !== undefined &&
      (node.attrs as Record<string, unknown>).level !== undefined &&
      ![1, 2, 3].includes(
        (node.attrs as Record<string, unknown>).level as number,
      )
    ) {
      return false;
    }

    if (node.marks !== undefined) {
      if (!Array.isArray(node.marks)) {
        return false;
      }
      for (const mark of node.marks) {
        if (
          typeof mark !== "object" ||
          mark === null ||
          Array.isArray(mark) ||
          typeof (mark as Record<string, unknown>).type !== "string" ||
          !markTypes.has((mark as Record<string, unknown>).type as string)
        ) {
          return false;
        }
      }
    }

    if (Array.isArray(node.content)) {
      pending.push(
        ...node.content.map((child) => ({
          node: child,
          parentType: node.type as string,
          depth: current.depth + 1,
        })),
      );
    }
  }

  return true;
}

export function getSafeTiptapDocument(value: unknown): JSONContent {
  return isTiptapDocument(value)
    ? value
    : { type: "doc", content: [{ type: "paragraph" }] };
}

export function plainTextToTiptapDocument(text: string) {
  return {
    type: "doc",
    content: text.split(/\r?\n/).map((line) => ({
      type: "paragraph",
      ...(line ? { content: [{ type: "text", text: line }] } : {}),
    })),
  };
}

export function tiptapDocumentToPlainText(value: unknown): string {
  if (!isTiptapDocument(value)) {
    return "";
  }

  const nodeText = (node: Record<string, unknown>): string => {
    if (node.type === "text") {
      return typeof node.text === "string" ? node.text : "";
    }
    if (node.type === "hardBreak") {
      return "\n";
    }

    const children = Array.isArray(node.content)
      ? node.content
          .filter(
            (child): child is Record<string, unknown> =>
              typeof child === "object" &&
              child !== null &&
              !Array.isArray(child),
          )
          .map(nodeText)
          .join("")
      : "";

    return node.type === "paragraph" ? `${children}\n` : children;
  };

  return (value.content as Record<string, unknown>[])
    .filter(
      (node): node is Record<string, unknown> =>
        typeof node === "object" && node !== null && !Array.isArray(node),
    )
    .map(nodeText)
    .join("")
    .replace(/\n$/, "");
}

export function isValidTiptapDocument(value: unknown) {
  return isTiptapDocument(value);
}
