// prisma.config.ts
import path from 'node:path';
import { defineConfig } from 'prisma/config';
// If you rely on .env for CLI commands (migrate/seed), load it explicitly:
import 'dotenv/config';

export default defineConfig({
  // where your schema lives
  schema: path.join('prisma', 'schema.prisma'),

  // Prisma CLI settings (migrate/seed)
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },

  // (optional) if you later use views/typedSql, point them here:
  // views: { path: path.join("prisma", "views") },
  // typedSql: { path: path.join("prisma", "queries") },
});
