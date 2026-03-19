import { createClient } from "@/lib/supabase/server";
import { encrypt } from "@/lib/crypto";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: system } = await supabase
    .from("solar_systems")
    .select("id, se_portal_username")
    .eq("user_id", user.id)
    .single();

  if (!system) {
    return NextResponse.json(
      { error: "No solar system registered" },
      { status: 404 }
    );
  }

  const body = await request.json();
  const action: string = body.action;

  if (action === "save") {
    const username: string = body.username;
    const password: string = body.password;

    if (!username || !password) {
      return NextResponse.json(
        { error: "Username and password are required" },
        { status: 400 }
      );
    }

    let encryptedPassword: string;
    try {
      encryptedPassword = encrypt(password);
    } catch (err) {
      return NextResponse.json(
        {
          error:
            err instanceof Error
              ? err.message
              : "Encryption configuration error",
        },
        { status: 500 }
      );
    }

    const { error } = await supabase
      .from("solar_systems")
      .update({
        se_portal_username: username,
        se_portal_password_encrypted: encryptedPassword,
      })
      .eq("id", system.id);

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      username,
    });
  }

  if (action === "remove") {
    const { error } = await supabase
      .from("solar_systems")
      .update({
        se_portal_username: null,
        se_portal_password_encrypted: null,
      })
      .eq("id", system.id);

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  }

  if (action === "status") {
    return NextResponse.json({
      configured: !!system.se_portal_username,
      username: system.se_portal_username ?? null,
    });
  }

  return NextResponse.json(
    { error: "Invalid action. Use: save, remove, or status" },
    { status: 400 }
  );
}
