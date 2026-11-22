/* Автономный режим запускается без конфигурации и внешних запросов. */
(async () => {
  const load = src => new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src=src;script.onload=resolve;script.onerror=()=>reject(new Error(`Не загружен ${src.split('?')[0]}`));
    document.body.append(script);
  });
  try {
    if(new URLSearchParams(location.search).get('mode')==='cloud')await load('config.local.js');
    for(const file of ['cloud.js','local.js','catalog.js','model.js','app.js'])await load(`${file}?v=local-submission-1`);
  } catch(error) {
    document.getElementById('resultCaption').textContent=`${error.message}. Проверь файлы проекта и инструкцию README.md.`;
  }
})();
