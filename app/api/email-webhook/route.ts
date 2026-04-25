/**
 * Inbound email webhook — receives invoice attachments from email providers.
 *
 * Supported providers (all send multipart/form-data):
 *   • SendGrid Inbound Parse
 *   • Mailgun Route (forward with attachments)
 *
 * URL: POST /api/email-webhook?tenant=<slug>&secret=<WEBHOOK_SECRET>
 *
 * Configure in your email provider's inbound settings.
 * Set WEBHOOK_SECRET env var and pass it as the ?secret= query param.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  ingestEmailAttachments,
  parseAttachmentsFromFormDataAsync,
} from "@/server/services/ingestion/email";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(req.url);
    const tenantSlug = searchParams.get("tenant");
    const secret     = searchParams.get("secret");

    // Validate webhook secret (skip check if not configured)
    const expectedSecret = process.env.WEBHOOK_SECRET;
    if (expectedSecret && secret !== expectedSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!tenantSlug) {
      return NextResponse.json({ error: "Missing tenant parameter" }, { status: 400 });
    }

    const tenant = await db.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    const contentType = req.headers.get("content-type") ?? "";

    let fromAddress = "unknown@email.com";
    let attachments: Awaited<ReturnType<typeof parseAttachmentsFromFormDataAsync>> = [];

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();

      // Extract sender info (SendGrid/Mailgun field names)
      fromAddress = (formData.get("from") as string) || (formData.get("sender") as string) || fromAddress;

      attachments = await parseAttachmentsFromFormDataAsync(formData);
    } else if (contentType.includes("application/json")) {
      // Some providers (AWS SES via SNS) send JSON with base64 content
      const body = await req.json();
      fromAddress = body.from ?? fromAddress;

      if (Array.isArray(body.attachments)) {
        for (const att of body.attachments) {
          if (!att.content && !att.data) continue;
          const content = Buffer.from(att.content ?? att.data, "base64");
          attachments.push({
            filename: att.filename ?? att.name ?? "invoice.pdf",
            mimeType: att.type ?? att.contentType ?? "application/pdf",
            content,
          });
        }
      }
    }

    if (attachments.length === 0) {
      return NextResponse.json({
        message: "No supported attachments found",
        processed: 0,
      });
    }

    const result = await ingestEmailAttachments(tenant.id, fromAddress, "", attachments);

    return NextResponse.json({
      processed:  result.processed,
      skipped:    result.skipped,
      invoiceIds: result.invoiceIds,
      errors:     result.errors,
    });
  } catch (err) {
    console.error("[email-webhook]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Some email providers send a HEAD/GET to verify the endpoint
export async function GET() {
  return NextResponse.json({ status: "Email webhook active" });
}
