import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

function createPrismaClient() {
  return new PrismaClient({
    // Production serverless: avoid query logging overhead under load.
    log: process.env.NODE_ENV === "production" ? ["error"] : ["error", "warn"],
    // Survive brief Supabase blips (session load must not crash the page).
    transactionOptions: {
      maxWait: 10_000,
      timeout: 20_000,
    },
  });
}

function clientHasInvoiceModel(client: PrismaClient) {
  return typeof (client as { orderInvoiceStatus?: unknown }).orderInvoiceStatus ===
    "object";
}

// After `prisma generate`, recreate the cached client so new models are available.
if (global.prismaGlobal && !clientHasInvoiceModel(global.prismaGlobal)) {
  void global.prismaGlobal.$disconnect().catch(() => undefined);
  global.prismaGlobal = undefined;
}

const prisma = global.prismaGlobal ?? createPrismaClient();
// Always reuse across HMR / warm serverless invocations.
global.prismaGlobal = prisma;

export default prisma;
