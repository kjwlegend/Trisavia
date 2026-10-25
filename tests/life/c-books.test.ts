import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {LIFE_C_BOOKS,lifeBook} from '../../apps/platform/domains/life/c-books.ts';import {hashRuntimeRequest} from '../../apps/platform/domains/runtime/command.ts';import type {JsonObject} from '../../apps/platform/contracts/store.ts';
test('runtime book versions preserve the exact WS02 authored bodies and stable canonical content without a runtime documentation dependency',async()=>{
 for(const [i,name]of ['qingzhou-life-guide','harbor-handbook'].entries()){const original=JSON.parse(await readFile(new URL('../../docs/workstreams/ws02-perception/product/books/'+name+'.v1.json',import.meta.url),'utf8'));assert.deepEqual(LIFE_C_BOOKS[i],original);const book=lifeBook(original.bookId)!;assert.equal(book.version,1);assert(book.body.length>=300);assert.equal(book.digest,hashRuntimeRequest(original as JsonObject));}assert.equal(lifeBook('unregistered-book'),undefined);
});
