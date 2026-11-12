"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  FilePlus2,
  FileText,
  Import,
  UsersRound,
} from "lucide-react";

type DocumentSummary = {
  id: string;
  title: string;
  updated_at: string;
  accessRole?: "editor" | "viewer";
  owner?: { id: string; name: string };
};

type DemoUser = { id: string; name: "Alex" | "Sarah"; email: string };

async function responseError(response: Response) {
  const body = (await response.json().catch(() => null)) as
    | { error?: string }
    | null;
  return body?.error ?? "Something went wrong. Please try again.";
}

async function fetchDashboardData() {
  const sessionResponse = await fetch("/api/session", { cache: "no-store" });
  if (!sessionResponse.ok) {
    throw new Error(await responseError(sessionResponse));
  }
  const session = (await sessionResponse.json()) as {
    user: DemoUser;
    users: DemoUser[];
  };

  const documentsResponse = await fetch("/api/documents", {
    cache: "no-store",
  });
  if (!documentsResponse.ok) {
    throw new Error(await responseError(documentsResponse));
  }
  const documents = (await documentsResponse.json()) as {
    documents: DocumentSummary[];
    sharedDocuments: DocumentSummary[];
  };

  return { session, documents };
}

async function fetchDocuments() {
  const response = await fetch("/api/documents", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(await responseError(response));
  }
  return (await response.json()) as {
    documents: DocumentSummary[];
    sharedDocuments: DocumentSummary[];
  };
}

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Updated recently"
    : `Updated ${new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date)}`;
}

export default function Dashboard() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [sharedDocuments, setSharedDocuments] = useState<DocumentSummary[]>([]);
  const [users, setUsers] = useState<DemoUser[]>([]);
  const [currentUser, setCurrentUser] = useState<DemoUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    const collapsed =
      window.localStorage.getItem("collabdocs-sidebar-collapsed") === "true";
    if (collapsed) {
      const frame = window.requestAnimationFrame(() =>
        setSidebarCollapsed(true),
      );
      return () => window.cancelAnimationFrame(frame);
    }
  }, []);

  function toggleSidebar() {
    setSidebarCollapsed((collapsed) => {
      window.localStorage.setItem(
        "collabdocs-sidebar-collapsed",
        String(!collapsed),
      );
      return !collapsed;
    });
  }

  useEffect(() => {
    let active = true;

    async function initializeDashboard() {
      try {
        const result = await fetchDashboardData();
        if (active) {
          setCurrentUser(result.session.user);
          setUsers(result.session.users);
          setDocuments(result.documents.documents);
          setSharedDocuments(result.documents.sharedDocuments);
        }
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load documents.",
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void initializeDashboard();
    return () => {
      active = false;
    };
  }, []);

  async function loadDashboard() {
    setLoading(true);
    setError("");
    try {
      const result = await fetchDashboardData();
      setCurrentUser(result.session.user);
      setUsers(result.session.users);
      setDocuments(result.documents.documents);
      setSharedDocuments(result.documents.sharedDocuments);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load documents.",
      );
    } finally {
      setLoading(false);
    }
  }

  function createDocument() {
    router.push("/documents/new");
  }

  async function switchUser(name: "Alex" | "Sarah") {
    if (name === currentUser?.name || switching) {
      return;
    }
    setSwitching(true);
    setError("");
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) {
        throw new Error(await responseError(response));
      }
      const result = (await response.json()) as { user: DemoUser };
      setCurrentUser(result.user);
      const documentData = await fetchDocuments();
      setDocuments(documentData.documents);
      setSharedDocuments(documentData.sharedDocuments);
      router.refresh();
    } catch (switchError) {
      setError(
        switchError instanceof Error
          ? switchError.message
          : "Could not switch demo user.",
      );
    } finally {
      setSwitching(false);
    }
  }

  async function importFile(file: File | undefined) {
    if (!file) {
      return;
    }
    setImporting(true);
    setError("");
    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch("/api/documents/import", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        throw new Error(await responseError(response));
      }
      const result = (await response.json()) as {
        document: { id: string };
      };
      router.push(`/documents/${result.document.id}`);
    } catch (importError) {
      setError(
        importError instanceof Error
          ? importError.message
          : "Could not import this file.",
      );
    } finally {
      setImporting(false);
      if (fileInput.current) {
        fileInput.current.value = "";
      }
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="CollabDocs home">
          <span className="brand-mark" aria-hidden="true">
            C
          </span>
          CollabDocs
        </Link>
        <label className="user-switcher">
          <span className="sr-only">Switch demo user</span>
          <select
            aria-label="Switch demo user"
            value={currentUser?.name ?? "Alex"}
            disabled={switching || loading}
            onChange={(event) =>
              void switchUser(event.target.value as "Alex" | "Sarah")
            }
          >
            {users.length === 0 ? (
              <option value="Alex">{currentUser?.name ?? "Alex"}</option>
            ) : (
              users.map((user) => (
                <option key={user.id} value={user.name}>
                  {user.name}
                </option>
              ))
            )}
          </select>
        </label>
      </header>

      <div
        className={`dashboard-layout${sidebarCollapsed ? " sidebar-collapsed" : ""}`}
      >
        <aside className="workspace-sidebar" aria-label="Workspace navigation">
          <div className="sidebar-heading">
            {!sidebarCollapsed && <span>Workspace</span>}
            <button
              className="icon-button sidebar-toggle"
              type="button"
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              onClick={toggleSidebar}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {sidebarCollapsed ? (
                <ChevronRight size={18} />
              ) : (
                <ChevronLeft size={18} />
              )}
            </button>
          </div>
          <nav className="sidebar-nav">
            <a href="#my-documents" aria-label="My Documents" title="My Documents">
              <FileText size={17} />
              {!sidebarCollapsed && <span>My Documents</span>}
            </a>
            <a
              href="#shared-with-me"
              aria-label="Shared with Me"
              title="Shared with Me"
            >
              <UsersRound size={17} />
              {!sidebarCollapsed && <span>Shared with Me</span>}
            </a>
          </nav>
          {!sidebarCollapsed && (
            <div className="sidebar-recent">
              <h2>
                <Clock3 size={15} /> Recent Documents
              </h2>
              {loading ? (
                <p className="sidebar-empty">Loading…</p>
              ) : [...documents, ...sharedDocuments]
                  .sort(
                    (left, right) =>
                      new Date(right.updated_at).getTime() -
                      new Date(left.updated_at).getTime(),
                  )
                  .slice(0, 5)
                  .map((document) => (
                    <Link
                      key={document.id}
                      href={`/documents/${document.id}`}
                      title={document.title}
                      aria-label={document.title}
                    >
                      <FileText size={15} />
                      <span>{document.title}</span>
                    </Link>
                  ))}
              {!loading && documents.length + sharedDocuments.length === 0 && (
                <p className="sidebar-empty">No recent documents</p>
              )}
            </div>
          )}
          <div className="sidebar-actions">
            <button
              className="sidebar-action"
              type="button"
              aria-label="Import Document"
              title="Import Document"
              disabled={importing}
              onClick={() => fileInput.current?.click()}
            >
              <Import size={17} />
              {!sidebarCollapsed && (
                <span>{importing ? "Importing…" : "Import Document"}</span>
              )}
            </button>
            <button
              className="sidebar-action sidebar-new"
              type="button"
              aria-label="New Document"
              title="New Document"
              onClick={createDocument}
            >
              <FilePlus2 size={17} />
              {!sidebarCollapsed && <span>New Document</span>}
            </button>
          </div>
        </aside>

      <section className="dashboard-content" aria-labelledby="documents-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">YOUR WORKSPACE</p>
            <h1 id="documents-heading">My Documents</h1>
            <p className="section-description">
              Your ideas, all in one place. Import .txt, .docx, or text-based
              .pdf files up to 5 MB; scanned PDFs are not supported.
            </p>
          </div>
          <div className="dashboard-actions">
            <input
              ref={fileInput}
              className="sr-only"
              type="file"
              accept=".txt,.docx,.pdf,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              aria-label="Import a document (.txt, .docx, or text-based .pdf)"
              onChange={(event) => void importFile(event.target.files?.[0])}
            />
            <span className="document-count">
              {documents.length} owned · {sharedDocuments.length} shared
            </span>
          </div>
        </div>

        {error && (
          <div className="notice error-notice" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => void loadDashboard()}>
              Try again
            </button>
          </div>
        )}

        {loading ? (
          <div className="loading-state" role="status">
            Loading your documents…
          </div>
        ) : !error ? (
          <>
            <DocumentSection
              id="my-documents"
              title="My Documents"
              documents={documents}
              emptyMessage="Create a document to get your thoughts down."
            />
            <DocumentSection
              id="shared-with-me"
              title="Shared with Me"
              documents={sharedDocuments}
              emptyMessage="Documents shared with you will appear here."
              showOwner
            />
          </>
        ) : null}
      </section>
      </div>
    </main>
  );
}

function DocumentSection({
  id,
  title,
  documents,
  emptyMessage,
  showOwner = false,
}: {
  id: string;
  title: string;
  documents: DocumentSummary[];
  emptyMessage: string;
  showOwner?: boolean;
}) {
  return (
    <section
      id={id}
      className="document-section"
      aria-label={title}
      aria-live="polite"
    >
      <h2>{title}</h2>
      {documents.length === 0 ? (
        <p className="section-empty">{emptyMessage}</p>
      ) : (
        <ul className="document-list">
          {documents.map((document) => (
            <li key={document.id}>
              <Link
                className="document-card"
                href={`/documents/${document.id}`}
              >
                <span className="document-icon" aria-hidden="true">
                  <span />
                </span>
                <span className="document-details">
                  <span className="document-title">{document.title}</span>
                  <span className="document-updated">
                    {showOwner && document.owner
                      ? `Owned by ${document.owner.name} · ${document.accessRole === "viewer" ? "Viewer" : "Editor"} · `
                      : ""}
                    {formatUpdatedAt(document.updated_at)}
                  </span>
                </span>
                <span className="document-arrow" aria-hidden="true">
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
