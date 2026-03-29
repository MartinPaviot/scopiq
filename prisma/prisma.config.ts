import path from "node:path";
import { defineConfig } from "prisma/config";
import { config } from "dotenv";

// Load .env manually since Prisma config runs before Next.js env loading
config({ path: path.join(__dirname, "..", ".env") });

export default defineConfig({
  earlyAccess: true,
  schema: path.join(__dirname, "schema.prisma"),
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
});
