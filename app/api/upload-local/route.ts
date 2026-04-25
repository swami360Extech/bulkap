import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// Dev-only endpoint: accepts PUT uploads that would normally go to S3.
// Stores the file bytes in TempUpload so the extraction pipeline can read them.
// The s3Key is passed as ?key= on the URL (set by ingestion.getUploadUrl in dev mode).
export async function PUT(req: NextRequest) {
  const s3Key = req.nextUrl.searchParams.get("key");
  const buffer = Buffer.from(await req.arrayBuffer());
  const mimeType = req.headers.get("content-type") ?? "application/octet-stream";

  if (s3Key && buffer.length > 0) {
    await db.tempUpload.upsert({
      where:  { s3Key },
      update: { content: buffer, mimeType },
      create: { s3Key, content: buffer, mimeType },
    });
  }

  return new NextResponse(null, { status: 200 });
}
