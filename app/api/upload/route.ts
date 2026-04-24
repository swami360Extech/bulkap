import { type NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { runExtractionPipeline } from "@/server/services/extraction/pipeline";

// Called after confirmUpload to kick off async extraction
// In production this would publish to Kafka — for now runs in-process
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { invoiceId } = await req.json() as { invoiceId: string };
  if (!invoiceId) return NextResponse.json({ error: "invoiceId required" }, { status: 400 });

  // Fire and forget — don't await so the response returns immediately
  runExtractionPipeline(invoiceId).catch((err) =>
    console.error(`[pipeline] extraction failed for ${invoiceId}:`, err)
  );

  return NextResponse.json({ queued: true, invoiceId });
}
