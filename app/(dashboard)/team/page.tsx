"use client";

import { useState, useCallback } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { formatDate } from "@/lib/utils";
import { useSession } from "next-auth/react";
import {
  UserPlus, Trash2, Shield, CheckCircle2, Copy, RefreshCw,
  Mail, MailX, AlertTriangle, Eye, EyeOff, Clock,
} from "lucide-react";
import type { UserRole } from "@prisma/client";

const ROLE_LABELS: Record<string, string> = {
  ADMIN:      "Administrator",
  AP_MANAGER: "AP Manager",
  AP_CLERK:   "AP Clerk",
  APPROVER:   "Approver",
  VIEWER:     "Viewer",
};

const ROLE_COLORS: Record<string, string> = {
  ADMIN:      "bg-red-50 text-red-700 border-red-200",
  AP_MANAGER: "bg-blue-50 text-blue-700 border-blue-200",
  AP_CLERK:   "bg-slate-50 text-slate-700 border-slate-200",
  APPROVER:   "bg-violet-50 text-violet-700 border-violet-200",
  VIEWER:     "bg-slate-50 text-slate-500 border-slate-200",
};

const ALL_ROLES: UserRole[] = ["ADMIN", "AP_MANAGER", "AP_CLERK", "APPROVER", "VIEWER"];

function generatePassword(): string {
  const upper   = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower   = "abcdefghjkmnpqrstuvwxyz";
  const digits  = "23456789";
  const special = "!@#$%&";
  const all     = upper + lower + digits + special;
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  const rand = Array.from({ length: 8 }, () => pick(all)).join("");
  return (pick(upper) + pick(lower) + pick(digits) + pick(special) + rand).slice(0, 12);
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);
  return (
    <button onClick={copy} className="p-1 rounded hover:bg-slate-100 transition-colors" title="Copy">
      {copied
        ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
        : <Copy className="w-3.5 h-3.5 text-slate-400 hover:text-slate-600" />}
    </button>
  );
}

type InviteResult = {
  emailSent: boolean;
  emailSkipped: boolean;
  emailError: string | null;
  tempPassword: string;
  user: { name: string; email: string };
};

function InviteSuccessBanner({ result, onClose }: { result: InviteResult; onClose: () => void }) {
  const [show, setShow] = useState(false);
  return (
    <div className={`rounded-xl border p-4 space-y-3 ${result.emailSent ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          {result.emailSent
            ? <Mail className="w-4 h-4 text-green-600 shrink-0" />
            : <MailX className="w-4 h-4 text-amber-600 shrink-0" />}
          <p className="text-sm font-semibold text-slate-800">
            {result.emailSent
              ? `Invite sent to ${result.user.email}`
              : result.emailSkipped
                ? "Account created — email service not configured"
                : `Account created — email failed: ${result.emailError}`}
          </p>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xs">✕</button>
      </div>
      <div className="bg-white rounded-lg border border-slate-200 px-4 py-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs text-slate-500 font-medium">Temporary password for {result.user.name}</p>
          <p className={`font-mono text-sm text-slate-800 mt-0.5 ${show ? "" : "blur-sm select-none"}`}>
            {result.tempPassword}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => setShow((v) => !v)} className="p-1 rounded hover:bg-slate-100" title={show ? "Hide" : "Reveal"}>
            {show ? <EyeOff className="w-3.5 h-3.5 text-slate-400" /> : <Eye className="w-3.5 h-3.5 text-slate-400" />}
          </button>
          <CopyButton text={result.tempPassword} />
        </div>
      </div>
      {!result.emailSent && (
        <p className="text-xs text-amber-700">
          Share this password securely (e.g. via a password manager or encrypted message). The user must change it on first login.
        </p>
      )}
    </div>
  );
}

function InviteDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen]         = useState(false);
  const [name, setName]         = useState("");
  const [email, setEmail]       = useState("");
  const [role, setRole]         = useState<UserRole>("AP_CLERK");
  const [password, setPassword] = useState(generatePassword());
  const [showPass, setShowPass] = useState(false);
  const [result, setResult]     = useState<InviteResult | null>(null);

  function resetForm() {
    setName(""); setEmail(""); setRole("AP_CLERK");
    setPassword(generatePassword()); setShowPass(false); setResult(null);
  }

  const invite = trpc.team.invite.useMutation({
    onSuccess: (data) => {
      setResult({
        emailSent:    data.emailSent,
        emailSkipped: data.emailSkipped,
        emailError:   data.emailError,
        tempPassword: data.tempPassword,
        user:         data.user,
      });
      onSuccess();
    },
  });

  function handleClose() {
    setOpen(false);
    resetForm();
    invite.reset();
  }

  const valid = name.trim().length >= 2 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && password.length >= 8;

  return (
    <>
      <Button size="sm" onClick={() => { resetForm(); setOpen(true); }}>
        <UserPlus className="w-3.5 h-3.5" /> Invite User
      </Button>

      <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
        <DialogContent
          title="Invite Team Member"
          description="Create an account and send a welcome email with login instructions."
        >
          {result ? (
            <div className="mt-2 space-y-4">
              <InviteSuccessBanner result={result} onClose={() => {}} />
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => { resetForm(); }}>Invite another</Button>
                <Button onClick={handleClose}>Done</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4 mt-2">
              {/* Name */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wide">Full Name</label>
                <input
                  type="text" value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="Jane Smith"
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Email */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wide">Work Email</label>
                <input
                  type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="jane@company.com"
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Role */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wide">Role</label>
                <select
                  value={role} onChange={(e) => setRole(e.target.value as UserRole)}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {ALL_ROLES.map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
                <p className="text-xs text-slate-400">{roleDescription(role)}</p>
              </div>

              {/* Temporary password */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wide">Temporary Password</label>
                <div className="relative">
                  <input
                    type={showPass ? "text" : "password"}
                    value={password} onChange={(e) => setPassword(e.target.value)}
                    className="w-full text-sm border border-slate-200 rounded-lg pl-3 pr-20 py-2.5 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    <button type="button" onClick={() => setShowPass((v) => !v)} className="p-1 rounded hover:bg-slate-100">
                      {showPass ? <EyeOff className="w-3.5 h-3.5 text-slate-400" /> : <Eye className="w-3.5 h-3.5 text-slate-400" />}
                    </button>
                    <button type="button" onClick={() => setPassword(generatePassword())} className="p-1 rounded hover:bg-slate-100" title="Generate new password">
                      <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
                    </button>
                    <CopyButton text={password} />
                  </div>
                </div>
                <p className="text-xs text-slate-400">Auto-generated. The user will be required to change this on first login.</p>
              </div>

              {invite.isError && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                  <p className="text-xs text-red-600">{invite.error.message}</p>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <Button variant="secondary" onClick={handleClose}>Cancel</Button>
                <Button
                  loading={invite.isPending}
                  disabled={!valid}
                  onClick={() => invite.mutate({ name: name.trim(), email: email.trim(), role, password })}
                >
                  <Mail className="w-3.5 h-3.5" /> Send Invite
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ResetPasswordDialog({ userId, userName, userEmail, onSuccess }: {
  userId: string; userName: string; userEmail: string; onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ tempPassword: string; emailSent: boolean; emailSkipped: boolean; emailError: string | null } | null>(null);
  const [showPass, setShowPass] = useState(false);

  const reset = trpc.team.resetPassword.useMutation({
    onSuccess: (data) => { setResult(data); onSuccess(); },
  });

  function handleClose() {
    setOpen(false);
    setResult(null);
    reset.reset();
  }

  return (
    <>
      <button onClick={() => { setResult(null); setOpen(true); }} className="text-xs text-slate-500 hover:text-blue-600 hover:underline">
        Reset password
      </button>
      <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
        <DialogContent title={`Reset Password — ${userName}`} description={`A new temporary password will be generated and emailed to ${userEmail}.`}>
          {result ? (
            <div className="mt-2 space-y-4">
              <div className={`rounded-xl border p-4 space-y-3 ${result.emailSent ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"}`}>
                <div className="flex items-center gap-2">
                  {result.emailSent
                    ? <><Mail className="w-4 h-4 text-green-600" /><p className="text-sm font-semibold text-green-800">Reset email sent to {userEmail}</p></>
                    : <><MailX className="w-4 h-4 text-amber-600" /><p className="text-sm font-semibold text-amber-800">{result.emailSkipped ? "Email service not configured" : `Email failed: ${result.emailError}`}</p></>}
                </div>
                <div className="bg-white rounded-lg border border-slate-200 px-4 py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs text-slate-500">New temporary password</p>
                    <p className={`font-mono text-sm text-slate-800 mt-0.5 ${showPass ? "" : "blur-sm select-none"}`}>{result.tempPassword}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setShowPass((v) => !v)} className="p-1 rounded hover:bg-slate-100">
                      {showPass ? <EyeOff className="w-3.5 h-3.5 text-slate-400" /> : <Eye className="w-3.5 h-3.5 text-slate-400" />}
                    </button>
                    <CopyButton text={result.tempPassword} />
                  </div>
                </div>
              </div>
              <div className="flex justify-end">
                <Button onClick={handleClose}>Done</Button>
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700">A new temporary password will be generated and emailed to <strong>{userEmail}</strong>. The user will be required to change it on next login.</p>
              </div>
              {reset.isError && (
                <p className="text-xs text-red-600 bg-red-50 rounded px-3 py-2">{reset.error.message}</p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={handleClose}>Cancel</Button>
                <Button loading={reset.isPending} onClick={() => reset.mutate({ userId })}>
                  Reset & Send Email
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ResendInviteButton({ userId, onSuccess }: { userId: string; onSuccess: () => void }) {
  const [result, setResult] = useState<{ emailSent: boolean; tempPassword: string } | null>(null);
  const [showPass, setShowPass] = useState(false);

  const resend = trpc.team.resendInvite.useMutation({
    onSuccess: (data) => { setResult(data); onSuccess(); },
  });

  if (result) {
    return (
      <div className="flex items-center gap-2">
        {result.emailSent
          ? <span className="text-xs text-green-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Sent</span>
          : <span className="text-xs text-amber-600 flex items-center gap-1">
              <MailX className="w-3 h-3" /> Not sent —
              <button onClick={() => setShowPass((v) => !v)} className="underline">show password</button>
              {showPass && <span className="font-mono">{result.tempPassword}</span>}
            </span>}
      </div>
    );
  }

  return (
    <button
      onClick={() => resend.mutate({ userId })}
      disabled={resend.isPending}
      className="text-xs text-blue-600 hover:underline disabled:opacity-50 flex items-center gap-1"
    >
      <Mail className="w-3 h-3" />
      {resend.isPending ? "Sending…" : "Resend invite"}
    </button>
  );
}

function roleDescription(role: UserRole): string {
  const map: Record<UserRole, string> = {
    ADMIN:      "Full access — can manage users, settings, and all invoices",
    AP_MANAGER: "Can manage invoices, exceptions, and team queue assignments",
    AP_CLERK:   "Can process invoices, work queue items, and resolve exceptions",
    APPROVER:   "Can approve invoices assigned for approval",
    VIEWER:     "Read-only access to invoices and reports",
  };
  return map[role] ?? "";
}

export default function TeamPage() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";

  const { data: users, refetch } = trpc.team.list.useQuery();
  const updateRole = trpc.team.updateRole.useMutation({ onSuccess: () => refetch() });
  const removeUser = trpc.team.remove.useMutation({ onSuccess: () => refetch() });
  const [removeConfirm, setRemoveConfirm] = useState<string | null>(null);

  return (
    <>
      <TopBar
        title="Team"
        actions={isAdmin ? <InviteDialog onSuccess={() => refetch()} /> : undefined}
      />

      <div className="flex-1 p-6 space-y-5 max-w-5xl">
        {!isAdmin && (
          <div className="flex items-center gap-2 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-600">
            <Shield className="w-4 h-4 text-slate-400" />
            You can view your team but only Administrators can invite or manage users.
          </div>
        )}

        {/* Role summary */}
        <div className="grid grid-cols-5 gap-3">
          {ALL_ROLES.map((role) => {
            const count = (users ?? []).filter((u) => u.role === role).length;
            return (
              <div key={role} className="bg-white rounded-xl border border-slate-200 p-3 text-center">
                <p className="text-xl font-bold text-slate-900">{count}</p>
                <p className="text-xs text-slate-500 mt-0.5">{ROLE_LABELS[role]}</p>
              </div>
            );
          })}
        </div>

        {/* Users table */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-xs text-slate-500 uppercase tracking-wide">
                <th className="px-5 py-3 text-left font-semibold">User</th>
                <th className="px-5 py-3 text-left font-semibold">Role</th>
                <th className="px-5 py-3 text-left font-semibold">Status</th>
                <th className="px-5 py-3 text-left font-semibold">Exceptions</th>
                <th className="px-5 py-3 text-left font-semibold">Last Login</th>
                {isAdmin && <th className="px-5 py-3 text-left font-semibold">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(users ?? []).map((user) => {
                const isSelf = user.id === session?.user?.id;
                const isPending = (user as any).inviteStatus === "PENDING";
                const mustChange = (user as any).mustChangePassword;

                return (
                  <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                    {/* User info */}
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-800 flex items-center justify-center text-white text-xs font-semibold shrink-0">
                          {user.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-slate-900 flex items-center gap-1.5 flex-wrap">
                            {user.name}
                            {isSelf && <span className="text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">you</span>}
                          </p>
                          <p className="text-xs text-slate-500">{user.email}</p>
                        </div>
                      </div>
                    </td>

                    {/* Role */}
                    <td className="px-5 py-3">
                      {isAdmin && !isSelf ? (
                        <select
                          value={user.role}
                          onChange={(e) => updateRole.mutate({ userId: user.id, role: e.target.value as UserRole })}
                          className={`text-xs font-medium border rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 ${ROLE_COLORS[user.role] ?? ""}`}
                        >
                          {ALL_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                        </select>
                      ) : (
                        <span className={`inline-flex text-xs font-medium border rounded-md px-2 py-0.5 ${ROLE_COLORS[user.role] ?? ""}`}>
                          {ROLE_LABELS[user.role] ?? user.role}
                        </span>
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-5 py-3">
                      {isPending ? (
                        <div className="space-y-1">
                          <span className="flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md w-fit">
                            <Clock className="w-3 h-3" /> Invite pending
                          </span>
                          {isAdmin && <ResendInviteButton userId={user.id} onSuccess={() => refetch()} />}
                        </div>
                      ) : mustChange ? (
                        <span className="flex items-center gap-1 text-xs font-medium text-orange-700 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-md w-fit">
                          <AlertTriangle className="w-3 h-3" /> Must change password
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-emerald-600">
                          <CheckCircle2 className="w-3 h-3" /> Active
                        </span>
                      )}
                    </td>

                    {/* Exceptions */}
                    <td className="px-5 py-3">
                      {user._count.assignedExceptions > 0 ? (
                        <span className="text-xs font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md">
                          {user._count.assignedExceptions} open
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-slate-400">
                          <CheckCircle2 className="w-3 h-3" /> Clear
                        </span>
                      )}
                    </td>

                    {/* Last login */}
                    <td className="px-5 py-3 text-xs text-slate-500">
                      {user.lastLoginAt ? formatDate(user.lastLoginAt) : <span className="text-slate-300">Never</span>}
                    </td>

                    {/* Admin actions */}
                    {isAdmin && (
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3 flex-wrap">
                          {!isSelf && (
                            <ResetPasswordDialog
                              userId={user.id}
                              userName={user.name}
                              userEmail={user.email}
                              onSuccess={() => refetch()}
                            />
                          )}
                          {!isSelf && (
                            removeConfirm === user.id ? (
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs text-red-600">Sure?</span>
                                <button
                                  onClick={() => { removeUser.mutate({ userId: user.id }); setRemoveConfirm(null); }}
                                  className="text-xs text-red-600 font-semibold hover:underline"
                                >
                                  Yes, remove
                                </button>
                                <button onClick={() => setRemoveConfirm(null)} className="text-xs text-slate-500 hover:underline">
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setRemoveConfirm(user.id)}
                                className="p-1 rounded hover:bg-red-50 text-slate-300 hover:text-red-500 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
