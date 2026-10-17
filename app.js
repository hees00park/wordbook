'use strict';
(() => {
  const DATA = globalThis.WORD_DATA || [];
  const C = WordbookCore.create(DATA);
  const BY_ID = new Map(DATA.map(word => [word.id, word]));
  const dictionary = WordbookDictionary.create(DATA);
  let lookupRequest = 0, lookupController = null, lookupTrigger = null;
  const STORE_KEY = 'wordbook-progress-v2';
  const VOICE_KEY = 'wordbook-voice-v1';
  const $ = id => document.getElementById(id);
  const icons = {
    cards:'<rect x="5" y="6" width="14" height="15" rx="2"/><path d="M8 3h9M9 11h6M9 15h4"/>',
    book:'<path d="M12 6c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Zm0 0v15"/>',
    pencil:'<path d="m15 4 5 5M4 20l4-1 13-13-4-4L4 15v5ZM13 20h8"/>',
    volume:'<path d="m11 5-6 4H2v6h3l6 4V5ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/>',
    pointer:'<path d="m5 3 5 17 3-6 6-3L5 3ZM15 16l4 4"/>',
    shuffle:'<path d="M3 6h3c5 0 7 12 12 12h3M18 15l3 3-3 3M3 18h3c1.5 0 2.8-1.3 4-3M14 9c1.2-1.8 2.5-3 4-3h3M18 3l3 3-3 3"/>',
    repeat:'<path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3"/>',
    check:'<path d="m5 12 4 4L19 6"/>',left:'<path d="m14 6-6 6 6 6"/>',right:'<path d="m10 6 6 6-6 6"/>',
    lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
    sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/>',
    search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',close:'<path d="m6 6 12 12M18 6 6 18"/>',
    bookmark:'<path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16l-6-4-6 4Z"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  };
  const svg = name => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || ''}</svg>`;
  document.querySelectorAll('[data-icon]').forEach(node => { node.innerHTML = svg(node.dataset.icon); });
  const posName = value => ({'n.':'noun','v.':'verb','adj.':'adjective','adv.':'adverb','phr.':'expression'}[value] || value);
  const make = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  let storageAvailable = true;
  function loadState() {
    try {
      const saved = localStorage.getItem(STORE_KEY);
      if (saved) return C.hydrate(JSON.parse(saved));
      const fresh = C.emptyState();
      const legacy = JSON.parse(localStorage.getItem('teum-wordbook-v1') || 'null');
      const byWord = new Map(DATA.map(word => [word.word,word.id]));
      Object.entries(legacy?.ratings || {}).forEach(([oldId,status]) => {
        const id = byWord.get(globalThis.LEGACY_WORD_MAP?.[oldId]);
        if (id && ['known','review'].includes(status)) fresh.ratings[id] = status;
      });
      return fresh;
    } catch { return C.emptyState(); }
  }
  let state = loadState();
  let todayKey = C.dayKey();
  let today = C.day(state, todayKey);
  let view = 'learn', mode = 'today', category = 'all';
  let pool = [], position = 0, revealed = false, detailId = null, collectionChanged = false;
  let toastTimer, emptyAction = 'study', collectionLimit = 100;
  let calendarMonth = todayKey.slice(0,7);
  function toast(text) { $('toast').textContent = text; $('toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('visible'),2600); }
  function save() {
    try { localStorage.setItem(STORE_KEY,JSON.stringify(state)); storageAvailable = true; }
    catch { storageAvailable = false; }
    if (!storageAvailable) $('save-note').textContent = 'Browser storage is unavailable. Progress will last only in this open page.';
  }
  function ensureToday() {
    const key = C.dayKey();
    if (key === todayKey) return false;
    todayKey = key; today = C.day(state,key); mode = 'today'; category = 'all'; calendarMonth = key.slice(0,7);
    $('category-select').value = 'all';
    ['detail-dialog','about-dialog','submit-dialog'].forEach(id => { if ($(id).open) $(id).close(); });
    view = 'learn'; beginStudy(); setView('learn'); save(); toast('A new daily set is ready. Dates reset at midnight KST.');
    return true;
  }
  const action = fn => event => { if (ensureToday()) { event?.preventDefault?.(); return; } fn(event); };
  function matchingStudy() {
    const ids = mode === 'review' ? DATA.filter(word => state.ratings[word.id] === 'review').map(word => word.id) : today.ids;
    return ids.filter(id => (category === 'all' || BY_ID.get(id).category === category) && (mode !== 'unseen' || !today.studied.includes(id)));
  }
  function beginStudy({resume = false} = {}) {
    pool = matchingStudy();
    position = resume && mode === 'today' && category === 'all' ? Math.min(today.cursor,pool.length) : 0;
    revealed = false;
    renderStudy(); renderStats(); save();
  }
  function currentWord() { return BY_ID.get(pool[position]) || null; }
  function closeLookup(restoreFocus = false) {
    lookupRequest++; lookupController?.abort(); lookupController = null;
    $('word-lookup').hidden = true;
    if (restoreFocus && lookupTrigger) lookupTrigger.focus({preventScroll:true});
    lookupTrigger = null;
  }
  async function lookUpWord(text, trigger) {
    closeLookup(); const request = lookupRequest, cardId = currentWord()?.id;
    lookupTrigger = trigger;
    $('word-lookup').hidden = false; $('lookup-word').textContent = text;
    $('lookup-meaning').textContent = ''; $('lookup-definition').textContent = 'Looking up…'; $('lookup-definition').hidden = false;
    $('lookup-source').textContent = 'Dictionary';
    $('lookup-link').href = `https://en.dict.naver.com/#/search?query=${encodeURIComponent(text)}`;
    const controller = new AbortController(); lookupController = controller;
    const timer = setTimeout(() => controller.abort(),8000);
    const result = await dictionary.lookup(text,{signal:controller.signal});
    clearTimeout(timer);
    if (request !== lookupRequest || cardId !== currentWord()?.id || $('word-lookup').hidden) return;
    lookupController = null;
    $('lookup-word').textContent = result?.baseForm ? `${text} → ${result.word}` : text;
    $('lookup-meaning').textContent = result?.meaning || '';
    $('lookup-definition').hidden = !!result?.meaning;
    $('lookup-definition').textContent = result?.definition || 'No local definition found. Open the Korean dictionary for this word.';
    $('lookup-source').textContent = result?.source || 'Dictionary unavailable';
  }
  function showExample(node,word) {
    node.replaceChildren();
    let found = null;
    for (const candidate of [word.word,...(word.aliases || [])]) {
      const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      found = new RegExp(`\\b${escaped}(?:s|es|ed|d|ing)?\\b`,'i').exec(word.example);
      if (found) break;
    }
    let cursor = 0;
    for (const token of word.example.matchAll(/[A-Za-z]+(?:['’][A-Za-z]+)*(?:-[A-Za-z]+)*/g)) {
      node.append(document.createTextNode(word.example.slice(cursor,token.index)));
      const highlighted = found && token.index < found.index+found[0].length && token.index+token[0].length > found.index;
      const button = make('button',`example-token${highlighted ? ' target-token' : ''}`,token[0]);
      button.type = 'button'; button.setAttribute('aria-label',`Look up ${token[0]}`);
      button.addEventListener('click',action(() => lookUpWord(token[0],button)));
      node.append(button); cursor = token.index+token[0].length;
    }
    node.append(document.createTextNode(word.example.slice(cursor)));
  }
  function renderStudy() {
    closeLookup();
    document.querySelectorAll('[data-mode]').forEach(button => { const active = button.dataset.mode === mode; button.classList.toggle('active',active); button.setAttribute('aria-pressed',String(active)); });
    const word = currentWord();
    $('word-card').hidden = !word; $('empty-card').hidden = !!word; $('study-actions').hidden = !word;
    $('previous-button').disabled = !pool.length || position === 0; $('next-button').disabled = !word;
    $('ready-banner').hidden = !C.canQuiz(state,todayKey) || today.passed;
    if (!word) {
      const complete = C.canQuiz(state,todayKey);
      $('empty-eyebrow').textContent = mode === 'review' ? 'REVIEW' : 'DAILY STUDY';
      $('empty-title').textContent = complete ? 'Daily study complete' : mode === 'review' ? 'No review words in this set' : 'End of this set';
      $('empty-description').textContent = complete ? 'All 50 items are studied. Test all 50, one at a time. At least 45 correct answers are required to pass.' : mode === 'review' ? 'Use “Review again” or bookmark words in the word list.' : `${today.studied.length} of 50 daily items studied. Continue with the remaining words.`;
      emptyAction = complete ? 'test' : mode === 'review' ? 'study' : 'unfinished';
      $('empty-action').textContent = complete ? 'View daily test →' : mode === 'review' ? 'Back to daily study →' : 'Continue unstudied words →';
      return;
    }
    if (mode === 'today' && category === 'all') today.cursor = position;
    $('word-number').textContent = `WORD ${String(DATA.indexOf(word)+1).padStart(3,'0')}`;
    $('level-tag').textContent = word.level; $('category-tag').textContent = word.category; $('kind-tag').textContent = word.kind === 'idiom' ? 'IDIOM' : word.kind === 'phrasal' ? 'PHRASAL VERB' : 'WORD';
    $('word-button').textContent = word.word;
    $('word-button').classList.toggle('long-word',word.word.length > 11); $('word-button').classList.toggle('phrase',word.kind !== 'word');
    $('word-button').setAttribute('aria-label',`${word.word}. Click to ${revealed ? 'hide' : 'show'} the Korean meaning.`);
    $('word-button').setAttribute('aria-expanded',String(revealed));
    $('part-of-speech').textContent = posName(word.pos);
    showExample($('example-sentence'),word);
    $('meaning-hidden').hidden = revealed; $('meaning-content').hidden = !revealed;
    $('word-meaning').textContent = revealed ? word.meaning : '';
    $('example-translation').textContent = revealed ? word.translation : '';
    $('card-progress-text').textContent = `${position+1} / ${pool.length}`;
    $('card-progress-fill').style.width = `${(position+1)/pool.length*100}%`;
  }
  function renderStats() {
    const known = Object.values(state.ratings).filter(value => value === 'known').length;
    const review = Object.values(state.ratings).filter(value => value === 'review').length;
    $('known-count').textContent = known; $('review-count').textContent = review; $('tab-review-count').textContent = review;
    $('unseen-count').textContent = DATA.length-known-review; $('total-count').textContent = DATA.length; $('nav-total').textContent = DATA.length;
    const count = today.studied.length, eligible = C.canQuiz(state,todayKey);
    $('today-count').textContent = count; $('daily-progress-fill').style.width = `${count / C.DAILY_TARGET * 100}%`; $('daily-progress').setAttribute('aria-valuenow',String(count));
    $('daily-message').textContent = today.passed ? 'Daily target passed: study and test complete.' : eligible ? 'Study complete. Pass the test to complete today.' : `${C.DAILY_TARGET-count} items remaining before the test unlocks.`;
    $('daily-status-label').textContent = today.passed ? 'DAY PASSED' : eligible ? 'TEST READY' : 'TEST LOCKED';
    $('daily-status-label').parentElement?.classList.toggle('passed',today.passed);
    $('daily-best-score').textContent = today.attempts.length ? `${today.bestScore} / 50` : '— / 50';
    $('nav-test-state').textContent = today.passed ? 'Passed' : eligible ? 'Ready' : 'Locked';
    $('date-label').textContent = new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',month:'short',day:'numeric',year:'numeric'}).format(new Date());
    renderCalendar();
  }
  function renderCalendar() {
    const [year,month] = calendarMonth.split('-').map(Number);
    const first = new Date(Date.UTC(year,month-1,1));
    $('calendar-month').textContent = new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'long',year:'numeric'}).format(first);
    $('calendar-grid').replaceChildren();
    const offset = (first.getUTCDay()+6)%7;
    for (let i=0;i<offset;i++) $('calendar-grid').append(make('span','calendar-blank',''));
    const length = new Date(Date.UTC(year,month,0)).getUTCDate();
    for (let day=1;day<=length;day++) {
      const key = `${calendarMonth}-${String(day).padStart(2,'0')}`, record = state.days[key];
      const passed = !!record?.passed && record.studied.length === (record.target || C.DAILY_TARGET);
      const progress = !passed && (record?.studied.length > 0 || record?.attempts.length > 0);
      const future = key > todayKey;
      const cell = make('button',`calendar-day${key===todayKey?' today':''}${passed?' passed':''}${progress?' in-progress':''}${future?' future':''}`,String(day));
      cell.type = 'button'; cell.disabled = future;
      const status = passed ? `Passed. Best score ${record.bestScore} of 50.` : record ? `${record.studied.length} of ${record.target || C.DAILY_TARGET} items studied. Not passed.` : 'No recorded activity.';
      cell.setAttribute('aria-label',`${key}. ${status}`); cell.title = `${key}: ${status}`;
      if (key === todayKey) cell.setAttribute('aria-current','date');
      cell.addEventListener('click',action(() => toast(`${key}: ${status}`)));
      $('calendar-grid').append(cell);
    }
  }
  function reveal() { if (!currentWord()) return; const restore = document.activeElement === $('reveal-button') || document.activeElement === $('hide-meaning'); revealed = !revealed; renderStudy(); if (restore) $(revealed ? 'hide-meaning' : 'reveal-button').focus({preventScroll:true}); }
  function rate(status) {
    const word = currentWord(); if (!word) return;
    if (!C.rate(state,todayKey,word.id,status)) state.ratings[word.id] = status;
    position++; revealed = false;
    if (mode === 'today' && category === 'all') today.cursor = position;
    save(); renderStudy(); renderStats();
    if (!currentWord()) $('empty-action').focus({preventScroll:true});
  }
  function move(direction) { if (direction<0 && position>0) position--; else if (direction>0 && currentWord()) position++; else return; revealed=false; if(mode==='today'&&category==='all')today.cursor=position;renderStudy();save(); }
  function setView(next) {
    if (next !== view) stopPronunciation();
    closeLookup();
    view = next;
    ['learn','test','collection'].forEach(name => { $(`${name==='learn'?'learning':name}-view`).hidden = name!==view; $(`nav-${name}`).classList.toggle('active',name===view); $(`nav-${name}`).setAttribute('aria-current',name===view?'page':'false'); });
    const titles = {learn:['Study','Daily vocabulary','50 items. 50 test questions. Score 90% to pass.'],test:['Daily test','Daily spelling test','Translate Korean meanings into English, one item at a time. 45 correct answers required.'],collection:['Word list','Vocabulary list','Words, idioms, and phrasal verbs. Daily sets focus on B2–C1.']};
    const [label,title,description] = titles[view]; $('breadcrumb-current').textContent=label;$('page-title').textContent=title;$('page-description').textContent=description;
    if (view==='learn') { if(collectionChanged){collectionChanged=false;beginStudy({resume:true});}else renderStudy(); }
    else if(view==='test') renderTest(); else renderCollection();
    renderStats();
  }
  function renderCollection(reset = false) {
    if (reset === true) collectionLimit = 100;
    const query=$('word-search').value.trim().toLowerCase(),filter=$('collection-filter').value,kind=$('collection-kind').value;
    const words=DATA.filter(word => (kind === 'all' || word.kind === kind) && `${word.word} ${word.meaning}`.toLowerCase().includes(query) && (filter==='all'||(filter==='unseen'?!state.ratings[word.id]:state.ratings[word.id]===filter)));
    $('collection-result-count').textContent=`${Math.min(collectionLimit,words.length)} of ${words.length} entries`; $('load-more').hidden = words.length <= collectionLimit; $('collection-list').replaceChildren();$('collection-list').hidden=!words.length;$('collection-empty').hidden=!!words.length;
    const fragment=document.createDocumentFragment();
    words.slice(0,collectionLimit).forEach(word => {
      const status=state.ratings[word.id],row=make('div','collection-row'),button=make('button','collection-word');button.type='button';button.setAttribute('aria-label',`View ${word.word}`);
      const name=make('span','',word.word);name.append(make('small','',word.pos));const meaning=make('span','collection-meaning',word.meaning);meaning.lang='ko';button.append(name,meaning);button.addEventListener('click',action(()=>openDetail(word.id)));
      const level=make('span','collection-level',word.level),tag=make('span',`row-status ${status||''}`,status==='known'?'Known':status==='review'?'Review':'Unstudied');
      const bookmark=make('button',`collection-review${status==='review'?' is-review':''}`);bookmark.type='button';bookmark.dataset.wordId=word.id;bookmark.innerHTML=svg('bookmark');bookmark.setAttribute('aria-label',`${status==='review'?'Remove':'Add'} ${word.word} ${status==='review'?'from':'to'} review`);bookmark.setAttribute('aria-pressed',String(status==='review'));bookmark.addEventListener('click',action(()=>toggleReview(word.id)));
      row.append(button,level,tag,bookmark);fragment.append(row);
    });$('collection-list').append(fragment);
  }
  function toggleReview(id) {
    const focus=document.activeElement?.classList.contains('collection-review');
    if(state.ratings[id]==='review')delete state.ratings[id];else state.ratings[id]='review';collectionChanged=true;save();renderStats();renderCollection();
    if(focus)($('collection-list').querySelector(`[data-word-id="${id}"]`)||$('collection-list').querySelector('.collection-review')||$('collection-filter')).focus({preventScroll:true});
    if(detailId===id&&$('detail-dialog').open)$('detail-review').textContent=state.ratings[id]==='review'?'Remove from review':'Add to review';
    toast(state.ratings[id]==='review'?'Added to review.':'Removed from review.');
  }
  function openDetail(id) { const word=BY_ID.get(id);if(!word)return;stopPronunciation();closeLookup();detailId=id;$('detail-category').textContent=`${word.level} · ${word.kind === "word" ? "Word" : word.kind === "idiom" ? "Idiom" : "Phrasal verb"} · ${word.category} · ${posName(word.pos)}`;$('detail-title').textContent=word.word;$('detail-meaning').textContent=word.meaning;$('detail-example').textContent=word.example;$('detail-translation').textContent=word.translation;$('detail-review').textContent=state.ratings[id]==='review'?'Remove from review':'Add to review';$('detail-dialog').showModal(); }
  function renderTest(focus=false) {
    const eligible=C.canQuiz(state,todayKey),quiz=today.quiz;
    const gated=!eligible||!quiz;
    $('test-gate').hidden=!gated;$('quiz-active').hidden=gated||quiz?.submitted;$('quiz-result').hidden=gated||!quiz?.submitted;
    if(gated){$('gate-title').textContent=eligible?"Ready for today's test":"Complete today's study first";$('gate-description').textContent=eligible?'All 50 daily items, one at a time. Type each English spelling. At least 45 correct answers required.':`${today.studied.length} / 50 items studied. Mark each daily item to unlock the test.`;$('test-start').textContent=eligible?'Start 50-question test':'Continue studying';return;}
    if(quiz.submitted){renderResults(quiz);return;}
    const index=Math.min(49,Math.max(0,quiz.cursor||0)),word=BY_ID.get(quiz.ids[index]);quiz.cursor=index;
    $('quiz-number').textContent=`QUESTION ${String(index+1).padStart(2,'0')} / 50`;$('quiz-meaning').textContent=word.meaning;$('quiz-pos').textContent=posName(word.pos);$('quiz-answer').value=quiz.answers[word.id]||'';$('quiz-previous').disabled=index===0;$('quiz-next').textContent=index===49?'Submit test →':'Next →';
    renderQuizProgress();save();if(focus)$('quiz-answer').focus({preventScroll:true});
  }
  function renderQuizProgress() {
    const quiz=today.quiz;if(!quiz||quiz.submitted)return;
    const answered=quiz.ids.filter(id=>C.normalize(quiz.answers[id])).length;
    $('quiz-answered').textContent=`${answered} / 50 answered`;
    $('quiz-progress-fill').style.width=`${(quiz.cursor+1)/C.QUIZ_SIZE*100}%`;
    $('quiz-progress').setAttribute('aria-valuenow',String(quiz.cursor+1));
    $('quiz-submit-top').hidden=quiz.cursor!==C.QUIZ_SIZE-1;
  }
  function captureAnswer() {const quiz=today.quiz;if(!quiz||quiz.submitted)return;C.setAnswer(state,todayKey,quiz.ids[quiz.cursor||0],$('quiz-answer').value);save();}
  function nextQuestion(direction) { const quiz=today.quiz;if(!quiz||quiz.submitted)return;captureAnswer();if(direction>0&&quiz.cursor===49){requestSubmit();return;}quiz.cursor=Math.min(49,Math.max(0,quiz.cursor+direction));renderTest(true); }
  function requestSubmit() {if(!today.quiz||today.quiz.submitted)return;captureAnswer();const missing=today.quiz.ids.filter(id=>!C.normalize(today.quiz.answers[id])).length;$('submit-description').textContent=missing?`${missing} unanswered question${missing===1?'':'s'} will be marked incorrect. You need 45 correct answers to pass.`:'All 50 questions are answered. Submit to see your score.';$('submit-dialog').showModal();}
  function renderResults(quiz) {
    $('result-badge').textContent=quiz.passed?'PASSED':'NOT PASSED';$('result-badge').classList.toggle('failed',!quiz.passed);$('result-title').textContent=quiz.passed?'Daily test passed':'Passing score not reached';$('result-score').textContent=quiz.score;$('result-percent').textContent=`${quiz.score*2}%`;
    $('result-description').textContent=quiz.passed?'You studied all 50 daily items and scored at least 90%. Today is marked as passed.':`You need 45 correct answers to pass. Review your answers and try the same 50 items in a new order.${today.passed?' Your earlier pass for today is preserved.':''}`;
    $('attempt-summary').textContent=`${today.attempts.length} attempt${today.attempts.length===1?'':'s'} · Best: ${today.bestScore}/50`;
    $('answer-review-list').replaceChildren();
    const correct=new Set(quiz.correctIds);
    quiz.ids.forEach((id,index)=>{const word=BY_ID.get(id),isCorrect=correct.has(id),row=make('div',`answer-review-row${isCorrect?'':' incorrect'}`),top=make('div','answer-review-top'),meaning=make('strong','',`${index+1}. ${word.meaning}`);meaning.lang='ko';top.append(meaning,make('span','',isCorrect?'CORRECT':'INCORRECT'));const detail=make('div','answer-detail');detail.append(make('span','',`Your answer: ${quiz.answers[id]?.trim()||'(no answer)'}`));const answer=make('span','');answer.append(document.createTextNode('Correct spelling: '),make('strong','',word.word));detail.append(answer);row.append(top,detail);$('answer-review-list').append(row);});
  }
  function startTest() {if(!C.canQuiz(state,todayKey)){mode='unseen';category='all';$('category-select').value='all';beginStudy();setView('learn');return;}C.startQuiz(state,todayKey);save();renderTest(true);renderStats();}
  let speechRequest = 0;
  let voiceStorageAvailable = true;
  function loadVoicePreference() {
    try {
      const saved = JSON.parse(localStorage.getItem(VOICE_KEY) || 'null');
      if (saved && typeof saved.voiceURI === 'string' && saved.voiceURI.length <= 1024 && typeof saved.name === 'string' && saved.name.length <= 256 && typeof saved.lang === 'string' && /^en[-_]gb(?:[-_]|$)/i.test(saved.lang)) return {voiceURI:saved.voiceURI,name:saved.name,lang:saved.lang};
    } catch { voiceStorageAvailable = false; }
    return null;
  }
  let voicePreference = loadVoicePreference();
  function stopPronunciation() { speechRequest++; window.speechSynthesis?.cancel(); }
  const voiceKey = voice => JSON.stringify({voiceURI:voice.voiceURI || '',name:voice.name || '',lang:voice.lang || ''});
  function britishVoices() {
    const voices = window.speechSynthesis?.getVoices() || [];
    return [...new Map(voices.filter(voice => /^en[-_]gb(?:[-_]|$)/i.test(voice.lang)).map(voice => [voiceKey(voice),voice])).values()];
  }
  function preferredVoice(voices) {
    if (!voicePreference) return null;
    return voices.find(voice => voicePreference.voiceURI && voice.voiceURI === voicePreference.voiceURI) || voices.find(voice => voice.name === voicePreference.name && voice.lang.toLowerCase().replace(/_/g,'-') === voicePreference.lang.toLowerCase().replace(/_/g,'-')) || null;
  }
  function britishVoice() { const voices = britishVoices(); return preferredVoice(voices) || voices[0] || null; }
  function renderVoiceSettings() {
    const supported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
    const voices = supported ? britishVoices() : [],selected = preferredVoice(voices),select = $('voice-select');
    select.replaceChildren();
    const defaultOption = make('option','','Default British voice'); defaultOption.value = ''; select.append(defaultOption);
    for (const voice of voices) { const option = make('option','',voice.name); option.value = voiceKey(voice); select.append(option); }
    select.value = selected ? voiceKey(selected) : ''; select.disabled = !voices.length;
    $('voice-preview').disabled = !voices.length;
    $('voice-status').textContent = !supported ? 'Pronunciation is not supported in this browser.' : !voices.length ? 'No British voices are available to this browser. Check your device voice settings, then reopen this page.' : voicePreference && !selected ? `Your saved voice is unavailable. Using ${voices[0].name} for now.` : `Using ${selected?.name || voices[0].name}. ${voiceStorageAvailable ? 'Your choice is saved in this browser.' : 'Your choice applies to this visit.'}`;
  }
  function chooseVoice() {
    stopPronunciation();
    const value = $('voice-select').value,voice = britishVoices().find(item => voiceKey(item) === value);
    if (value && !voice) { renderVoiceSettings(); return; }
    voicePreference = voice ? {voiceURI:voice.voiceURI || '',name:voice.name || '',lang:voice.lang} : null;
    try { localStorage.setItem(VOICE_KEY,JSON.stringify(voicePreference)); voiceStorageAvailable = true; }
    catch { voiceStorageAvailable = false; toast('Voice selected for this visit. Browser storage is unavailable.'); }
    renderVoiceSettings();
  }
  function waitForBritishVoice() {
    const voice = britishVoice(); if (voice) return Promise.resolve(voice);
    return new Promise(resolve => {
      const synth = window.speechSynthesis;
      let finished = false, timer;
      const finish = () => { if(finished)return;finished=true;clearTimeout(timer);synth.removeEventListener?.('voiceschanged',onChange);resolve(britishVoice()); };
      const onChange = () => { if(britishVoice())finish(); };
      synth.addEventListener?.('voiceschanged',onChange);
      timer = setTimeout(finish,1200);
      onChange();
    });
  }
  async function playBritishText(text,isActive) {
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) { toast('Pronunciation is not supported in this browser.'); return; }
    const request = ++speechRequest;
    window.speechSynthesis.cancel();
    const voice = await waitForBritishVoice();
    if (request !== speechRequest || !isActive()) return;
    if (!voice) { toast('An English (United Kingdom) voice is not available. Enable one in your browser or device settings.'); return; }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-GB'; utterance.voice = voice; utterance.rate = .85;
    utterance.onerror = event => { if(!['canceled','interrupted'].includes(event.error))toast('Audio could not be played. Check your browser voice settings.'); };
    window.speechSynthesis.speak(utterance);
  }
  function speak() {
    const word = currentWord(); if (!word) return;
    return playBritishText(word.word,() => word.id === currentWord()?.id && view === 'learn' && !$('about-dialog').open);
  }
  function previewVoice() { return playBritishText('The next train leaves at half past three.',() => $('about-dialog').open); }
  // Start loading device voices before the first pronunciation button press.
  if ('speechSynthesis' in window) { window.speechSynthesis.getVoices(); window.speechSynthesis.addEventListener?.('voiceschanged',renderVoiceSettings); }
  renderVoiceSettings();
  $('voice-select').addEventListener('change',action(chooseVoice));
  $('voice-preview').addEventListener('click',action(previewVoice));
  ['close','cancel'].forEach(event => $('about-dialog').addEventListener(event,stopPronunciation));
  $('word-button').addEventListener('click',action(reveal));$('reveal-button').addEventListener('click',action(reveal));$('audio-button').addEventListener('click',action(speak));
  $('hide-meaning').addEventListener('click',action(() => {if(revealed)reveal();}));
  $('lookup-close').addEventListener('click',() => closeLookup(true));
  document.addEventListener('keydown',event => {if(event.key === 'Escape' && view === 'learn' && !['detail-dialog','about-dialog','submit-dialog'].some(id=>$(id).open) && !$('word-lookup').hidden){event.preventDefault();closeLookup(true);}});
  $('rate-review').addEventListener('click',action(()=>rate('review')));$('rate-known').addEventListener('click',action(()=>rate('known')));$('previous-button').addEventListener('click',action(()=>move(-1)));$('next-button').addEventListener('click',action(()=>move(1)));
  $('shuffle-button').addEventListener('click',action(()=>{for(let i=pool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}if(mode==='today'&&category==='all')today.ids=[...pool];position=0;revealed=false;renderStudy();save();toast('Study order shuffled.');}));
  $('category-select').addEventListener('change',action(e=>{category=e.target.value;beginStudy();}));document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',action(()=>{mode=button.dataset.mode;beginStudy();})));
  $('empty-action').addEventListener('click',action(()=>{if(emptyAction==='test'){setView('test');return;}mode=emptyAction==='unfinished'?'unseen':'today';category='all';$('category-select').value='all';beginStudy();}));
  ['learn','test','collection'].forEach(name=>$(`nav-${name}`).addEventListener('click',action(()=>setView(name))));document.querySelector('.brand').addEventListener('click',action(e=>{e.preventDefault();setView('learn');}));
  ['banner-test','rail-test'].forEach(id=>$(id).addEventListener('click',action(()=>setView('test'))));$('test-start').addEventListener('click',action(startTest));$('test-retake').addEventListener('click',action(startTest));
  $('result-study').addEventListener('click',action(()=>{mode='today';category='all';$('category-select').value='all';beginStudy();setView('learn');}));
  $('quiz-answer').addEventListener('input',action(()=>{captureAnswer();renderQuizProgress();}));$('quiz-form').addEventListener('submit',action(e=>{e.preventDefault();nextQuestion(1);}));$('quiz-next').addEventListener('click',action(()=>nextQuestion(1)));$('quiz-previous').addEventListener('click',action(()=>nextQuestion(-1)));$('quiz-submit-top').addEventListener('click',action(requestSubmit));$('cancel-submit').addEventListener('click',()=>{$('submit-dialog').close();$('quiz-answer').focus();});$('confirm-submit').addEventListener('click',action(()=>{const result=C.submitQuiz(state,todayKey);if(!result)return;$('submit-dialog').close();save();renderTest();renderStats();$('result-title').setAttribute('tabindex','-1');$('result-title').focus({preventScroll:true});}));
  $('word-search').addEventListener('input',action(()=>renderCollection(true)));$('collection-filter').addEventListener('change',action(()=>renderCollection(true)));$('collection-kind').addEventListener('change',action(()=>renderCollection(true)));$('load-more').addEventListener('click',action(()=>{collectionLimit+=100;renderCollection();}));$('detail-close').addEventListener('click',()=>$('detail-dialog').close());$('detail-review').addEventListener('click',action(()=>{if(detailId)toggleReview(detailId);}));
  function showAbout(){stopPronunciation();closeLookup();renderVoiceSettings();$('reset-confirm').hidden=true;$('reset-progress').hidden=false;$('about-dialog').showModal();}
  $('about-button').addEventListener('click',showAbout);$('mobile-about').addEventListener('click',showAbout);$('about-close').addEventListener('click',()=>{stopPronunciation();$('about-dialog').close();});$('reset-progress').addEventListener('click',()=>{$('reset-confirm').hidden=false;$('reset-progress').hidden=true;});$('cancel-reset').addEventListener('click',()=>{$('reset-confirm').hidden=true;$('reset-progress').hidden=false;});
  $('confirm-reset').addEventListener('click',action(()=>{state=C.emptyState();today=C.day(state,todayKey);mode='today';category='all';$('category-select').value='all';collectionChanged=false;beginStudy();setView('learn');save();$('about-dialog').close();toast('All study progress and test records have been reset.');}));
  ['detail-dialog','about-dialog','submit-dialog'].forEach(id=>$(id).addEventListener('click',event=>{if(event.target!==$(id))return;const rect=$(id).getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)$(id).close();}));
  ['prev','next'].forEach(direction=>$(`calendar-${direction}`).addEventListener('click',action(()=>{const[y,m]=calendarMonth.split('-').map(Number),date=new Date(Date.UTC(y,m-1+(direction==='prev'?-1:1),1));calendarMonth=`${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}`;renderCalendar();})));
  document.addEventListener('keydown',event=>{if(ensureToday()||view!=='learn'||['detail-dialog','about-dialog','submit-dialog'].some(id=>$(id).open)||event.ctrlKey||event.metaKey||event.altKey||event.repeat)return;if(event.target?.closest('input, select, textarea, [contenteditable="true"]'))return;if(event.code==='Space'){if(event.target?.closest('button, a'))return;event.preventDefault();reveal();}else if(event.key==='1'){event.preventDefault();rate('review');}else if(event.key==='2'){event.preventDefault();rate('known');}else if(event.key==='ArrowLeft'){event.preventDefault();move(-1);}else if(event.key==='ArrowRight'){event.preventDefault();move(1);}});
  window.addEventListener('focus',() => {ensureToday();renderVoiceSettings();});setInterval(ensureToday,60000);
  beginStudy({resume:true});setView('learn');save();
})();
