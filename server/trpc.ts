import { initTRPC, TRPCError } from "@trpc/server";
import { type NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

export async function createTRPCContext(opts: { req: NextRequest }) {
  const session = await getServerSession(authOptions);
  return { db, session, req: opts.req };
}

export type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;

const t = initTRPC.context<TRPCContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, session: ctx.session } });
});

export const managerProcedure = protectedProcedure.use(({ ctx, next }) => {
  const role = ctx.session.user.role;
  if (role !== "ADMIN" && role !== "AP_MANAGER") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Manager role required" });
  }
  return next({ ctx });
});
