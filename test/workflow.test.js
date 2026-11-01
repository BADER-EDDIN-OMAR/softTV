import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';

test('request, secure tracking, admin updates, attachments and persistence',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'softtv-test-'));let child;let base;
 const preload=join(dir,'port.cjs');const {writeFileSync}=await import('node:fs');writeFileSync(preload,`const http=require('node:http'); const original=http.Server.prototype.listen; http.Server.prototype.listen=function(...args){this.on('listening',()=>console.log('TEST_PORT='+this.address().port));return original.apply(this,args)};`);
 async function boot(trustProxy=false){child=spawn(process.execPath,['--require',preload,'server.js'],{env:{...process.env,DATA_DIR:dir,PORT:'0',ADMIN_PASSWORD:'test-password-for-suite',TRUST_PROXY:String(trustProxy),SUPABASE_URL:'',SUPABASE_SERVICE_ROLE_KEY:'',APP_ORIGIN:'',RENDER_EXTERNAL_URL:'https://softtv-test.onrender.com'},stdio:['ignore','pipe','pipe']});base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Startup timeout')),10000);child.stdout.on('data',chunk=>{const m=chunk.toString().match(/TEST_PORT=(\d+)/);if(m){clearTimeout(timer);resolve('http://127.0.0.1:'+m[1]);}});child.on('exit',code=>{clearTimeout(timer);reject(new Error('Server exited: '+code));});});}
 async function stop(){if(child&&child.exitCode===null){child.kill();await once(child,'exit');}}
 const post=(data,extra={})=>({method:'POST',headers:{'Content-Type':'application/json',...extra},body:JSON.stringify(data)});
 try{await boot();
 assert.equal((await fetch(base+'/')).status,200);assert.equal((await fetch(base+'/api/admin/requests')).status,401);
 let r=await fetch(base+'/api/requests',{method:'POST',body:new FormData()});assert.equal(r.status,400);
 const f=new FormData();for(const [k,v] of Object.entries({category:'problem',kind:'series',title:'مسلسل تجريبي',language:'subtitled',issue:'missing',season:'2',episode:'5–8',notes:'حلقات ناقصة'}))f.set(k,v);
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=','base64');f.set('attachment',new Blob([png],{type:'image/png'}),'example.png');
 r=await fetch(base+'/api/requests',{method:'POST',body:f});assert.equal(r.status,201);const receipt=await r.json();assert.equal(receipt.token.length,48);
 r=await fetch(base+'/api/track',post({...receipt,token:'wrong'}));assert.equal(r.status,404);
 r=await fetch(base+'/api/track',post(receipt));assert.equal(r.status,200);const tracked=await r.json();assert.equal(tracked.status,'new');assert.equal(tracked.notes,undefined);assert.equal(tracked.attachment,undefined);
 r=await fetch(base+'/api/admin/login',post({password:'wrong'}));assert.equal(r.status,401);
 r=await fetch(base+'/api/admin/login',post({password:'test-password-for-suite'},{Origin:'https://evil.example'}));assert.equal(r.status,403);
 r=await fetch(base+'/api/admin/login',post({password:'test-password-for-suite'},{Origin:'https://softtv-test.onrender.com'}));assert.equal(r.status,200);const cookie=r.headers.get('set-cookie').split(';')[0],{csrf}=await r.json();assert.match(r.headers.get('set-cookie'),/HttpOnly/);
 r=await fetch(base+'/api/admin/requests',{headers:{Cookie:cookie}});const list=await r.json();assert.equal(list.length,1);assert.equal(list[0].notes,'حلقات ناقصة');assert.equal(list[0].token,undefined);
 const attachment='/api/admin/attachments/'+list[0].attachment;assert.equal((await fetch(base+attachment)).status,401);r=await fetch(base+attachment,{headers:{Cookie:cookie}});assert.equal(r.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await r.arrayBuffer()),png);
 const update={method:'PATCH',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({status:'done',reply:'أضفنا الحلقات المطلوبة'})};assert.equal((await fetch(base+'/api/admin/requests/'+receipt.id,update)).status,403);update.headers['X-CSRF-Token']=csrf;assert.equal((await fetch(base+'/api/admin/requests/'+receipt.id,update)).status,200);
 await stop();await boot();r=await fetch(base+'/api/track',post(receipt));const persisted=await r.json();assert.equal(persisted.status,'done');assert.equal(persisted.reply,'أضفنا الحلقات المطلوبة');assert.equal((await fetch(base+'/api/admin/requests',{headers:{Cookie:cookie}})).status,401);
 const bad=new FormData();for(const [k,v]of f.entries())bad.set(k,v);bad.set('attachment',new Blob(['<script>evil</script>'],{type:'image/png'}),'fake.png');assert.equal((await fetch(base+'/api/requests',{method:'POST',body:bad})).status,400);

 await stop();await boot(true);
 for(let i=0;i<13;i++){
  const simple=new FormData();for(const [k,v]of Object.entries({category:'addition',kind:'movie',title:'طلب اختبار الحدود',language:'original'}))simple.set(k,v);
  const response=await fetch(base+'/api/requests',{method:'POST',headers:{'X-Forwarded-For':'198.51.100.10'},body:simple});assert.equal(response.status,i<12?201:429);
 }
 const another=new FormData();for(const [k,v]of Object.entries({category:'addition',kind:'channel',title:'قناة اختبار',language:'original'}))another.set(k,v);
 assert.equal((await fetch(base+'/api/requests',{method:'POST',headers:{'X-Forwarded-For':'198.51.100.11'},body:another})).status,201);
 }finally{await stop();rmSync(dir,{recursive:true,force:true});}
});
