"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { trpc } from "@/lib/trpc";
import { KeyRound, Eye, EyeOff, CheckCircle2, ShieldAlert } from "lucide-react";

function PasswordStrength({ password }: { password: string }) {
  const checks = [
    { label: "At least 8 characters",     ok: password.length >= 8 },
    { label: "At least one uppercase",    ok: /[A-Z]/.test(password) },
    { label: "At least one number",       ok: /\d/.test(password) },
    { label: "At least one special char", ok: /[^A-Za-z0-9]/.test(password) },
  ];
  const score = checks.filter((c) => c.ok).length;
  const colors = ["bg-red-400", "bg-orange-400", "bg-yellow-400", "bg-green-400", "bg-green-500"];

  return (
    <div className="space-y-2 mt-2">
      <div className="flex gap-1 h-1.5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`flex-1 rounded-full transition-colors ${i < score ? colors[score] : "bg-slate-200"}`} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-1">
        {checks.map(({ label, ok }) => (
          <p key={label} className={`text-xs flex items-center gap-1 ${ok ? "text-green-600" : "text-slate-400"}`}>
            <CheckCircle2 className={`w-3 h-3 ${ok ? "text-green-500" : "text-slate-300"}`} />
            {label}
          </p>
        ))}
      </div>
    </div>
  );
}

export default function ChangePasswordPage() {
  const [current, setCurrent]   = useState("");
  const [next, setNext]         = useState("");
  const [confirm, setConfirm]   = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext]       = useState(false);
  const [done, setDone]         = useState(false);

  const change = trpc.team.changePassword.useMutation({
    onSuccess: async () => {
      setDone(true);
      // Force re-login so JWT is issued without mustChangePassword flag
      setTimeout(() => signOut({ callbackUrl: "/login" }), 3000);
    },
  });

  const mismatch = confirm.length > 0 && next !== confirm;
  const weak = next.length > 0 && !/^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}/.test(next);
  const canSubmit = current.length >= 1 && next.length >= 8 && next === confirm && !weak;

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="bg-white rounded-2xl p-10 text-center shadow-lg max-w-sm w-full space-y-4">
          <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-7 h-7 text-green-600" />
          </div>
          <h2 className="text-lg font-bold text-slate-900">Password updated!</h2>
          <p className="text-sm text-slate-500">Redirecting you to login…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="bg-[#1e3a5f] px-8 py-7 text-white">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-lg bg-blue-500 flex items-center justify-center">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <span className="font-bold text-lg">BulkAP</span>
          </div>
          <h1 className="text-xl font-bold">Set your new password</h1>
          <p className="text-blue-200 text-sm mt-1">
            Your account was created with a temporary password. Please choose a permanent one to continue.
          </p>
        </div>

        <div className="px-8 py-7 space-y-5">
          {/* Current password */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Temporary password</label>
            <div className="relative">
              <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type={showCurrent ? "text" : "password"}
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                placeholder="Enter your temporary password"
                className="w-full pl-10 pr-10 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={() => setShowCurrent((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* New password */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 uppercase tracking-wide">New password</label>
            <div className="relative">
              <input
                type={showNext ? "text" : "password"}
                value={next}
                onChange={(e) => setNext(e.target.value)}
                placeholder="Choose a strong password"
                className="w-full pl-4 pr-10 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={() => setShowNext((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showNext ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {next.length > 0 && <PasswordStrength password={next} />}
          </div>

          {/* Confirm */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Confirm new password</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Re-enter your new password"
              className={`w-full px-4 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 ${
                mismatch ? "border-red-400 focus:ring-red-400" : "border-slate-200 focus:ring-blue-500"
              }`}
            />
            {mismatch && <p className="text-xs text-red-500">Passwords do not match</p>}
          </div>

          {change.isError && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <p className="text-xs text-red-600">{change.error.message}</p>
            </div>
          )}

          <button
            disabled={!canSubmit || change.isPending}
            onClick={() => change.mutate({ currentPassword: current, newPassword: next })}
            className="w-full bg-blue-600 disabled:bg-blue-300 text-white py-3 rounded-xl font-semibold text-sm transition-colors hover:bg-blue-700"
          >
            {change.isPending ? "Updating…" : "Set new password"}
          </button>
        </div>
      </div>
    </div>
  );
}
