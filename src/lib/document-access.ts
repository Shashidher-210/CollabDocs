export type DocumentAccessRole = "owner" | "editor" | "viewer" | "none";

export function getDocumentAccessRole({
  ownerId,
  userId,
  shareRole,
}: {
  ownerId: string;
  userId: string;
  shareRole?: string | null;
}): DocumentAccessRole {
  if (ownerId === userId) {
    return "owner";
  }
  return shareRole === "editor" || shareRole === "viewer" ? shareRole : "none";
}

export function canReadDocument(role: DocumentAccessRole) {
  return role !== "none";
}

export function canEditDocument(role: DocumentAccessRole) {
  return role === "owner" || role === "editor";
}

export function canRenameDocument(role: DocumentAccessRole) {
  return role === "owner";
}

export function canShareDocument(role: DocumentAccessRole) {
  return role === "owner";
}

export function getShareCreationDecision({
  ownerId,
  actorId,
  targetId,
  alreadyShared,
}: {
  ownerId: string;
  actorId: string;
  targetId: string;
  alreadyShared: boolean;
}): "not-owner" | "self-share" | "duplicate" | "allowed" {
  if (ownerId !== actorId) {
    return "not-owner";
  }
  if (targetId === actorId) {
    return "self-share";
  }
  return alreadyShared ? "duplicate" : "allowed";
}

export function isStaleDocumentRevision(
  currentRevision: number,
  expectedRevision: number,
) {
  return currentRevision !== expectedRevision;
}
