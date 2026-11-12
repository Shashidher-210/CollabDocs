import { connection, NextResponse } from "next/server";
import { z } from "zod";
import {
  DatabaseError,
  getCurrentDemoUser,
  UnauthorizedError,
} from "@/lib/demo-session";
import { documentIdSchema } from "@/lib/documents";
import { canEditDocument, getDocumentAccessRole } from "@/lib/document-access";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

const suggestionSchema = z.object({
  action: z.enum(["improve", "grammar", "summarize", "professional"]),
  text: z.string().trim().min(1).max(10_000),
});

const instructions = {
  improve: "Improve clarity and flow while preserving the original meaning.",
  grammar: "Correct grammar, spelling, and punctuation without changing meaning.",
  summarize: "Summarize the selected text concisely.",
  professional:
    "Rewrite the selected text in a polished, professional tone without adding facts.",
} as const;

function errorResponse(error: unknown) {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  if (error instanceof DatabaseError) {
    console.error("AI suggestion authorization failed:", error.message);
  } else {
    console.error("AI suggestion request failed");
  }
  return NextResponse.json(
    { error: "The writing suggestion could not be generated" },
    { status: 500 },
  );
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
    const parsed = suggestionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Select text and a valid writing action" },
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
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    let shareRole: string | null = null;
    if (document.owner_id !== user.id) {
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
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OpenAI is not configured. Add OPENAI_API_KEY on the server." },
        { status: 503 },
      );
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.3,
        max_tokens: 1200,
        messages: [
          {
            role: "system",
            content: `${instructions[parsed.data.action]} Return only the revised text.`,
          },
          { role: "user", content: parsed.data.text },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    if (!response.ok) {
      console.error("OpenAI writing suggestion returned status:", response.status);
      return NextResponse.json(
        { error: "OpenAI could not generate a suggestion right now." },
        { status: 502 },
      );
    }

    const result = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const suggestion = result.choices?.[0]?.message?.content?.trim();
    if (!suggestion) {
      return NextResponse.json(
        { error: "OpenAI returned an empty suggestion." },
        { status: 502 },
      );
    }

    return NextResponse.json(
      { suggestion },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
