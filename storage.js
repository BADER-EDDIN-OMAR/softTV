import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export async function createStore(root) {
 if(process.env.SUPABASE_URL || process.env.SUPABASE_SERVICE_ROLE_KEY){
  if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)throw new Error('Both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  return createSupabaseStore({url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY});
 }
 const {DatabaseSync}=await import('node:sqlite');
 mkdirSync(join(root,'uploads'),{recursive:true});
 const db=new DatabaseSync(join(root,'softtv.sqlite'));
 db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, token TEXT NOT NULL, category TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, language TEXT NOT NULL, season TEXT, episode TEXT, issue TEXT, notes TEXT, attachment TEXT, mime TEXT, status TEXT NOT NULL DEFAULT 'new', reply TEXT NOT NULL DEFAULT '', created TEXT NOT NULL);`);
 return {
  mode:'sqlite',
  async health(){db.prepare('SELECT 1').get();},
  async list(){return db.prepare('SELECT * FROM requests ORDER BY created DESC LIMIT 1000').all();},
  async insert(row){const keys=Object.keys(row);db.prepare(`INSERT INTO requests(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...Object.values(row));},
  async update(id,status,reply){return !!db.prepare('UPDATE requests SET status=?,reply=? WHERE id=?').run(status,reply,id).changes;},
  async track(id,token){return db.prepare('SELECT * FROM requests WHERE id=? AND token=?').get(id,token);},
  async attachment(id){return db.prepare('SELECT mime FROM requests WHERE attachment=?').get(id);},
  async put(id,buffer){writeFileSync(join(root,'uploads',id),buffer,{mode:0o600});},
  async get(id){return readFileSync(join(root,'uploads',id));},
  async remove(id){try{unlinkSync(join(root,'uploads',id));}catch(e){if(e.code!=='ENOENT')throw e;}},
  close(){db.close();}
 };
}

export function createSupabaseStore({url,key,fetchImpl=fetch}) {
 const base=new URL(url);if(base.protocol!=='https:'||base.username||base.password||base.pathname!=='/'||base.search||base.hash)throw new Error('SUPABASE_URL must be an HTTPS origin');
 const endpoint=base.origin;
 async function call(path,{method='GET',body,mime,representation=false,binary=false}={}){
  let response;
  try{response=await fetchImpl(endpoint+path,{method,headers:{apikey:key,Authorization:`Bearer ${key}`,...(body?{'Content-Type':mime||'application/json'}:{}),...(representation?{Prefer:'return=representation'}:{})},body,signal:AbortSignal.timeout(15000)});}catch{throw unavailable();}
  if(!response.ok)throw unavailable();
  if(binary)return Buffer.from(await response.arrayBuffer());
  if(response.status===204)return null;
  const raw=await response.text();return raw?JSON.parse(raw):null;
 }
 function unavailable(){return Object.assign(new Error('خدمة حفظ الطلبات غير متاحة مؤقتًا. حاول لاحقًا.'),{status:503});}
 function query(filters){return '/rest/v1/requests?'+new URLSearchParams(filters);}
 const object=id=>'/storage/v1/object/softtv-attachments/'+encodeURIComponent(id);
 return {
  mode:'supabase',
  async health(){await call(query({select:'id',limit:'1'}));},
  async list(){return await call(query({select:'*',order:'created.desc',limit:'1000'}));},
  async insert(row){await call('/rest/v1/requests',{method:'POST',body:JSON.stringify(row)});},
  async update(id,status,reply){const rows=await call(query({id:'eq.'+id,select:'id'}),{method:'PATCH',body:JSON.stringify({status,reply}),representation:true});return rows.length>0;},
  async track(id,token){const rows=await call(query({id:'eq.'+id,token:'eq.'+token,select:'*',limit:'1'}));return rows[0];},
  async attachment(id){const rows=await call(query({attachment:'eq.'+id,select:'mime',limit:'1'}));return rows[0];},
  async put(id,buffer,mime){await call(object(id),{method:'POST',body:buffer,mime});},
  async get(id){return await call('/storage/v1/object/authenticated/softtv-attachments/'+encodeURIComponent(id),{binary:true});},
  async remove(id){await call(object(id),{method:'DELETE'});},
  close(){}
 };
}
