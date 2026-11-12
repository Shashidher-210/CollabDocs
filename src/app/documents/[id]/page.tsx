import { Suspense } from "react";
import DocumentEditor from "./document-editor";

async function DocumentPageContent({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DocumentEditor id={id} />;
}

export default function DocumentPage({
  params,
}: PageProps<"/documents/[id]">) {
  return (
    <Suspense
      fallback={
        <div className="editor-loading" role="status">
          Loading document…
        </div>
      }
    >
      <DocumentPageContent params={params} />
    </Suspense>
  );
}
