/* Вне дел. Интерфейс локального прототипа; запуск без сборки. */
(() => {
  'use strict';
  const {interestGroups, categories, seedIdeas, profiles, starterGuides, coverOptions, imageFor} = VnedelCatalog;
  const {statuses, STORAGE_KEY, durationMinutes, normalizeState, matchesIdea, sortIdeas} = VnedelModel;
  const $ = id => document.getElementById(id);
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const filters = {category:'all', group:'all', format:'all', budget:'all', location:'all', duration:'all', status:'all', search:'', sort:'all'};
  const filterIds = {group:'groupFilter', format:'format', budget:'budget', location:'location', duration:'duration', status:'boardStatus', search:'search', sort:'sortOrder'};
  let storageWarning = '';
  let raw = {};
  try { raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
  catch (error) { storageWarning = error instanceof SyntaxError ? 'Сохранение повреждено. Открыта новая сессия.' : 'Хранилище браузера недоступно. Изменения останутся до перезагрузки.'; }
  // Локальная отметка входа не подтверждает личность. Сеанс проверяется сервером.
  if(!raw||typeof raw!=='object'||Array.isArray(raw))raw={};
  raw.session = null;
  const state = normalizeState(raw);
  const cloud = VnedelCloud;
  if(cloud.local){
    $('localLoginFields').hidden=false;$('cloudLoginFields').hidden=true;
    $('loginEmail').required=false;$('localCode').required=true;
    $('loginSubmit').textContent='Войти';
    $('storageAbout').textContent='Локальный режим: профили имитируются, все доски, идеи и записи хранятся в этом браузере. Другой профиль здесь увидит общую ленту, другой компьютер — нет. Это не настоящая защита данных. Личные пароли вводить не нужно.';
  }
  let cloudReady = false;
  let syncQueue = Promise.resolve();
  let syncRevision = 0;
  let syncError = '';
  const remotePostHashes = new Map();
  let sentToEmail = '';
  const sessionValue=(key,fallback='')=>{try{return sessionStorage.getItem(key)||fallback;}catch{return fallback;}};
  const setSessionValue=(key,value)=>{try{sessionStorage.setItem(key,value);}catch{/* Вход всё равно проверит сервер. */}};
  let lastCodeAt = Number(sessionValue('vnedel-last-email-request','0'));
  let currentView = 'community';
  let selectedInterests = [];
  let currentIdea = null;
  let currentAuthor = null;
  let editingId = null;
  let returnToDetail = false;
  let switchingModal = false;
  let changingAccount = false;
  let interestTrigger = null;
  const commentDrafts = new Map();
  const wallDrafts = new Map();
  const noteDrafts = new Map();
  const modals = Object.fromEntries(['interest','detail','author','publish','login'].map(name => [name, new bootstrap.Modal($(`${name}Modal`))]));
  const toast = new bootstrap.Toast($('notice'), {delay:7000});
  const person = () => state.people[state.activeProfile];
  const featured = [23,27,15,9,24,25,26,2];
  const curatedIdeas = [...seedIdeas].sort((a,b)=>(featured.includes(a.id)?featured.indexOf(a.id):100+a.id)-(featured.includes(b.id)?featured.indexOf(b.id):100+b.id));
  const allIdeas = () => [...state.posts].reverse().concat(curatedIdeas);
  const findIdea = id => allIdeas().find(idea => String(idea.id) === String(id));
  const draftKey = id => `${state.activeProfile}:${id}`;
  const priceText = idea => idea.price ? `${idea.price.toLocaleString('ru')} ₽` : 'Без затрат';
  const locationText = idea => idea.format === 'home' ? 'Дома · любой город' : idea.city;

  function notify(message, action = null) {
    $('noticeText').textContent = message;
    $('noticeAction').hidden=!action;
    $('noticeAction').onclick=action?()=>{toast.hide();action();}:null;
    toast.show();
  }
  function persist(successMessage) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch { notify('Не удалось сохранить изменения на этом устройстве.'); }
    if (!state.session || !cloudReady) return true;
    const userId = state.activeProfile;
    const revision=++syncRevision;
    const board = structuredClone(person());
    const posts = structuredClone(state.posts.filter(post=>post.authorId===userId));
    $('syncStatus').textContent = 'Сохраняем…';
    syncQueue = syncQueue.catch(()=>{}).then(async()=>{
      if (state.activeProfile !== userId || !state.session) return;
      try {
        await cloud.saveBoard(board);
        for (const post of posts) {
          const hash=JSON.stringify(post);
          if(remotePostHashes.get(post.id)!==hash){await cloud.savePost(post);remotePostHashes.set(post.id,hash);}
        }
        syncError='';
        if(revision===syncRevision)$('syncStatus').textContent = 'Всё сохранено';
        if (successMessage) notify(successMessage);
      } catch (error) {
        syncError=error.message;
        if(revision===syncRevision)$('syncStatus').textContent = 'Не сохранено · повторить';
        notify(`${error.message} Не перезагружай страницу; нажми «повторить», чтобы сохранить изменения.`);
      }
    });
    return true;
  }
  function requireLogin() {
    if (state.session && cloudReady) return true;
    for (const name of ['detail','author','publish']) {
      if ($(`${name}Modal`).classList.contains('show')) { switchModal(name,'login'); return false; }
    }
    showLogin(); return false;
  }
  async function loadCloud(user = null, name = '') {
    let data = await cloud.load();
    user ||= data.user;
    if (user && !data.profiles.some(profile=>profile.id===user.id)) {
      name = name.trim() || sessionValue('vnedel-pending-name') || 'Участник';
      await cloud.saveProfile({name:name.trim().slice(0,60),city:'',bio:'Здесь начинается история нового увлечения.'});
      data = await cloud.load();
    }
    for (const profile of data.profiles) profiles[profile.id] = {name:profile.name,city:profile.city,bio:profile.bio};
    const comments = {}, walls = {};
    for (const message of data.messages) {
      const target = message.kind==='idea' ? comments : walls;
      (target[message.target_id] ||= []).push({authorId:message.user_id,text:message.body});
    }
    const next = normalizeState({theme:state.theme,session:user?{userId:user.id}:null,
      posts:data.posts.map(row=>({...row.data,authorId:row.user_id})),comments,walls,
      people:user?{[user.id]:data.board || {}}:{}});
    Object.assign(state,next);
    remotePostHashes.clear();for(const post of state.posts)remotePostHashes.set(post.id,JSON.stringify(post));
    cloudReady = true;
    render();
    $('syncStatus').textContent = user ? 'Всё сохранено' : 'Войди, чтобы сохранить своё';
  }

  function applyTheme() {
    document.documentElement.dataset.theme = state.theme;
    document.documentElement.dataset.bsTheme = state.theme;
    const dark = state.theme === 'dark';
    $('themeToggle').innerHTML = `<span aria-hidden="true">${dark ? '☀' : '☾'}</span>`;
    $('themeToggle').setAttribute('aria-label', dark ? 'Включить светлую тему' : 'Включить тёмную тему');
    $('themeToggle').setAttribute('aria-pressed', String(dark));
    $('themeToggle').title = dark ? 'Светлая тема' : 'Тёмная тема';
    document.querySelector('meta[name="theme-color"]').content = dark ? '#101010' : '#f8f7f3';
  }

  function syncFilterControls() {
    for (const [key,id] of Object.entries(filterIds)) $(id).value = filters[key];
  }
  function resetFilters() {
    for (const key of Object.keys(filters)) filters[key] = key === 'search' ? '' : 'all';
    syncFilterControls();
  }
  function setView(view) {
    if(['board','feed'].includes(view)&&!state.session){showLogin();return;}
    currentView = view;
    resetFilters();
    render();
  }
  function focusCard(id) {
    const button = [...document.querySelectorAll('#cardGrid [data-open]')].find(el => el.dataset.open === String(id));
    (button || $('discovery')).focus({preventScroll:true});
  }
  function switchModal(from, to, setup) {
    switchingModal = true;
    $(`${from}Modal`).addEventListener('hidden.bs.modal', () => {
      setup?.();
      modals[to].show();
      switchingModal = false;
    }, {once:true});
    modals[from].hide();
  }

  function renderChoices() {
    const focused = document.activeElement?.dataset.interest;
    $('interestChoices').innerHTML = Object.entries(interestGroups).map(([group,names],index) => `
      <fieldset class="interest-group"><legend><span class="group-index">0${index+1}</span>${group}</legend>
        <div>${names.map(name => `<button type="button" class="interest-choice ${selectedInterests.includes(name)?'selected':''}" data-interest="${name}" aria-pressed="${selectedInterests.includes(name)}"><span class="choice-mark" aria-hidden="true">${selectedInterests.includes(name)?'✓':'+'}</span>${name}</button>`).join('')}</div>
      </fieldset>`).join('');
    $('applyInterests').disabled = !selectedInterests.length;
    $('selectedCount').textContent = selectedInterests.length ? `Выбрано направлений: ${selectedInterests.length}` : 'Можно начать с одного интереса';
    $('interestClose').hidden = !person().interests.length;
    if (focused) [...$('interestChoices').querySelectorAll('button')].find(button => button.dataset.interest === focused)?.focus({preventScroll:true});
  }
  function openInterests(trigger = $('editInterests')) {
    if (!requireLogin()) return;
    interestTrigger = trigger;
    selectedInterests = [...person().interests];
    renderChoices();
    modals.interest.show();
  }

  function authorLink(idea) {
    return `<button type="button" class="author-link" data-author="${escapeHTML(idea.authorId)}" aria-label="Открыть страницу: ${escapeHTML(idea.author)}"><span class="author-dot" aria-hidden="true">${escapeHTML(idea.author[0])}</span><span>${escapeHTML(idea.author)}</span><span aria-hidden="true">↗</span></button>`;
  }
  function cardHTML(idea) {
    const saved = person().saved.includes(idea.id);
    const status = person().statuses[idea.id] || statuses[0];
    return `<article class="idea-card">
      <div class="card-media"><button type="button" class="card-image-button" data-open="${escapeHTML(idea.id)}" aria-label="Открыть идею: ${escapeHTML(idea.title)}"><img src="${escapeHTML(idea.image)}" alt="${escapeHTML(idea.title)}" loading="lazy" decoding="async"></button><span class="photo-label">${idea.format==='home'?'Дома':'Вне дома'} · ${priceText(idea)}</span><button type="button" class="save-mini ${saved?'saved':''}" data-save="${escapeHTML(idea.id)}" aria-label="${saved?'Убрать с доски':'Сохранить на доску'}: ${escapeHTML(idea.title)}" aria-pressed="${saved}">${saved?'✓':'+'}</button></div>
      <div class="card-content"><p class="card-category">${escapeHTML(idea.category)}<span>${durationMinutes(idea)} мин</span></p><h3><button type="button" class="card-title" data-open="${escapeHTML(idea.id)}">${escapeHTML(idea.title)}</button></h3>${authorLink(idea)}<p class="card-location"><span aria-hidden="true">⌖</span> ${escapeHTML(locationText(idea))}</p>
      ${currentView==='board'?`<label class="visually-hidden" for="status-${escapeHTML(idea.id)}">Статус идеи ${escapeHTML(idea.title)}</label><select class="status-select form-select" id="status-${escapeHTML(idea.id)}" data-status="${escapeHTML(idea.id)}">${statuses.map(value=>`<option ${status===value?'selected':''}>${value}</option>`).join('')}</select>${person().notes[idea.id]?`<p class="card-note">${escapeHTML(person().notes[idea.id])}</p>`:''}`:''}</div>
    </article>`;
  }

  function render() {
    const p = person();
    document.body.dataset.view=currentView;
    const activeFilterCount=Object.entries(filters).filter(([key,value])=>!['sort','search'].includes(key)&&value!=='all').length;
    $('activeFilterCount').textContent=activeFilterCount?String(activeFilterCount):'';
    $('savedCount').textContent = p.saved.length;
    $('profile').textContent = profiles[state.activeProfile].name[0];
    $('profile').setAttribute('aria-label', `Открыть мой профиль: ${profiles[state.activeProfile].name}`);
    $('sessionName').textContent = state.session ? profiles[state.activeProfile].name : 'Твоё время для нового';
    $('logout').textContent = state.session ? 'Выйти' : cloud.local?'Войти':'Войти по почте';
    $('profile').textContent = state.session ? profiles[state.activeProfile].name[0] : '↗';
    if(!state.session)$('profile').setAttribute('aria-label',cloud.local?'Войти':'Войти по почте');
    $('peopleSection').hidden = currentView!=='community';
    $('peopleRow').innerHTML=Object.entries(profiles).filter(([id])=>id!==state.activeProfile).slice(0,12).map(([id,profile])=>`<button class="person-pill" type="button" data-author="${escapeHTML(id)}"><span class="author-dot">${escapeHTML(profile.name[0])}</span><span>${escapeHTML(profile.name.split(',')[0])}</span><span aria-hidden="true">↗</span></button>`).join('');
    $('interestTotal').textContent = p.interests.length;
    const board = currentView === 'board', community = currentView === 'community';
    document.querySelector('.intro').classList.toggle('intro-compact', board || community);
    $('pageTitle').innerHTML = board ? 'От «хочу»<br><span>к «получилось».</span>' : community ? 'Время для <span>чего-то нового.</span>' : 'Для себя.<br><span>Просто так.</span>';
    $('pageDescription').textContent = board ? `Это твои находки, ${profiles[state.activeProfile].name}. Выбери первый шаг, попробуй и сохрани впечатление.` : community ? 'Здесь встречаются разные увлечения. Делись своими идеями и находи то, что захочется попробовать.' : 'Найди занятие по интересам, времени и бюджету. Сохрани идею — и сделай первый шаг.';
    $('sectionTitle').innerHTML = `${board?'Моя доска':community?'Общая лента':'Тебе может понравиться'} <span aria-hidden="true">✦</span>`;
    $('sectionEyebrow').textContent = board ? 'МАЛЕНЬКИЕ ШАГИ УЖЕ СЧИТАЮТСЯ' : community ? 'ЧТО ВДОХНОВЛЯЕТ ДРУГИХ' : 'ТВОЯ СЛЕДУЮЩАЯ МАЛЕНЬКАЯ ИСТОРИЯ';
    $('mapNodes').innerHTML = p.interests.length ? p.interests.slice(0,3).map(name=>`<span class="node">${name}</span>`).join('') : '<span class="node">Новые<br>открытия</span>';
    for (const button of document.querySelectorAll('nav [data-view]')) {
      const active = button.dataset.view === currentView;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current');
    }
    const filterNames = interestGroups[filters.group] || categories;
    $('categoryFilters').innerHTML = ['all',...filterNames].map(name=>`<button type="button" class="chip ${filters.category===name?'active':''}" data-category="${name}" aria-pressed="${filters.category===name}">${name==='all'?'Все интересы':name}</button>`).join('');
    const cities = [...new Set(allIdeas().filter(idea=>idea.format==='out').map(idea=>idea.city))].sort((a,b)=>a.localeCompare(b,'ru'));
    $('location').innerHTML = '<option value="all">Любая локация</option><option value="home">Дома · любой город</option>'+cities.map(city=>`<option value="${escapeHTML(city)}">${escapeHTML(city)}</option>`).join('');
    if (!['all','home',...cities].includes(filters.location)) filters.location = 'all';
    syncFilterControls();
    $('boardStatusLabel').hidden = !board;
    $('boardProgress').hidden = !board || !p.saved.length;
    $('boardProgress').innerHTML = statuses.map((status,index)=>`<button type="button" class="progress-item ${filters.status===status?'active':''}" data-progress="${status}" aria-pressed="${filters.status===status}"><span class="progress-dot dot-${index}" aria-hidden="true"></span><strong>${p.saved.filter(id=>p.statuses[id]===status).length}</strong><span>${status}</span></button>`).join('');
    const visible = sortIdeas(allIdeas().filter(idea=>matchesIdea(idea,filters,p,currentView)),filters.sort);
    document.querySelector('[data-quick="short"]').setAttribute('aria-pressed',String(filters.duration==='15'));
    document.querySelector('[data-quick="free"]').setAttribute('aria-pressed',String(filters.budget==='free'));
    $('surpriseIdea').disabled=!visible.length;
    const count = visible.length;
    const word = count%10===1 && count%100!==11 ? 'идея' : count%10>=2 && count%10<=4 && (count%100<12 || count%100>14) ? 'идеи' : 'идей';
    $('resultCaption').textContent = `${count} ${word} · ${board?'на твоей доске':community?'в общей ленте':'по твоим интересам'}`;
    $('cardGrid').innerHTML = visible.map(cardHTML).join('');
    $('clearFilters').hidden = !Object.entries(filters).some(([key,value])=>key==='search'?value.trim():value!=='all');
    $('budgetHint').hidden = filters.budget !== 'free';
    $('emptyState').hidden = count > 0;
    const emptyBoard = board && !p.saved.length;
    $('emptyTitle').textContent = emptyBoard ? 'Здесь начнётся твоё новое увлечение' : 'Такого сочетания пока нет';
    $('emptyText').textContent = emptyBoard ? 'Сохрани первую идею из подборки. Потом можно будет отметить первый шаг и свои впечатления.' : currentView==='feed' ? 'Попробуй другие фильтры или открой общую ленту — там есть идеи всех направлений.' : 'Попробуй снять один из фильтров или поискать по другому слову.';
    $('resetFilters').textContent = emptyBoard ? 'Найти первую идею' : 'Сбросить фильтры';
  }

  function toggleSave(id) {
    if (!requireLogin()) return;
    const p = person();
    const wasSaved = p.saved.includes(id);
    const removed={status:p.statuses[id],note:p.notes[id],userId:state.activeProfile};
    if (wasSaved) { p.saved = p.saved.filter(item=>item!==id); delete p.statuses[id]; delete p.notes[id]; }
    else { p.saved.push(id); p.statuses[id] = statuses[0]; }
    persist(wasSaved ? null : 'Сохранено на твою доску · Хочу попробовать');
    if(wasSaved)notify('Идея убрана с доски',()=>{
      if(state.activeProfile!==removed.userId||!state.session)return;
      if(!p.saved.includes(id))p.saved.push(id);p.statuses[id]=removed.status||statuses[0];
      if(removed.note)p.notes[id]=removed.note;
      persist('Идея и прогресс восстановлены');render();
      if(currentIdea?.id===id&&$('detailModal').classList.contains('show'))updateDetailState();
    });
    render();
    if (currentIdea?.id === id && $('detailModal').classList.contains('show')) updateDetailState();
    else [...document.querySelectorAll('#cardGrid [data-save]')].find(button=>button.dataset.save===String(id))?.focus({preventScroll:true});
    if (currentView==='board' && !p.saved.length) $('resetFilters').focus({preventScroll:true});
  }
  function noteHTML(note) {
    return `<div class="comment"><button type="button" class="text-author" data-author="${note.authorId}">${escapeHTML(profiles[note.authorId].name)}</button><p>${escapeHTML(note.text)}</p></div>`;
  }
  function updateDetailState() {
    const saved = person().saved.includes(currentIdea.id);
    $('detailSave').textContent = saved ? '✓ Сохранено · убрать с доски' : 'Сохранить на мою доску';
    $('detailSave').setAttribute('aria-pressed', String(saved));
    $('personalExperience').hidden = !saved;
    if (saved) {
      $('detailStatus').value = person().statuses[currentIdea.id] || statuses[0];
      $('ideaNote').value = noteDrafts.get(draftKey(currentIdea.id)) ?? person().notes[currentIdea.id] ?? '';
    }
  }
  function renderDetail() {
    const idea = currentIdea;
    const comments = state.comments[idea.id] || [];
    const guide = starterGuides[idea.category];
    $('detailBody').innerHTML = `<div class="detail-layout"><div class="detail-visual"><img class="detail-image" src="${escapeHTML(idea.image)}" alt="${escapeHTML(idea.title)}"><span class="detail-image-caption">${idea.type==='Референс участника'?'Визуальный референс':'Иллюстрация идеи'}</span></div><div class="detail-info">${authorLink(idea)}<h2 id="detailTitle">${escapeHTML(idea.title)}</h2><div class="detail-tags">${[idea.category,locationText(idea),`${durationMinutes(idea)} мин`,priceText(idea)].map(tag=>`<span class="detail-tag">${escapeHTML(tag)}</span>`).join('')}</div><p class="detail-description">${escapeHTML(idea.description)}</p><div class="first-step"><p class="eyebrow">НАЧАТЬ ПРОЩЕ, ЧЕМ КАЖЕТСЯ</p><h3>Твой первый маленький шаг</h3><p>${escapeHTML(idea.firstStep || guide.step)}</p><div class="materials"><strong>Что понадобится</strong><p>${escapeHTML(idea.materials || guide.materials)}</p></div></div><button type="button" id="detailSave" class="btn btn-dark w-100" data-save="${escapeHTML(idea.id)}"></button><p class="demo-note">${idea.price===0?'Без платы за занятие; материалы и инструмент предполагаются своими.':'Бюджет примерный, платежей и записи на занятие нет.'}</p>${idea.authorId===state.activeProfile && String(idea.id).startsWith('post-')?`<button type="button" class="text-button edit-idea" data-edit="${escapeHTML(idea.id)}">Редактировать мою идею ↗</button>`:''}<section id="personalExperience" class="personal-experience" hidden><h3>Моя попытка</h3><label class="form-label" for="detailStatus">Где ты сейчас?</label><select id="detailStatus" class="form-select">${statuses.map(status=>`<option>${status}</option>`).join('')}</select><label class="form-label mt-3" for="ideaNote">Впечатление или следующий шаг</label><textarea id="ideaNote" class="form-control" maxlength="300" rows="2" placeholder="Что получилось? Что хочется попробовать дальше?"></textarea><div class="note-footer"><span id="noteDraftHint" class="demo-note" role="status">Личная заметка · видна только тебе</span><button type="button" id="saveIdeaNote" class="text-button">Сохранить заметку</button></div></section><section class="discussion"><h3>Обсуждаем вместе <span class="comment-count">${comments.length}</span></h3>${comments.map(noteHTML).join('')}<form id="commentForm"><label for="commentInput" class="form-label">Твой вопрос или опыт</label><div class="comment-form"><textarea id="commentInput" maxlength="300" rows="2" placeholder="Спроси или поделись опытом…">${escapeHTML(commentDrafts.get(draftKey(idea.id)) || '')}</textarea><button class="btn btn-dark" aria-label="Добавить комментарий">↑</button></div><p id="commentError" class="comment-error" role="alert"></p></form><p class="demo-note">Комментарии открыты всем участникам. Личные заметки находятся на твоей доске.</p></section></div></div>`;
    updateDetailState();
    $('commentInput').addEventListener('input',()=>commentDrafts.set(draftKey(idea.id),$('commentInput').value));
    $('commentForm').addEventListener('submit',async event=>{
      event.preventDefault();
      if(!requireLogin())return;
      const text = $('commentInput').value.trim();
      if (!text) { $('commentError').textContent='Напиши вопрос или комментарий.'; $('commentInput').focus(); return; }
      if (comments.length>=30) { $('commentError').textContent='Доступно до 30 комментариев под одной идеей.'; return; }
      const button=$('commentForm').querySelector('button');button.disabled=true;
      try {await cloud.addMessage('idea',idea.id,text.slice(0,300));}
      catch(error){$('commentError').textContent=error.message;button.disabled=false;return;}
      state.comments[idea.id]=[...comments,{authorId:state.activeProfile,text:text.slice(0,300)}];
      commentDrafts.delete(draftKey(idea.id)); persist(); renderDetail(); $('commentInput').focus({preventScroll:true});
    });
    $('detailStatus').addEventListener('change',()=>{person().statuses[idea.id]=$('detailStatus').value;persist('Статус обновлён на твоей доске');render();});
    $('ideaNote').addEventListener('input',()=>{noteDrafts.set(draftKey(idea.id),$('ideaNote').value);$('noteDraftHint').textContent='Есть несохранённые изменения';});
    $('saveIdeaNote').addEventListener('click',()=>{person().notes[idea.id]=$('ideaNote').value.trim().slice(0,300);noteDrafts.delete(draftKey(idea.id));$('noteDraftHint').textContent='Личная заметка · видна только тебе';persist('Личная заметка сохранена');render();});
  }
  function openIdea(id) { currentIdea=findIdea(id); if (!currentIdea) return; renderDetail(); modals.detail.show(); }

  function renderAuthor() {
    const author = profiles[currentAuthor];
    const posts = allIdeas().filter(idea=>idea.authorId===currentAuthor);
    const wall = state.walls[currentAuthor] || [];
    $('authorBody').innerHTML = `<div class="profile-heading"><span class="profile-avatar" aria-hidden="true">${escapeHTML(author.name[0])}</span><div><p class="eyebrow">${/^[a-f0-9-]{36}$/.test(currentAuthor)?'УЧАСТНИК':'КОЛЛЕКЦИЯ ИДЕЙ'}</p><h2 id="authorTitle">${escapeHTML(author.name)}</h2><p class="muted">⌖ ${escapeHTML(author.city)}</p></div></div><p>${escapeHTML(author.bio)}</p>${currentAuthor===state.activeProfile&&state.session?`<details class="profile-edit"><summary>Изменить профиль</summary><form id="profileForm"><label class="form-label mt-3" for="profileName">Имя</label><input class="form-control" id="profileName" maxlength="60" required value="${escapeHTML(author.name)}"><label class="form-label mt-3" for="profileCity">Город</label><input class="form-control" id="profileCity" maxlength="50" value="${escapeHTML(author.city)}"><label class="form-label mt-3" for="profileBio">О себе</label><textarea class="form-control" id="profileBio" maxlength="500" rows="3">${escapeHTML(author.bio)}</textarea><p id="profileError" role="alert"></p><button class="btn btn-dark mt-3">Сохранить профиль</button></form></details>`:''}<h3 class="profile-section-title">Идеи автора <span class="comment-count">${posts.length}</span></h3><div class="author-posts">${posts.length?posts.map(idea=>`<button type="button" data-author-post="${escapeHTML(idea.id)}"><img src="${escapeHTML(idea.image)}" alt="" loading="lazy"><span>${escapeHTML(idea.title)} ↗</span></button>`).join(''):'<p class="muted">Пока нет публикаций. Начать можно с кнопки «Добавить идею».</p>'}</div><section class="discussion"><h3>Гостевая книга</h3><p class="demo-note">Открытая запись на странице автора. Её смогут прочитать другие участники.</p>${wall.map(noteHTML).join('')}<form id="wallForm"><label for="wallInput" class="form-label">Написать на странице</label><textarea id="wallInput" class="form-control" maxlength="300" rows="3" placeholder="Мне понравилась твоя идея…">${escapeHTML(wallDrafts.get(draftKey(currentAuthor))||'')}</textarea><p id="wallError" class="comment-error" role="alert"></p><button class="btn btn-dark mt-2">Оставить запись</button></form></section>`;
    $('profileForm')?.addEventListener('submit',async event=>{
      event.preventDefault();
      const name=$('profileName').value.trim();
      if(!name){$('profileError').textContent='Напиши имя.';return;}
      const button=$('profileForm').querySelector('button');button.disabled=true;
      const updated={name,city:$('profileCity').value.trim(),bio:$('profileBio').value.trim()};
      try{await cloud.saveProfile(updated);Object.assign(profiles[state.activeProfile],updated);for(const post of state.posts)if(post.authorId===state.activeProfile)post.author=name;render();renderAuthor();notify('Профиль обновлён');}
      catch(error){$('profileError').textContent=error.message;button.disabled=false;}
    });
    $('wallInput').addEventListener('input',()=>wallDrafts.set(draftKey(currentAuthor),$('wallInput').value));
    $('wallForm').addEventListener('submit',async event=>{
      event.preventDefault(); if(!requireLogin())return; const text=$('wallInput').value.trim();
      if (!text) { $('wallError').textContent='Напиши текст записи.'; $('wallInput').focus(); return; }
      if (wall.length>=30) { $('wallError').textContent='Доступно до 30 записей на странице автора.'; return; }
      const button=$('wallForm').querySelector('button');button.disabled=true;
      try {await cloud.addMessage('wall',currentAuthor,text.slice(0,300));}
      catch(error){$('wallError').textContent=error.message;button.disabled=false;return;}
      state.walls[currentAuthor]=[...wall,{authorId:state.activeProfile,text:text.slice(0,300)}];
      wallDrafts.delete(draftKey(currentAuthor));persist('Запись опубликована на странице');renderAuthor();$('wallInput').focus({preventScroll:true});
    });
  }
  function openAuthor(id) {
    if (!Object.hasOwn(profiles,id)) return;
    currentAuthor=id;
    if ($('authorModal').classList.contains('show')) { renderAuthor(); return; }
    if ($('detailModal').classList.contains('show')) { returnToDetail=true; switchModal('detail','author',renderAuthor); }
    else { returnToDetail=false;renderAuthor();modals.author.show(); }
  }

  function openPublish(idea = null) {
    if (!requireLogin()) return;
    editingId=idea?.id || null;
    $('publishDraftHint').hidden=true;
    $('publishForm').reset();$('publishError').textContent='';
    $('publishWho').textContent=profiles[state.activeProfile].name;
    $('publishCity').value=idea?.city || profiles[state.activeProfile].city;
    $('publishHeading').textContent=idea?'Обновить свою идею':'Твоя маленькая идея';
    $('publishSubmit').textContent=idea?'Сохранить изменения':'Поделиться идеей';
    if (idea) {
      $('publishTitle').value=idea.title;$('publishDescription').value=idea.description;
      $('publishCategory').value=idea.category;$('publishFormat').value=idea.format;
      $('publishPrice').value=idea.price;$('publishDuration').value=durationMinutes(idea);
      $('publishCover').value=coverOptions.includes(idea.image)?idea.image:'auto';
      $('publishMaterials').value=idea.materials||'';$('publishStep').value=idea.firstStep||'';
    }
    if(!idea){
      try{
        const draft=JSON.parse(sessionValue(`vnedel-publish-draft:${state.activeProfile}`,'null'));
        if(draft&&typeof draft==='object'){
          for(const id of publishFields)if(typeof draft[id]==='string')$(id).value=draft[id].slice(0,$(id).maxLength>0?$(id).maxLength:1500);
          if(!categories.includes($('publishCategory').value))$('publishCategory').value=categories[0];
          $('publishDraftHint').hidden=false;
        }
      }catch{/* Повреждённый черновик не мешает создать идею. */}
    }
    if ($('detailModal').classList.contains('show')) switchModal('detail','publish');else modals.publish.show();
  }

  const publishFields=['publishTitle','publishCategory','publishFormat','publishCity','publishPrice','publishDuration','publishCover','publishDescription','publishMaterials','publishStep'];
  $('publishForm').addEventListener('input',()=>{if(!editingId&&state.session)setSessionValue(`vnedel-publish-draft:${state.activeProfile}`,JSON.stringify(Object.fromEntries(publishFields.map(id=>[id,$(id).value]))));});
  document.addEventListener('click',event=>{
    const quick=event.target.closest('[data-quick]');if(quick){const key=quick.dataset.quick==='short'?'duration':'budget',value=key==='duration'?'15':'free';filters[key]=filters[key]===value?'all':value;render();return;}
    const save=event.target.closest('[data-save]');if(save){const idea=findIdea(save.dataset.save);if(idea)toggleSave(idea.id);return;}
    const author=event.target.closest('[data-author]');if(author){openAuthor(author.dataset.author);return;}
    const authorPost=event.target.closest('[data-author-post]');if(authorPost){returnToDetail=false;switchModal('author','detail',()=>{currentIdea=findIdea(authorPost.dataset.authorPost);renderDetail();});return;}
    const edit=event.target.closest('[data-edit]');if(edit){const idea=findIdea(edit.dataset.edit);if(idea?.authorId===state.activeProfile)openPublish(idea);return;}
    const open=event.target.closest('[data-open]');if(open){openIdea(open.dataset.open);return;}
    const category=event.target.closest('[data-category]');if(category){filters.category=category.dataset.category;render();[...$('categoryFilters').children].find(b=>b.dataset.category===filters.category)?.focus({preventScroll:true});return;}
    const progress=event.target.closest('[data-progress]');if(progress){filters.status=filters.status===progress.dataset.progress?'all':progress.dataset.progress;render();[...$('boardProgress').children].find(b=>b.dataset.progress===progress.dataset.progress)?.focus({preventScroll:true});return;}
    const interest=event.target.closest('[data-interest]');if(interest){const name=interest.dataset.interest;selectedInterests=selectedInterests.includes(name)?selectedInterests.filter(x=>x!==name):[...selectedInterests,name];renderChoices();return;}
    const view=event.target.closest('[data-view]:not(body)');if(view){event.preventDefault();setView(!state.session&&view.classList.contains('brand')?'community':view.dataset.view);}
  });

  $('interestModal').addEventListener('hide.bs.modal',event=>{if(!person().interests.length&&state.session&&!changingAccount)event.preventDefault();});
  $('interestModal').addEventListener('hidden.bs.modal',()=>interestTrigger?.focus({preventScroll:true}));
  $('detailModal').addEventListener('hidden.bs.modal',()=>{if(!switchingModal && currentIdea)focusCard(currentIdea.id);});
  $('authorModal').addEventListener('hidden.bs.modal',()=>{
    if (switchingModal) return;
    if (returnToDetail && currentIdea) {returnToDetail=false;renderDetail();modals.detail.show();}
    else $('profile').focus({preventScroll:true});
  });
  $('publishModal').addEventListener('hidden.bs.modal',()=>{if(!switchingModal)$('addIdea').focus({preventScroll:true});});
  $('themeToggle').addEventListener('click',()=>{state.theme=state.theme==='dark'?'light':'dark';applyTheme();persist();});
  $('applyInterests').addEventListener('click',()=>{
    if (!selectedInterests.length || !requireLogin()) return;
    person().interests=[...selectedInterests];resetFilters();persist();render();modals.interest.hide();
  });
  $('editInterests').addEventListener('click',event=>openInterests(event.currentTarget));
  $('profile').addEventListener('click',()=>{if(requireLogin())openAuthor(state.activeProfile);});
  function showLogin() {
    $('loginError').textContent = '';
    modals.login.show();
  }
  $('loginModal').addEventListener('shown.bs.modal', () => $(cloud.local?'localCode':'loginEmail').focus());
  $('loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    if(cloud.local){
      $('loginError').textContent='';$('loginSubmit').disabled=true;
      try{await cloud.signIn($('localProfile').value,$('localCode').value);await loadCloud();currentView='feed';resetFilters();render();modals.login.hide();$('localCode').value='';if(!person().interests.length)openInterests();}
      catch(error){$('loginError').textContent=error.message;}
      finally{$('loginSubmit').disabled=false;}
      return;
    }
    const email = $('loginEmail').value.trim();
    const submit = $('loginSubmit');
    submit.disabled = true; $('loginError').textContent = '';
    const previousText=submit.textContent;submit.textContent='Отправляем письмо…';
    $('loginHint').textContent='Ожидаем ответ почтового сервиса. Это может занять до полутора минут.';
    try {
      const remaining=Math.ceil((60000-(Date.now()-lastCodeAt))/1000);
      if(remaining>0)throw new Error(`Новое письмо можно запросить через ${remaining} с.`);
      setSessionValue('vnedel-pending-name',$('loginName').value.trim().slice(0,60));
      lastCodeAt=Date.now();setSessionValue('vnedel-last-email-request',String(lastCodeAt));
      await cloud.sendCode(email);
      sentToEmail=email;
      $('loginHint').textContent='Письмо отправлено. Нажми ссылку в письме — она вернёт тебя сюда. Проверь папку «Спам», если письма нет.';
      submit.textContent='Отправить письмо ещё раз';
    } catch(error) { $('loginError').textContent=error.message;$('loginHint').textContent=''; }
    finally {submit.disabled=false;if(submit.textContent==='Отправляем письмо…')submit.textContent=previousText;}
  });
  $('logout').addEventListener('click',async()=>{
    if (!state.session) {showLogin();return;}
    $('logout').disabled=true;
    try {
      await syncQueue;
      try {await cloud.signOut();} catch {notify('Выход выполнен на этом устройстве. Сервер временно недоступен.');}
      try{localStorage.removeItem(STORAGE_KEY);}catch{/* Очищаем состояние страницы независимо от доступа к хранилищу. */}
      Object.assign(state,normalizeState({theme:state.theme}));
      setSessionValue(`vnedel-publish-draft:${state.activeProfile}`,'');
      cloudReady=false; sentToEmail='';
      $('loginForm').reset();$('loginSubmit').textContent=cloud.local?'Войти':'Получить ссылку';
      commentDrafts.clear();wallDrafts.clear();noteDrafts.clear();currentIdea=null;currentAuthor=null;
      currentView='community';resetFilters();await loadCloud();
    } catch(error){notify(error.message);}
    finally{$('logout').disabled=false;render();}
  });
  $('surpriseIdea').addEventListener('click',()=>{const ideas=allIdeas().filter(idea=>matchesIdea(idea,filters,person(),currentView));if(ideas.length)openIdea(ideas[Math.floor(Math.random()*ideas.length)].id);});
  $('refreshFeed').addEventListener('click',async()=>{
    $('refreshFeed').disabled=true;
    try{await syncQueue;if(syncError){notify('Сначала повтори сохранение изменений. Обновление ленты может заменить несохранённые данные.');return;}await loadCloud();notify('Лента обновлена');}
    catch(error){notify(error.message);}
    finally{$('refreshFeed').disabled=false;}
  });
  $('syncStatus').addEventListener('click',()=>{if(state.session)persist('Сохранение обновлено');});
  document.addEventListener('change',event=>{
    const select=event.target.closest('[data-status]');
    if (!select || !requireLogin()) return;
    const idea=findIdea(select.dataset.status);
    if (idea && statuses.includes(select.value)) {
      person().statuses[idea.id]=select.value;persist('Статус обновлён');render();
      const newSelect=$(`status-${idea.id}`);if(newSelect)newSelect.focus({preventScroll:true});else $('boardStatus').focus({preventScroll:true});
    }
  });
  for (const [key,id] of Object.entries(filterIds)) $(id).addEventListener(key==='search'?'input':'change',()=>{
    filters[key]=$(id).value;if(key==='group')filters.category='all';render();
  });
  $('clearFilters').addEventListener('click',()=>{resetFilters();render();$('search').focus({preventScroll:true});});
  $('resetFilters').addEventListener('click',()=>{if(currentView==='board'&&!person().saved.length)currentView='feed';resetFilters();render();$('search').focus({preventScroll:true});});
  $('publishCategory').innerHTML=Object.entries(interestGroups).map(([group,names])=>`<optgroup label="${group}">${names.map(name=>`<option>${name}</option>`).join('')}</optgroup>`).join('');
  $('addIdea').addEventListener('click',()=>openPublish());
  $('publishForm').addEventListener('submit',event=>{
    event.preventDefault();
    if(!requireLogin())return;
    const title=$('publishTitle').value.trim(),description=$('publishDescription').value.trim();
    const city=$('publishCity').value.trim(),category=$('publishCategory').value,format=$('publishFormat').value;
    const price=Number($('publishPrice').value),duration=Number($('publishDuration').value);
    if(!title||!description||!city||!categories.includes(category)||!['home','out'].includes(format)||!Number.isInteger(price)||price<0||price>1000000||!Number.isInteger(duration)||duration<5||duration>1440){$('publishError').textContent='Проверь поля: название, описание, город, бюджет и время от 5 до 1 440 минут.';return;}
    if(!editingId && state.posts.filter(post=>post.authorId===state.activeProfile).length>=50){$('publishError').textContent='Можно разместить до 50 идей.';return;}
    const existing=editingId?state.posts.find(idea=>idea.id===editingId&&idea.authorId===state.activeProfile):null;
    if(editingId&&!existing){$('publishError').textContent='Эта публикация недоступна для редактирования.';return;}
    const idea={id:existing?.id||`post-${crypto.randomUUID()}`,title:title.slice(0,90),description:description.slice(0,1500),category,format,city:city.slice(0,50),price,duration,time:`${duration} мин`,authorId:state.activeProfile,author:profiles[state.activeProfile].name,image:coverOptions.includes($('publishCover').value)?$('publishCover').value:imageFor(category),materials:$('publishMaterials').value.trim().slice(0,300),firstStep:$('publishStep').value.trim().slice(0,300),type:'Идея участника'};
    if(existing)Object.assign(existing,idea);else state.posts.push(idea);
    const edited=!!existing;
    persist(edited?'Идея обновлена. Сохранения на досках остались.':'Идея опубликована в общей ленте. Другой профиль сможет сохранить её себе.');
    if(!edited)setSessionValue(`vnedel-publish-draft:${state.activeProfile}`,'');
    setView('community');modals.publish.hide();editingId=null;
  });

  // Ссылка входа открывается в новой вкладке: исходная форма тоже должна заметить вход.
  window.addEventListener('vnedel:auth-changed',async()=>{
    try{
      const user=await cloud.currentUser();
      if(user?.id===state.session?.userId)return;
      changingAccount=true;returnToDetail=false;
      for(const modal of Object.values(modals))modal.hide();
      Object.assign(state,normalizeState({theme:state.theme}));
      cloudReady=false;commentDrafts.clear();wallDrafts.clear();noteDrafts.clear();
      currentView='community';render();
      await loadCloud(user);
      if(state.session){currentView='feed';render();if(!person().interests.length)openInterests();}
    }catch(error){notify(error.message);}
    finally{changingAccount=false;}
  });
  // Обновление другой открытой вкладки того же браузера без сервера.
  window.addEventListener('storage',event=>{
    if(event.key===STORAGE_KEY)notify('Данные изменены в другой вкладке. Перезагрузи страницу, чтобы увидеть обновление.');
  });
  if(window.matchMedia('(max-width:680px)').matches)$('advancedFilters').open=false;
  if(cloud.local)document.querySelector('.demo-banner>span').textContent='Локальный режим · данные сохраняются в браузере';
  applyTheme();render();
  if (cloud.configured) loadCloud().then(()=>{if(state.session){currentView='feed';render();if(!person().interests.length)openInterests();}}).catch(error=>notify(error.message));
  if(storageWarning)notify(storageWarning);
  if(cloud.callbackError){showLogin();$('loginError').textContent=cloud.callbackError;}
})();
