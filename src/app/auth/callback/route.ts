import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { routing } from "@/i18n/routing";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? `/${routing.defaultLocale}/dashboard`;

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const url = request.nextUrl.clone();
      url.pathname = next;
      url.searchParams.delete("code");
      url.searchParams.delete("next");
      return NextResponse.redirect(url);
    }
  }

  const url = request.nextUrl.clone();
  url.pathname = `/${routing.defaultLocale}/login`;
  return NextResponse.redirect(url);
}
