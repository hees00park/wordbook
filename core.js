'use strict';
/* Daily vocabulary rules. CEFR labels and expression types come from the bank. */
(() => {
  const DAILY_TARGET=50,QUIZ_SIZE=50,PASS_COUNT=45;
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'});
  const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const dictionary=()=>Object.create(null);
  const normalize=value=>typeof value==='string'?value.normalize('NFKC').trim().toLowerCase().replace(/[‘’]/g,"'").replace(/[‐‑–]/g,'-').replace(/\s+/g,' '):'';
  const integer=(value,max)=>Number.isInteger(value)?Math.min(max,Math.max(0,value)):0;
  function dayKey(value=new Date()){const date=value instanceof Date?value:new Date(value);if(!Number.isFinite(date.getTime()))return'';const p=Object.fromEntries(formatter.formatToParts(date).map(x=>[x.type,x.value]));return`${p.year}-${p.month}-${p.day}`;}
  function validKey(key){if(typeof key!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(key))return false;const date=new Date(`${key}T00:00:00.000Z`);return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===key;}
  function seededRandom(text){let seed=2166136261;for(let i=0;i<text.length;i++)seed=Math.imul(seed^text.charCodeAt(i),16777619);return()=>{let value=seed+=0x6D2B79F5;value=Math.imul(value^value>>>15,value|1);value^=value+Math.imul(value^value>>>7,value|61);return((value^value>>>14)>>>0)/4294967296;};}
  function shuffled(values,random){const result=[...values];for(let i=result.length-1;i>0;i--){const draw=Number(random()),fraction=Number.isFinite(draw)?Math.max(0,Math.min(1-Number.EPSILON,draw)):0;const j=Math.floor(fraction*(i+1));[result[i],result[j]]=[result[j],result[i]];}return result;}
  function create(data,options={}){
    const words=new Map();
    for(const item of Array.isArray(data)?data:[])if(record(item)&&typeof item.id==='string'&&item.id&&typeof item.word==='string'&&item.word.trim()&&!words.has(item.id))words.set(item.id,item);
    const ids=[...words.keys()];
    const clock=typeof options.now==='function'?options.now:()=>new Date(),today=()=>dayKey(clock());
    const emptyState=()=>({version:4,ratings:dictionary(),days:dictionary(),previousPlans:dictionary()});
    const uniqueIds=value=>Array.isArray(value)?[...new Set(value.filter(id=>typeof id==='string'&&words.has(id)))]:[];
    const isExpression=id=>['idiom','phrasal'].includes(words.get(id).kind);
    function cleanAnswers(raw,allowed){const answers=dictionary();if(record(raw))for(const id of allowed)if(typeof raw[id]==='string')answers[id]=raw[id].slice(0,512);return answers;}
    function grade(quiz){
      const accepted=new Map(),promptKeys=new Map();
      for(const id of quiz.ids){
        const word=words.get(id),meaning=normalize(word.meaning);
        // Identical prompts cannot distinguish synonyms; accept those in this test.
        // Missing meanings remain separate so unrelated entries never share answers.
        const key=meaning?'prompt:'+JSON.stringify([normalize(word.pos),meaning]):'id:'+id;
        promptKeys.set(id,key);if(!accepted.has(key))accepted.set(key,new Set());
        for(const answer of[word.word,...(Array.isArray(word.aliases)?word.aliases:[])]){const value=normalize(answer);if(value)accepted.get(key).add(value);}
      }
      quiz.correctIds=quiz.ids.filter(id=>{const answer=normalize(quiz.answers[id]);return answer!==''&&accepted.get(promptKeys.get(id)).has(answer);});
      quiz.score=quiz.correctIds.length;quiz.passed=quiz.score>=PASS_COUNT;return quiz;
    }
    function cleanQuiz(raw,allowed,forceSubmitted=false){
      if(!record(raw)||!Array.isArray(raw.ids)||raw.ids.length!==QUIZ_SIZE)return null;
      const selected=uniqueIds(raw.ids);if(selected.length!==QUIZ_SIZE||!selected.every(id=>allowed.has(id)))return null;
      const quiz={ids:selected,answers:cleanAnswers(raw.answers,selected),cursor:integer(raw.cursor,QUIZ_SIZE-1),submitted:forceSubmitted||raw.submitted===true};
      if(typeof raw.submittedAt==='string'&&Number.isFinite(Date.parse(raw.submittedAt)))quiz.submittedAt=raw.submittedAt;
      if(quiz.submitted)grade(quiz);return quiz;
    }
    function cleanDay(raw,target){
      if(!record(raw)||!Array.isArray(raw.ids))return null;
      const selected=uniqueIds(raw.ids);if(selected.length!==Math.min(target,ids.length)||raw.ids.length!==selected.length||!selected.length)return null;
      const allowed=new Set(selected),studied=uniqueIds(raw.studied).filter(id=>allowed.has(id));
      const complete=selected.length===target&&studied.length===target;
      const quiz=complete?cleanQuiz(raw.quiz,allowed):null;
      const attempts=complete&&Array.isArray(raw.attempts)?raw.attempts.map(item=>cleanQuiz(item,allowed,true)).filter(Boolean):[];
      const results=[...attempts,...(quiz?.submitted?[quiz]:[])];
      return{target,planVersion:4,ids:selected,studied,cursor:integer(raw.cursor,selected.length),quiz,attempts,passed:results.some(q=>q.passed),bestScore:Math.max(0,...results.map(q=>q.score))};
    }
    function selectDaily(state,key,preferred=[]){
      const lastAssigned=dictionary(),preferredIds=new Set(preferred);
      for(const priorKey of Object.keys(state.days).filter(d=>validKey(d)&&d<key).sort())for(const id of state.days[priorKey]?.ids||[])if(words.has(id))lastAssigned[id]=priorKey;
      const random=seededRandom(`wordbook:daily50:v4:${key}`);
      const rank=values=>shuffled(values,random).sort((a,b)=>Number(preferredIds.has(b))-Number(preferredIds.has(a))||(lastAssigned[a]||'').localeCompare(lastAssigned[b]||''));
      // B2 30, C1 15, B1 3, C2 2;40 single words +10 expressions.
      const buckets=[{level:'B2',expression:false,size:24},{level:'B2',expression:true,size:6},{level:'C1',expression:false,size:12},{level:'C1',expression:true,size:3},{level:'B1',expression:false,size:3},{level:'C2',expression:false,size:1},{level:'C2',expression:true,size:1}];
      const selected=[],selectedSet=new Set();
      const take=(bucket,predicate)=>{const chosen=rank(ids.filter(id=>!selectedSet.has(id)&&predicate(id))).slice(0,bucket.remaining);for(const id of chosen){selected.push(id);selectedSet.add(id);}bucket.remaining-=chosen.length;};
      for(const bucket of buckets){bucket.remaining=bucket.size;take(bucket,id=>words.get(id).level===bucket.level&&isExpression(id)===bucket.expression);}
      // Reserve all exact matches before borrowing a missing kind within its level.
      for(const bucket of buckets)if(bucket.remaining)take(bucket,id=>words.get(id).level===bucket.level);
      // A depleted level falls back to other levels, preferring the requested kind.
      for(const bucket of buckets)if(bucket.remaining)take(bucket,id=>isExpression(id)===bucket.expression);
      for(const bucket of buckets)if(bucket.remaining)take(bucket,()=>true);
      return shuffled(selected,random);
    }
    const newDay=(selected,studied=[])=>({target:DAILY_TARGET,planVersion:4,ids:selected,studied,cursor:0,quiz:null,attempts:[],passed:false,bestScore:0});
    function hydrate(raw){
      const state=emptyState();if(!record(raw))return state;
      if(record(raw.ratings))for(const id of ids)if(['known','review'].includes(raw.ratings[id]))state.ratings[id]=raw.ratings[id];
      if(record(raw.previousPlans))for(const[key,value]of Object.entries(raw.previousPlans))if(validKey(key)&&key<=today()){const archived=cleanDay(value,200);if(archived)state.previousPlans[key]=archived;}
      if(!record(raw.days))return state;
      for(const key of Object.keys(raw.days).sort()){
        const rawDay=raw.days[key];if(!validKey(key)||key>today()||!record(rawDay))continue;
        const legacy=Array.isArray(rawDay.ids)&&rawDay.ids.length===200;
        const cleaned=cleanDay(rawDay,legacy?200:DAILY_TARGET);if(!cleaned)continue;
        if(legacy&&key===today()){
          state.previousPlans[key]=cleaned;
          const selected=selectDaily(state,key,cleaned.studied),studied=selected.filter(id=>cleaned.studied.includes(id));
          state.days[key]=newDay(selected,studied);
        }else{
          const started=(Array.isArray(rawDay.studied)&&rawDay.studied.length>0)||record(rawDay.quiz)||(Array.isArray(rawDay.attempts)&&rawDay.attempts.length>0);
          const olderPlan=!Number.isInteger(rawDay.planVersion)||rawDay.planVersion<4;
          state.days[key]=key===today()&&olderPlan&&!started?newDay(selectDaily(state,key)):cleaned;
        }
      }
      return state;
    }
    function day(state,key=today()){
      if(!record(state)||!validKey(key)||key>today())return null;
      if(!record(state.days))state.days=dictionary();
      if(Object.prototype.hasOwnProperty.call(state.days,key))return state.days[key];
      if(key!==today())return null;
      state.days[key]=newDay(selectDaily(state,key));return state.days[key];
    }
    const currentDay=(state,key)=>key===today()?day(state,key):null;
    function rate(state,key,id,status){if(!['known','review'].includes(status))return false;const current=currentDay(state,key);if(!current||!current.ids.includes(id))return false;if(!record(state.ratings))state.ratings=dictionary();state.ratings[id]=status;if(!current.studied.includes(id))current.studied.push(id);return true;}
    function canQuiz(state,key=today()){const current=currentDay(state,key);return!!(current&&current.ids.length===DAILY_TARGET&&new Set(current.studied.filter(id=>current.ids.includes(id))).size===DAILY_TARGET);}
    function startQuiz(state,key=today(),random=Math.random){
      if(!canQuiz(state,key))return null;const current=day(state,key);if(current.quiz&&!current.quiz.submitted)return current.quiz;
      const previous=current.quiz?.ids||[],selected=shuffled(current.ids,typeof random==='function'?random:Math.random);
      // Every test covers the complete daily50. Retakes change order, never coverage.
      if(selected.length>1&&selected.every((id,i)=>id===previous[i]))selected.push(selected.shift());
      current.quiz={ids:selected,answers:dictionary(),cursor:0,submitted:false};return current.quiz;
    }
    function setAnswer(state,key,id,text){const quiz=currentDay(state,key)?.quiz;if(!quiz||quiz.submitted||!quiz.ids.includes(id)||typeof text!=='string')return false;quiz.answers[id]=text.slice(0,512);return true;}
    function submitQuiz(state,key=today()){
      if(!canQuiz(state,key))return null;const current=day(state,key),quiz=current.quiz;if(!quiz)return null;if(quiz.submitted)return quiz;
      quiz.submitted=true;quiz.submittedAt=new Date(clock()).toISOString();grade(quiz);
      current.attempts.push({...quiz,ids:[...quiz.ids],answers:{...quiz.answers},correctIds:[...quiz.correctIds]});current.passed=current.passed||quiz.passed;current.bestScore=Math.max(current.bestScore,quiz.score);return quiz;
    }
    return{DAILY_TARGET,QUIZ_SIZE,PASS_COUNT,emptyState,hydrate,dayKey,normalize,day,rate,canQuiz,startQuiz,setAnswer,submitQuiz};
  }
  const api={create,dayKey,normalize,DAILY_TARGET,QUIZ_SIZE,PASS_COUNT};globalThis.WordbookCore=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
