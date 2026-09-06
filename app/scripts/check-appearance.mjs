import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundled = await build({ entryPoints:['src/lib/appearance.ts'], bundle:true, platform:'node', format:'esm', write:false });
const { normalizeScale, readScale, persistScale, APPEARANCE_KEY } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
let checks = 0;
for (const [value, expected] of [['75',75],['100',100],['125',125],[75,75],[null,100],['',100],['0',100],['150',100],['75px',100],['NaN',100],['100.0',100],[{},100]]) { assert.equal(normalizeScale(value), expected); checks++; }
const values = new Map(); const storage = {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
for (const scale of [75,100,125]) { persistScale(scale,storage); assert.equal(readScale(storage),scale); assert.equal(values.get(APPEARANCE_KEY),String(scale)); checks++; }
assert.match(APPEARANCE_KEY,/^hermes-mobile\./); checks++;
const blocked = {getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}};
assert.equal(readScale(blocked),100); assert.equal(persistScale(75,blocked),false); checks++;
assert.equal(readScale(undefined),100); checks++;
console.log(JSON.stringify({status:'passed',checks}));
