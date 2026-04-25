"use client";

import { useState } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { formatDate } from "@/lib/utils";
import { useSession } from "next-auth/react";
import {
  User, Database, Shield, CheckCircle2, XCircle,
  Mail, Server, Plus, Wifi, WifiOff, Trash2, Pencil,
  Loader2, AlertCircle, X,
} from "lucide-react";

const ROLE_LABELS: Record<string, string> = {
  ADMIN:      "Administrator",
  AP_MANAGER: "AP Manager",
  AP_CLERK:   "AP Clerk",
  APPROVER:   "Approver",
  VIEWER:     "Viewer",
};

// ─── Types ────────────────────────────────────────────────────────────────────

type TestStatus =
  | { state: "idle" }
  | { state: "testing" }
  | { state: "ok";   latencyMs: number }
  | { state: "fail"; error: string };

// ─── Oracle Connections Card ──────────────────────────────────────────────────

function OracleConnectionsCard({ isManager }: { isManager: boolean }) {
  const utils = trpc.useUtils();
  const { data: connections = [], isLoading } = trpc.oracle.list.useQuery();

  // Per-connection test state (keyed by connection id)
  const [testState, setTestState] = useState<Record<string, TestStatus>>({});

  // Inline edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ label: "", baseUrl: "", username: "", password: "" });

  // Add new
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ label: "", baseUrl: "", username: "", password: "", setActive: false });
  const [addTestState, setAddTestState] = useState<TestStatus>({ state: "idle" });

  // Delete confirmation
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  // Inline error banner
  const [bannerError, setBannerError] = useState<string | null>(null);

  const refetch = () => utils.oracle.list.invalidate();
  const clearError = () => setBannerError(null);

  const testMutation = trpc.oracle.test.useMutation();

  const addMutation = trpc.oracle.add.useMutation({
    onSuccess: () => {
      setShowAdd(false);
      setAddForm({ label: "", baseUrl: "", username: "", password: "", setActive: false });
      setAddTestState({ state: "idle" });
      refetch();
    },
    onError: (e) => setBannerError(e.message),
  });

  const updateMutation = trpc.oracle.update.useMutation({
    onSuccess: () => { setEditingId(null); refetch(); },
    onError:   (e) => setBannerError(e.message),
  });

  const removeMutation = trpc.oracle.remove.useMutation({
    onSuccess: () => { setConfirmRemoveId(null); refetch(); },
    onError:   (e) => { setConfirmRemoveId(null); setBannerError(e.message); },
  });

  const setActiveMutation = trpc.oracle.setActive.useMutation({
    onSuccess: () => refetch(),
    onError:   (e) => setBannerError(e.message),
  });

  function handleTestSaved(connectionId: string) {
    setTestState((p) => ({ ...p, [connectionId]: { state: "testing" } }));
    testMutation.mutate(
      { mode: "saved", connectionId },
      {
        onSuccess: (data) => {
          setTestState((p) => ({
            ...p,
            [connectionId]: data.ok
              ? { state: "ok",   latencyMs: data.latencyMs }
              : { state: "fail", error:     data.error },
          }));
        },
        onError: (err) => {
          setTestState((p) => ({ ...p, [connectionId]: { state: "fail", error: err.message } }));
        },
      }
    );
  }

  function handleTestAdhoc() {
    setAddTestState({ state: "testing" });
    testMutation.mutate(
      { mode: "adhoc", baseUrl: addForm.baseUrl, username: addForm.username, password: addForm.password },
      {
        onSuccess: (data) => {
          setAddTestState(
            data.ok
              ? { state: "ok",   latencyMs: data.latencyMs }
              : { state: "fail", error:     data.error }
          );
        },
        onError: (err) => setAddTestState({ state: "fail", error: err.message }),
      }
    );
  }

  function startEdit(conn: { id: string; label: string; baseUrl: string; username: string }) {
    setEditingId(conn.id);
    setEditForm({ label: conn.label, baseUrl: conn.baseUrl, username: conn.username, password: "" });
    setBannerError(null);
  }

  function TestResultLine({ ts, lastTestOk, lastTestError, lastTestedAt }: {
    ts?: TestStatus;
    lastTestOk?:    boolean | null;
    lastTestError?: string  | null;
    lastTestedAt?:  Date | string | null;
  }) {
    const s = ts ?? { state: "idle" as const };

    if (s.state === "testing") {
      return (
        <span className="flex items-center gap-1 text-xs text-slate-500">
          <Loader2 className="w-3 h-3 animate-spin" /> Testing…
        </span>
      );
    }
    if (s.state === "ok") {
      return (
        <span className="flex items-center gap-1 text-xs text-emerald-600">
          <CheckCircle2 className="w-3 h-3" /> Connected ({s.latencyMs} ms)
        </span>
      );
    }
    if (s.state === "fail") {
      return (
        <span className="flex items-center gap-1 text-xs text-red-600">
          <XCircle className="w-3 h-3" /> {s.error}
        </span>
      );
    }

    // idle — fall back to persisted DB state
    if (lastTestedAt) {
      const when = new Date(lastTestedAt).toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" });
      return lastTestOk
        ? <span className="flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 className="w-3 h-3" /> Connected — tested {when}</span>
        : <span className="flex items-center gap-1 text-xs text-red-600"><XCircle className="w-3 h-3" /> {lastTestError ?? "Failed"} — tested {when}</span>;
    }
    return <span className="text-xs text-slate-400 italic">Never tested</span>;
  }

  const inputCls = "w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-slate-500" />
            <CardTitle>Oracle Connections</CardTitle>
          </div>
          {isManager && !showAdd && (
            <Button size="sm" variant="secondary"
              onClick={() => { setShowAdd(true); setAddTestState({ state: "idle" }); clearError(); }}>
              <Plus className="w-3.5 h-3.5" /> Add Connection
            </Button>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-0.5">
          Configure one or more Oracle Fusion instances. Only the <strong>active</strong> connection is used for submissions and validation.
        </p>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Error banner */}
        {bannerError && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span className="flex-1">{bannerError}</span>
            <button onClick={clearError}><X className="w-3 h-3" /></button>
          </div>
        )}

        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading connections…
          </div>
        )}

        {!isLoading && connections.length === 0 && !showAdd && (
          <p className="text-sm text-slate-400 italic text-center py-4">
            {isManager ? "No connections yet — add one to get started." : "No Oracle connections configured. Contact your administrator."}
          </p>
        )}

        {/* Connection list */}
        {connections.map((conn) => {
          const ts = testState[conn.id];

          /* ── Edit form ── */
          if (editingId === conn.id) {
            return (
              <div key={conn.id} className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-3">
                <p className="text-xs font-semibold text-blue-800">Edit — {conn.label}</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-600 mb-1">Label</label>
                    <input type="text" value={editForm.label}
                      onChange={(e) => setEditForm((p) => ({ ...p, label: e.target.value }))}
                      className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-600 mb-1">Username</label>
                    <input type="text" value={editForm.username}
                      onChange={(e) => setEditForm((p) => ({ ...p, username: e.target.value }))}
                      className={inputCls} />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-slate-600 mb-1">Base URL</label>
                  <input type="url" value={editForm.baseUrl}
                    onChange={(e) => setEditForm((p) => ({ ...p, baseUrl: e.target.value }))}
                    className={`${inputCls} font-mono`} />
                </div>
                <div>
                  <label className="block text-xs text-slate-600 mb-1">Password <span className="text-slate-400">(leave blank to keep existing)</span></label>
                  <input type="password" value={editForm.password} placeholder="••••••••"
                    onChange={(e) => setEditForm((p) => ({ ...p, password: e.target.value }))}
                    className={inputCls} />
                </div>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" loading={updateMutation.isPending}
                    disabled={!editForm.label || !editForm.baseUrl || !editForm.username}
                    onClick={() => updateMutation.mutate({ id: conn.id, ...editForm })}>
                    Save Changes
                  </Button>
                  <Button size="sm" variant="secondary"
                    onClick={() => { setEditingId(null); clearError(); }}>
                    Cancel
                  </Button>
                </div>
              </div>
            );
          }

          /* ── Connection card ── */
          return (
            <div key={conn.id}
              className={`rounded-xl border p-4 transition-all ${
                conn.isActive
                  ? "border-blue-200 bg-blue-50"
                  : "border-slate-200 bg-white hover:border-slate-300"
              }`}>
              <div className="flex items-start justify-between gap-3">
                {/* Left: info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    {conn.isActive ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 bg-blue-100 rounded-full px-2 py-0.5">
                        <Wifi className="w-3 h-3" /> Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                        <WifiOff className="w-3 h-3" /> Inactive
                      </span>
                    )}
                    <span className="text-sm font-semibold text-slate-900">{conn.label}</span>
                  </div>
                  <p className="text-xs font-mono text-slate-600 break-all">{conn.baseUrl}</p>
                  <p className="text-xs text-slate-500 mt-0.5">Username: <span className="font-medium">{conn.username}</span></p>
                  <div className="mt-2">
                    <TestResultLine ts={ts} lastTestOk={conn.lastTestOk}
                      lastTestError={conn.lastTestError} lastTestedAt={conn.lastTestedAt} />
                  </div>
                </div>

                {/* Right: actions */}
                {isManager && (
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <div className="flex items-center gap-1.5">
                      {/* Set active */}
                      {!conn.isActive && (
                        <Button size="sm" variant="secondary"
                          loading={setActiveMutation.isPending}
                          onClick={() => setActiveMutation.mutate({ id: conn.id })}>
                          Set Active
                        </Button>
                      )}

                      {/* Test */}
                      <Button size="sm" variant="secondary"
                        disabled={ts?.state === "testing"}
                        onClick={() => handleTestSaved(conn.id)}>
                        {ts?.state === "testing"
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : <Wifi className="w-3 h-3" />}
                        Test
                      </Button>

                      {/* Edit */}
                      <button onClick={() => startEdit(conn)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                        title="Edit">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>

                      {/* Delete (only for inactive) */}
                      {!conn.isActive && (
                        confirmRemoveId === conn.id ? (
                          <div className="flex items-center gap-1 ml-1">
                            <span className="text-xs text-red-600 font-medium">Remove?</span>
                            <Button size="sm" variant="destructive"
                              loading={removeMutation.isPending}
                              onClick={() => removeMutation.mutate({ id: conn.id })}>
                              Yes
                            </Button>
                            <Button size="sm" variant="secondary"
                              onClick={() => setConfirmRemoveId(null)}>
                              No
                            </Button>
                          </div>
                        ) : (
                          <button onClick={() => setConfirmRemoveId(conn.id)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                            title="Remove">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Add new connection form */}
        {showAdd && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-3">
            <p className="text-xs font-semibold text-emerald-800">New Oracle Connection</p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-600 mb-1">Label</label>
                <input type="text" placeholder="e.g. Production" value={addForm.label}
                  onChange={(e) => setAddForm((p) => ({ ...p, label: e.target.value }))}
                  className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Username</label>
                <input type="text" placeholder="ap_user@company.com" value={addForm.username}
                  onChange={(e) => setAddForm((p) => ({ ...p, username: e.target.value }))}
                  className={inputCls} />
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-600 mb-1">Oracle Base URL</label>
              <input type="url" placeholder="https://your-instance.fa.us6.oraclecloud.com"
                value={addForm.baseUrl}
                onChange={(e) => setAddForm((p) => ({ ...p, baseUrl: e.target.value }))}
                className={`${inputCls} font-mono`} />
            </div>

            <div>
              <label className="block text-xs text-slate-600 mb-1">Password</label>
              <input type="password" placeholder="••••••••" value={addForm.password}
                onChange={(e) => setAddForm((p) => ({ ...p, password: e.target.value }))}
                className={inputCls} />
            </div>

            <div className="flex items-center gap-2">
              <input id="setActive" type="checkbox" checked={addForm.setActive}
                onChange={(e) => setAddForm((p) => ({ ...p, setActive: e.target.checked }))}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
              <label htmlFor="setActive" className="text-xs text-slate-600">
                Set as active connection immediately
              </label>
            </div>

            {/* Test result for new form */}
            {addTestState.state !== "idle" && (
              <div className={`flex items-center gap-1.5 text-xs ${
                addTestState.state === "ok"      ? "text-emerald-600"
                : addTestState.state === "fail"  ? "text-red-600"
                : "text-slate-500"
              }`}>
                {addTestState.state === "testing" && <Loader2 className="w-3 h-3 animate-spin" />}
                {addTestState.state === "ok"      && <CheckCircle2 className="w-3 h-3" />}
                {addTestState.state === "fail"    && <XCircle className="w-3 h-3" />}
                {addTestState.state === "testing" && "Testing connection…"}
                {addTestState.state === "ok"      && `Connected successfully (${addTestState.latencyMs} ms) — safe to save.`}
                {addTestState.state === "fail"    && addTestState.error}
              </div>
            )}

            <div className="flex gap-2 pt-1 flex-wrap">
              <Button size="sm"
                loading={addMutation.isPending}
                disabled={!addForm.label || !addForm.baseUrl || !addForm.username || !addForm.password}
                onClick={() => addMutation.mutate(addForm)}>
                Save Connection
              </Button>
              <Button size="sm" variant="outline"
                disabled={!addForm.baseUrl || !addForm.username || !addForm.password || addTestState.state === "testing"}
                onClick={handleTestAdhoc}>
                <Wifi className="w-3 h-3" /> Test Connection
              </Button>
              <Button size="sm" variant="secondary"
                onClick={() => { setShowAdd(false); setAddTestState({ state: "idle" }); clearError(); }}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Settings Page ────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { data: session } = useSession();
  const isManager = session?.user?.role === "ADMIN" || session?.user?.role === "AP_MANAGER";

  const { data: me }     = trpc.user.me.useQuery();
  const { data: tenant } = trpc.user.tenantConfig.useQuery();

  const [name, setName]             = useState("");
  const [profileSaved, setProfileSaved] = useState(false);

  const updateProfile = trpc.user.updateProfile.useMutation({
    onSuccess: () => { setProfileSaved(true); setTimeout(() => setProfileSaved(false), 3000); },
  });

  return (
    <>
      <TopBar title="Settings" />

      <div className="flex-1 p-6 space-y-5 max-w-2xl">

        {/* Profile */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-slate-500" />
              <CardTitle>My Profile</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-slate-500 mb-1">Email</p>
                <p className="font-medium text-slate-900">{me?.email ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Role</p>
                <p className="font-medium text-slate-900">{ROLE_LABELS[me?.role ?? ""] ?? me?.role ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Member since</p>
                <p className="font-medium text-slate-900">{me?.createdAt ? formatDate(me.createdAt) : "—"}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Last login</p>
                <p className="font-medium text-slate-900">{me?.lastLoginAt ? formatDate(me.lastLoginAt) : "—"}</p>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Display Name</label>
              <input type="text" value={name || me?.name || ""}
                onChange={(e) => setName(e.target.value)}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>

            <div className="flex items-center gap-3">
              <Button size="sm" loading={updateProfile.isPending}
                onClick={() => updateProfile.mutate({ name: name || me?.name || "" })}
                disabled={!name || name === me?.name}>
                Save Profile
              </Button>
              {profileSaved && (
                <span className="flex items-center gap-1 text-xs text-emerald-600">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Saved
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Oracle Connections (multi-server) */}
        <OracleConnectionsCard isManager={isManager} />

        {/* Ingestion Channels */}
        {isManager && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-slate-500" />
                <CardTitle>Ingestion Channels</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Email webhook */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Mail className="w-3.5 h-3.5 text-blue-600" />
                  <p className="text-sm font-semibold text-slate-800">Email Webhook</p>
                </div>
                <p className="text-xs text-slate-500 mb-2">
                  Configure your email provider (SendGrid Inbound Parse, Mailgun) to forward inbound emails to this URL.
                  PDF/image attachments are automatically ingested.
                </p>
                <div className="bg-slate-50 rounded-lg px-3 py-2 border border-slate-200">
                  <p className="text-xs font-mono text-slate-700 break-all">
                    POST {typeof window !== "undefined" ? window.location.origin : "https://your-app.com"}
                    /api/email-webhook?tenant={tenant?.slug ?? "<tenant-slug>"}&amp;secret={"<WEBHOOK_SECRET>"}
                  </p>
                </div>
                <div className="mt-2 space-y-1">
                  <p className="text-xs text-slate-500">Required environment variable:</p>
                  <div className="bg-slate-900 rounded-lg px-3 py-2 text-xs font-mono text-slate-200">
                    WEBHOOK_SECRET=your-secret-token
                  </div>
                </div>
                <p className="text-xs text-slate-400 mt-2">
                  Supported: SendGrid Inbound Parse (multipart/form-data), Mailgun Routes, AWS SES via SNS (JSON).
                </p>
              </div>

              {/* SFTP */}
              <div className="pt-4 border-t border-slate-100">
                <div className="flex items-center gap-2 mb-2">
                  <Server className="w-3.5 h-3.5 text-violet-600" />
                  <p className="text-sm font-semibold text-slate-800">SFTP Polling</p>
                </div>
                <p className="text-xs text-slate-500 mb-2">
                  BulkAP can poll an SFTP server for new invoice files. Managers can trigger a manual poll via the API
                  or configure automatic polling with a cron job.
                </p>
                <div className="space-y-1">
                  <p className="text-xs text-slate-500">Environment variables:</p>
                  <div className="bg-slate-900 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 space-y-0.5">
                    <p>SFTP_HOST=sftp.your-vendor.com</p>
                    <p>SFTP_PORT=22</p>
                    <p>SFTP_USERNAME=apuser</p>
                    <p className="text-slate-400">SFTP_PASSWORD=secret          # or SFTP_PRIVATE_KEY</p>
                    <p>SFTP_REMOTE_PATH=/invoices/incoming</p>
                    <p className="text-slate-400">SFTP_ARCHIVE_PATH=/invoices/processed  # optional</p>
                  </div>
                </div>
                <p className="text-xs text-slate-400 mt-2">
                  Supported file types: PDF, PNG, JPG, XLSX, XLS, CSV, XML.
                  Requires <span className="font-mono">npm install ssh2-sftp-client</span>.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Security */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-slate-500" />
              <CardTitle>Security</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-slate-500 mb-1">Authentication</p>
                <p className="font-medium text-slate-900">Email + Password (JWT)</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Session</p>
                <p className="font-medium text-slate-900">30-day expiry</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Tenant</p>
                <p className="font-medium text-slate-900">{tenant?.name ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Environment</p>
                <p className="font-medium text-slate-900">
                  {tenant?.oracleBaseUrl && !tenant.oracleBaseUrl.includes("example.com") ? "Production" : "Development / Demo"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

      </div>
    </>
  );
}
