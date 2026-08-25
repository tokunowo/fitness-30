
const KEY='tosinFitness30.v1';
function load(){try{return JSON.parse(localStorage.getItem(KEY))||{}}catch(e){return {}}}
function save(s){localStorage.setItem(KEY,JSON.stringify(s));render()}
let state=load();
function dayState(n){state.days ??={}; state.days[n] ??={checks:{},done:false,feel:'',notes:''}; return state.days[n]}
function currentDayIndex(){
  const today=new Date(); today.setHours(0,0,0,0);
  const start=new Date(PLAN[0].date+'T00:00:00');
  let idx=Math.floor((today-start)/(86400000));
  return Math.max(0,Math.min(PLAN.length-1,idx));
}
let selected=currentDayIndex();

function pct(){return Math.round(PLAN.filter(p=>dayState(p.day).done).length/PLAN.length*100)}
function streak(){
  let s=0; for(const p of PLAN){if(dayState(p.day).done)s++; else break;} return s;
}
function renderToday(){
 const p=PLAN[selected], ds=dayState(p.day);
 const ex=p.exercises.map((e,i)=>`
 <div class="exercise">
   <input type="checkbox" ${ds.checks[i]?'checked':''} onchange="toggleCheck(${p.day},${i},this.checked)">
   <div><h3>${e.name}</h3><div class="work">${e.work}</div><div class="cue">${e.cue}</div></div>
   ${e.video?`<a class="watch" href="${e.video}" target="_blank" rel="noopener">▶ Watch</a>`:''}
 </div>`).join('');
 document.getElementById('todayView').innerHTML=`
  <div class="card">
   <div class="dayline">DAY ${p.day} OF 30 • ${p.dateLabel}</div>
   <h2>${p.title}</h2>
   <div class="muted">Target time: ${p.target} • Rest 60–90 sec between strength sets.</div>
  </div>
  <div class="card">${ex}
   <button class="complete ${ds.done?'done':''}" onclick="completeDay(${p.day})">${ds.done?'✓ DAY COMPLETE — TAP TO REOPEN':'COMPLETE DAY '+p.day}</button>
  </div>
  <div class="card">
   <h3>Quick Check-In</h3>
   <div class="metrics">
    <label>How I felt (1–10)<input type="number" min="1" max="10" value="${ds.feel||''}" onchange="setField(${p.day},'feel',this.value)"></label>
    <label>Notes<textarea onchange="setField(${p.day},'notes',this.value)">${ds.notes||''}</textarea></label>
   </div>
  </div>`;
}
window.toggleCheck=(d,i,v)=>{let ds=dayState(d);ds.checks[i]=v;localStorage.setItem(KEY,JSON.stringify(state));updateHeader()}
window.completeDay=(d)=>{let ds=dayState(d);ds.done=!ds.done;if(ds.done){PLAN[d-1].exercises.forEach((_,i)=>ds.checks[i]=true)}save(state)}
window.setField=(d,f,v)=>{dayState(d)[f]=v;localStorage.setItem(KEY,JSON.stringify(state))}
function renderCalendar(){
 document.getElementById('calendarView').innerHTML=`<div class="card"><h2>30-Day Calendar</h2><p class="muted">Tap any day to open it. Your progress is saved on this device.</p><div class="calendar">${
 PLAN.map((p,i)=>`<div class="daycard ${dayState(p.day).done?'done':''} ${i===currentDayIndex()?'current':''}" onclick="selected=${i};switchView('today')"><div class="n">Day ${p.day} ${dayState(p.day).done?'✓':''}</div><div>${p.dateLabel}</div><div class="t">${p.title}</div></div>`).join('')
 }</div></div>`;
}
function renderProgress(){
 const done=PLAN.filter(p=>dayState(p.day).done).length;
 const feelings=PLAN.map(p=>Number(dayState(p.day).feel)).filter(Boolean);
 const avg=feelings.length?(feelings.reduce((a,b)=>a+b,0)/feelings.length).toFixed(1):'—';
 document.getElementById('progressView').innerHTML=`
 <div class="card"><h2>Your Progress</h2>
  <div class="bar"><div style="width:${pct()}%"></div></div>
  <div class="stats" style="margin-top:14px">
   <div class="stat"><b>${done}</b><span>Days complete</span></div>
   <div class="stat"><b>${pct()}%</b><span>Program complete</span></div>
   <div class="stat"><b>${avg}</b><span>Avg. feeling</span></div>
  </div>
 </div>
 <div class="card"><h3>Progress is private</h3><p class="muted">This version stores your checkmarks, notes and completion status in your browser using local storage. Nothing is uploaded unless you later choose cloud sync.</p></div>`;
}
function updateHeader(){document.getElementById('progressPct').textContent=pct()+'%'}
function switchView(name){
 document.querySelectorAll('.view').forEach(x=>x.classList.add('hidden'));
 document.getElementById(name+'View').classList.remove('hidden');
 document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
 if(name==='today')renderToday(); if(name==='calendar')renderCalendar(); if(name==='progress')renderProgress();
 window.scrollTo({top:0,behavior:'smooth'});
}
window.switchView=switchView;
document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>switchView(b.dataset.view));
function render(){renderToday();renderCalendar();renderProgress();updateHeader()}
render();
