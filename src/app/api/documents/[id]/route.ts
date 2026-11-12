import { connection, NextResponse } from "next/server";
import {
  DatabaseError,
  getCurrentDemoUser,
  UnauthorizedError,
} from "@/lib/demo-session";
import {
  documentIdSchema,
  isValidTiptapDocument,
  updateDocumentSchema,
} from "@/lib/documents";
import {
  canReadDocument,
  canEditDocument,
  canRenameDocument,
  getDocumentAccessRole,
  isStaleDocumentRevision,
} from "@/lib/document-access";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

function handleError(error: unknown) {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  if (error instanceof DatabaseError) {
    console.error("Document database operation failed:", error.message);
    return NextResponse.json(
      { error: "A database operation failed" },
      { status: 500 },
    );
  }

  console.error("Document request failed");
  return NextResponse.json(
    { error: "The request could not be completed" },
    { status: 500 },
  );
}

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    await connection();
    const user = await getCurrentDemoUser();
    const { id } = await params;
    if (!documentIdSchema.safeParse(id).success) {
      return NextResponse.json(
        { error: "Invalid document ID" },
        { status: 400 },
      );
    }

    const supabase = createSupabaseAdminClient();
    const { data: document, error } = await supabase
      .from("documents")
      .select("id, title, content, owner_id, revision, created_at, updated_at")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      throw new DatabaseError(error.message);
    }
    if (!document) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 },
      );
    }

    const { data: share, error: shareError } = await supabase
      .from("document_shares")
      .select("role")
      .eq("document_id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (shareError) {
      throw new DatabaseError(shareError.message);
    }

    const accessRole = getDocumentAccessRole({
      ownerId: document.owner_id,
      userId: user.id,
      shareRole: share?.role,
    });
    if (!canReadDocument(accessRole)) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 },
      );
    }

    const { data: owner, error: ownerError } = await supabase
      .from("users")
      .select("id, name")
      .eq("id", document.owner_id)
      .maybeSingle();
    if (ownerError) {
      throw new DatabaseError(ownerError.message);
    }

    let collaborators: Array<{ userId: string; name: string; role: string }> = [];
    if (accessRole === "owner") {
      const { data: shares, error: collaboratorsError } = await supabase
        .from("document_shares")
        .select("user_id, role")
        .eq("document_id", id);
      if (collaboratorsError) {
        throw new DatabaseError(collaboratorsError.message);
      }

      const collaboratorIds = [...new Set((shares ?? []).map((item) => item.user_id))];
      if (collaboratorIds.length > 0) {
        const { data: users, error: usersError } = await supabase
          .from("users")
          .select("id, name")
          .in("id", collaboratorIds);
        if (usersError) {
          throw new DatabaseError(usersError.message);
        }

        const names = new Map((users ?? []).map((item) => [item.id, item.name]));
        collaborators = (shares ?? []).map((item) => ({
          userId: item.user_id,
          name: names.get(item.user_id) ?? "Unknown",
          role: item.role,
        }));
      }
    }

    return NextResponse.json({
      document,
      accessRole,
      owner: owner ?? { id: document.owner_id, name: "Unknown" },
      collaborators,
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const user = await getCurrentDemoUser();
    const { id } = await params;
    if (!documentIdSchema.safeParse(id).success) {
      return NextResponse.json(
        { error: "Invalid document ID" },
        { status: 400 },
      );
    }

    const supabase = createSupabaseAdminClient();
    const { data: document, error: documentError } = await supabase
      .from("documents")
      .select("id, owner_id")
      .eq("id", id)
      .maybeSingle();
    if (documentError) {
      throw new DatabaseError(documentError.message);
    }
    if (!document) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 },
      );
    }

    const isOwner = document.owner_id === user.id;
    let shareRole: string | null = null;
    if (!isOwner) {
      const { data: share, error: shareError } = await supabase
        .from("document_shares")
        .select("role")
        .eq("document_id", id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (shareError) {
        throw new DatabaseError(shareError.message);
      }
      shareRole = share?.role ?? null;
    }
    const accessRole = getDocumentAccessRole({
      ownerId: document.owner_id,
      userId: user.id,
      shareRole,
    });
    if (!canEditDocument(accessRole)) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = updateDocumentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid document data" },
        { status: 400 },
      );
    }

    if (parsed.data.title !== undefined && !canRenameDocument(accessRole)) {
      return NextResponse.json(
        { error: "Only the document owner can rename this document" },
        { status: 403 },
      );
    }

    if (
      parsed.data.content !== undefined &&
      !isValidTiptapDocument(parsed.data.content)
    ) {
      return NextResponse.json(
        { error: "Content must be a valid Tiptap JSON document" },
        { status: 400 },
      );
    }

    const updates = {
      ...(parsed.data.title !== undefined && { title: parsed.data.title }),
      ...(parsed.data.content !== undefined && {
        content: parsed.data.content,
      }),
      revision: parsed.data.revision + 1,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from("documents")
      .update(updates)
      .eq("id", id)
      .eq("revision", parsed.data.revision)
      .select("id, title, content, owner_id, revision, created_at, updated_at")
      .maybeSingle();

    if (error) {
      throw new DatabaseError(error.message);
    }
    if (data) {
      return NextResponse.json({ document: data });
    }

    const { data: current, error: lookupError } = await supabase
      .from("documents")
      .select("revision")
      .eq("id", id)
      .maybeSingle();

    if (lookupError) {
      throw new DatabaseError(lookupError.message);
    }
    if (!current) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 },
      );
    }
    if (!isStaleDocumentRevision(current.revision, parsed.data.revision)) {
      throw new DatabaseError("Document update did not match its revision");
    }

    return NextResponse.json(
      {
        error: "This document changed since it was opened. Reload before saving.",
      },
      { status: 409 },
    );
  } catch (error) {
    return handleError(error);
  }
}
