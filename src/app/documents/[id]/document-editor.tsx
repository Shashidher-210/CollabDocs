"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bold,
  Check,
  Download,
  Heading1,
  Heading2,
  Import,
  Italic,
  LayoutPanelLeft,
  List,
  ListOrdered,
  MessageSquare,
  Pilcrow,
  Printer,
  Sparkles,
  Underline as UnderlineIcon,
} from "lucide-react";
import { useEditor, useEditorState, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useMemo, useRef, useState } from "react";
import type { JSONContent } from "@tiptap/react";
import { getSafeTiptapDocument } from "@/lib/documents";
import { tiptapToMarkdown } from "@/lib/document-export";

type DocumentRecord = {
  id: string;
  title: string;
  content: unknown;
  revision: number;
  accessRole: "owner" | "editor" | "viewer";
  collaborators: Collaborator[];
};

type Collaborator = { userId: string; name: string; role: string };
type DocumentAttachment = {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  url: string;
};
type DocumentComment = {
  id: string;
  from_position: number;
  to_position: number;
  selected_text: string;
  body: string;
  resolved_at: string | null;
  author: string;
};
type DocumentSuggestion = {
  id: string;
  from_position: number;
  to_position: number;
  original_text: string;
  suggested_text: string;
  status: "pending" | "accepted" | "rejected";
  base_revision: number;
  author: string;
};
type DemoUser = { id: string; name: "Alex" | "Sarah"; email: string };
type SaveState = "idle" | "saving" | "saved" | "error";
type AiAction = "improve" | "grammar" | "summarize" | "professional";
type OutlineHeading = { level: number; text: string; position: number };

async function responseError(response: Response) {
  const body = (await response.json().catch(() => null)) as
    | { error?: string }
    | null;
  return body?.error ?? "Something went wrong. Please try again.";
}

export default function DocumentEditor({ id }: { id: string }) {
  const isDraft = id === "new";
  const [document, setDocument] = useState<DocumentRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadDocument() {
      if (isDraft) {
        setDocument({
          id: "new",
          title: "",
          content: { type: "doc", content: [{ type: "paragraph" }] },
          revision: 0,
          accessRole: "owner",
          collaborators: [],
        });
        setLoading(false);
        return;
      }

      try {
        const response = await fetch(`/api/documents/${id}`, {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(await responseError(response));
        }

        const result = (await response.json()) as {
          document: Omit<DocumentRecord, "accessRole" | "collaborators">;
          accessRole: DocumentRecord["accessRole"];
          collaborators: Collaborator[];
        };
        if (active) {
          setDocument({
            ...result.document,
            accessRole: result.accessRole,
            collaborators: result.collaborators,
          });
        }
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load this document.",
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadDocument();
    return () => {
      active = false;
    };
  }, [id, isDraft]);

  const documentForRoute = document?.id === id ? document : null;

  return (
    <main className="editor-shell">
      {loading || (!documentForRoute && !error) ? (
        <>
          <EditorNavigation />
          <div className="editor-loading" role="status">
            Loading document…
          </div>
        </>
      ) : error && !documentForRoute ? (
        <>
          <EditorNavigation />
          <section className="editor-error" role="alert">
            <h1>Document unavailable</h1>
            <p>{error}</p>
            <Link className="secondary-button" href="/">
              Back to documents
            </Link>
          </section>
        </>
      ) : documentForRoute ? (
        <LoadedDocumentEditor
          key={id}
          id={id}
          initialDocument={documentForRoute}
        />
      ) : null}
    </main>
  );
}

function EditorNavigation({
  onNavigate,
}: {
  onNavigate?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <header className="editor-topbar">
      <Link className="brand" href="/" onClick={onNavigate}>
        <span className="brand-mark" aria-hidden="true">
          C
        </span>
        CollabDocs
      </Link>
      <Link className="back-link" href="/" onClick={onNavigate}>
        <span aria-hidden="true">←</span> All documents
      </Link>
    </header>
  );
}

function LoadedDocumentEditor({
  id,
  initialDocument,
}: {
  id: string;
  initialDocument: DocumentRecord;
}) {
  const router = useRouter();
  const isDraft = id === "new";
  const [title, setTitle] = useState(initialDocument.title);
  const [documentId, setDocumentId] = useState(initialDocument.id);
  const [revision, setRevision] = useState(initialDocument.revision);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [shareError, setShareError] = useState("");
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareUsers, setShareUsers] = useState<DemoUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedShareRole, setSelectedShareRole] = useState<"editor" | "viewer">(
    "editor",
  );
  const [collaborators, setCollaborators] = useState(
    initialDocument.collaborators,
  );
  const [layout, setLayout] = useState<"page" | "pageless">("page");
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [outline, setOutline] = useState<OutlineHeading[]>([]);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [aiAction, setAiAction] = useState<AiAction>("improve");
  const [aiText, setAiText] = useState("");
  const [aiSuggestion, setAiSuggestion] = useState("");
  const [aiError, setAiError] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [attachments, setAttachments] = useState<DocumentAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [comments, setComments] = useState<DocumentComment[]>([]);
  const [suggestions, setSuggestions] = useState<DocumentSuggestion[]>([]);
  const [collaborationError, setCollaborationError] = useState("");
  const [collaborationBusy, setCollaborationBusy] = useState(false);
  const isOwner = initialDocument.accessRole === "owner";
  const canEdit = initialDocument.accessRole !== "viewer";
  const saving = useRef(false);
  const editVersion = useRef(0);
  const aiSelection = useRef<{ from: number; to: number } | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const attachmentInput = useRef<HTMLInputElement>(null);
  const initialContent = useMemo(
    () => getSafeTiptapDocument(initialDocument.content),
    [initialDocument.content],
  );
  const savedContent = useRef(JSON.stringify(initialContent));
  const savedTitle = useRef(initialDocument.title);

  const editor = useEditor(
    {
      extensions: [StarterKit],
      content: initialContent,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          "aria-label": "Document content",
          class: "tiptap-prose",
          spellcheck: "true",
        },
      },
      onCreate: ({ editor: initializedEditor }) => {
        savedContent.current = JSON.stringify(initializedEditor.getJSON());
        setDirty(false);
      },
      onUpdate: ({ editor: updatedEditor }) => {
        editVersion.current += 1;
        setDirty(
          JSON.stringify(updatedEditor.getJSON()) !== savedContent.current ||
            title !== savedTitle.current,
        );
        setSaveState("idle");
      },
    },
    [initialDocument.id],
  );

  useEffect(() => {
    editor?.setEditable(canEdit && (!isDraft || saveState !== "saving"));
  }, [editor, isDraft, saveState, canEdit]);

  useEffect(() => {
    const savedLayout = window.localStorage.getItem(
      `collabdocs-layout-${documentId}`,
    );
    const nextLayout = savedLayout === "pageless" ? "pageless" : "page";
    const frame = window.requestAnimationFrame(() => setLayout(nextLayout));
    return () => window.cancelAnimationFrame(frame);
  }, [documentId]);

  useEffect(() => {
    if (isDraft) {
      return;
    }
    let active = true;
    async function loadAttachments() {
      try {
        const response = await fetch(
          `/api/documents/${documentId}/attachments`,
          { cache: "no-store" },
        );
        if (!response.ok) {
          throw new Error(await responseError(response));
        }
        const result = (await response.json()) as {
          attachments: DocumentAttachment[];
        };
        if (active) {
          setAttachments(result.attachments);
          setAttachmentError("");
        }
      } catch (loadError) {
        if (active) {
          setAttachmentError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load attachments.",
          );
        }
      }
    }
    void loadAttachments();
    return () => {
      active = false;
    };
  }, [documentId, isDraft]);

  useEffect(() => {
    if (isDraft) {
      return;
    }
    let active = true;
    async function loadCollaboration() {
      try {
        const response = await fetch(
          `/api/documents/${documentId}/collaboration`,
          { cache: "no-store" },
        );
        if (!response.ok) {
          throw new Error(await responseError(response));
        }
        const result = (await response.json()) as {
          comments: DocumentComment[];
          suggestions: DocumentSuggestion[];
        };
        if (active) {
          setComments(result.comments);
          setSuggestions(result.suggestions);
          setCollaborationError("");
        }
      } catch (loadError) {
        if (active) {
          setCollaborationError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load comments and suggestions.",
          );
        }
      }
    }
    void loadCollaboration();
    return () => {
      active = false;
    };
  }, [documentId, isDraft]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const activeEditor = editor;
    function updateOutline() {
      const headings: OutlineHeading[] = [];
      activeEditor.state.doc.descendants((node, position) => {
        if (node.type.name === "heading") {
          headings.push({
            level: Number(node.attrs.level),
            text: node.textContent || "Untitled heading",
            position,
          });
        }
      });
      setOutline(headings);
    }

    updateOutline();
    activeEditor.on("update", updateOutline);
    return () => {
      activeEditor.off("update", updateOutline);
    };
  }, [editor]);

  function changeLayout(nextLayout: "page" | "pageless") {
    setLayout(nextLayout);
    window.localStorage.setItem(
      `collabdocs-layout-${documentId}`,
      nextLayout,
    );
  }

  const shouldWarnBeforeLeaving =
    isDraft
      ? Boolean(title.trim()) || Boolean(editor?.getText().trim())
      : dirty;

  useEffect(() => {
    if (!shouldWarnBeforeLeaving) {
      return;
    }

    function warnBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [shouldWarnBeforeLeaving]);

  function confirmNavigation(event: React.MouseEvent<HTMLAnchorElement>) {
    if (
      shouldWarnBeforeLeaving &&
      !window.confirm("Discard your unsaved changes?")
    ) {
      event.preventDefault();
    }
  }

  const toolbarState = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) =>
      currentEditor
        ? {
            bold: currentEditor.isActive("bold"),
            italic: currentEditor.isActive("italic"),
            underline: currentEditor.isActive("underline"),
            heading1: currentEditor.isActive("heading", { level: 1 }),
            heading2: currentEditor.isActive("heading", { level: 2 }),
            bulletList: currentEditor.isActive("bulletList"),
            orderedList: currentEditor.isActive("orderedList"),
            hasSelection: !currentEditor.state.selection.empty,
          }
        : {
            bold: false,
            italic: false,
            underline: false,
            heading1: false,
            heading2: false,
            bulletList: false,
            orderedList: false,
            hasSelection: false,
          },
  });

  async function saveDocument() {
    if (!editor || !canEdit || saving.current) {
      return;
    }

    saving.current = true;
    setSaveState("saving");
    setError("");
    const savedEditVersion = editVersion.current;
    const titleToSave = title.trim() || "Untitled Document";

    try {
      const content: JSONContent = editor.getJSON();
      const response = await fetch(
        isDraft ? "/api/documents" : `/api/documents/${documentId}`,
        {
          method: isDraft ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            isDraft
              ? { title: titleToSave, content }
              : {
                  ...(isOwner && { title: titleToSave }),
                  content,
                  revision,
                },
          ),
        },
      );
      if (!response.ok) {
        throw new Error(await responseError(response));
      }

      const result = (await response.json()) as {
        document: DocumentRecord;
      };
      savedContent.current = JSON.stringify(content);
      savedTitle.current = result.document.title;
      setTitle(result.document.title);
      setDocumentId(result.document.id);
      setRevision(result.document.revision);
      setDirty(savedEditVersion !== editVersion.current);
      setSaveState(
        savedEditVersion === editVersion.current ? "saved" : "idle",
      );
      if (isDraft) {
        const draftLayout = window.localStorage.getItem(
          "collabdocs-layout-new",
        );
        if (draftLayout) {
          window.localStorage.setItem(
            `collabdocs-layout-${result.document.id}`,
            draftLayout,
          );
          window.localStorage.removeItem("collabdocs-layout-new");
        }
        router.replace(`/documents/${result.document.id}`);
      }
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save this document.",
      );
      setSaveState("error");
    } finally {
      saving.current = false;
    }
  }

  async function importIntoDraft(file: File | undefined) {
    if (!editor || !isDraft || !file) {
      return;
    }

    setError("");
    setSaveState("saving");
    try {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("draft", "true");
      const response = await fetch("/api/documents/import", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        throw new Error(await responseError(response));
      }

      const imported = (await response.json()) as {
        title: string;
        content: JSONContent;
      };
      if (editor.getText().trim()) {
        editor
          .chain()
          .focus()
          .setTextSelection(editor.state.doc.content.size - 1)
          .insertContent(imported.content.content ?? [])
          .run();
      } else {
        editor.commands.setContent(imported.content);
      }
      if (!title.trim()) {
        setTitle(imported.title);
      }
      editVersion.current += 1;
      setDirty(true);
      setSaveState("idle");
    } catch (importError) {
      setError(
        importError instanceof Error
          ? importError.message
          : "Could not import this file into the draft.",
      );
      setSaveState("error");
    } finally {
      if (importInput.current) {
        importInput.current.value = "";
      }
    }
  }

  function exportMarkdown() {
    if (!editor) {
      return;
    }
    const markdown = tiptapToMarkdown(editor.getJSON());
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = `${title.trim() || "Untitled Document"}.md`.replace(
      /[<>:"/\\|?*\u0000-\u001f]/g,
      "_",
    );
    link.click();
    URL.revokeObjectURL(url);
  }

  async function uploadAttachment(file: File | undefined) {
    if (!file || isDraft || !canEdit || attachmentBusy) {
      return;
    }
    setAttachmentBusy(true);
    setAttachmentError("");
    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch(
        `/api/documents/${documentId}/attachments`,
        { method: "POST", body: formData },
      );
      if (!response.ok) {
        throw new Error(await responseError(response));
      }
      const attachmentsResponse = await fetch(
        `/api/documents/${documentId}/attachments`,
        { cache: "no-store" },
      );
      if (!attachmentsResponse.ok) {
        throw new Error(await responseError(attachmentsResponse));
      }
      const result = (await attachmentsResponse.json()) as {
        attachments: DocumentAttachment[];
      };
      setAttachments(result.attachments);
    } catch (uploadError) {
      setAttachmentError(
        uploadError instanceof Error
          ? uploadError.message
          : "Could not upload this attachment.",
      );
    } finally {
      setAttachmentBusy(false);
      if (attachmentInput.current) {
        attachmentInput.current.value = "";
      }
    }
  }

  async function addCollaboration(kind: "comment" | "suggestion") {
    if (!editor || !canEdit || isDraft || collaborationBusy) {
      return;
    }
    const { from, to } = editor.state.selection;
    if (from === to) {
      setCollaborationError("Select text in the document first.");
      return;
    }
    const selectedText = editor.state.doc.textBetween(from, to, "\n");
    const text = window.prompt(
      kind === "comment" ? "Comment on the selected text:" : "Suggested replacement text:",
    );
    if (text === null || !text.trim()) {
      return;
    }
    setCollaborationBusy(true);
    setCollaborationError("");
    try {
      const response = await fetch(`/api/documents/${documentId}/collaboration`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          kind === "comment"
            ? { kind, from, to, selectedText, body: text }
            : { kind, from, to, selectedText, suggestedText: text },
        ),
      });
      if (!response.ok) {
        throw new Error(await responseError(response));
      }
      const result = (await response.json()) as {
        comment?: DocumentComment;
        suggestion?: DocumentSuggestion;
      };
      if (result.comment) {
        setComments((current) => [...current, result.comment!]);
      }
      if (result.suggestion) {
        setSuggestions((current) => [...current, result.suggestion!]);
      }
    } catch (createError) {
      setCollaborationError(
        createError instanceof Error
          ? createError.message
          : "Could not save your comment or suggestion.",
      );
    } finally {
      setCollaborationBusy(false);
    }
  }

  async function decideCollaboration(
    kind: "comment" | "suggestion",
    id: string,
    decision: boolean | "accepted" | "rejected",
  ) {
    if (!editor || !canEdit || collaborationBusy) {
      return;
    }
    setCollaborationBusy(true);
    setCollaborationError("");
    try {
      const response = await fetch(`/api/documents/${documentId}/collaboration`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          kind === "comment"
            ? { kind, id, resolved: decision }
            : { kind, id, decision },
        ),
      });
      if (!response.ok) {
        throw new Error(await responseError(response));
      }
      const result = (await response.json()) as {
        comment?: { id: string; resolved_at: string | null };
        suggestion?: { id: string; status: "accepted" | "rejected" };
        document?: DocumentRecord | null;
      };
      if (result.comment) {
        setComments((current) =>
          current.map((item) =>
            item.id === result.comment?.id
              ? { ...item, resolved_at: result.comment.resolved_at }
              : item,
          ),
        );
      }
      if (result.suggestion) {
        setSuggestions((current) =>
          current.map((item) =>
            item.id === result.suggestion?.id
              ? { ...item, status: result.suggestion.status }
              : item,
          ),
        );
      }
      if (result.document) {
        editor.commands.setContent(
          getSafeTiptapDocument(result.document.content),
          { emitUpdate: false },
        );
        setRevision(result.document.revision);
        savedContent.current = JSON.stringify(editor.getJSON());
        setDirty(false);
        setSaveState("saved");
      }
    } catch (decisionError) {
      setCollaborationError(
        decisionError instanceof Error
          ? decisionError.message
          : "Could not update the comment or suggestion.",
      );
    } finally {
      setCollaborationBusy(false);
    }
  }

  function runEditorCommand(command: () => boolean) {
    if (command()) {
      editVersion.current += 1;
      setDirty(true);
      setSaveState("idle");
    }
  }

  async function openShareDialog() {
    setShareError("");
    setShareDialogOpen(true);
    try {
      const response = await fetch("/api/session", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(await responseError(response));
      }
      const result = (await response.json()) as {
        user: DemoUser;
        users: DemoUser[];
      };
      const availableUsers = result.users.filter(
        (user) => user.id !== result.user.id,
      );
      setShareUsers(availableUsers);
      setSelectedUserId((current) => current || availableUsers[0]?.id || "");
    } catch (loadError) {
      setShareError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load demo users.",
      );
    }
  }

  async function shareDocument(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedUserId || sharing) {
      return;
    }

    setSharing(true);
    setShareError("");
    try {
      const response = await fetch(`/api/documents/${id}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: selectedUserId,
          role: selectedShareRole,
        }),
      });
      if (!response.ok) {
        throw new Error(await responseError(response));
      }
      const result = (await response.json()) as {
        collaborator: Collaborator;
      };
      setCollaborators((current) => [...current, result.collaborator]);
    } catch (shareRequestError) {
      setShareError(
        shareRequestError instanceof Error
          ? shareRequestError.message
          : "Could not share this document.",
      );
    } finally {
      setSharing(false);
    }
  }

  async function changeCollaboratorRole(
    collaborator: Collaborator,
    role: "editor" | "viewer",
  ) {
    setShareError("");
    try {
      const response = await fetch(`/api/documents/${id}/share`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: collaborator.userId, role }),
      });
      if (!response.ok) {
        throw new Error(await responseError(response));
      }
      setCollaborators((current) =>
        current.map((item) =>
          item.userId === collaborator.userId ? { ...item, role } : item,
        ),
      );
    } catch (changeError) {
      setShareError(
        changeError instanceof Error
          ? changeError.message
          : "Could not change this collaborator's role.",
      );
    }
  }

  async function removeCollaborator(collaborator: Collaborator) {
    setShareError("");
    try {
      const response = await fetch(`/api/documents/${id}/share`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: collaborator.userId }),
      });
      if (!response.ok) {
        throw new Error(await responseError(response));
      }
      setCollaborators((current) =>
        current.filter((item) => item.userId !== collaborator.userId),
      );
    } catch (removeError) {
      setShareError(
        removeError instanceof Error
          ? removeError.message
          : "Could not revoke this collaborator's access.",
      );
    }
  }

  function openAiDialog() {
    if (!editor || editor.state.selection.empty || isDraft) {
      return;
    }
    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, "\n").trim();
    if (!selectedText) {
      return;
    }
    aiSelection.current = { from, to };
    setAiText(selectedText);
    setAiSuggestion("");
    setAiError("");
    setAiAction("improve");
    setAiDialogOpen(true);
  }

  async function requestAiSuggestion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!aiText || aiLoading) {
      return;
    }
    setAiLoading(true);
    setAiError("");
    setAiSuggestion("");
    try {
      const response = await fetch(`/api/documents/${documentId}/ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: aiAction, text: aiText }),
      });
      if (!response.ok) {
        throw new Error(await responseError(response));
      }
      const result = (await response.json()) as { suggestion: string };
      setAiSuggestion(result.suggestion);
    } catch (requestError) {
      setAiError(
        requestError instanceof Error
          ? requestError.message
          : "Could not generate a writing suggestion.",
      );
    } finally {
      setAiLoading(false);
    }
  }

  function replaceSelectedText() {
    const selection = aiSelection.current;
    if (!editor || !selection || !aiSuggestion) {
      return;
    }
    editor
      .chain()
      .focus()
      .setTextSelection(selection)
      .insertContent(aiSuggestion)
      .run();
    setAiDialogOpen(false);
  }

  const selectedStyle =
    toolbarState?.heading1
      ? "heading-1"
      : toolbarState?.heading2
        ? "heading-2"
        : "paragraph";

  return (
    <>
      <EditorNavigation onNavigate={confirmNavigation} />
      <div className={`editor-workspace${outlineOpen ? "" : " outline-hidden"}`}>
      {outlineOpen && (
        <aside className="document-outline" aria-label="Document outline">
          <div className="outline-heading">
            <h2>Outline</h2>
            <button
              className="icon-button"
              type="button"
              aria-label="Hide document outline"
              onClick={() => setOutlineOpen(false)}
            >
              <LayoutPanelLeft size={17} />
            </button>
          </div>
          {outline.length === 0 ? (
            <p className="outline-empty">Headings you add will appear here.</p>
          ) : (
            <nav aria-label="Document headings">
              {outline.map((heading) => (
                <button
                  className={`outline-item outline-level-${heading.level}`}
                  key={`${heading.position}-${heading.text}`}
                  type="button"
                  onClick={() =>
                    editor
                      ?.chain()
                      .focus()
                      .setTextSelection(heading.position + 1)
                      .scrollIntoView()
                      .run()
                  }
                >
                  {heading.text}
                </button>
              ))}
            </nav>
          )}
        </aside>
      )}
      <section className={`editor-content layout-${layout}`}>
      <div className="editor-layout-controls">
        {!outlineOpen && (
          <button
            className="icon-button"
            type="button"
            aria-label="Show document outline"
            onClick={() => setOutlineOpen(true)}
          >
            <LayoutPanelLeft size={17} />
          </button>
        )}
        <div className="layout-toggle" role="group" aria-label="Document layout">
          <button
            type="button"
            aria-pressed={layout === "page"}
            onClick={() => changeLayout("page")}
          >
            Page
          </button>
          <button
            type="button"
            aria-pressed={layout === "pageless"}
            onClick={() => changeLayout("pageless")}
          >
            Pageless
          </button>
        </div>
      </div>
      <div className="editor-actions">
        {!canEdit && (
          <span className="save-feedback">You have view-only access</span>
        )}
        <div className="save-feedback" aria-live="polite">
          {saveState === "saving" && "Saving…"}
          {saveState === "saved" && "Saved"}
          {saveState === "error" && "Not saved"}
          {saveState === "idle" && dirty && "Unsaved changes"}
        </div>
        {!isDraft && <DocumentPresence documentId={documentId} />}
        {canEdit && !isDraft && (
          <>
            <button
              className="secondary-button editor-export-button"
              type="button"
              disabled={!toolbarState?.hasSelection || collaborationBusy}
              onClick={() => void addCollaboration("comment")}
            >
              <MessageSquare size={15} aria-hidden="true" />
              Comment
            </button>
            <button
              className="secondary-button editor-export-button"
              type="button"
              disabled={!toolbarState?.hasSelection || collaborationBusy}
              onClick={() => void addCollaboration("suggestion")}
            >
              Suggest edit
            </button>
          </>
        )}
        <button
          className="secondary-button editor-export-button"
          type="button"
          onClick={exportMarkdown}
          disabled={!editor || !canEdit}
        >
          <Download size={15} aria-hidden="true" />
          Markdown
        </button>
        <button
          className="secondary-button editor-export-button"
          type="button"
          onClick={() => window.print()}
        >
          <Printer size={15} aria-hidden="true" />
          PDF / Print
        </button>
        {isDraft && (
          <>
            <input
              ref={importInput}
              className="sr-only"
              type="file"
              accept=".txt,.docx,.pdf,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              aria-label="Import text into this draft"
              onChange={(event) =>
                void importIntoDraft(event.target.files?.[0])
              }
            />
            <button
              className="secondary-button editor-export-button"
              type="button"
              onClick={() => importInput.current?.click()}
              disabled={!editor || saveState === "saving"}
            >
              <Import size={15} aria-hidden="true" />
              Import into draft
            </button>
          </>
        )}
        {isOwner && !isDraft && (
          <button
            className="secondary-button share-button"
            type="button"
            onClick={() => void openShareDialog()}
          >
            Share
          </button>
        )}
        {canEdit && (
          <>
            <button
              className="primary-button save-button"
              type="button"
              onClick={saveDocument}
              disabled={!editor || saveState === "saving"}
            >
              {saveState === "saving" ? "Saving…" : "Save"}
            </button>
            <button
              className="secondary-button ai-button"
              type="button"
              disabled={!editor || isDraft || !toolbarState?.hasSelection}
              onClick={openAiDialog}
              title={
                toolbarState?.hasSelection
                  ? "Get writing suggestions for selected text"
                  : "Select text to get writing suggestions"
              }
            >
              <Sparkles size={16} aria-hidden="true" />
              Writing help
            </button>
          </>
        )}
      </div>

      <label className="sr-only" htmlFor="document-title">
        Document title
      </label>
      <input
        id="document-title"
        className="document-title-input"
        value={title}
        maxLength={120}
        readOnly={!isOwner || (isDraft && saveState === "saving")}
        onChange={(event) => {
          editVersion.current += 1;
          setDirty(
            event.target.value !== savedTitle.current ||
              JSON.stringify(editor?.getJSON()) !== savedContent.current,
          );
          setTitle(event.target.value);
          setSaveState("idle");
        }}
        placeholder="Untitled document"
      />

      <div className="formatting-toolbar" role="toolbar" aria-label="Text formatting">
        <label className="sr-only" htmlFor="heading-style">
          Heading style
        </label>
        <select
          id="heading-style"
          className="heading-select"
          value={selectedStyle}
          disabled={!editor || !canEdit}
          onChange={(event) => {
            if (!editor) {
              return;
            }
            const style = event.target.value;
            runEditorCommand(() => {
              const chain = editor.chain().focus();
              if (style === "heading-1") {
                return chain.setHeading({ level: 1 }).run();
              }
              if (style === "heading-2") {
                return chain.setHeading({ level: 2 }).run();
              }
              return chain.setParagraph().run();
            });
          }}
        >
          <option value="paragraph">Normal text</option>
          <option value="heading-1">Heading 1</option>
          <option value="heading-2">Heading 2</option>
        </select>

        <span className="toolbar-divider" aria-hidden="true" />

        <ToolbarButton
          label="Bold"
          shortcut="Ctrl+B"
          active={toolbarState?.bold ?? false}
          disabled={!editor || !canEdit}
          onClick={() =>
            runEditorCommand(
              () => editor?.chain().focus().toggleBold().run() ?? false,
            )
          }
        >
          <Bold aria-hidden="true" size={17} />
        </ToolbarButton>
        <ToolbarButton
          label="Italic"
          shortcut="Ctrl+I"
          active={toolbarState?.italic ?? false}
          disabled={!editor || !canEdit}
          onClick={() =>
            runEditorCommand(
              () => editor?.chain().focus().toggleItalic().run() ?? false,
            )
          }
        >
          <Italic aria-hidden="true" size={17} />
        </ToolbarButton>
        <ToolbarButton
          label="Underline"
          shortcut="Ctrl+U"
          active={toolbarState?.underline ?? false}
          disabled={!editor || !canEdit}
          onClick={() =>
            runEditorCommand(
              () => editor?.chain().focus().toggleUnderline().run() ?? false,
            )
          }
        >
          <UnderlineIcon aria-hidden="true" size={17} />
        </ToolbarButton>

        <span className="toolbar-divider" aria-hidden="true" />

        <ToolbarButton
          label="Bulleted list"
          active={toolbarState?.bulletList ?? false}
          disabled={!editor || !canEdit}
          onClick={() =>
            runEditorCommand(
              () => editor?.chain().focus().toggleBulletList().run() ?? false,
            )
          }
        >
          <List aria-hidden="true" size={18} />
        </ToolbarButton>
        <ToolbarButton
          label="Numbered list"
          active={toolbarState?.orderedList ?? false}
          disabled={!editor || !canEdit}
          onClick={() =>
            runEditorCommand(
              () => editor?.chain().focus().toggleOrderedList().run() ?? false,
            )
          }
        >
          <ListOrdered aria-hidden="true" size={18} />
        </ToolbarButton>
        <span className="toolbar-divider toolbar-divider-wide" aria-hidden="true" />
        <span className="toolbar-heading-indicator" aria-hidden="true">
          {toolbarState?.heading1 ? (
            <Heading1 size={17} />
          ) : toolbarState?.heading2 ? (
            <Heading2 size={17} />
          ) : (
            <Pilcrow size={17} />
          )}
        </span>
      </div>

      {error && (
        <div className="notice error-notice editor-notice" role="alert">
          {error}
        </div>
      )}

      <div className="rich-text-surface">
        {editor ? (
          <EditorContent editor={editor} className="tiptap-editor-frame" />
        ) : (
          <div className="editor-loading" role="status">
            Preparing editor…
          </div>
        )}
      </div>

      {!isDraft && (
        <section className="document-attachments" aria-label="Attachments">
          <div className="attachment-heading">
            <h2>Attachments</h2>
            {canEdit && (
              <>
                <input
                  ref={attachmentInput}
                  className="sr-only"
                  type="file"
                  accept=".pdf,.txt,.png,.jpg,.jpeg,.webp"
                  aria-label="Choose an attachment"
                  onChange={(event) =>
                    void uploadAttachment(event.target.files?.[0])
                  }
                />
                <button
                  type="button"
                  className="secondary-button editor-export-button"
                  onClick={() => attachmentInput.current?.click()}
                  disabled={attachmentBusy}
                >
                  {attachmentBusy ? "Uploading…" : "Attach file"}
                </button>
              </>
            )}
          </div>
          {attachmentError && (
            <p className="share-error" role="alert">
              {attachmentError}
            </p>
          )}
          {attachments.length === 0 ? (
            <p className="attachment-empty">No attachments yet.</p>
          ) : (
            <ul className="attachment-list">
              {attachments.map((attachment) => (
                <li key={attachment.id}>
                  <a
                    href={attachment.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {attachment.fileName}
                  </a>
                  <span>
                    {Math.max(1, Math.round(attachment.sizeBytes / 1024))} KB
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {!isDraft && (
        <section className="document-collaboration" aria-label="Comments and suggestions">
          <h2>Comments &amp; suggestions</h2>
          {collaborationError && (
            <p className="share-error" role="alert">
              {collaborationError}
            </p>
          )}
          {comments.length === 0 && suggestions.length === 0 ? (
            <p className="attachment-empty">No comments or suggestions yet.</p>
          ) : (
            <ul className="collaboration-list">
              {comments.map((comment) => (
                <li key={comment.id} className={comment.resolved_at ? "is-resolved" : ""}>
                  <button
                    className="collaboration-quote"
                    type="button"
                    onClick={() =>
                      editor
                        ?.chain()
                        .focus()
                        .setTextSelection({
                          from: comment.from_position,
                          to: comment.to_position,
                        })
                        .scrollIntoView()
                        .run()
                    }
                  >
                    “{comment.selected_text}”
                  </button>
                  <p>{comment.body}</p>
                  <small>{comment.author}</small>
                  {canEdit && (
                    <button
                      type="button"
                      className="collaboration-decision"
                      disabled={collaborationBusy}
                      onClick={() =>
                        void decideCollaboration(
                          "comment",
                          comment.id,
                          !comment.resolved_at,
                        )
                      }
                    >
                      {comment.resolved_at ? "Reopen" : "Resolve"}
                    </button>
                  )}
                </li>
              ))}
              {suggestions.map((suggestion) => (
                <li key={suggestion.id}>
                  <button
                    className="collaboration-quote"
                    type="button"
                    onClick={() =>
                      editor
                        ?.chain()
                        .focus()
                        .setTextSelection({
                          from: suggestion.from_position,
                          to: suggestion.to_position,
                        })
                        .scrollIntoView()
                        .run()
                    }
                  >
                    “{suggestion.original_text}”
                  </button>
                  <p>
                    Suggested: <strong>{suggestion.suggested_text}</strong>
                  </p>
                  <small>
                    {suggestion.author} · {suggestion.status}
                  </small>
                  {canEdit && suggestion.status === "pending" && (
                    <div className="suggestion-actions">
                      <button
                        type="button"
                        className="primary-button"
                        disabled={collaborationBusy}
                        onClick={() =>
                          void decideCollaboration(
                            "suggestion",
                            suggestion.id,
                            "accepted",
                          )
                        }
                      >
                        <Check size={14} /> Accept
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={collaborationBusy}
                        onClick={() =>
                          void decideCollaboration(
                            "suggestion",
                            suggestion.id,
                            "rejected",
                          )
                        }
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {shareDialogOpen && isOwner && (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShareDialogOpen(false);
            }
          }}
        >
          <section
            className="share-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-dialog-title"
          >
            <div className="share-dialog-heading">
              <div>
                <p className="eyebrow">COLLABORATE</p>
                <h2 id="share-dialog-title">Share document</h2>
              </div>
              <button
                className="dialog-close"
                type="button"
                aria-label="Close share dialog"
                onClick={() => setShareDialogOpen(false)}
              >
                ×
              </button>
            </div>
            <form onSubmit={shareDocument}>
              <label className="share-field-label" htmlFor="share-user">
                Invite a demo user
              </label>
              <div className="share-form-row">
                <select
                  id="share-user"
                  className="share-select"
                  value={selectedUserId}
                  disabled={shareUsers.length === 0 || sharing}
                  onChange={(event) => setSelectedUserId(event.target.value)}
                >
                  {shareUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
                <select
                  className="share-select"
                  aria-label="Permission level"
                  value={selectedShareRole}
                  disabled={sharing}
                  onChange={(event) =>
                    setSelectedShareRole(
                      event.target.value as "editor" | "viewer",
                    )
                  }
                >
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button
                  className="primary-button"
                  type="submit"
                  disabled={!selectedUserId || sharing}
                >
                  {sharing ? "Sharing…" : `Invite as ${selectedShareRole}`}
                </button>
              </div>
            </form>

            {shareError && (
              <p className="share-error" role="alert">
                {shareError}
              </p>
            )}

            <div className="collaborator-list">
              <h3>People with access</h3>
              {collaborators.length === 0 ? (
                <p className="collaborator-empty">Only you have access.</p>
              ) : (
                <ul>
                  {collaborators.map((collaborator) => (
                    <li key={collaborator.userId}>
                      <span className="collaborator-avatar" aria-hidden="true">
                        {collaborator.name.slice(0, 1)}
                      </span>
                      <span className="collaborator-name">
                        {collaborator.name}
                      </span>
                      <select
                        className="collaborator-role-select"
                        aria-label={`Role for ${collaborator.name}`}
                        value={collaborator.role === "viewer" ? "viewer" : "editor"}
                        onChange={(event) =>
                          void changeCollaboratorRole(
                            collaborator,
                            event.target.value as "editor" | "viewer",
                          )
                        }
                      >
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                      </select>
                      <button
                        type="button"
                        className="collaborator-remove"
                        aria-label={`Remove ${collaborator.name}`}
                        onClick={() => void removeCollaborator(collaborator)}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      )}
      {aiDialogOpen && (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !aiLoading) {
              setAiDialogOpen(false);
            }
          }}
        >
          <section
            className="share-dialog ai-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-dialog-title"
          >
            <div className="share-dialog-heading">
              <div>
                <p className="eyebrow">OPTIONAL AI ASSISTANT</p>
                <h2 id="ai-dialog-title">Writing suggestions</h2>
              </div>
              <button
                className="dialog-close"
                type="button"
                aria-label="Close writing suggestions"
                disabled={aiLoading}
                onClick={() => setAiDialogOpen(false)}
              >
                ×
              </button>
            </div>
            <p className="ai-privacy-note">
              Your selected text will be sent to OpenAI only when you click
              Generate. Suggestions are not saved until you replace text and
              click Save.
            </p>
            <form onSubmit={requestAiSuggestion}>
              <label className="share-field-label" htmlFor="ai-action">
                What would you like help with?
              </label>
              <select
                id="ai-action"
                className="share-select ai-action-select"
                value={aiAction}
                disabled={aiLoading}
                onChange={(event) =>
                  setAiAction(event.target.value as AiAction)
                }
              >
                <option value="improve">Improve writing</option>
                <option value="grammar">Correct grammar</option>
                <option value="summarize">Summarize selected text</option>
                <option value="professional">Rewrite professionally</option>
              </select>
              <label className="share-field-label" htmlFor="ai-selected-text">
                Selected text (editable)
              </label>
              <textarea
                id="ai-selected-text"
                className="ai-text-input"
                value={aiText}
                maxLength={10_000}
                disabled={aiLoading}
                onChange={(event) => setAiText(event.target.value)}
              />
              {aiError && (
                <p className="share-error" role="alert">
                  {aiError}
                </p>
              )}
              {aiSuggestion && (
                <>
                  <label
                    className="share-field-label"
                    htmlFor="ai-suggestion"
                  >
                    Suggestion
                  </label>
                  <textarea
                    id="ai-suggestion"
                    className="ai-text-input"
                    value={aiSuggestion}
                    readOnly
                  />
                </>
              )}
              <div className="ai-dialog-actions">
                {aiSuggestion && (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={replaceSelectedText}
                  >
                    Replace selected text
                  </button>
                )}
                <button
                  className="primary-button"
                  type="submit"
                  disabled={!aiText.trim() || aiLoading}
                >
                  {aiLoading ? "Generating…" : "Generate"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      </section>
      </div>
    </>
  );
}

function DocumentPresence({ documentId }: { documentId: string }) {
  const [names, setNames] = useState<string[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let inFlight = false;
    async function refreshPresence() {
      if (inFlight) {
        return;
      }
      inFlight = true;
      try {
        const heartbeat = await fetch(
          `/api/documents/${documentId}/presence`,
          { method: "POST" },
        );
        if (!heartbeat.ok) {
          throw new Error(await responseError(heartbeat));
        }
        const response = await fetch(
          `/api/documents/${documentId}/presence`,
          { cache: "no-store" },
        );
        if (!response.ok) {
          throw new Error(await responseError(response));
        }
        const result = (await response.json()) as {
          collaborators: Array<{ id: string; name: string }>;
        };
        if (active) {
          setNames(result.collaborators.map((person) => person.name));
          setError("");
        }
      } catch (presenceError) {
        if (active) {
          setError(
            presenceError instanceof Error
              ? presenceError.message
              : "Presence is unavailable.",
          );
        }
      } finally {
        inFlight = false;
      }
    }

    void refreshPresence();
    const timer = window.setInterval(() => void refreshPresence(), 10_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [documentId]);

  return (
    <span className="presence-indicator" aria-live="polite">
      {error
        ? "Presence unavailable"
        : names.length > 0
          ? `Here now: ${names.join(", ")}`
          : "You’re here"}
    </span>
  );
}

function ToolbarButton({
  label,
  shortcut,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className="toolbar-button"
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={shortcut ? `${label} (${shortcut})` : label}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
