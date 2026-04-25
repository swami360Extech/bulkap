import { router } from "@/server/trpc";
import { invoiceRouter } from "@/server/routers/invoice";
import { exceptionRouter } from "@/server/routers/exception";
import { ingestionRouter } from "@/server/routers/ingestion";
import { vendorRouter } from "@/server/routers/vendor";
import { userRouter } from "@/server/routers/user";
import { submissionRouter } from "@/server/routers/submission";
import { teamRouter }    from "@/server/routers/team";
import { reportsRouter } from "@/server/routers/reports";
import { oracleRouter }  from "@/server/routers/oracle";
import { queueRouter }   from "@/server/routers/queue";

export const appRouter = router({
  invoice:    invoiceRouter,
  exception:  exceptionRouter,
  ingestion:  ingestionRouter,
  vendor:     vendorRouter,
  user:       userRouter,
  submission: submissionRouter,
  team:       teamRouter,
  reports:    reportsRouter,
  oracle:     oracleRouter,
  queue:      queueRouter,
});

export type AppRouter = typeof appRouter;
