/* Автономный прототип авторизации для ИДЗ1. Это не защита персональных данных. */
(() => {
  'use strict';
  const remote = globalThis.VnedelCloud;
  globalThis.VnedelRemote = remote;
  if (new URLSearchParams(location.search).get('mode') === 'cloud') return;
  const KEY = 'vnedel-local-database-v1';
  const initialProfiles = [
    {id:'anna',name:'Анна',city:'Москва',bio:'Люблю шитьё, керамику и маленькие проекты для себя.'},
    {id:'sonya',name:'Соня',city:'Санкт-Петербург',bio:'Пою, гуляю с камерой и пробую новое без спешки.'},
    {id:'33333333-3333-4333-8333-333333333333',name:'Миша',city:'Казань',bio:'Нахожу время для гитары, велосипеда и настольных игр.'}
  ];
  function read() {
    let raw;
    try {raw=JSON.parse(localStorage.getItem(KEY)||'null');}
    catch {raw=null;}
    if(!raw||typeof raw!=='object'||Array.isArray(raw))raw={};
    const profiles=initialProfiles.map(profile=>{
      const saved=Array.isArray(raw.profiles)?raw.profiles.find(value=>value?.id===profile.id):null;
      return {...profile,...(saved?{name:String(saved.name||profile.name).trim().slice(0,60)||profile.name,city:String(saved.city||'').slice(0,50),bio:String(saved.bio||'').slice(0,500)}:{})};
    });
    return {version:1,activeUser:profiles.some(p=>p.id===raw.activeUser)?raw.activeUser:null,profiles,
      boards:raw.boards&&typeof raw.boards==='object'&&!Array.isArray(raw.boards)?raw.boards:{},
      posts:Array.isArray(raw.posts)?raw.posts.filter(row=>row&&profiles.some(p=>p.id===row.user_id)&&row.data&&row.data.id===row.id).slice(0,500):[],
      messages:Array.isArray(raw.messages)?raw.messages.filter(row=>row&&profiles.some(p=>p.id===row.user_id)&&['idea','wall'].includes(row.kind)&&typeof row.body==='string').slice(-1000):[]};
  }
  function write(data) {
    try{localStorage.setItem(KEY,JSON.stringify(data));}
    catch{throw new Error('Не удалось сохранить данные в браузере. Проверь разрешение на хранение и свободное место.');}
  }
  function owner(data){if(!data.activeUser)throw new Error('Сначала войди в профиль.');return data.activeUser;}
  async function currentUser(){const data=read();return data.activeUser?{id:data.activeUser}:null;}
  async function signIn(userId,code){
    const data=read();
    if(!data.profiles.some(profile=>profile.id===userId)||code!=='1234')throw new Error('Для локального входа введи код 1234.');
    data.activeUser=userId;write(data);return {id:userId};
  }
  async function signOut(){const data=read();data.activeUser=null;write(data);}
  async function load(){
    const data=read();
    return {user:data.activeUser?{id:data.activeUser}:null,profiles:data.profiles,posts:data.posts,messages:data.messages,board:data.activeUser?data.boards[data.activeUser]||null:null};
  }
  async function saveProfile(profile){
    const data=read(),id=owner(data),target=data.profiles.find(value=>value.id===id);
    const name=String(profile.name||'').trim().slice(0,60);if(!name)throw new Error('Укажи имя.');
    Object.assign(target,{name,city:String(profile.city||'').slice(0,50),bio:String(profile.bio||'').slice(0,500)});write(data);
  }
  async function saveBoard(board){const data=read();data.boards[owner(data)]=structuredClone(board);write(data);}
  async function savePost(post){
    const data=read(),userId=owner(data);
    if(post.authorId!==userId)throw new Error('Эту идею может менять только автор.');
    const index=data.posts.findIndex(row=>row.id===post.id);
    if(index>=0&&data.posts[index].user_id!==userId)throw new Error('Эту идею может менять только автор.');
    if(index<0&&data.posts.filter(row=>row.user_id===userId).length>=50)throw new Error('Можно разместить до 50 своих идей.');
    const row={id:post.id,user_id:userId,data:structuredClone(post)};
    if(index<0)data.posts.push(row);else data.posts[index]=row;write(data);
  }
  async function addMessage(kind,targetId,text){
    const data=read(),id=owner(data),body=String(text||'').trim().slice(0,300);
    if(!body||!['idea','wall'].includes(kind))throw new Error('Напиши текст сообщения.');
    const row={id:crypto.randomUUID(),user_id:id,kind,target_id:String(targetId),body};
    data.messages.push(row);data.messages=data.messages.slice(-1000);write(data);return [row];
  }
  globalThis.VnedelCloud={configured:true,local:true,callbackError:'',profiles:initialProfiles,signIn,currentUser,signOut,load,saveProfile,saveBoard,savePost,addMessage};
})();
