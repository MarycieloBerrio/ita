// Types for e2e/sql-fixture.ts, which imports the PGlite migration loader.
import type { PGlite } from '@electric-sql/pglite';

/** Applies every migration to an embedded PGlite database (the native variant is not used by e2e). */
export function createTestDatabase(native?: false): Promise<PGlite>;
