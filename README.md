# CollabDocs

CollabDocs is a Next.js app backed by Supabase. Run it locally with `npm run dev`.

## Environment

Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and
`SUPABASE_SECRET_KEY` in `.env.local`. The service-role secret is used only by
server-side API routes and must never be exposed to browser code.

## Demo session

The app starts with the seeded Alex demo user. A signed, HttpOnly cookie selects
the current demo user, and the server checks that user against the `users` table
before document operations. This is simulated authentication for development
only; it is not production-ready authentication and must not be used to protect
real user accounts or sensitive data.

Documents are stored as Tiptap-compatible JSONB. The editor supports basic
text formatting, headings, and lists while keeping explicit revision-aware
saves.

## Optional OpenAI writing suggestions

Set `OPENAI_API_KEY` in the local `.env.local` file to enable selected-text
writing suggestions. Keep this key server-side; never add a `NEXT_PUBLIC_`
prefix or paste the key into chat. Selected text is sent to OpenAI only after
the user clicks **Generate** in the writing-help dialog. Suggested text is not
saved unless the user replaces the selection and explicitly saves the document.
Create the key in the OpenAI API dashboard, add it locally as
`OPENAI_API_KEY=...`, and restart `npm run dev`. The app returns a clear
configuration error until the server has loaded the key.

The editor's page/pageless preference and workspace sidebar state are stored in
the current browser's local storage; they are not synchronized across devices.

## Import formats

The document importer accepts UTF-8 `.txt`, `.docx`, and text-based `.pdf`
files up to 5 MB. DOCX and PDF formatting is reduced to readable paragraph
text during import. Scanned/image-only PDFs are not supported; OCR is not
implemented. Legacy `.doc` files are not supported.

Unsaved drafts can import a supported file into the current draft; the imported
text is appended when the draft already contains text. Editors can export
Markdown or use **PDF / Print** to open the browser print dialog and choose
Save as PDF. PDF export uses the browser's print layout.

## Collaboration schema

The collaboration API requires the SQL in
`supabase/migrations/20261112180000_collaboration_features.sql`. Run it once in
the Supabase SQL Editor before using viewer roles, comments, suggestions,
presence, or attachments. Attachments are stored in the private
`collabdocs-attachments` bucket and served through short-lived signed URLs.
The current presence indicator polls every ten seconds; it does not synchronize
document edits in real time.
