const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const vm=require('node:vm');
const {randomUUID}=require('node:crypto');
const source=readFileSync(join(__dirname,'..','local.js'),'utf8');
function open(storage=new Map(),failWrite=false){
 const context=vm.createContext({location:{search:''},URLSearchParams,structuredClone,crypto:{randomUUID},VnedelCloud:{remote:true},
 localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>{if(failWrite)throw new Error('quota');storage.set(key,value);}}});
 vm.runInContext(source,context);return {api:context.VnedelCloud,storage};
}
test('incorrect local code never opens a session',async()=>{
 const {api}=open();await assert.rejects(api.signIn('anna','0000'),/1234/);assert.equal(await api.currentUser(),null);
});
test('board, status, note and session survive a new application instance',async()=>{
 const {api,storage}=open();await api.signIn('anna','1234');
 await api.saveBoard({interests:['Пение'],saved:[15],statuses:{15:'В процессе'},notes:{15:'Спеть куплет'}});
 const restarted=open(storage).api,data=await restarted.load();
 assert.equal(data.user.id,'anna');assert.equal(data.board.notes[15],'Спеть куплет');assert.equal(data.board.statuses[15],'В процессе');
});
test('sign out preserves boards while another profile has a separate board',async()=>{
 const {api}=open();await api.signIn('anna','1234');await api.saveBoard({saved:[15]});await api.signOut();
 assert.equal(await api.currentUser(),null);await api.signIn('sonya','1234');assert.equal((await api.load()).board,null);
 await api.saveBoard({saved:[1]});await api.signIn('anna','1234');assert.equal(JSON.stringify((await api.load()).board.saved),'[15]');
});
test('a publication is shared and another profile cannot replace it',async()=>{
 const {api}=open();await api.signIn('anna','1234');
 const post={id:'post-test',authorId:'anna',title:'Песня',description:'Первый шаг'};await api.savePost(post);
 await api.signIn('sonya','1234');assert.equal((await api.load()).posts[0].data.title,'Песня');
 await assert.rejects(api.savePost({...post,authorId:'sonya',title:'Подмена'}),/только автор/);
});
test('messages and profile edits persist without sending any email',async()=>{
 const {api,storage}=open();await api.signIn('sonya','1234');await api.saveProfile({name:'Соня',city:'Казань',bio:'Пою'});
 await api.addMessage('idea',15,'Попробовала!');const data=await open(storage).api.load();
 assert.equal(data.profiles.find(p=>p.id==='sonya').city,'Казань');assert.equal(data.messages[0].body,'Попробовала!');
});
test('storage failure is reported rather than confirming a successful sign in',async()=>{
 const {api}=open(new Map(),true);await assert.rejects(api.signIn('anna','1234'),/Не удалось сохранить/);
});
