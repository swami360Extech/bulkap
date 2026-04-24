"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;

export function DialogContent({
  children,
  className,
  title,
  description,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
  description?: string;
}) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
      <RadixDialog.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white shadow-xl border border-slate-200 focus:outline-none",
          className
        )}
      >
        {(title || description) && (
          <div className="flex items-start justify-between px-6 py-5 border-b border-slate-200">
            <div>
              {title && <RadixDialog.Title className="text-base font-semibold text-slate-900">{title}</RadixDialog.Title>}
              {description && <RadixDialog.Description className="text-sm text-slate-500 mt-0.5">{description}</RadixDialog.Description>}
            </div>
            <RadixDialog.Close className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
              <X className="w-4 h-4" />
            </RadixDialog.Close>
          </div>
        )}
        <div className="p-6">{children}</div>
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}
