import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSupabaseStore} from '../storage.js';

test('remote storage contract: private API auth, filters, files and errors',async()=>{
 const calls=[];let reply=[],status=200;
 const fetchImpl=async(url,options)=>{calls.push({url:new URL(url),...options});if(reply instanceof Uint8Array)return new Response(reply,{status});return new Response(JSON.stringify(reply),{status});};
 const store=createSupabaseStore({url:'https://test-project.supabase.co',key:'test-server-only-key',fetchImpl});
 await store.health();assert.equal(calls.at(-1).url.searchParams.get('limit'),'1');
 reply=[{id:'A123',token:'private-hash'}];assert.equal((await store.list()).length,1);assert.equal(calls.at(-1).url.searchParams.get('order'),'created.desc');
 for(const c of calls){assert.equal(c.headers.apikey,'test-server-only-key');assert.equal(c.headers.Authorization,'Bearer test-server-only-key');}
 await store.insert({id:'A123',title:'طلب'});assert.equal(calls.at(-1).method,'POST');assert.equal(JSON.parse(calls.at(-1).body).title,'طلب');
 reply=[{id:'A123'}];assert.equal(await store.update('A123','done','تم'),true);assert.equal(calls.at(-1).headers.Prefer,'return=representation');reply=[];assert.equal(await store.update('missing','done',''),false);
 reply=[{id:'A123',token:'hash'}];assert.equal((await store.track('A123','hash')).id,'A123');assert.equal(calls.at(-1).url.searchParams.get('token'),'eq.hash');
 reply=[];assert.equal(await store.track('A123','wrong'),undefined);
 reply=[{mime:'image/png'}];assert.equal((await store.attachment('file')).mime,'image/png');
 const bytes=Buffer.from([137,80,78,71]);reply={};await store.put('file',bytes,'image/png');assert.equal(calls.at(-1).headers['Content-Type'],'image/png');assert.equal(calls.at(-1).url.pathname,'/storage/v1/object/softtv-attachments/file');
 reply=bytes;assert.deepEqual(await store.get('file'),bytes);assert.equal(calls.at(-1).url.pathname,'/storage/v1/object/authenticated/softtv-attachments/file');
 reply={};await store.remove('file');assert.equal(calls.at(-1).method,'DELETE');
 status=503;await assert.rejects(()=>store.list(),e=>e.status===503&&!e.message.includes('test-server-only-key'));
 const offline=createSupabaseStore({url:'https://test-project.supabase.co',key:'test-key',fetchImpl:async()=>{throw new Error('upstream secret text');}});await assert.rejects(()=>offline.health(),e=>e.status===503&&!e.message.includes('upstream'));
 assert.throws(()=>createSupabaseStore({url:'http://example.com',key:'x'}),/HTTPS/);
});

test('invalid project URL never exposes its input in errors',()=>{
 const input='dummy-private-value-for-test';
 assert.throws(()=>createSupabaseStore({url:input,key:'test-key'}),error=>{assert.match(error.message,/SUPABASE_URL/);assert.ok(!error.stack.includes(input));assert.equal(error.input,undefined);assert.equal(error.cause,undefined);return true;});
});
