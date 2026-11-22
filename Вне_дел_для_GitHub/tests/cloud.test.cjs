const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const code=readFileSync(join(__dirname,'..','cloud.js'),'utf8');
function setup(fetch,stored=null,config={supabaseUrl:'https://testproject.supabase.co',publishableKey:'sb_publishable_test'}){
 const storage=new Map(stored?[['vnedel-cloud-session-v1',JSON.stringify(stored)]]:[]);
 const context=vm.createContext({VNEDEL_CONFIG:config,fetch,AbortSignal,URLSearchParams,Date,
  location:{hash:'',origin:'http://127.0.0.1:5174',pathname:'/'},
  localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}});
 vm.runInContext(code,context);return {api:context.VnedelCloud,storage};
}
const response=(body,status=200)=>({status,ok:status<400,json:async()=>body});
const session={access_token:'test-access',refresh_token:'test-refresh',expires_at:Date.now()/1000+3600};
test('missing setup does not claim to send a message',async()=>{
 let calls=0;const {api}=setup(async()=>{calls++;},{},{});
 await assert.rejects(api.sendCode('person@example.com'),/не настроен/);assert.equal(calls,0);
});
test('a failed email request is not automatically sent twice',async()=>{
 let calls=0;const {api}=setup(async()=>{calls++;throw new TypeError('network');});
 await assert.rejects(api.sendCode('person@example.com'),/соединиться/);assert.equal(calls,1);
});
test('email service rate limit has a specific explanation',async()=>{
 const {api}=setup(async()=>response({code:'over_email_send_rate_limit'},429));
 await assert.rejects(api.sendCode('person@example.com'),/лимит почтового сервиса/);
});
test('concurrent actions refresh an expired session once',async()=>{
 let refreshes=0;const {api}=setup(async(url)=>{
  if(url.includes('grant_type=refresh_token')){refreshes++;return response({...session,expires_in:3600});}
  return response({id:'verified-user'});
 },{...session,expires_at:0});
 const users=await Promise.all([api.currentUser(),api.currentUser()]);
 assert.equal(refreshes,1);assert.equal(users[0].id,'verified-user');assert.equal(users[1].id,'verified-user');
});
test('private board ownership comes from the verified user',async()=>{
 let written;
 const {api}=setup(async(url,options)=>{
  if(url.endsWith('/auth/v1/user'))return response({id:'verified-owner'});
  written=JSON.parse(options.body);return response(null,204);
 },session);
 await api.saveBoard({saved:[15],user_id:'forged-owner'});
 assert.equal(written.user_id,'verified-owner');
});
test('local credentials are removed even when sign out cannot reach the server',async()=>{
 const {api,storage}=setup(async()=>{throw new TypeError('network');},session);
 await assert.rejects(api.signOut(),/соединиться/);assert.equal(storage.has('vnedel-cloud-session-v1'),false);
});
