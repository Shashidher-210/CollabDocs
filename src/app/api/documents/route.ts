import { connection, NextResponse } from "next/server";
import {
  DatabaseError,
  getCurrentDemoUser,
  UnauthorizedError,
} from "@/lib/demo-session";
import {
  createDocumentSchema,
  isValidTiptapDocument,
  plainTextToTiptapDocument,
} from "@/lib/documents";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

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

export async function GET() {
  try {
    await connection();
    const user = await getCurrentDemoUser();
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("documents")
      .select("id, title, content, owner_id, revision, created_at, updated_at")
      .eq("owner_id", user.id)
      .order("updated_at", { ascending: false });

    if (error) {
      throw new DatabaseError(error.message);
    }

    const { data: shares, error: sharesError } = await supabase
      .from("document_shares")
      .select("document_id, role")
      .eq("user_id", user.id)
      .in("role", ["editor", "viewer"]);
    if (sharesError) {
      throw new DatabaseError(sharesError.message);
    }

    const sharedIds = [
      ...new Set((shares ?? []).map((share) => share.document_id)),
    ];
    let sharedDocuments: Array<Record<string, unknown>> = [];
    if (sharedIds.length > 0) {
      const { data: sharedRows, error: sharedError } = await supabase
        .from("documents")
        .select("id, title, owner_id, revision, created_at, updated_at")
        .in("id", sharedIds)
        .neq("owner_id", user.id)
        .order("updated_at", { ascending: false });
      if (sharedError) {
        throw new DatabaseError(sharedError.message);
      }

      const ownerIds = [...new Set((sharedRows ?? []).map((row) => row.owner_id))];
      const { data: owners, error: ownersError } = await supabase
        .from("users")
        .select("id, name")
        .in("id", ownerIds);
      if (ownersError) {
        throw new DatabaseError(ownersError.message);
      }

      const ownerNames = new Map(
        (owners ?? []).map((owner) => [owner.id, owner.name]),
      );
      const shareRoles = new Map(
        (shares ?? []).map((share) => [share.document_id, share.role]),
      );
      sharedDocuments = (sharedRows ?? []).map((row) => ({
        ...row,
        accessRole: shareRoles.get(row.id) ?? "viewer",
        owner: {
          id: row.owner_id,
          name: ownerNames.get(row.owner_id) ?? "Unknown",
        },
      }));
    }

    return NextResponse.json({
      documents: data ?? [],
      sharedDocuments,
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentDemoUser();
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = createDocumentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid document data" },
        { status: 400 },
      );
    }

    const content =
      parsed.data.content ?? plainTextToTiptapDocument("");
    if (!isValidTiptapDocument(content)) {
      return NextResponse.json(
        { error: "Content must be a valid Tiptap JSON document" },
        { status: 400 },
      );
    }

    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("documents")
      .insert({
        owner_id: user.id,
        title: parsed.data.title ?? "Untitled document",
        content,
        revision: 1,
      })
      .select("id, title, content, owner_id, revision, created_at, updated_at")
      .single();

    if (error) {
      throw new DatabaseError(error.message);
    }

    return NextResponse.json({ document: data }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}
