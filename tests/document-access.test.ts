import { describe, expect, it } from "vitest";
import {
  canReadDocument,
  canEditDocument,
  canRenameDocument,
  canShareDocument,
  getDocumentAccessRole,
  getShareCreationDecision,
  isStaleDocumentRevision,
} from "@/lib/document-access";

describe("document authorization", () => {
  const ownerId = "alex-id";
  const editorId = "sarah-id";
  const strangerId = "other-id";

  it("allows the owner to read, edit, rename, and share", () => {
    const role = getDocumentAccessRole({ ownerId, userId: ownerId });

    expect(role).toBe("owner");
    expect(canEditDocument(role)).toBe(true);
    expect(canRenameDocument(role)).toBe(true);
    expect(canShareDocument(role)).toBe(true);
  });

  it("allows a shared editor to read and edit but not rename or share", () => {
    const role = getDocumentAccessRole({
      ownerId,
      userId: editorId,
      shareRole: "editor",
    });

    expect(role).toBe("editor");
    expect(canEditDocument(role)).toBe(true);
    expect(canRenameDocument(role)).toBe(false);
    expect(canShareDocument(role)).toBe(false);
  });

  it("allows a shared viewer to read without changing or sharing", () => {
    const role = getDocumentAccessRole({
      ownerId,
      userId: editorId,
      shareRole: "viewer",
    });

    expect(role).toBe("viewer");
    expect(canReadDocument(role)).toBe(true);
    expect(canEditDocument(role)).toBe(false);
    expect(canRenameDocument(role)).toBe(false);
    expect(canShareDocument(role)).toBe(false);
  });

  it("rejects a user without an editor share", () => {
    const role = getDocumentAccessRole({
      ownerId,
      userId: strangerId,
      shareRole: null,
    });

    expect(role).toBe("none");
    expect(canReadDocument(role)).toBe(false);
    expect(canEditDocument(role)).toBe(false);
    expect(canRenameDocument(role)).toBe(false);
    expect(canShareDocument(role)).toBe(false);
  });

  it("rejects self-sharing, sharing by editors, and duplicate shares", () => {
    expect(
      getShareCreationDecision({
        ownerId,
        actorId: ownerId,
        targetId: ownerId,
        alreadyShared: false,
      }),
    ).toBe("self-share");
    expect(
      getShareCreationDecision({
        ownerId,
        actorId: editorId,
        targetId: strangerId,
        alreadyShared: false,
      }),
    ).toBe("not-owner");
    expect(
      getShareCreationDecision({
        ownerId,
        actorId: ownerId,
        targetId: editorId,
        alreadyShared: true,
      }),
    ).toBe("duplicate");
  });

  it("detects stale document revisions", () => {
    expect(isStaleDocumentRevision(4, 3)).toBe(true);
    expect(isStaleDocumentRevision(3, 3)).toBe(false);
  });
});
