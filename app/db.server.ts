import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

function createPrismaClient() {
  return new PrismaClient();
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
