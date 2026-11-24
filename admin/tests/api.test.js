const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');
function client(response) {
  const store = new Map(); let request;
  const context = { exports: {}, process: {env:{}}, window: {location: {pathname:'/', href:''}}, localStorage: {getItem:k=>store.get(k)||null, setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)}, fetch:async (url,options)=>{ request={url,options}; return {...response,json:async()=>response.body}; }};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/api.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
  return {api:context.exports,context,request:()=>request};
}
test('same-origin request includes bearer and unwraps data',async()=>{
 const c=client({ok:true,status:200,body:{success:true,data:{count:3}}});
 c.api.setToken('test-token'); assert.equal((await c.api.apiGet('/api/admin/dashboard')).count,3);
 assert.equal(c.request().url,'/api/admin/dashboard'); assert.equal(c.request().options.headers.Authorization,'Bearer test-token');
});
test('401 clears session and redirects',async()=>{
 const c=client({ok:false,status:401,body:{success:false,error:{message:'Expired'}}}); c.api.setToken('expired');
 await assert.rejects(c.api.apiGet('/api/admin/users'),/Expired/);assert.equal(c.api.getToken(),null);assert.equal(c.context.window.location.href,'/login');
});
test('write uses JSON and backend error is surfaced',async()=>{
 const c=client({ok:false,status:403,body:{success:false,error:{message:'Forbidden'}}});
 await assert.rejects(c.api.apiPost('/api/providers',{apiKey:'write-only'}),/Forbidden/);
 assert.equal(c.request().options.method,'POST');assert.equal(JSON.parse(c.request().options.body).apiKey,'write-only');
});

/* ── Animeku provider management helpers ─────────────────────────────── */
test('animeku details link travels as an encoded query parameter',async()=>{
 const c=client({ok:true,status:200,body:{success:true,data:{anime:{},episodes:[],episodeOrder:{reversed:false,numberSource:'episode'},playback:'not_authorized'}}});
 c.api.setToken('admin-token');
 await c.api.animekuDetails('?anime/naruto');
 assert.equal(c.request().url,'/api/anime/details?link=%3Fanime%2Fnaruto');
});
test('animeku catalog builds kind, paging and type filters',async()=>{
 const c=client({ok:true,status:200,body:{success:true,data:{kind:'ongoing',page:2,total:40,items:[]}}});
 assert.deepEqual(await c.api.animekuCatalog('ongoing',2,12,'TV Series'),{kind:'ongoing',page:2,total:40,items:[]});
 assert.equal(c.request().url,'/api/anime/ongoing?page=2&limit=12&type=TV%20Series');
 await c.api.animekuCatalog('popular');
 assert.equal(c.request().url,'/api/anime/popular?page=1&limit=20');
});
test('animeku stream probe reduces an authorized answer to a source count',async()=>{
 const c=client({ok:true,status:200,body:{success:true,data:{streamUrl:'https://cdn.example.test/hls/abc.m3u8',alternativeLinks:['https://mirror.example.test/1','https://mirror.example.test/2'],temporary:true}}});
 const probe=await c.api.animekuStreamProbe('anime-1','episode-1');
 assert.equal(probe.authorized,true); assert.equal(probe.code,'AUTHORIZED');
 assert.equal(probe.sourceCount,3); assert.equal(probe.temporary,true);
 assert.equal(c.request().url,'/api/anime/anime-1/episodes/episode-1/stream');
 // No temporary media URL may survive into the dashboard payload.
 assert.equal(/example\.test|m3u8|https?:/.test(JSON.stringify(probe)),false);
});
test('animeku stream probe reports an unauthorized deployment as expected, not broken',async()=>{
 const c=client({ok:false,status:403,body:{success:false,error:{code:'STREAM_NOT_AUTHORIZED',message:'Anime playback is not authorized on this deployment'}}});
 const probe=await c.api.animekuStreamProbe('anime-1','episode-1');
 assert.equal(probe.authorized,false); assert.equal(probe.code,'STREAM_NOT_AUTHORIZED');
 assert.equal(probe.sourceCount,0); assert.match(probe.message,/not authorized/);
});
test('persisted episode audit counts stored media urls',()=>{
 const c=client({ok:true,status:200,body:{success:true,data:[]}});
 assert.equal(c.api.persistedMediaUrlCount([{_id:'a',streamUrl:''},{_id:'b'},{_id:'c',streamUrl:'   '},{_id:'d',streamUrl:'https://cdn/x.mp4'}]),1);
});
test('animeku provider record is selected by type and patched by id',async()=>{
 const c=client({ok:true,status:200,body:{success:true,data:[
  {_id:'p1',providerId:'jikan',name:'Jikan',type:'anime_metadata',enabled:true},
  {_id:'p2',providerId:'animasu',name:'Animasu (Animeku catalog)',type:'animeku',enabled:true,cacheTtlSec:300}]}});
 const record=await c.api.animekuProviderRecord();
 assert.equal(record._id,'p2'); assert.equal(record.cacheTtlSec,300);
});
test('updateProvider sends a partial PATCH',async()=>{
 const c=client({ok:true,status:200,body:{success:true,data:{_id:'p2',enabled:false}}});
 await c.api.updateProvider('p2',{enabled:false,cacheTtlSec:600});
 assert.equal(c.request().options.method,'PATCH');
 assert.deepEqual(JSON.parse(c.request().options.body),{enabled:false,cacheTtlSec:600});
 assert.equal(c.request().url,'/api/providers/p2');
});
test('ApiRequestError carries the backend code and status',async()=>{
 const c=client({ok:false,status:503,body:{success:false,error:{code:'PROVIDER_DISABLED',message:'Animeku is disabled'}}});
 await assert.rejects(c.api.animekuStatus(),(error)=>error instanceof c.api.ApiRequestError&&error.code==='PROVIDER_DISABLED'&&error.status===503);
});
