-- Role simplification migration
-- Creates a new enum, remaps values, and swaps it in place.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'UserRole_new') THEN
        CREATE TYPE "UserRole_new" AS ENUM ('ADMIN','STAFF','LANGRI','VIEWER');
    END IF;
END $$;

ALTER TABLE "User"
  ALTER COLUMN "role" TYPE "UserRole_new"
  USING (
    CASE "role"::text
      WHEN 'SECRETARY' THEN 'ADMIN'
      WHEN 'GRANTHI'   THEN 'STAFF'
      ELSE "role"
    END
  )::"UserRole_new";

-- Drop old enum and rename new to old name
DO $$ BEGIN
    -- Drop old enum if it exists
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'UserRole') THEN
        DROP TYPE "UserRole";
    END IF;
END $$;

ALTER TYPE "UserRole_new" RENAME TO "UserRole";
