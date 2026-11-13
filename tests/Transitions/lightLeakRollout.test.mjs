import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installLightLeakRollout} from '../../ui/src/player-extensions/lightLeakRollout.mjs';

test('rollout refreshes only the shell, preserves identity/media, and cannot reload-loop',async()=>{
 const originalCaches=globalThis.caches, originalFetch=globalThis.fetch;
 const stores=new Map();
 const cache=name=>{if(!stores.has(name))stores.set(name,new Map());const map=stores.get(name);return {match:async k=>map.get(k)?.clone(),put:async(k,v)=>map.set(k,v.clone())};};
 globalThis.caches={open:async name=>cache(name)};globalThis.fetch=async()=>new Response('new shell');
 let skipped=0,navigations=0,claimed=0;
 const listeners={};const scope='https://example.test/userscripts/player/';
 const worker={registration:{scope},skipWaiting:async()=>skipped++,addEventListener:(name,fn)=>listeners[name]=fn,clients:{claim:async()=>claimed++,matchAll:async()=>[
  {url:scope+'index.html?rotate=left',navigate:async()=>navigations++},
  {url:scope+'setup.html',navigate:async()=>{throw Error('Do not navigate setup');}},
  {url:'https://example.test/other/',navigate:async()=>{throw Error('Do not navigate other apps');}},
 ]}};
 const event=async name=>{let pending;listeners[name]({waitUntil:p=>pending=p});await pending;};
 try {
  installLightLeakRollout(worker);await event('install');await event('activate');
  assert.equal(skipped,1);assert.equal(navigations,1);assert.equal(claimed,1);
  assert.deepEqual([...stores.keys()].sort(),['xibo-static-v1','xibo-sw-version']);
  await event('install');await event('activate');
  assert.equal(skipped,1);assert.equal(navigations,1,'same version must never reload again');
 } finally {globalThis.caches=originalCaches;globalThis.fetch=originalFetch;}
});

test('offline update leaves clients playing and retries later',async()=>{
 const originalCaches=globalThis.caches, originalFetch=globalThis.fetch;
 const marker=new Map();let fail=true,navigations=0;const listeners={};
 globalThis.caches={open:async()=>({match:async key=>marker.get(key)?.clone(),put:async(key,value)=>marker.set(key,value.clone())})};
 globalThis.fetch=async()=>{if(fail)throw Error('offline');return new Response('shell');};
 const worker={registration:{scope:'https://example.test/player/'},skipWaiting:async()=>{},addEventListener:(n,f)=>listeners[n]=f,clients:{claim:async()=>{},matchAll:async()=>[{url:'https://example.test/player/',navigate:async()=>navigations++}]}};
 const event=async()=>{let pending;listeners.activate({waitUntil:p=>pending=p});await pending;};
 try {installLightLeakRollout(worker);await event();assert.equal(navigations,0);assert.equal(marker.size,0);fail=false;await event();assert.equal(navigations,1);}
 finally{globalThis.caches=originalCaches;globalThis.fetch=originalFetch;}
});
