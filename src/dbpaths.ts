/**
 * Which `touches` paths are the database's: its migrations and its schema. One definition, used by `aidw analyze` (who
 * may own such a task) and by the bugfix boundary (a fix that changes the database is not small).
 *
 * The notes-app run showed why this lives in one place: the scaffold task touched `drizzle/**` and `src/db/schema.ts`,
 * and both checks missed it, because each had its own pattern and neither knew Drizzle's folder.
 */

/** A folder or file that holds a migration, for the tools aidw's stack packs know (Prisma, Drizzle, Supabase, Alembic, Rails, Flyway). */
const MIGRATION = /(^|\/)(migrations?|db\/migrate|drizzle|alembic\/versions|flyway|liquibase)(\/|$)|\.sql$/i;

/** The schema definition of an ORM: it changes together with its migration, so the same task owns both. */
const SCHEMA = /(^|\/)(prisma\/schema\.prisma|(db|database)\/schema(\.[a-z]+)?(\/.*)?)$/i;

export const isMigrationPath = (glob: string): boolean => MIGRATION.test(glob);
export const isDatabasePath = (glob: string): boolean => MIGRATION.test(glob) || SCHEMA.test(glob);
export const touchesDatabase = (globs: string[]): boolean => globs.some(isDatabasePath);
