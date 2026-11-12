import { connection, NextResponse } from "next/server";
import { z } from "zod";
import {
  DatabaseError,
  getCurrentDemoUser,
  UnauthorizedError,
} from "@/lib/demo-session";
import { documentIdSchema } from "@/lib/documents";
import { getShareCreationDecision } from "@/lib/document-access";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };
const shareSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["editor", "viewer"]).default("editor"),
});
const changeSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["editor", "viewer"]),
});
const revokeSchema = z.object({ userId: z.string().uuid() });

function handleError(error: unknown) {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  if (error instanceof DatabaseError) {
    console.error("Document sharing database operation failed:", error.message);
  } else {
    console.error("Document sharing request failed");
  }
  return NextResponse.json(
    { error: "The sharing request could not be completed" },
    { status: 500 },
  );
}

async function parseBody(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function findDocument(supabase: ReturnType<typeof createSupabaseAdminClient>, id: string) {
  const { data, error } = await supabase
    .from("documents")
    .select("id, owner_id")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    throw new DatabaseError(error.message);
  }
  return data;
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    await connection();
    const user = await getCurrentDemoUser();
    const { id } = await params;
    if (!documentIdSchema.safeParse(id).success) {
      return NextResponse.json({ error: "Invalid document ID" }, { status: 400 });
    }
    const parsed = shareSchema.safeParse(await parseBody(request));
    if (!parsed.success) {
      return NextResponse.json({ error: "A valid userId is required" }, { status: 400 });
    }

    const supabase = createSupabaseAdminClient();
    const document = await findDocument(supabase, id);
    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    if (document.owner_id !== user.id) {
      return NextResponse.json({ error: "Only the document owner can share this document" }, { status: 403 });
    }
    const targetId = parsed.data.userId;
    if (targetId === user.id) {
      return NextResponse.json({ error: "You cannot share a document with yourself" }, { status: 400 });
    }
    const { data: target, error: targetError } = await supabase
      .from("users")
      .select("id, name")
      .eq("id", targetId)
      .maybeSingle();
    if (targetError) {
      throw new DatabaseError(targetError.message);
    }
    if (!target) {
      return NextResponse.json({ error: "The selected user was not found" }, { status: 404 });
    }
    const { data: existing, error: existingError } = await supabase
      .from("document_shares")
      .select("user_id")
      .eq("document_id", id)
      .eq("user_id", target.id)
      .maybeSingle();
    if (existingError) {
      throw new DatabaseError(existingError.message);
    }
    if (
      getShareCreationDecision({
        ownerId: document.owner_id,
        actorId: user.id,
        targetId: target.id,
        alreadyShared: Boolean(existing),
      }) === "duplicate"
    ) {
      return NextResponse.json({ error: "This document is already shared with that user" }, { status: 409 });
    }
    const { error: insertError } = await supabase.from("document_shares").insert({
      document_id: id,
      user_id: target.id,
      role: parsed.data.role,
    });
    if (insertError) {
      if (insertError.code === "23505") {
        return NextResponse.json({ error: "This document is already shared with that user" }, { status: 409 });
      }
      throw new DatabaseError(insertError.message);
    }
    return NextResponse.json(
      {
        collaborator: {
          userId: target.id,
          name: target.name,
          role: parsed.data.role,
        },
      },
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
    const parsed = changeSchema.safeParse(await parseBody(request));
    if (!parsed.success) {
      return NextResponse.json({ error: "A valid userId and role are required" }, { status: 400 });
    }
    const supabase = createSupabaseAdminClient();
    const document = await findDocument(supabase, id);
    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    if (document.owner_id !== user.id) {
      return NextResponse.json({ error: "Only the owner can manage access" }, { status: 403 });
    }
    const { data: share, error } = await supabase
      .from("document_shares")
      .update({ role: parsed.data.role })
      .eq("document_id", id)
      .eq("user_id", parsed.data.userId)
      .select("user_id, role")
      .maybeSingle();
    if (error) {
      throw new DatabaseError(error.message);
    }
    if (!share) {
      return NextResponse.json({ error: "Share not found" }, { status: 404 });
    }
    const { data: target, error: targetError } = await supabase
      .from("users")
      .select("name")
      .eq("id", share.user_id)
      .single();
    if (targetError) {
      throw new DatabaseError(targetError.message);
    }
    return NextResponse.json({
      collaborator: { userId: share.user_id, name: target.name, role: share.role },
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    await connection();
    const user = await getCurrentDemoUser();
    const { id } = await params;
    if (!documentIdSchema.safeParse(id).success) {
      return NextResponse.json({ error: "Invalid document ID" }, { status: 400 });
    }
    const parsed = revokeSchema.safeParse(await parseBody(request));
    if (!parsed.success) {
      return NextResponse.json({ error: "A valid userId is required" }, { status: 400 });
    }
    const supabase = createSupabaseAdminClient();
    const document = await findDocument(supabase, id);
    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    if (document.owner_id !== user.id) {
      return NextResponse.json({ error: "Only the owner can manage access" }, { status: 403 });
    }
    const { data: share, error } = await supabase
      .from("document_shares")
      .delete()
      .eq("document_id", id)
      .eq("user_id", parsed.data.userId)
      .select("user_id")
      .maybeSingle();
    if (error) {
      throw new DatabaseError(error.message);
    }
    if (!share) {
      return NextResponse.json({ error: "Share not found" }, { status: 404 });
    }
    return NextResponse.json({ revoked: true });
  } catch (error) {
    return handleError(error);
  }
}
