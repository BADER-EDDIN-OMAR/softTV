import http from 'node:http';
import { createStore } from './storage.js';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { isIP } from 'node:net';

const root=resolve(process.env.DATA_DIR || 'data'); mkdirSync(join(root,'uploads'),{recursive:true});
const store=await createStore(root);
if(store.mode==='supabase'&&!process.env.ADMIN_PASSWORD)throw new Error('ADMIN_PASSWORD is required with Supabase to survive ephemeral host restarts');
const passwordFile=join(root,'admin-password');
if(!process.env.ADMIN_PASSWORD&&!existsSync(passwordFile)) writeFileSync(passwordFile,randomBytes(18).toString('base64url'),{mode:0o600});
const adminPassword=process.env.ADMIN_PASSWORD || readFileSync(passwordFile,'utf8').trim();
if(adminPassword.length<12) throw new Error('ADMIN_PASSWORD must contain at least 12 characters');
const salt=randomBytes(16), passwordHash=scryptSync(adminPassword,salt,32), sessions=new Map(), limits=new Map();
const states=['new','working','done','declined'];
const appOrigin=process.env.APP_ORIGIN||process.env.RENDER_EXTERNAL_URL;
const hash=s=>createHash('sha256').update(s).digest('hex');
function rate(key,max,window=600000){ const now=Date.now(); let r=limits.get(key); if(!r||r.end<now) {r={n:0,end:now+window};limits.set(key,r);} if(limits.size>10000) for(const [k,v] of limits) if(v.end<now)limits.delete(k); return ++r.n<=max; }
function session(req){const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('softtv_session='))?.slice(15); const s=sessions.get(token); if(!s||s.expires<Date.now()){if(token)sessions.delete(token);return null;}return s;}
function send(res,code,data){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
async function body(req,max=16*1024*1024){let size=0,chunks=[];for await(const c of req){size+=c.length;if(size>max)throw Object.assign(new Error('حجم الملف كبير. الحد الأقصى ١٥ ميجابايت.'),{status:413});chunks.push(c);}return Buffer.concat(chunks);}
function clean(s,max=200){return typeof s==='string'?s.trim().slice(0,max):'';}
function publicRow(row){return {id:row.id,title:row.title,kind:row.kind,category:row.category,status:row.status,reply:row.reply,created:row.created};}
function detect(buf,mime){if(mime==='image/jpeg')return buf[0]===255&&buf[1]===216&&buf[2]===255;if(mime==='image/png')return buf.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));if(mime==='image/webp')return buf.toString('ascii',0,4)==='RIFF'&&buf.toString('ascii',8,12)==='WEBP';if(mime==='video/mp4')return buf.toString('ascii',4,8)==='ftyp';if(mime==='video/webm')return buf.subarray(0,4).equals(Buffer.from([26,69,223,163]));return false;}
const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
 try{
 const url=new URL(req.url,'http://localhost'),path=url.pathname;
 const forwarded=String(req.headers['x-forwarded-for']||'').split(',').at(-1).trim();
 const ip=process.env.TRUST_PROXY==='true'&&isIP(forwarded)?forwarded:req.socket.remoteAddress;
 if(!['GET','HEAD'].includes(req.method)&&req.headers.origin&&req.headers.origin!==`${req.socket.encrypted?'https':'http'}://${req.headers.host}`&&req.headers.origin!==appOrigin)return send(res,403,{error:'مصدر الطلب غير مسموح.'});
 if(path==='/api/health'){await store.health();return send(res,200,{ok:true});}
 if(path==='/api/admin/login'&&req.method==='POST'){
 if(!rate('login:'+ip,10))return send(res,429,{error:'محاولات كثيرة. حاول بعد عشر دقائق.'});
 const data=JSON.parse((await body(req,4096)).toString());if(!timingSafeEqual(scryptSync(String(data.password||''),salt,32),passwordHash))return send(res,401,{error:'كلمة المرور غير صحيحة.'});
 const token=randomBytes(32).toString('hex'),csrf=randomBytes(24).toString('hex');for(const [k,v] of sessions)if(v.expires<Date.now())sessions.delete(k);sessions.set(token,{csrf,expires:Date.now()+8*3600000});
 res.setHeader('Set-Cookie',`softtv_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.COOKIE_SECURE==='true'?'; Secure':''}`);return send(res,200,{csrf});}
 if(path.startsWith('/api/admin/')){
 const s=session(req);if(!s)return send(res,401,{error:'سجّل الدخول أولًا.'});if(req.method!=='GET'&&req.headers['x-csrf-token']!==s.csrf)return send(res,403,{error:'انتهت صلاحية الصفحة. حدّث الصفحة.'});
 if(path==='/api/admin/session')return send(res,200,{csrf:s.csrf});
 if(path==='/api/admin/logout'&&req.method==='POST'){sessions.forEach((v,k)=>{if(v===s)sessions.delete(k);});res.setHeader('Set-Cookie','softtv_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return send(res,200,{ok:true});}
 if(path==='/api/admin/requests'&&req.method==='GET')return send(res,200,(await store.list()).map(({token,...r})=>r));
 const m=path.match(/^\/api\/admin\/requests\/([A-F0-9]{12})$/);if(m&&req.method==='PATCH'){const d=JSON.parse((await body(req,8192)).toString());if(!states.includes(d.status))return send(res,400,{error:'حالة غير صالحة.'});const updated=await store.update(m[1],d.status,clean(d.reply,2000));return send(res,updated?200:404,{ok:updated});}
 const a=path.match(/^\/api\/admin\/attachments\/([a-f0-9]{40})$/);if(a&&req.method==='GET'){const row=await store.attachment(a[1]);if(!row)return send(res,404,{error:'غير موجود'});const buffer=await store.get(a[1]);res.writeHead(200,{'Content-Type':row.mime,'Content-Disposition':'inline'});return res.end(buffer);}
 return send(res,404,{error:'غير موجود'});}
 if(path==='/api/requests'&&req.method==='POST'){
 if(!rate('submit:'+ip,12))return send(res,429,{error:'وصلت للحد المؤقت للطلبات. حاول بعد عشر دقائق.'});
 const raw=await body(req);const form=await new Request('http://localhost',{method:'POST',headers:{'Content-Type':req.headers['content-type']||''},body:raw}).formData();
 if(form.get('website'))return send(res,400,{error:'تعذر إرسال الطلب.'});
 const category=clean(form.get('category')),kind=clean(form.get('kind')),title=clean(form.get('title')),language=clean(form.get('language')),issue=clean(form.get('issue')),season=clean(form.get('season'),10),episode=clean(form.get('episode'),30),notes=clean(form.get('notes'),2000);
 if(!['addition','problem'].includes(category)||!['series','movie','channel'].includes(kind)||title.length<2||!['subtitled','dubbed','original'].includes(language)||(category==='problem'&&!['missing','playback','audio','subtitle','quality','other'].includes(issue)))return send(res,400,{error:'أكمل الحقول المطلوبة بشكل صحيح.'});
 if(season&&!/^\d{1,4}$/.test(season))return send(res,400,{error:'رقم الموسم غير صالح.'});
 let attachment='',mime='';const file=form.get('attachment');if(file&&typeof file!=='string'&&file.size){if(file.size>15*1024*1024)return send(res,413,{error:'الحد الأقصى للمرفق ١٥ ميجابايت.'});const buffer=Buffer.from(await file.arrayBuffer());if(!detect(buffer,file.type))return send(res,400,{error:'ارفع صورة JPG أو PNG أو WebP، أو فيديو MP4 أو WebM صالحًا.'});attachment=randomBytes(20).toString('hex');mime=file.type;await store.put(attachment,buffer,mime);}
 const id=randomBytes(6).toString('hex').toUpperCase(),token=randomBytes(24).toString('hex');try{await store.insert({id,token:hash(token),category,kind,title,language,season,episode,issue,notes,attachment,mime,created:new Date().toISOString()});}catch(error){if(attachment)await store.remove(attachment).catch(()=>{});throw error;}return send(res,201,{id,token});}
 if(path==='/api/track'&&req.method==='POST'){if(!rate('track:'+ip,60))return send(res,429,{error:'حاول لاحقًا.'});const d=JSON.parse((await body(req,4096)).toString()),row=await store.track(clean(d.id).toUpperCase(),hash(clean(d.token)));return send(res,row?200:404,row?publicRow(row):{error:'لم نجد الطلب. تأكد من رقم الطلب ورمز المتابعة.'});}
 if(req.method==='GET'||req.method==='HEAD'){const files={'/':'index.html','/admin':'index.html','/app.js':'app.js','/style.css':'style.css'};if(files[path]){const type=path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html';res.writeHead(200,{'Content-Type':type+'; charset=utf-8'});return res.end(req.method==='HEAD'?undefined:readFileSync(new URL('./public/'+files[path],import.meta.url)));}}
 send(res,404,{error:'الصفحة غير موجودة.'});
 }catch(e){if(!res.headersSent)send(res,e.status||400,{error:e.status?e.message:'تعذر إتمام الطلب. تحقق من البيانات وحاول مجددًا.'});else res.end();}
});
server.requestTimeout=30000;server.listen(Number(process.env.PORT||3000),process.env.HOST||'0.0.0.0',()=>console.log(`SoftTV running on port ${process.env.PORT||3000}. Admin password: ${process.env.ADMIN_PASSWORD?'configured via environment':'stored in '+passwordFile}`));

function shutdown(){server.close(()=>{store.close();process.exit(0);});setTimeout(()=>process.exit(1),10000).unref();}
process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
