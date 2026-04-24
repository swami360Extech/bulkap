import { router } from "@/server/trpc";
import { invoiceRouter } from "@/server/routers/invoice";
import { exceptionRouter } from "@/server/routers/exception";
import { ingestionRouter } from "@/server/routers/ingestion";

export const appRouter = router({
  invoice: invoiceRouter,
  exception: exceptionRouter,
  ingestion: ingestionRouter,
});

export type AppRouter = typeof appRouter;
