import { NextResponse } from "next/server";
import { getAuthDebugEvents, isAuthDebugEnabled, summarizeAuthConfiguration } from "@/lib/auth-debug";

export const dynamic = "force-dynamic";

export function GET() {
  if (!isAuthDebugEnabled()) {
    return NextResponse.json({ message: "Auth debug is disabled." }, { status: 404 });
  }

  const configuration = summarizeAuthConfiguration();
  const events = getAuthDebugEvents();

  return NextResponse.json(
    {
      configuration,
      events,
      generatedAt: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
