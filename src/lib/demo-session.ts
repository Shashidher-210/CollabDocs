import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const DEMO_SESSION_COOKIE = "collabdocs_demo_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface DemoUser {
  id: string;
  name: string;
  email: string;
}

export class UnauthorizedError extends Error {}

export class DatabaseError extends Error {}

function getSigningKey() {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("Supabase server environment is not configured");
  }

  return createHmac("sha256", secretKey)
    .update("collabdocs:demo-session:v1")
    .digest();
}

function signSession(userId: string, expiresAt: number) {
  return createHmac("sha256", getSigningKey())
    .update(`${userId}.${expiresAt}`)
    .digest("base64url");
}

export function createDemoSessionCookie(userId: string) {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  return `${userId}.${expiresAt}.${signSession(userId, expiresAt)}`;
}

function readSessionUserId(value: string | undefined) {
  if (!value) {
    return null;
  }

  const [userId, expiresValue, signature, ...rest] = value.split(".");
  const expiresAt = Number(expiresValue);
  if (
    !userId ||
    !signature ||
    rest.length > 0 ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= Math.floor(Date.now() / 1000)
  ) {
    return null;
  }

  const expected = Buffer.from(signSession(userId, expiresAt), "base64url");
  const received = Buffer.from(signature, "base64url");
  if (
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  ) {
    return null;
  }

  return userId;
}

async function findDemoUser(column: "id" | "name", value: string) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("users")
    .select("id, name, email")
    .eq(column, value)
    .maybeSingle();

  if (error) {
    throw new DatabaseError("Could not retrieve the demo user");
  }

  return data as DemoUser | null;
}

export async function getCurrentDemoUser(): Promise<DemoUser> {
  const cookieStore = await cookies();
  const userId = readSessionUserId(
    cookieStore.get(DEMO_SESSION_COOKIE)?.value,
  );
  if (!userId) {
    throw new UnauthorizedError("A valid demo session is required");
  }

  const user = await findDemoUser("id", userId);
  if (!user) {
    throw new UnauthorizedError("The demo session user no longer exists");
  }

  return user;
}

export async function getInitialDemoUser() {
  const user = await findDemoUser("name", "Alex");
  if (!user) {
    throw new DatabaseError("The Alex demo user could not be found");
  }

  return user;
}

export async function getDemoUserByName(name: "Alex" | "Sarah") {
  return findDemoUser("name", name);
}

export async function readDemoSessionCookie() {
  const cookieStore = await cookies();
  return cookieStore.get(DEMO_SESSION_COOKIE)?.value;
}

export function isValidDemoSessionCookie(value: string | undefined) {
  return readSessionUserId(value) !== null;
}
