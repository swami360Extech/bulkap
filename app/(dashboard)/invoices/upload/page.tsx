"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { DropZone } from "@/components/upload/DropZone";
import { CheckCircle2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function UploadPage() {
  const router = useRouter();
  const [uploaded, setUploaded] = useState<string[]>([]);

  function handleDone(ids: string[]) {
    setUploaded((prev) => [...prev, ...ids]);
  }

  return (
    <>
      <TopBar title="Upload Invoices" />
      <div className="flex-1 p-6">
        <div className="max-w-2xl mx-auto space-y-6">

          {/* Success banner */}
          {uploaded.length > 0 && (
            <div className="flex items-center justify-between px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span className="text-sm font-medium text-emerald-800">
                  {uploaded.length} invoice{uploaded.length > 1 ? "s" : ""} queued for processing
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push("/invoices")}
                className="text-emerald-700 hover:text-emerald-900"
              >
                View invoices <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </div>
          )}

          {/* Upload card */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6">
            <h2 className="text-sm font-semibold text-slate-900 mb-1">Add Invoices</h2>
            <p className="text-xs text-slate-500 mb-5">
              Each file is uploaded securely and queued for AI extraction and Oracle validation.
            </p>
            <DropZone onDone={handleDone} />
          </div>

          {/* Supported formats */}
          <div className="bg-slate-50 rounded-xl border border-slate-200 p-4">
            <p className="text-xs font-medium text-slate-700 mb-2">Supported formats</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                ["PDF", "Digital and scanned invoices"],
                ["Excel / XLSX", "Vendor spreadsheet exports"],
                ["CSV", "Bulk invoice data files"],
                ["XML", "EDI and structured formats"],
                ["JPG / PNG", "Scanned images (auto-converted)"],
              ].map(([fmt, desc]) => (
                <div key={fmt} className="flex items-start gap-2">
                  <span className="text-xs font-semibold text-blue-700 w-20 shrink-0">{fmt}</span>
                  <span className="text-xs text-slate-500">{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
