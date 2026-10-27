import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {BEHAVIOR_PERMISSIONS_SQL} from '../../apps/platform/infrastructure/postgresql/behavior-migration.ts';
import {BEHAVIOR_JOURNAL_PERMISSIONS_SQL} from '../../apps/platform/infrastructure/postgresql/behavior-journal-migration.ts';

test('each paired Town/Life preparation restores the private journal ACL after its legacy schema reset',async()=>{
 assert.match(BEHAVIOR_PERMISSIONS_SQL,/REVOKE ALL ON ALL TABLES IN SCHEMA behavior FROM connet_app/);
 for(const file of ['behavior-prepare.ts','town-services-prepare.ts','life-prepare.ts','life-b-prepare.ts','life-c-prepare.ts']){
  const source=await readFile(new URL('../../scripts/'+file,import.meta.url),'utf8');
  const calls=[...source.matchAll(/await client\.query\((BEHAVIOR_(?:JOURNAL_)?PERMISSIONS_SQL)\);/g)].map(match=>match[1]);
  assert.deepEqual(calls,['BEHAVIOR_PERMISSIONS_SQL','BEHAVIOR_JOURNAL_PERMISSIONS_SQL'],file);
  assert.match(source,/import \{BEHAVIOR_JOURNAL_PERMISSIONS_SQL\} from '\.\.\/apps\/platform\/infrastructure\/postgresql\/behavior-journal-migration\.ts';/,file);
 }
});

test('journal restoration grants only schema usage and new-table SELECT/INSERT, never mutation of existing facts',()=>{
 assert.deepEqual(BEHAVIOR_JOURNAL_PERMISSIONS_SQL.split(';').filter(Boolean),[
  'GRANT USAGE ON SCHEMA behavior TO connet_app',
  'GRANT SELECT,INSERT ON behavior.journal_entries TO connet_app',
  'REVOKE UPDATE,DELETE ON behavior.journal_entries FROM connet_app',
 ]);
});
