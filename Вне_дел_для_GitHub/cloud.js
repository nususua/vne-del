/* Только публичный ключ. Проверку личности и доступ к строкам выполняет сервер. */
(() => {
 'use strict';
 const config = globalThis.VNEDEL_CONFIG || {};
 const base = String(config.supabaseUrl || '').replace(/\/$/, '');
 const key = String(config.publishableKey || '');
 const sessionKey = 'vnedel-cloud-session-v1';
 let session = null;
 let refreshTask = null;
 const configured = /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base) && !!key && !key.startsWith('sb_secret_');
 try { session = JSON.parse(localStorage.getItem(sessionKey) || 'null'); } catch { /* Новая сессия. */ }
 const saveSession = value => {
  session = value;
  try { if(value) localStorage.setItem(sessionKey, JSON.stringify(value)); else localStorage.removeItem(sessionKey); }
  catch { throw new Error('Не удалось сохранить вход. Разреши хранение данных для этого сайта.'); }
 };
 async function request(path, {method = 'GET', body, authorized = false, prefer} = {}) {
  if (!configured) throw new Error('Вход по почте пока не настроен.');
  if (authorized) await validSession();
  const headers = {'apikey':key, 'Content-Type':'application/json'};
  if (authorized) headers.Authorization = `Bearer ${session.access_token}`;
  if (prefer) headers.Prefer = prefer;
  let response;
  try { response = await fetch(`${base}${path}`, {method, headers, body:body === undefined ? undefined : JSON.stringify(body), signal:AbortSignal.timeout(path.startsWith('/auth/v1/otp') ? 90000 : 45000)}); }
  catch (error) {
   if(error.name==='TimeoutError')throw new Error(path.startsWith('/auth/v1/otp')?'Сервер долго отвечает. Письмо могло уже отправиться — сначала проверь почту, прежде чем повторять запрос.':'Сервер долго отвечает. Попробуй обновить данные немного позже.');
   throw new Error('Не удалось соединиться с сервером. Проверь интернет и повтори попытку.');
  }
  const result = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
   const code = result?.error_code || result?.code;
   if (response.status === 429) throw new Error(code==='over_email_send_rate_limit'?'Достигнут лимит почтового сервиса. Проверь последнее письмо или попробуй позже.':'Слишком много запросов. Подожди минуту перед повторной отправкой.');
   if (code === 'email_address_not_authorized') throw new Error('Отправка на этот адрес пока недоступна. Нужно настроить почтовый сервис.');
   if (code === 'otp_expired' || code === 'invalid_credentials') throw new Error('Код неверный или устарел. Запроси новое письмо.');
   if (response.status === 401) throw new Error('Сеанс истёк. Войди по почте ещё раз.');
   throw new Error('Не удалось выполнить действие. Попробуй ещё раз.');
  }
  return result;
 }
 // Ссылка из письма возвращает сеанс во фрагменте URL. Удаляем токены из адресной строки.
 let callbackError = '';
 if (typeof location !== 'undefined' && location.hash.includes('access_token=')) {
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.get('access_token') && params.get('refresh_token')) {
   saveSession({access_token:params.get('access_token'),refresh_token:params.get('refresh_token'),expires_at:Date.now()/1000 + Number(params.get('expires_in') || 3600)});
   history.replaceState(null,'',location.pathname + location.search);
  }
 } else if (typeof location !== 'undefined' && location.hash.includes('error=')) {
  callbackError='Ссылка устарела или уже использована. Запроси новое письмо.';
  history.replaceState(null,'',location.pathname + location.search);
 }
 async function validSession() {
  if (!session?.refresh_token) throw new Error('Сначала войди по почте.');
  if (Number(session.expires_at) > Date.now()/1000 + 90) return session;
  if (!refreshTask) refreshTask = request('/auth/v1/token?grant_type=refresh_token', {method:'POST',body:{refresh_token:session.refresh_token}})
   .then(value => {saveSession({...value,expires_at:Date.now()/1000 + value.expires_in});return session;})
   .finally(() => {refreshTask=null;});
  return refreshTask;
 }
 async function sendCode(email) {
  return request(`/auth/v1/otp?redirect_to=${encodeURIComponent(location.origin + location.pathname + '?mode=cloud')}`, {method:'POST',body:{email,create_user:true}});
 }
 async function verifyCode(email, token) {
  const value = await request('/auth/v1/verify', {method:'POST',body:{email,token,type:'email'}});
  saveSession({...value,expires_at:Date.now()/1000 + value.expires_in});
  return value.user;
 }
 async function currentUser() {
  if (!configured || !session) return null;
  await validSession();
  return request('/auth/v1/user', {authorized:true});
 }
 async function signOut() {
  try { if (session) await request('/auth/v1/logout', {method:'POST',authorized:true}); }
  finally {saveSession(null);}
 }
 async function load() {
  const user = await currentUser();
  const [profiles,posts,messages,boards] = await Promise.all([
   request('/rest/v1/profiles?select=*'),
   request('/rest/v1/posts?select=*&order=created_at.asc&limit=500'),
   request('/rest/v1/messages?select=*&order=created_at.asc&limit=1000'),
   user ? request(`/rest/v1/boards?user_id=eq.${user.id}&select=*`,{authorized:true}) : []
  ]);
  return {user,profiles,posts,messages,board:boards[0]?.data || null};
 }
 async function upsert(table, value) {
  return request(`/rest/v1/${table}`,{method:'POST',body:value,authorized:true,prefer:'resolution=merge-duplicates,return=minimal'});
 }
 async function saveProfile(profile) {
  const user = await currentUser();
  if (!user) throw new Error('Сначала войди по почте.');
  return upsert('profiles',{id:user.id,name:profile.name,city:profile.city || '',bio:profile.bio || ''});
 }
 async function saveBoard(board) {
  const user = await currentUser();
  if (!user) throw new Error('Сначала войди по почте.');
  return upsert('boards',{user_id:user.id,data:board,updated_at:new Date().toISOString()});
 }
 async function savePost(post) {
  const user = await currentUser();
  if (!user || post.authorId !== user.id) throw new Error('Эту идею может менять только автор.');
  return upsert('posts',{id:post.id,user_id:user.id,data:post});
 }
 async function addMessage(kind,targetId,text) {
  const user = await currentUser();
  if (!user) throw new Error('Сначала войди по почте.');
  return request('/rest/v1/messages',{method:'POST',authorized:true,body:{user_id:user.id,kind,target_id:String(targetId),body:text},prefer:'return=representation'});
 }
 if (typeof addEventListener === 'function') addEventListener('storage',event=>{
  if(event.key!==sessionKey)return;
  try{session=JSON.parse(event.newValue || 'null');}catch{session=null;}
  dispatchEvent(new CustomEvent('vnedel:auth-changed'));
 });
 globalThis.VnedelCloud = {configured,callbackError,sendCode,verifyCode,currentUser,signOut,load,saveProfile,saveBoard,savePost,addMessage};
})();
