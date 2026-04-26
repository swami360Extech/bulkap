const BASE_URL = process.env.NEXTAUTH_URL ?? "https://bulkap.vercel.app";

const ROLE_LABELS: Record<string, string> = {
  ADMIN:      "Administrator",
  AP_MANAGER: "AP Manager",
  AP_CLERK:   "AP Clerk",
  APPROVER:   "Approver",
  VIEWER:     "Viewer",
};

function shell(title: string, preheader: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;">${preheader}</div>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08);">
        <!-- Header -->
        <tr>
          <td style="background:#1e3a5f;padding:28px 40px;text-align:center;">
            <div style="display:inline-flex;align-items:center;gap:10px;">
              <div style="background:#3b82f6;border-radius:8px;width:32px;height:32px;display:inline-block;text-align:center;line-height:32px;font-size:18px;">⚡</div>
              <span style="color:#fff;font-size:20px;font-weight:800;letter-spacing:-.3px;">BulkAP</span>
            </div>
            <p style="color:#93c5fd;margin:6px 0 0;font-size:13px;">Oracle Invoice Processing Platform</p>
          </td>
        </tr>
        <!-- Body -->
        <tr><td style="padding:40px 40px 32px;">${body}</td></tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;text-align:center;">
            <p style="margin:0;font-size:12px;color:#94a3b8;">
              This email was sent by BulkAP. If you didn't expect this, please ignore it.<br/>
              <a href="${BASE_URL}" style="color:#3b82f6;text-decoration:none;">${BASE_URL}</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function btn(href: string, text: string): string {
  return `<a href="${href}" style="display:inline-block;background:#3b82f6;color:#fff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:10px;margin:24px 0 8px;">${text}</a>`;
}

function field(label: string, value: string): string {
  return `<tr>
    <td style="padding:8px 14px;font-size:13px;color:#64748b;background:#f8fafc;border-radius:6px 0 0 6px;font-weight:500;white-space:nowrap;">${label}</td>
    <td style="padding:8px 14px;font-size:13px;color:#0f172a;background:#f1f5f9;border-radius:0 6px 6px 0;font-family:monospace;">${value}</td>
  </tr>`;
}

export function inviteEmail(params: {
  inviteeName: string;
  inviteeEmail: string;
  inviterName: string;
  role: string;
  tempPassword: string;
  tenantName: string;
}): { subject: string; html: string; text: string } {
  const subject = `You've been invited to BulkAP — ${params.tenantName}`;
  const loginUrl = `${BASE_URL}/login`;
  const roleLabel = ROLE_LABELS[params.role] ?? params.role;

  const html = shell(
    subject,
    `${params.inviterName} has invited you to BulkAP as ${roleLabel}`,
    `
    <h2 style="margin:0 0 8px;font-size:22px;color:#0f172a;font-weight:700;">Welcome to BulkAP, ${params.inviteeName}!</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">
      <strong>${params.inviterName}</strong> has invited you to join <strong>${params.tenantName}</strong> on BulkAP as an <strong>${roleLabel}</strong>.
    </p>

    <p style="margin:0 0 12px;font-size:13px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:.5px;">Your login details</p>
    <table cellpadding="0" cellspacing="4" style="width:100%;border-collapse:separate;border-spacing:0 4px;">
      ${field("Email", params.inviteeEmail)}
      ${field("Temporary password", params.tempPassword)}
      ${field("Role", roleLabel)}
    </table>

    <div style="background:#fef9c3;border:1px solid #fde047;border-radius:10px;padding:14px 18px;margin:20px 0 0;">
      <p style="margin:0;font-size:13px;color:#854d0e;">
        <strong>⚠ Security notice:</strong> You will be asked to change this password on your first login. Do not share it with anyone.
      </p>
    </div>

    <div style="text-align:center;margin-top:8px;">
      ${btn(loginUrl, "Sign in to BulkAP →")}
      <p style="margin:4px 0 0;font-size:12px;color:#94a3b8;">Or copy this link: <a href="${loginUrl}" style="color:#3b82f6;">${loginUrl}</a></p>
    </div>
    `
  );

  const text = `Welcome to BulkAP, ${params.inviteeName}!

${params.inviterName} has invited you to ${params.tenantName} as ${roleLabel}.

Your login details:
  Email:             ${params.inviteeEmail}
  Temporary password: ${params.tempPassword}
  Role:              ${roleLabel}

You will be required to change your password on first login.

Sign in at: ${loginUrl}`;

  return { subject, html, text };
}

export function passwordResetEmail(params: {
  userName: string;
  userEmail: string;
  resetterName: string;
  newPassword: string;
  tenantName: string;
}): { subject: string; html: string; text: string } {
  const subject = `Your BulkAP password has been reset`;
  const loginUrl = `${BASE_URL}/login`;

  const html = shell(
    subject,
    `${params.resetterName} has reset your BulkAP password`,
    `
    <h2 style="margin:0 0 8px;font-size:22px;color:#0f172a;font-weight:700;">Password reset</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">
      <strong>${params.resetterName}</strong> has reset your password for <strong>${params.tenantName}</strong> on BulkAP.
    </p>

    <p style="margin:0 0 12px;font-size:13px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:.5px;">New credentials</p>
    <table cellpadding="0" cellspacing="4" style="width:100%;border-collapse:separate;border-spacing:0 4px;">
      ${field("Email", params.userEmail)}
      ${field("New temporary password", params.newPassword)}
    </table>

    <div style="background:#fef9c3;border:1px solid #fde047;border-radius:10px;padding:14px 18px;margin:20px 0 0;">
      <p style="margin:0;font-size:13px;color:#854d0e;">
        <strong>⚠ Security notice:</strong> You will be asked to set a new password after signing in. If you didn't request this reset, contact your administrator immediately.
      </p>
    </div>

    <div style="text-align:center;margin-top:8px;">
      ${btn(loginUrl, "Sign in now →")}
    </div>
    `
  );

  const text = `Your BulkAP password has been reset by ${params.resetterName}.

New temporary password: ${params.newPassword}

You will be required to change your password on login.

Sign in at: ${loginUrl}

If you didn't request this reset, contact your administrator immediately.`;

  return { subject, html, text };
}
