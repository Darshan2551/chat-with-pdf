import { NextResponse } from "next/server";

export const jsonError = (message: string, status = 400) =>
  NextResponse.json({ error: message }, { status });
