// Чистые правила фильтрации и восстановления локальных данных.
(() => {
  'use strict';
  const {categories, seedIdeas, profiles, imageFor, coverOptions, interestGroups} = VnedelCatalog;
  const statuses = ['Хочу попробовать', 'В процессе', 'Попробовала'];
  const profileIds = () => Object.keys(profiles).filter(id => ['anna','sonya'].includes(id) || /^[a-f0-9-]{36}$/.test(id));
  const STORAGE_KEY = 'vnedel-final-v1';
  const text = (value, max, fallback = '') => typeof value === 'string' ? value.trim().slice(0, max) : fallback;
  const normalize = value => String(value).toLocaleLowerCase('ru').replace(/ё/g, 'е');

  function durationMinutes(idea) {
    if (Number.isFinite(idea.duration) && idea.duration > 0) return Math.min(1440, Math.round(idea.duration));
    const time = String(idea.time || '').replace(',', '.');
    const amount = Number.parseFloat(time);
    return Number.isFinite(amount) && amount > 0 ? Math.min(1440, Math.round(amount * (/час/.test(time) ? 60 : 1))) : 60;
  }

  function normalizeState(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = {};
    const seen = new Set();
    const posts = (Array.isArray(raw.posts) ? raw.posts : []).filter(post => {
      if (!post || typeof post !== 'object' || !/^post-[a-zA-Z0-9-]{1,80}$/.test(post.id) || seen.has(post.id)) return false;
      const valid = categories.includes(post.category) && profileIds().includes(post.authorId) && text(post.title, 90) && text(post.description, 1500) && Number.isFinite(post.price) && post.price >= 0 && post.price <= 1000000;
      if (valid) seen.add(post.id);
      return valid;
    }).slice(0, 500).map(post => {
      const duration = durationMinutes(post);
      return {
        id: post.id, title: text(post.title, 90), description: text(post.description, 1500),
        category: post.category, authorId: post.authorId, author: profiles[post.authorId].name,
        city: text(post.city, 50, 'Москва') || 'Москва', format: post.format === 'out' ? 'out' : 'home',
        price: post.price, duration, time: `${duration} мин`,
        image: coverOptions.includes(post.image) ? post.image : imageFor(post.category),
        materials: text(post.materials, 300), firstStep: text(post.firstStep, 300), type: 'Идея участника'
      };
    });
    const allIds = new Set([...seedIdeas, ...posts].map(idea => String(idea.id)));
    function cleanProfile(value) {
      const p = value && typeof value === 'object' ? value : {};
      const saved = [...new Set((Array.isArray(p.saved) ? p.saved : []).filter(id => allIds.has(String(id))).map(id => /^\d+$/.test(String(id)) ? Number(id) : id))];
      const statusMap = Object.fromEntries(saved.map(id => [id, statuses.includes(p.statuses?.[id]) ? p.statuses[id] : statuses[0]]));
      const notes = Object.fromEntries(saved.map(id => [id, text(p.notes?.[id], 300)]));
      return {interests: [...new Set((Array.isArray(p.interests) ? p.interests : []).filter(x => categories.includes(x)))], saved, statuses: statusMap, notes};
    }
    function cleanNotes(value) {
      return (Array.isArray(value) ? value : []).map(note => typeof note === 'string' ? {authorId: 'anna', text: note} : note)
        .filter(note => note && profileIds().includes(note.authorId) && text(note.text, 300))
        .slice(-30).map(note => ({authorId: note.authorId, text: text(note.text, 300)}));
    }
    const comments = Object.fromEntries([...seedIdeas, ...posts].map(idea => [idea.id, cleanNotes(raw.comments?.[idea.id])]));
    const walls = Object.fromEntries(Object.keys(profiles).map(id => [id, cleanNotes(raw.walls?.[id])]));
    return {
      version: 4, session: profileIds().includes(raw.session?.userId) ? {userId:raw.session.userId} : null, theme: raw.theme === 'light' ? 'light' : 'dark', activeProfile: profileIds().includes(raw.session?.userId) ? raw.session.userId : raw.activeProfile === 'sonya' ? 'sonya' : 'anna',
      people: Object.fromEntries(profileIds().map(id=>[id, cleanProfile(raw.people?.[id] || (id==='anna'?raw:null))])), posts, comments, walls
    };
  }

  function matchesIdea(idea, filters, person, view) {
    if (view === 'board' ? !person.saved.includes(idea.id) : view === 'feed' && !person.interests.includes(idea.category)) return false;
    if (filters.category !== 'all' && idea.category !== filters.category) return false;
    if (filters.group !== 'all' && !interestGroups[filters.group]?.includes(idea.category)) return false;
    if (filters.format !== 'all' && idea.format !== filters.format) return false;
    if (filters.budget !== 'all' && (filters.budget === 'free' ? idea.price !== 0 : idea.price > Number(filters.budget))) return false;
    if (filters.location !== 'all' && (filters.location === 'home' ? idea.format !== 'home' : idea.format !== 'out' || idea.city !== filters.location)) return false;
    if (filters.duration !== 'all' && durationMinutes(idea) > Number(filters.duration)) return false;
    if (view === 'board' && filters.status !== 'all' && person.statuses[idea.id] !== filters.status) return false;
    return normalize(`${idea.title} ${idea.category} ${idea.author} ${idea.city}`).includes(normalize(filters.search.trim()));
  }

  function sortIdeas(ideas, order = 'all') {
    const sorted = [...ideas];
    if(order==='short')sorted.sort((a,b)=>durationMinutes(a)-durationMinutes(b));
    if(order==='budget')sorted.sort((a,b)=>a.price-b.price || durationMinutes(a)-durationMinutes(b));
    if(order==='title')sorted.sort((a,b)=>a.title.localeCompare(b.title,'ru'));
    return sorted;
  }

  globalThis.VnedelModel = {statuses, STORAGE_KEY, durationMinutes, normalizeState, matchesIdea, sortIdeas};
})();
