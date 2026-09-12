// Applies every migration to an in-process Postgres and runs the schema checks
// against it.
//
//   npm i --no-save @electric-sql/pglite
//   node supabase/tests/run-pglite.mjs .
//
// Same assertions as run.sh, minus the requirements that stopped anyone from
// running them: no Docker, no cluster, no Linux. That matters more than it
// sounds — the harness had been silently unrunnable since the invoice-upload
// migration started needing a `storage` schema the prelude did not create, and
// nothing noticed, because running it at all was a chore.
//
// Deliberately not a devDependency: the WASM build is large, CI has a real
// Postgres, and one install command is a smaller price than carrying it in
// every checkout.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const ROOT = process.argv[2];
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const TESTS = join(ROOT, 'supabase', 'tests');

const db = new PGlite({ extensions: { pgcrypto } });
await db.waitReady;

const fail = (label, error) => {
  console.error(`FAILED ${label}`);
  console.error(`  ${error.message}`);
  process.exit(1);
};

const run = async (label, sql) => {
  try {
    await db.exec(sql);
    console.log(`  ok  ${label}`);
  } catch (error) {
    fail(label, error);
  }
};

const stripMeta = (sql) =>
  sql
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('\\'))
    .join('\n');

await run('prelude', stripMeta(readFileSync(join(TESTS, '00_supabase_prelude.sql'), 'utf8')));

for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
  await run(file, stripMeta(readFileSync(join(MIGRATIONS, file), 'utf8')));
}

// The checks file marks each assertion with `\echo '  ok  …'`. Those markers
// double as section boundaries, so a failure can name the check that broke.
const lines = readFileSync(join(TESTS, '01_schema_checks.sql'), 'utf8').split(/\r?\n/);
let buffer = [];

for (const line of lines) {
  if (line.startsWith('\\echo')) {
    const label = line.replace(/^\\echo\s*'?/, '').replace(/'\s*$/, '').trim();
    const sql = buffer.join('\n').trim();
    buffer = [];
    if (!sql) continue;

    try {
      await db.exec(sql);
      if (label) console.log(`  ${label}`);
    } catch (error) {
      fail(label || 'unlabelled check', error);
    }
    continue;
  }

  if (!line.startsWith('\\')) buffer.push(line);
}

if (buffer.join('').trim()) await run('trailing statements', buffer.join('\n'));

console.log('\nALL CHECKS PASSED');
