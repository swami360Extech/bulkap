"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, FileText, X, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { trpc } from "@/lib/trpc";

interface FileEntry {
  file: File;
  id: string;
  state: "pending" | "uploading" | "done" | "error";
  s3Key?: string;
  invoiceId?: string;
  error?: string;
  progress: number;
}

const ACCEPTED_TYPES: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/vnd.ms-excel": [".xls"],
  "text/csv": [".csv"],
  "text/xml": [".xml"],
  "application/xml": [".xml"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DropZone({ onDone }: { onDone?: (invoiceIds: string[]) => void }) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const getUploadUrl = trpc.ingestion.getUploadUrl.useMutation();
  const confirmUpload = trpc.ingestion.confirmUpload.useMutation();

  const onDrop = useCallback((accepted: File[]) => {
    const entries: FileEntry[] = accepted.map((file) => ({
      file,
      id: crypto.randomUUID(),
      state: "pending",
      progress: 0,
    }));
    setFiles((prev) => [...prev, ...entries]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_TYPES,
    maxSize: 50 * 1024 * 1024,
    multiple: true,
  });

  function removeFile(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }

  async function uploadAll() {
    const pending = files.filter((f) => f.state === "pending");
    if (!pending.length) return;
    setSubmitting(true);

    const results = await Promise.allSettled(
      pending.map(async (entry) => {
        setFiles((prev) => prev.map((f) => f.id === entry.id ? { ...f, state: "uploading", progress: 10 } : f));

        // Step 1 — get presigned URL
        const { uploadUrl, s3Key } = await getUploadUrl.mutateAsync({
          filename: entry.file.name,
          mimeType: entry.file.type || "application/octet-stream",
          fileSize: entry.file.size,
        });

        setFiles((prev) => prev.map((f) => f.id === entry.id ? { ...f, progress: 30 } : f));

        // Step 2 — upload directly to S3
        const res = await fetch(uploadUrl, {
          method: "PUT",
          body: entry.file,
          headers: { "Content-Type": entry.file.type || "application/octet-stream" },
        });

        if (!res.ok) throw new Error(`S3 upload failed: ${res.status}`);
        setFiles((prev) => prev.map((f) => f.id === entry.id ? { ...f, progress: 70 } : f));

        // Step 3 — confirm upload, create invoice record
        const { invoiceId } = await confirmUpload.mutateAsync({
          s3Key,
          originalFilename: entry.file.name,
          mimeType: entry.file.type || "application/octet-stream",
        });

        setFiles((prev) =>
          prev.map((f) => f.id === entry.id ? { ...f, state: "done", s3Key, invoiceId, progress: 100 } : f)
        );

        return invoiceId;
      })
    );

    setSubmitting(false);

    const successIds = results
      .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")
      .map((r) => r.value);

    // Mark failures
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        const id = pending[i].id;
        setFiles((prev) =>
          prev.map((f) => f.id === id ? { ...f, state: "error", error: String(r.reason) } : f)
        );
      }
    });

    if (successIds.length > 0) onDone?.(successIds);
  }

  const pendingCount = files.filter((f) => f.state === "pending").length;
  const doneCount    = files.filter((f) => f.state === "done").length;
  const errorCount   = files.filter((f) => f.state === "error").length;

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        {...getRootProps()}
        className={cn(
          "border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-colors",
          isDragActive
            ? "border-blue-500 bg-blue-50"
            : "border-slate-200 hover:border-blue-300 hover:bg-slate-50"
        )}
      >
        <input {...getInputProps()} />
        <Upload className={cn("mx-auto w-8 h-8 mb-3", isDragActive ? "text-blue-500" : "text-slate-300")} />
        {isDragActive ? (
          <p className="text-sm font-medium text-blue-700">Drop invoices here…</p>
        ) : (
          <>
            <p className="text-sm font-medium text-slate-700">Drag invoices here or <span className="text-blue-700">browse</span></p>
            <p className="text-xs text-slate-400 mt-1">PDF · Excel · CSV · XML · JPG · PNG · up to 50 MB each</p>
          </>
        )}
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((entry) => (
            <div key={entry.id} className="flex items-center gap-3 px-4 py-3 bg-white rounded-xl border border-slate-200">
              <FileText className="w-4 h-4 text-slate-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{entry.file.name}</p>
                <p className="text-xs text-slate-400">{formatBytes(entry.file.size)}</p>
                {entry.state === "uploading" && (
                  <div className="mt-1.5 h-1 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all duration-300"
                      style={{ width: `${entry.progress}%` }}
                    />
                  </div>
                )}
                {entry.state === "error" && (
                  <p className="text-xs text-red-600 mt-0.5">{entry.error}</p>
                )}
              </div>
              <div className="shrink-0">
                {entry.state === "pending"   && <button onClick={() => removeFile(entry.id)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>}
                {entry.state === "uploading" && <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />}
                {entry.state === "done"      && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                {entry.state === "error"     && <AlertCircle className="w-4 h-4 text-red-500" />}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Summary + submit */}
      {files.length > 0 && (
        <div className="flex items-center justify-between pt-2">
          <div className="text-sm text-slate-500">
            {doneCount > 0 && <span className="text-emerald-600 font-medium">{doneCount} uploaded</span>}
            {errorCount > 0 && <span className="text-red-600 font-medium ml-2">{errorCount} failed</span>}
            {pendingCount > 0 && <span className="ml-2">{pendingCount} pending</span>}
          </div>
          <button
            onClick={uploadAll}
            disabled={pendingCount === 0 || submitting}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-800 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {submitting ? "Uploading…" : `Submit ${pendingCount} invoice${pendingCount !== 1 ? "s" : ""}`}
          </button>
        </div>
      )}
    </div>
  );
}
