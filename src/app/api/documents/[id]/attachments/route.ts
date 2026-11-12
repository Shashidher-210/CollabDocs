import { randomUUID } from "node:crypto";
import { connection, NextResponse } from "next/server";
import {
  DatabaseError,
  getCurrentDemoUser,
  UnauthorizedError,
} from "@/lib/demo-session";
import { documentIdSchema } from "@/lib/documents";
import { canEditDocument, getDocumentAccessRole } from "@/lib/document-access";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };
const bucket = "collabdocs-attachments";
const maxBytes = 10 * 1024 * 1024;
const allowedTypes = new Set([
  "application/pdf",
  "text/plain",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

async function getAccess(supabase: ReturnType<typeof createSupabaseAdminClient>, id: string, userId: string) {
  const { data: document, error } = await supabase
    .from("documents")
    .select("id, owner_id")
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
    console.error("Document attachment database operation failed:", error.message);
  } else {
    console.error("Document attachment request failed");
  }
  return NextResponse.json(
    { error: "The attachment request could not be completed" },
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
    const access = await getAccess(supabase, id, user.id);
    if (!access.document || access.role === "none") {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    const { data: attachments, error } = await supabase
      .from("document_attachments")
      .select("id, file_name, content_type, size_bytes, created_at, object_path")
      .eq("document_id", id)
      .order("created_at", { ascending: false });
    if (error) {
      throw new DatabaseError(error.message);
    }

    const results = await Promise.all(
      (attachments ?? []).map(async (attachment) => {
        const { data, error: signedUrlError } = await supabase.storage
          .from(bucket)
          .createSignedUrl(attachment.object_path, 60);
        if (signedUrlError) {
          throw new DatabaseError(signedUrlError.message);
        }
        return {
          id: attachment.id,
          fileName: attachment.file_name,
          contentType: attachment.content_type,
          sizeBytes: attachment.size_bytes,
          createdAt: attachment.created_at,
          url: data.signedUrl,
        };
      }),
    );
    return NextResponse.json({ attachments: results });
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
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Choose an attachment file" }, { status: 400 });
    }
    if (file.size < 1) {
      return NextResponse.json({ error: "Attachment files cannot be empty" }, { status: 400 });
    }
    if (file.size > maxBytes) {
      return NextResponse.json(
        { error: "Attachments must be 10 MB or smaller" },
        { status: 413 },
      );
    }
    if (!allowedTypes.has(file.type)) {
      return NextResponse.json(
        { error: "Allowed attachments: PDF, TXT, PNG, JPEG, or WEBP" },
        { status: 400 },
      );
    }

    const supabase = createSupabaseAdminClient();
    const access = await getAccess(supabase, id, user.id);
    if (!access.document || !canEditDocument(access.role)) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const safeName =
      file.name.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 180) ||
      "attachment";
    const objectPath = `${id}/${randomUUID()}-${safeName}`;
    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(objectPath, file, {
        contentType: file.type,
        upsert: false,
      });
    if (uploadError) {
      throw new DatabaseError(uploadError.message);
    }

    const { data: attachment, error: insertError } = await supabase
      .from("document_attachments")
      .insert({
        document_id: id,
        uploaded_by: user.id,
        object_path: objectPath,
        file_name: safeName,
        content_type: file.type,
        size_bytes: file.size,
      })
      .select("id, file_name, content_type, size_bytes, created_at")
      .single();
    if (insertError) {
      const { error: cleanupError } = await supabase.storage
        .from(bucket)
        .remove([objectPath]);
      if (cleanupError) {
        console.error("Failed to clean up an unlinked attachment:", cleanupError.message);
      }
      throw new DatabaseError(insertError.message);
    }

    return NextResponse.json({ attachment }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}
