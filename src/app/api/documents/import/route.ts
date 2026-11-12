import { connection, NextResponse } from "next/server";
import {
  DatabaseError,
  getCurrentDemoUser,
  UnauthorizedError,
} from "@/lib/demo-session";
import { isValidTiptapDocument } from "@/lib/documents";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import {
  extractImportContent,
  MAX_IMPORT_BYTES,
  validateImportFile,
} from "@/lib/document-import";

export async function POST(request: Request) {
  try {
    await connection();
    const user = await getCurrentDemoUser();
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        { error: "Choose a .txt, .docx, or text-based .pdf file to import" },
        { status: 400 },
      );
    }

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Choose a .txt, .docx, or text-based .pdf file to import" },
        { status: 400 },
      );
    }
    if (file.size > MAX_IMPORT_BYTES) {
      return NextResponse.json(
        { error: "Files must be 5 MB or smaller" },
        { status: 413 },
      );
    }

    const result = validateImportFile({
      fileName: file.name,
      contentType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    if (!result.success) {
      return NextResponse.json(
        { error: result.message },
        { status: result.status },
      );
    }

    let content;
    try {
      content = await extractImportContent(result);
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "The document could not be parsed.",
        },
        { status: 400 },
      );
    }
    if (!isValidTiptapDocument(content)) {
      return NextResponse.json(
        { error: "The file could not be converted to a document" },
        { status: 400 },
      );
    }

    if (formData.get("draft") === "true") {
      return NextResponse.json({
        title: result.title,
        content,
      });
    }

    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("documents")
      .insert({
        owner_id: user.id,
        title: result.title,
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
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof DatabaseError) {
      console.error("Document import database operation failed:", error.message);
    } else {
      console.error("Document import request failed");
    }
    return NextResponse.json(
      { error: "The file could not be imported" },
      { status: 500 },
    );
  }
}
