import { connection, NextResponse } from "next/server";
import {
  DatabaseError,
  getCurrentDemoUser,
  UnauthorizedError,
} from "@/lib/demo-session";
import { documentIdSchema } from "@/lib/documents";
import { canReadDocument, getDocumentAccessRole } from "@/lib/document-access";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

async function authorize(id: string, userId: string) {
  const supabase = createSupabaseAdminClient();
  const { data: document, error } = await supabase
    .from("documents")
    .select("id, owner_id")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    throw new DatabaseError(error.message);
  }
  if (!document) {
    return { supabase, role: "none" as const };
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
    supabase,
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
    console.error("Document presence database operation failed:", error.message);
  } else {
    console.error("Document presence request failed");
  }
  return NextResponse.json(
    { error: "Could not update document presence" },
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
    const { supabase, role } = await authorize(id, user.id);
    if (!canReadDocument(role)) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const cutoff = new Date(Date.now() - 45_000).toISOString();
    const { data: presence, error } = await supabase
      .from("document_presence")
      .select("user_id")
      .eq("document_id", id)
      .neq("user_id", user.id)
      .gte("last_seen_at", cutoff);
    if (error) {
      throw new DatabaseError(error.message);
    }
    const userIds = [...new Set((presence ?? []).map((item) => item.user_id))];
    if (userIds.length === 0) {
      return NextResponse.json({ collaborators: [] });
    }
    const { data: users, error: usersError } = await supabase
      .from("users")
      .select("id, name")
      .in("id", userIds);
    if (usersError) {
      throw new DatabaseError(usersError.message);
    }
    return NextResponse.json({
      collaborators: users ?? [],
      expiresInSeconds: 45,
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(_request: Request, { params }: RouteContext) {
  try {
    await connection();
    const user = await getCurrentDemoUser();
    const { id } = await params;
    if (!documentIdSchema.safeParse(id).success) {
      return NextResponse.json({ error: "Invalid document ID" }, { status: 400 });
    }
    const { supabase, role } = await authorize(id, user.id);
    if (!canReadDocument(role)) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    const { error } = await supabase.from("document_presence").upsert(
      {
        document_id: id,
        user_id: user.id,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "document_id,user_id" },
    );
    if (error) {
      throw new DatabaseError(error.message);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}
