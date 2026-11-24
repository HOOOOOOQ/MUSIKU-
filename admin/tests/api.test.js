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
