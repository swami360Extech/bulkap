"use client";

import { Bell, Search } from "lucide-react";
import { useSession } from "next-auth/react";

interface TopBarProps {
  title: string;
  actions?: React.ReactNode;
}

export function TopBar({ title, actions }: TopBarProps) {
  const { data: session } = useSession();

  return (
    <header className="sticky top-0 z-40 flex items-center justify-between h-14 px-6 bg-white border-b border-slate-200">
      <h1 className="text-base font-semibold text-slate-900">{title}</h1>
      <div className="flex items-center gap-3">
        {actions}
        <button className="relative p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors">
          <Bell className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-blue-800 flex items-center justify-center text-white text-xs font-semibold">
            {session?.user?.name?.charAt(0)?.toUpperCase() ?? "U"}
          </div>
          <span className="text-sm text-slate-700 hidden sm:block">{session?.user?.name}</span>
        </div>
      </div>
    </header>
  );
}
