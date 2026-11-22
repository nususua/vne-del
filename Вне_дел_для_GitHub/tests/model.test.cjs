const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({});
for(const file of ['catalog.js','model.js'])vm.runInContext(readFileSync(join(__dirname,'..',file),'utf8'),context);
const {VnedelCatalog:catalog,VnedelModel:model} = context;
const json = value=>JSON.parse(JSON.stringify(value));
test('malformed local data recovers without a trusted session',()=>{
 const state=model.normalizeState({session:{userId:'attacker'},people:null,posts:[null,{}]});
 assert.equal(state.session,null);assert.equal(state.posts.length,0);assert.deepEqual(json(state.people.anna.saved),[]);
});
test('cloud accounts preserve their private board independently',()=>{
 const first='12345678-1234-1234-1234-123456789012',second='12345678-1234-1234-1234-123456789013';
 catalog.profiles[first]={name:'Первый',city:'',bio:''};catalog.profiles[second]={name:'Второй',city:'',bio:''};
 const state=model.normalizeState({session:{userId:first},people:{[first]:{interests:['Пение'],saved:[15],statuses:{15:'В процессе'},notes:{15:'Спеть куплет'}},[second]:{saved:[1]}}});
 assert.equal(state.activeProfile,first);assert.deepEqual(json(state.people[first].saved),[15]);assert.deepEqual(json(state.people[second].saved),[1]);assert.equal(state.people[first].notes[15],'Спеть куплет');
});
test('unknown interests, deleted ideas and duplicate saves are removed',()=>{
 const state=model.normalizeState({interests:['Пение','unknown','Пение'],saved:[15,15,999],statuses:{15:'bad'}});
 assert.deepEqual(json(state.people.anna.interests),['Пение']);assert.deepEqual(json(state.people.anna.saved),[15]);assert.equal(state.people.anna.statuses[15],'Хочу попробовать');
});
test('search ignores letter case and е/ё while respecting budget and location',()=>{
 const filters={category:'all',group:'all',format:'all',budget:'free',location:'home',duration:'30',status:'all',search:'ШИТЬЕ'};
 const idea={id:1,title:'Шитьё',category:'Шитьё',author:'Анна',city:'Москва',format:'home',price:0,duration:20};
 assert.equal(model.matchesIdea(idea,filters,{interests:['Шитьё']},'feed'),true);
 assert.equal(model.matchesIdea({...idea,price:100},filters,{interests:['Шитьё']},'feed'),false);
});
test('post author cannot be forged with a supplied display name',()=>{
 const post={id:'post-test',category:'Пение',authorId:'anna',author:'Чужое имя',title:'Песня',description:'Попробовать',price:0};
 const state=model.normalizeState({posts:[post,{...post,id:'post-bad',authorId:'missing'}]});
 assert.equal(state.posts.length,1);assert.equal(state.posts[0].author,'Анна');
});
test('community keeps publications beyond the former global fifty-item cap',()=>{
 const posts=Array.from({length:70},(_,i)=>({id:`post-item-${i}`,category:'Пение',authorId:i%2?'anna':'sonya',title:`Идея ${i}`,description:'Первый шаг',price:0}));
 const state=model.normalizeState({posts});assert.equal(state.posts.length,70);
});
test('sorting supports quick and affordable choices without mutating the feed',()=>{
 const ideas=[{id:1,title:'Б',duration:40,price:100},{id:2,title:'А',duration:20,price:100},{id:3,title:'В',duration:60,price:0}];
 assert.deepEqual(json(model.sortIdeas(ideas,'short')).map(x=>x.id),[2,1,3]);
 assert.deepEqual(json(model.sortIdeas(ideas,'budget')).map(x=>x.id),[3,2,1]);
 assert.deepEqual(json(model.sortIdeas(ideas,'title')).map(x=>x.id),[2,1,3]);
 assert.deepEqual(ideas.map(x=>x.id),[1,2,3]);
});
