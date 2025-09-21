BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ProgramType' AND column_name = 'canBeOutsideGurdwara'
  ) THEN
    EXECUTE 'ALTER TABLE "ProgramType" RENAME COLUMN "canBeOutsideGurdwara" TO "canBeOutsideGurdwara"';
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'LocationType' AND e.enumlabel = 'HALL'
  ) THEN
    EXECUTE 'ALTER TYPE "LocationType" RENAME VALUE ''HALL'' TO ''GURDWARA''';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'LocationType' AND e.enumlabel = 'HOME'
  ) THEN
    EXECUTE 'ALTER TYPE "LocationType" RENAME VALUE ''HOME'' TO ''OUTSIDE_GURDWARA''';
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Booking' AND column_name = 'locationType'
  ) THEN
    IF EXISTS (SELECT 1 FROM "Booking" WHERE "locationType"::text IN ('HALL','HOME') LIMIT 1) THEN
      EXECUTE 'ALTER TABLE "Booking" ALTER COLUMN "locationType" TYPE text USING "locationType"::text';

      EXECUTE $upd$
        UPDATE "Booking"
        SET "locationType" = CASE
          WHEN "locationType" = 'HALL' THEN 'GURDWARA'
          WHEN "locationType" = 'HOME' THEN 'OUTSIDE_GURDWARA'
          ELSE "locationType"
        END
      $upd$;

      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LocationType') THEN
        EXECUTE 'CREATE TYPE "LocationType" AS ENUM (''GURDWARA'', ''OUTSIDE_GURDWARA'')';
      ELSE
        IF NOT EXISTS (
          SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
          WHERE t.typname = 'LocationType' AND e.enumlabel = 'GURDWARA'
        ) THEN
          EXECUTE 'ALTER TYPE "LocationType" ADD VALUE ''GURDWARA''';
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
          WHERE t.typname = 'LocationType' AND e.enumlabel = 'OUTSIDE_GURDWARA'
        ) THEN
          EXECUTE 'ALTER TYPE "LocationType" ADD VALUE ''OUTSIDE_GURDWARA''';
        END IF;
      END IF;

      EXECUTE 'ALTER TABLE "Booking" ALTER COLUMN "locationType" TYPE "LocationType" USING "locationType"::"LocationType"';
    END IF;
  END IF;
END
$$;

COMMIT;