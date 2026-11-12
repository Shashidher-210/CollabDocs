import { connection, NextResponse } from "next/server";
import {
  createDemoSessionCookie,
  DatabaseError,
  DEMO_SESSION_COOKIE,
  getCurrentDemoUser,
  getDemoUserByName,
  getInitialDemoUser,
  isValidDemoSessionCookie,
  readDemoSessionCookie,
  UnauthorizedError,
} from "@/lib/demo-session";
import { z } from "zod";

const switchUserSchema = z.object({
  name: z.enum(["Alex", "Sarah"]),
});

function setSessionCookie(response: NextResponse, userId: string) {
  response.cookies.set(DEMO_SESSION_COOKIE, createDemoSessionCookie(userId), {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}

export async function GET() {
  await connection();

  let user;
  let shouldSetCookie = false;

  try {
    const cookie = await readDemoSessionCookie();
    if (isValidDemoSessionCookie(cookie)) {
      try {
        user = await getCurrentDemoUser();
      } catch (error) {
        if (!(error instanceof UnauthorizedError)) {
          throw error;
        }
      }
    }

    if (!user) {
      user = await getInitialDemoUser();
      shouldSetCookie = true;
    }
  } catch (error) {
    if (error instanceof DatabaseError) {
      console.error("Could not initialize the demo session:", error.message);
      return NextResponse.json(
        { error: "Could not initialize the demo session" },
        { status: 500 },
      );
    }

    console.error("Could not initialize the demo session");
    return NextResponse.json(
      { error: "Could not initialize the demo session" },
      { status: 500 },
    );
  }

  let users;
  try {
    const demoUsers = await Promise.all([
      getDemoUserByName("Alex"),
      getDemoUserByName("Sarah"),
    ]);
    users = demoUsers.filter(
      (demoUser): demoUser is NonNullable<typeof demoUser> => demoUser !== null,
    );
  } catch (error) {
    if (error instanceof DatabaseError) {
      console.error("Could not load demo users:", error.message);
    } else {
      console.error("Could not load demo users");
    }
    return NextResponse.json(
      { error: "The demo users could not be loaded" },
      { status: 500 },
    );
  }
  if (users.length !== 2) {
    return NextResponse.json(
      { error: "The demo users could not be loaded" },
      { status: 500 },
    );
  }

  const response = NextResponse.json({ user, users });
  if (shouldSetCookie) {
    setSessionCookie(response, user.id);
  }

  return response;
}

export async function POST(request: Request) {
  await connection();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = switchUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Select Alex or Sarah" },
      { status: 400 },
    );
  }

  try {
    const user = await getDemoUserByName(parsed.data.name);
    if (!user) {
      return NextResponse.json(
        { error: "The selected demo user was not found" },
        { status: 404 },
      );
    }

    return setSessionCookie(NextResponse.json({ user }), user.id);
  } catch (error) {
    if (error instanceof DatabaseError) {
      console.error("Could not switch demo user:", error.message);
    } else {
      console.error("Could not switch demo user");
    }
    return NextResponse.json(
      { error: "Could not switch demo user" },
      { status: 500 },
    );
  }
}
