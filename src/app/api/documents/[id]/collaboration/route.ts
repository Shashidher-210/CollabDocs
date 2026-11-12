import { connection, NextResponse } from "next/server";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EditorState } from "@tiptap/pm/state";
import { z } from "zod";
import {
  DatabaseError,
  getCurrentDemoUser,
  UnauthorizedError,
} from "@/lib/demo-session";
import { documentIdSchema } from "@/lib/documents";
import { canEditDocument, canReadDocument, getDocumentAccessRole } from "@/lib/document-access";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };
const selectionSchema = z.object({
  from: z.number().int().nonnegative(),
  to: z.number().int().positive(),
  selectedText: z.string().min(1).max(5000),
}).refine((value) => value.to > value.from, "Select a text range");
const createSchema = z.discriminatedUnion("kind", [
  selectionSchema.extend({
    kind: z.literal("comment"),
    body: z.string().trim().min(1).max(2000),
  }),
  selectionSchema.extend({
    kind: z.literal("suggestion"),
    suggestedText: z.string().trim().min(1).max(5000),
  }),
]);
const decisionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("comment"),
    id: z.string().uuid(),
    resolved: z.boolean(),
  }),
  z.object({
    kind: z.literal("suggestion"),
    id: z.string().uuid(),
    decision: z.enum(["accepted", "rejected"]),
  }),
]);

async function getAccess(supabase: ReturnType<typeof createSupabaseAdminClient>, id: string, userId: string) {
  const { data: document, error } = await supabase
    .from("documents")
    .select("id, owner_id, content, revision")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    throw new DatabaseError(error.message);
  }
  if (!document) {
    return { document: null, role: "none" as const };
  }
  let shareRole: string | null = null;
  if (document.owner_id !== userId) {
    const { data: share, error: shareError } = await supabase
      .from("document_shares")
      .select("role")
      .eq("document_id", id)
      .eq("user_id", userId)
      .maybeSingle();
    if (shareError) {
      throw new DatabaseError(shareError.message);
    }
    shareRole = share?.role ?? null;
  }
  return {
    document,
    role: getDocumentAccessRole({
      ownerId: document.owner_id,
      userId,
      shareRole,
    }),
  };
}

function handleError(error: unknown) {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  if (error instanceof DatabaseError) {
    console.error("Document collaboration database operation failed:", error.message);
  } else {
    console.error("Document collaboration request failed");
  }
  return NextResponse.json(
    { error: "The collaboration request could not be completed" },
    { status: 500 },
  );
}

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    await connection();
    const user = await getCurrentDemoUser();
    const { id } = await params;
    if (!documentIdSchema.safeParse(id).success) {
      return NextResponse.json({ error: "Invalid document ID" }, { status: 400 });
    }
    const supabase = createSupabaseAdminClient();
    const { role } = await getAccess(supabase, id, user.id);
    if (!canReadDocument(role)) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    const [comments, suggestions] = await Promise.all([
      supabase
        .from("document_comments")
        .select("id, created_by, from_position, to_position, selected_text, body, resolved_at, created_at")
        .eq("document_id", id)
        .order("created_at", { ascending: true }),
      supabase
        .from("document_suggestions")
        .select("id, created_by, from_position, to_position, original_text, suggested_text, status, base_revision, created_at")
        .eq("document_id", id)
        .order("created_at", { ascending: true }),
    ]);
    if (comments.error) {
      throw new DatabaseError(comments.error.message);
    }
    if (suggestions.error) {
      throw new DatabaseError(suggestions.error.message);
    }
    const authorIds = [
      ...new Set([
        ...(comments.data ?? []).map((item) => item.created_by),
        ...(suggestions.data ?? []).map((item) => item.created_by),
      ]),
    ];
    const { data: users, error: usersError } =
      authorIds.length > 0
        ? await supabase.from("users").select("id, name").in("id", authorIds)
        : { data: [], error: null };
    if (usersError) {
      throw new DatabaseError(usersError.message);
    }
    const names = new Map((users ?? []).map((item) => [item.id, item.name]));
    return NextResponse.json({
      comments: (comments.data ?? []).map((item) => ({
        ...item,
        author: names.get(item.created_by) ?? "Unknown",
      })),
      suggestions: (suggestions.data ?? []).map((item) => ({
        ...item,
        author: names.get(item.created_by) ?? "Unknown",
      })),
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    await connection();
    const user = await getCurrentDemoUser();
    const { id } = await params;
    if (!documentIdSchema.safeParse(id).success) {
      return NextResponse.json({ error: "Invalid document ID" }, { status: 400 });
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid collaboration data" },
        { status: 400 },
      );
    }
    const supabase = createSupabaseAdminClient();
    const { document, role } = await getAccess(supabase, id, user.id);
    if (!document || !canEditDocument(role)) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    const selected = parsed.data;
    const schema = getSchema([StarterKit]);
    const currentDocument = schema.nodeFromJSON(document.content);
    const selectedFromDocument = currentDocument.textBetween(
      selected.from,
      selected.to,
      "\n",
    );
    if (selectedFromDocument !== selected.selectedText) {
      return NextResponse.json(
        { error: "The selected text changed. Refresh and try again." },
        { status: 409 },
      );
    }
    const fields = {
      document_id: id,
      created_by: user.id,
      from_position: selected.from,
      to_position: selected.to,
    };
    if (selected.kind === "comment") {
      const { data, error } = await supabase
        .from("document_comments")
        .insert({
          ...fields,
          selected_text: selected.selectedText,
          body: selected.body,
        })
        .select("id, created_by, from_position, to_position, selected_text, body, resolved_at, created_at")
        .single();
      if (error) {
        throw new DatabaseError(error.message);
      }
      return NextResponse.json(
        { comment: { ...data, author: user.name } },
        { status: 201 },
      );
    }
    const { data, error } = await supabase
      .from("document_suggestions")
      .insert({
        ...fields,
        original_text: selected.selectedText,
        suggested_text: selected.suggestedText,
        base_revision: document.revision,
      })
      .select("id, created_by, from_position, to_position, original_text, suggested_text, status, base_revision, created_at")
      .single();
    if (error) {
      throw new DatabaseError(error.message);
    }
    return NextResponse.json(
      { suggestion: { ...data, author: user.name } },
      { status: 201 },
    );
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    await connection();
    const user = await getCurrentDemoUser();
    const { id } = await params;
    if (!documentIdSchema.safeParse(id).success) {
      return NextResponse.json({ error: "Invalid document ID" }, { status: 400 });
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const parsed = decisionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid decision" },
        { status: 400 },
      );
    }
    const supabase = createSupabaseAdminClient();
    const { document, role } = await getAccess(supabase, id, user.id);
    if (!document || !canEditDocument(role)) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    const decision = parsed.data;
    if (decision.kind === "comment") {
      const { data, error } = await supabase
        .from("document_comments")
        .update({ resolved_at: decision.resolved ? new Date().toISOString() : null })
        .eq("id", decision.id)
        .eq("document_id", id)
        .select("id, resolved_at")
        .maybeSingle();
      if (error) {
        throw new DatabaseError(error.message);
      }
      if (!data) {
        return NextResponse.json({ error: "Comment not found" }, { status: 404 });
      }
      return NextResponse.json({ comment: data });
    }

    const { data: suggestion, error: suggestionError } = await supabase
      .from("document_suggestions")
      .select("id, from_position, to_position, original_text, suggested_text, status, base_revision")
      .eq("id", decision.id)
      .eq("document_id", id)
      .maybeSingle();
    if (suggestionError) {
      throw new DatabaseError(suggestionError.message);
    }
    if (!suggestion) {
      return NextResponse.json({ error: "Suggestion not found" }, { status: 404 });
    }
    if (suggestion.status !== "pending") {
      return NextResponse.json({ error: "Suggestion is already decided" }, { status: 409 });
    }

    let updatedDocument = null;
    if (decision.decision === "accepted") {
      if (suggestion.base_revision !== document.revision) {
        return NextResponse.json(
          { error: "The document changed since this suggestion was made." },
          { status: 409 },
        );
      }
      const schema = getSchema([StarterKit]);
      const parsedDocument = schema.nodeFromJSON(document.content);
      const selectedText = parsedDocument.textBetween(
        suggestion.from_position,
        suggestion.to_position,
        "\n",
      );
      if (selectedText !== suggestion.original_text) {
        return NextResponse.json(
          { error: "The selected text changed; this suggestion cannot be applied." },
          { status: 409 },
        );
      }
      const state = EditorState.create({ schema, doc: parsedDocument });
      const content = state.tr
        .insertText(
          suggestion.suggested_text,
          suggestion.from_position,
          suggestion.to_position,
        )
        .doc.toJSON();
      const { data, error } = await supabase
        .from("documents")
        .update({
          content,
          revision: document.revision + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("revision", document.revision)
        .select("id, title, content, owner_id, revision, created_at, updated_at")
        .maybeSingle();
      if (error) {
        throw new DatabaseError(error.message);
      }
      if (!data) {
        return NextResponse.json(
          { error: "The document changed before the suggestion was applied." },
          { status: 409 },
        );
      }
      updatedDocument = data;
    }

    const { data, error } = await supabase
      .from("document_suggestions")
      .update({
        status: decision.decision,
        decided_at: new Date().toISOString(),
      })
      .eq("id", decision.id)
      .eq("status", "pending")
      .select("id, status, decided_at")
      .maybeSingle();
    if (error) {
      throw new DatabaseError(error.message);
    }
    if (!data) {
      return NextResponse.json({ error: "Suggestion was already decided" }, { status: 409 });
    }
    return NextResponse.json({ suggestion: data, document: updatedDocument });
  } catch (error) {
    return handleError(error);
  }
}
