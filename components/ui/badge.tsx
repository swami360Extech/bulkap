import { cn } from "@/lib/utils";

type BadgeVariant = "default" | "success" | "warning" | "destructive" | "outline" | "secondary";

const variants: Record<BadgeVariant, string> = {
  default:     "bg-blue-100 text-blue-800",
  success:     "bg-emerald-100 text-emerald-800",
  warning:     "bg-amber-100 text-amber-800",
  destructive: "bg-red-100 text-red-800",
  outline:     "border border-slate-300 text-slate-700 bg-transparent",
  secondary:   "bg-slate-100 text-slate-700",
};

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({ variant = "default", className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn("inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium", variants[variant], className)}
      {...props}
    >
      {children}
    </span>
  );
}
