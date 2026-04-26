import { Resend } from "resend";

const FROM = process.env.EMAIL_FROM ?? "BulkAP <onboarding@resend.dev>";

function getClient(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key || key === "your-resend-api-key") return null;
  return new Resend(key);
}

export type EmailResult =
  | { ok: true; id: string }
  | { ok: false; error: string; skipped?: boolean };

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<EmailResult> {
  const client = getClient();

  if (!client) {
    console.warn("[email] RESEND_API_KEY not configured — email not sent to", params.to);
    return { ok: false, error: "Email service not configured", skipped: true };
  }

  try {
    const { data, error } = await client.emails.send({
      from: FROM,
      to:   params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    });

    if (error || !data) {
      console.error("[email] Resend error:", error);
      return { ok: false, error: error?.message ?? "Unknown send error" };
    }

    return { ok: true, id: data.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[email] Send exception:", msg);
    return { ok: false, error: msg };
  }
}

export function generateTempPassword(): string {
  const upper  = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower  = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const special = "!@#$%&";
  const all = upper + lower + digits + special;

  const pick = (set: string) => set[Math.floor(Math.random() * set.length)];
  const rand = Array.from({ length: 8 }, () => pick(all)).join("");
  // Guarantee one of each required class
  return (pick(upper) + pick(lower) + pick(digits) + pick(special) + rand).slice(0, 12);
}
