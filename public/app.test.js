import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('hero media is applied through CSSOM instead of an injectable style attribute',async()=>{
 const source=await readFile(new URL('./app.js',import.meta.url),'utf8');
 assert.doesNotMatch(source,/style=["'`]--hero-image/);
 assert.match(source,/style\.setProperty\('--hero-image'/);
});
