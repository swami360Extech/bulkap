"use client";

import { useState } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { formatDate } from "@/lib/utils";
import { useSession } from "next-auth/react";
import { UserPlus, Trash2, Shield, CheckCircle2 } from "lucide-react";
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

function InviteDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen]       = useState(false);
  const [name, setName]       = useState("");
  const [email, setEmail]     = useState("");
  const [role, setRole]       = useState<UserRole>("AP_CLERK");
  const [password, setPassword] = useState("");

  const invite = trpc.team.invite.useMutation({
    onSuccess: () => { setOpen(false); setName(""); setEmail(""); setPassword(""); onSuccess(); },
  });

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <UserPlus className="w-3.5 h-3.5" /> Invite User
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Invite Team Member" description="Create a new account for a team member. Share the temporary password securely.">
          <div className="space-y-3 mt-2">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Full Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Smith"
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jane@company.com"
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {ALL_ROLES.map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Temporary Password</label>
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min. 8 characters"
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
              />
              <p className="text-xs text-slate-400 mt-1">Share this securely — ask the user to change it on first login.</p>
            </div>
            {invite.isError && (
              <p className="text-xs text-red-600 bg-red-50 rounded px-3 py-2">{invite.error.message}</p>
            )}
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              loading={invite.isPending}
              disabled={!name || !email || !password || password.length < 8}
              onClick={() => invite.mutate({ name, email, role, password })}
            >
              <UserPlus className="w-3.5 h-3.5" /> Send Invite
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ResetPasswordDialog({ userId, userName, onSuccess }: { userId: string; userName: string; onSuccess: () => void }) {
  const [open, setOpen]         = useState(false);
  const [newPassword, setNewPassword] = useState("");

  const reset = trpc.team.resetPassword.useMutation({
    onSuccess: () => { setOpen(false); setNewPassword(""); onSuccess(); },
  });

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-slate-500 hover:text-blue-600 hover:underline"
      >
        Reset password
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={`Reset Password — ${userName}`} description="Enter a new temporary password for this user.">
          <div className="mt-2">
            <input
              type="text"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New password (min. 8 characters)"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
            />
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              loading={reset.isPending}
              disabled={newPassword.length < 8}
              onClick={() => reset.mutate({ userId, newPassword })}
            >
              Reset Password
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
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

      <div className="flex-1 p-6 space-y-5 max-w-4xl">

        {!isAdmin && (
          <div className="flex items-center gap-2 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-600">
            <Shield className="w-4 h-4 text-slate-400" />
            You can view your team but only Administrators can invite or manage users.
          </div>
        )}

        {/* Summary row */}
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
                <th className="px-5 py-3 text-left font-semibold">Open Exceptions</th>
                <th className="px-5 py-3 text-left font-semibold">Joined</th>
                <th className="px-5 py-3 text-left font-semibold">Last Login</th>
                {isAdmin && <th className="px-5 py-3 text-left font-semibold">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(users ?? []).map((user) => {
                const isSelf = user.id === session?.user?.id;
                return (
                  <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-800 flex items-center justify-center text-white text-xs font-semibold shrink-0">
                          {user.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-slate-900 flex items-center gap-1.5">
                            {user.name}
                            {isSelf && (
                              <span className="text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">you</span>
                            )}
                          </p>
                          <p className="text-xs text-slate-500">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      {isAdmin && !isSelf ? (
                        <select
                          value={user.role}
                          onChange={(e) => updateRole.mutate({ userId: user.id, role: e.target.value as UserRole })}
                          className={`text-xs font-medium border rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 ${ROLE_COLORS[user.role] ?? "bg-slate-50 text-slate-700 border-slate-200"}`}
                        >
                          {ALL_ROLES.map((r) => (
                            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                          ))}
                        </select>
                      ) : (
                        <span className={`inline-flex text-xs font-medium border rounded-md px-2 py-0.5 ${ROLE_COLORS[user.role] ?? ""}`}>
                          {ROLE_LABELS[user.role] ?? user.role}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {user._count.assignedExceptions > 0 ? (
                        <span className="text-xs font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md">
                          {user._count.assignedExceptions} open
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-emerald-600">
                          <CheckCircle2 className="w-3 h-3" /> Clear
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-500">{formatDate(user.createdAt)}</td>
                    <td className="px-5 py-3 text-xs text-slate-500">
                      {user.lastLoginAt ? formatDate(user.lastLoginAt) : "Never"}
                    </td>
                    {isAdmin && (
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          {!isSelf && (
                            <ResetPasswordDialog
                              userId={user.id}
                              userName={user.name}
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
                                <button
                                  onClick={() => setRemoveConfirm(null)}
                                  className="text-xs text-slate-500 hover:underline"
                                >
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
