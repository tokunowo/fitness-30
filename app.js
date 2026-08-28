
/* ---------- Interval sound + vibration cues ---------- */
let cueAudioContext = null;
let lastIntervalCueKey = "";

function ensureCueAudio() {
  try {
    if (!cueAudioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) cueAudioContext = new AudioCtx();
    }
    if (cueAudioContext?.state === "suspended") cueAudioContext.resume();
  } catch (err) {
    console.warn("Audio cue unavailable:", err);
  }
}

function playCueTone(kind = "countdown") {
  try {
    ensureCueAudio();
    if (!cueAudioContext) return;
    const ctx = cueAudioContext;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.type = "sine";
    oscillator.frequency.value = kind === "go" ? 1046.5 : 784;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(kind === "go" ? 0.22 : 0.14, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (kind === "go" ? 0.22 : 0.12));

    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + (kind === "go" ? 0.24 : 0.14));
  } catch (err) {
    console.warn("Could not play interval cue:", err);
  }
}

function vibrateCue(kind = "countdown") {
  try {
    if (!("vibrate" in navigator)) return;
    navigator.vibrate(kind === "go" ? [140, 70, 140] : 90);
  } catch (err) {
    console.warn("Vibration cue unavailable:", err);
  }
}

function fireIntervalCue(ds, kind, cueKey) {
  if (cueKey === lastIntervalCueKey) return;
  lastIntervalCueKey = cueKey;

  if (ds.interval?.soundEnabled !== false) playCueTone(kind);
  if (ds.interval?.vibrationEnabled !== false) vibrateCue(kind);
}

window.setIntervalCueOption = (dayNumber, field, checked) => {
  const ds = dayState(dayNumber);
  if (field === "soundEnabled") ds.interval.soundEnabled = Boolean(checked);
  if (field === "vibrationEnabled") ds.interval.vibrationEnabled = Boolean(checked);
  scheduleSave();
};

function checkIntervalCues(dayNumber, ds, snap) {
  if (!ds.interval?.running || !snap?.phase) return;

  // During a transition countdown, cue at 3, 2, and 1 seconds remaining.
  if (snap.phase.type === "transition") {
    const secondsLeft = Math.ceil(snap.remainingMs / 1000);
    if (secondsLeft >= 1 && secondsLeft <= 3) {
      fireIntervalCue(
        ds,
        "countdown",
        `${dayNumber}:${snap.phase.phaseIndex}:countdown:${secondsLeft}`
      );
    }
  }

  // At the first instant of a new work interval, play a distinct "GO" cue.
  if (snap.phase.type === "work") {
    const intoPhase = snap.elapsed - snap.phase.startMs;
    if (intoPhase >= 0 && intoPhase < 650) {
      fireIntervalCue(
        ds,
        "go",
        `${dayNumber}:${snap.phase.phaseIndex}:go`
      );
    }
  }
}

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

// Firebase web config is intentionally client-side.
// Access to workout data is protected by Firebase Authentication + Firestore Security Rules.
const firebaseConfig = {
  apiKey: "AIzaSyCkQ2ou_Bbmk8N-c5NZL36zLFkeQT-OSwM",
  authDomain: "gymverge-workout.firebaseapp.com",
  projectId: "gymverge-workout",
  storageBucket: "gymverge-workout.firebasestorage.app",
  messagingSenderId: "245696822644",
  appId: "1:245696822644:web:9a1c9aa29ba8838b4dc021"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

// IMPORTANT: keep the original localStorage key so existing progress is preserved.
const KEY = "tosinFitness30.v1";

let state = loadLocal();
let currentUser = null;
let cloudReady = false;
let syncTimer = null;
let selected = currentDayIndex();

setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.error("Auth persistence error:", error);
});

function loadLocal() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

function saveLocal() {
  localStorage.setItem(KEY, JSON.stringify(state));
}

function defaultSession() {
  return { running: false, startedAt: null, accumulatedMs: 0, lastCompletedMs: 0 };
}
function defaultInterval() {
  return { config: [], transitionSec: 3, running: false, startedAt: null, accumulatedMs: 0, lastCompletedMs: 0 };
}
function dayState(dayNumber) {
  state.days ??= {};
  state.days[dayNumber] ??= { checks: {}, done: false, feel: "", notes: "" };
  const ds = state.days[dayNumber];
  ds.checks ??= {};
  ds.done ??= false;
  ds.feel ??= "";
  ds.notes ??= "";
  ds.session ??= defaultSession();
  ds.interval ??= defaultInterval();
  return ds;
}

function currentDayIndex() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(PLAN[0].date + "T00:00:00");
  const idx = Math.floor((today - start) / 86400000);
  return Math.max(0, Math.min(PLAN.length - 1, idx));
}

function completionPercent() {
  const completed = PLAN.filter((p) => dayState(p.day).done).length;
  return Math.round((completed / PLAN.length) * 100);
}

function cloudDocRef(uid) {
  return doc(db, "users", uid, "fitness30", "progress");
}

// Merge is intentionally completion-preserving.
// This prevents a fresh device from erasing completed work already in the cloud.
function mergeStates(localState = {}, cloudState = {}) {
  const merged = {
    ...cloudState,
    ...localState,
    days: { ...(cloudState.days || {}) }
  };

  const dayKeys = new Set([
    ...Object.keys(cloudState.days || {}),
    ...Object.keys(localState.days || {})
  ]);

  for (const key of dayKeys) {
    const cloudDay = (cloudState.days || {})[key] || {};
    const localDay = (localState.days || {})[key] || {};

    merged.days[key] = {
      ...cloudDay,
      ...localDay,
      checks: { ...(cloudDay.checks || {}), ...(localDay.checks || {}) },
      done: Boolean(cloudDay.done || localDay.done),
      feel: localDay.feel || cloudDay.feel || "",
      notes: localDay.notes || cloudDay.notes || ""
    };
  }

  return merged;
}

function setAuthStatus(kind, text) {
  const el = document.getElementById("authStatus");
  el.className = kind || "";
  el.textContent = text;
}

async function loadCloudProgress() {
  if (!currentUser) return;

  setAuthStatus("syncing", "Loading cloud progress…");

  try {
    const snapshot = await getDoc(cloudDocRef(currentUser.uid));

    if (snapshot.exists()) {
      state = mergeStates(state, snapshot.data().state || {});
      saveLocal();
    }

    cloudReady = true;

    // First successful sign-in also migrates any existing browser-only progress to Firestore.
    await pushCloudProgress();
    render();

    setAuthStatus(
      "synced",
      `Signed in as ${currentUser.email} • Cloud synced`
    );
  } catch (error) {
    console.error("Cloud load error:", error);
    setAuthStatus(
      "error",
      `Signed in as ${currentUser.email} • Cloud sync error; local saving remains active`
    );
  }
}

async function pushCloudProgress() {
  saveLocal();

  if (!currentUser || !cloudReady) return;

  try {
    await setDoc(
      cloudDocRef(currentUser.uid),
      {
        state,
        programStart: PLAN[0].date,
        programEnd: PLAN[PLAN.length - 1].date,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    setAuthStatus(
      "synced",
      `Signed in as ${currentUser.email} • Cloud synced`
    );
  } catch (error) {
    console.error("Cloud save error:", error);
    setAuthStatus(
      "error",
      `Signed in as ${currentUser.email} • Saved locally; cloud sync failed`
    );
  }
}

function scheduleSave() {
  saveLocal();

  if (!currentUser || !cloudReady) return;

  setAuthStatus(
    "syncing",
    `Signed in as ${currentUser.email} • Syncing…`
  );

  clearTimeout(syncTimer);
  syncTimer = setTimeout(pushCloudProgress, 450);
}


function formatTime(ms) {
  ms = Math.max(0, Number(ms || 0));
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return h > 0
    ? `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`
    : `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
  })[ch]);
}
function sessionElapsedMs(ds, now = Date.now()) {
  const s = ds.session || defaultSession();
  return Math.max(0, Number(s.accumulatedMs || 0) +
    (s.running && s.startedAt ? now - Number(s.startedAt) : 0));
}
window.startWorkout = (dayNumber) => {
  const ds = dayState(dayNumber);
  if (!ds.session.running) {
    ds.session.running = true;
    ds.session.startedAt = Date.now();
    scheduleSave();
    render();
  }
};
window.pauseWorkout = (dayNumber) => {
  const ds = dayState(dayNumber);
  if (ds.session.running) {
    ds.session.accumulatedMs = sessionElapsedMs(ds);
    ds.session.running = false;
    ds.session.startedAt = null;
    scheduleSave();
    render();
  }
};
window.resetWorkoutTimer = (dayNumber) => {
  if (!confirm("Reset today's workout timer to 00:00? Your exercise checkmarks will not be changed.")) return;
  dayState(dayNumber).session = defaultSession();
  scheduleSave();
  render();
};


let intervalDrafts = {};

function ensureIntervalDraft(dayNumber) {
  const ds = dayState(dayNumber);
  if (!intervalDrafts[dayNumber]) {
    intervalDrafts[dayNumber] = {
      config: JSON.parse(JSON.stringify(ds.interval.config || [])),
      transitionSec: Number(ds.interval.transitionSec ?? 3)
    };
  }
  return intervalDrafts[dayNumber];
}
window.addIntervalDraftRow = (d) => {
  const draft = ensureIntervalDraft(d);
  draft.config.push({ label: `Interval ${draft.config.length + 1}`, durationSec: 60 });
  renderToday();
  requestAnimationFrame(() => {
    const details = document.getElementById(`intervalEditor-${d}`);
    if (details) details.open = true;
  });
};
window.removeIntervalDraftRow = (d, idx) => {
  const draft = ensureIntervalDraft(d);
  draft.config.splice(idx, 1);
  renderToday();
  requestAnimationFrame(() => {
    const details = document.getElementById(`intervalEditor-${d}`);
    if (details) details.open = true;
  });
};
window.updateIntervalDraftLabel = (d, idx, value) => {
  const draft = ensureIntervalDraft(d);
  if (draft.config[idx]) draft.config[idx].label = String(value).slice(0, 40);
};
window.updateIntervalDraftTime = (d, idx, part, value) => {
  const draft = ensureIntervalDraft(d);
  if (!draft.config[idx]) return;
  const cur = Number(draft.config[idx].durationSec || 0);
  let min = Math.floor(cur / 60), sec = cur % 60;
  if (part === "min") min = Math.max(0, Math.min(180, Number(value || 0)));
  else sec = Math.max(0, Math.min(59, Number(value || 0)));
  draft.config[idx].durationSec = min * 60 + sec;
};
window.updateIntervalDraftTransition = (d, value) => {
  ensureIntervalDraft(d).transitionSec = Math.max(0, Math.min(30, Number(value || 0)));
};
window.confirmIntervalSettings = (d) => {
  const ds = dayState(d);
  const draft = ensureIntervalDraft(d);
  ds.interval.config = JSON.parse(JSON.stringify(draft.config));
  ds.interval.transitionSec = draft.transitionSec;
  ds.interval.running = false;
  ds.interval.startedAt = null;
  ds.interval.accumulatedMs = 0;
  delete intervalDrafts[d];
  scheduleSave();
  render();
};
window.cancelIntervalSettings = (d) => {
  delete intervalDrafts[d];
  renderToday();
};

function runWalkPreset(dayNumber) {
  const presets = {
    2:{warm:300,jog:60,walk:90,reps:7,cool:300},
    9:{warm:300,jog:90,walk:120,reps:5,cool:300},
    16:{warm:300,jog:180,walk:120,reps:4,cool:300},
    23:{warm:300,jog:300,walk:120,reps:3,cool:300},
    30:{warm:300,jog:300,walk:120,reps:3,cool:300}
  };
  const p = presets[dayNumber];
  if (!p) return null;
  const out = [{label:"Warm-up Walk",durationSec:p.warm}];
  for (let i=1;i<=p.reps;i++) {
    out.push({label:`Jog ${i}`,durationSec:p.jog});
    out.push({label:`Walk ${i}`,durationSec:p.walk});
  }
  out.push({label:"Cool-down Walk",durationSec:p.cool});
  return out;
}
function buildPhases(interval) {
  const config=(interval.config||[]).filter(x=>Number(x.durationSec)>0);
  const transitionSec=Math.max(0,Math.min(30,Number(interval.transitionSec ?? 3)));
  const phases=[];
  config.forEach((step,idx)=>{
    phases.push({type:"work",label:String(step.label||`Interval ${idx+1}`),durationMs:Number(step.durationSec)*1000});
    if(idx<config.length-1 && transitionSec>0) phases.push({type:"transition",label:`Next: ${config[idx+1].label||`Interval ${idx+2}`}`,durationMs:transitionSec*1000});
  });
  let cursor=0;
  return phases.map((phase,index)=>{
    const p={...phase,phaseIndex:index,startMs:cursor,endMs:cursor+phase.durationMs};
    cursor=p.endMs;
    return p;
  });
}
function intervalElapsedMs(ds, now=Date.now()) {
  const t=ds.interval||defaultInterval();
  return Math.max(0,Number(t.accumulatedMs||0)+(t.running&&t.startedAt?now-Number(t.startedAt):0));
}
function intervalSnapshot(ds, now=Date.now()) {
  const phases=buildPhases(ds.interval);
  const totalMs=phases.length?phases[phases.length-1].endMs:0;
  const elapsed=Math.min(intervalElapsedMs(ds,now),totalMs||0);
  if(!phases.length) return {phases,totalMs,elapsed,phase:null,remainingMs:0,next:null,complete:false,progress:0};
  if(elapsed>=totalMs) return {phases,totalMs,elapsed,phase:null,remainingMs:0,next:null,complete:true,progress:100};
  const phase=phases.find(p=>elapsed<p.endMs);
  const remainingMs=phase.endMs-elapsed;
  const next=phases[phase.phaseIndex+1]||null;
  return {phases,totalMs,elapsed,phase,remainingMs,next,complete:false,progress:totalMs?elapsed/totalMs*100:0};
}
function setIntervalElapsed(ds, value) {
  const phases=buildPhases(ds.interval);
  const max=phases.length?phases[phases.length-1].endMs:0;
  ds.interval.accumulatedMs=Math.max(0,Math.min(max,Number(value||0)));
  ds.interval.startedAt=ds.interval.running?Date.now():null;
}
window.loadRunPreset=(dayNumber)=>{
  const preset=runWalkPreset(dayNumber); if(!preset)return;
  const ds=dayState(dayNumber);
  ds.interval={...defaultInterval(),config:preset,transitionSec:3};
  scheduleSave(); render();
};
window.addIntervalRow=(dayNumber)=>{
  const ds=dayState(dayNumber);
  ds.interval.config.push({label:`Interval ${ds.interval.config.length+1}`,durationSec:60});
  scheduleSave(); render();
};
window.removeIntervalRow=(dayNumber,index)=>{
  const ds=dayState(dayNumber); ds.interval.config.splice(index,1);
  ds.interval.running=false; ds.interval.startedAt=null; ds.interval.accumulatedMs=0;
  scheduleSave(); render();
};
window.updateIntervalLabel=(dayNumber,index,value)=>{dayState(dayNumber).interval.config[index].label=String(value).slice(0,40);scheduleSave();};
window.updateIntervalTime=(dayNumber,index,part,value)=>{
  const ds=dayState(dayNumber); const cur=Number(ds.interval.config[index].durationSec||0);
  let min=Math.floor(cur/60),sec=cur%60;
  if(part==="min") min=Math.max(0,Math.min(180,Number(value||0))); else sec=Math.max(0,Math.min(59,Number(value||0)));
  ds.interval.config[index].durationSec=min*60+sec; scheduleSave();
};
window.updateTransition=(dayNumber,value)=>{dayState(dayNumber).interval.transitionSec=Math.max(0,Math.min(30,Number(value||0)));scheduleSave();};
window.startInterval=(dayNumber)=>{
  const ds=dayState(dayNumber); const snap=intervalSnapshot(ds); if(!snap.phases.length)return;
  if(snap.complete) ds.interval.accumulatedMs=0;
  if(!ds.interval.running){ds.interval.running=true;ds.interval.startedAt=Date.now();
    if(!ds.session.running && sessionElapsedMs(ds)===0){ds.session.running=true;ds.session.startedAt=Date.now();}
    scheduleSave();render();}
};
window.pauseInterval=(dayNumber)=>{const ds=dayState(dayNumber);if(ds.interval.running){ds.interval.accumulatedMs=intervalElapsedMs(ds);ds.interval.running=false;ds.interval.startedAt=null;scheduleSave();render();}};
window.resetInterval=(dayNumber)=>{const ds=dayState(dayNumber);ds.interval.running=false;ds.interval.startedAt=null;ds.interval.accumulatedMs=0;scheduleSave();render();};
window.skipInterval=(dayNumber,dir)=>{const ds=dayState(dayNumber),snap=intervalSnapshot(ds);if(!snap.phases.length)return;let idx=snap.phase?snap.phase.phaseIndex:0;idx=Math.max(0,Math.min(snap.phases.length-1,idx+dir));setIntervalElapsed(ds,snap.phases[idx].startMs);scheduleSave();render();};

function renderTimerCard(p,ds) {
  const elapsed=sessionElapsedMs(ds),session=ds.session,interval=ds.interval,snap=intervalSnapshot(ds),preset=runWalkPreset(p.day);
  const rows=(interval.config||[]).map((step,idx)=>{const min=Math.floor(Number(step.durationSec||0)/60),sec=Number(step.durationSec||0)%60;return `<div class="interval-row"><input aria-label="Interval name" value="${escapeHtml(step.label||"")}" oninput="updateIntervalDraftLabel(${p.day},${idx},this.value)"><input aria-label="Minutes" type="number" min="0" max="180" value="${min}" oninput="updateIntervalDraftTime(${p.day},${idx},'min',this.value)"><input aria-label="Seconds" type="number" min="0" max="59" value="${sec}" oninput="updateIntervalDraftTime(${p.day},${idx},'sec',this.value)"><button aria-label="Remove interval" onclick="removeIntervalDraftRow(${p.day},${idx})">×</button></div>`;}).join("");
  let label="Ready",clock="00:00",next="";
  if(snap.complete&&snap.totalMs){label="Interval workout complete";clock=formatTime(snap.totalMs);} else if(snap.phase){label=snap.phase.type==="transition"?`Transition • ${snap.phase.label}`:snap.phase.label;clock=formatTime(snap.remainingMs);next=snap.next?`Next: ${snap.next.label}`:"Final interval";}
  return `<div class="card timer-card"><div class="timer-label">Live workout time</div><div id="sessionClock" class="timer-big">${formatTime(elapsed)}</div><div class="timer-meta"><span>${session.running?"● Running":elapsed>0?"Paused":"Not started"}</span>${session.lastCompletedMs?`<span class="saved-duration">Last completed: ${formatTime(session.lastCompletedMs)}</span>`:""}</div><div class="timer-actions">${session.running?`<button class="timer-btn warn" onclick="pauseWorkout(${p.day})">PAUSE WORKOUT</button>`:`<button class="timer-btn primary" onclick="startWorkout(${p.day})">${elapsed>0?"RESUME WORKOUT":"START WORKOUT"}</button>`}<button class="timer-btn" onclick="resetWorkoutTimer(${p.day})">Reset time</button></div><div class="timer-status">The timer uses the saved start time, so it stays accurate after switching apps, locking your phone, watching YouTube, or refreshing.</div><div class="interval-card"><div class="timer-label">Adjustable interval timer</div><div class="interval-now"><div><div id="intervalPhase" class="interval-phase">${label}</div><div id="intervalNext" class="interval-next">${next}</div></div><div id="intervalClock" class="interval-clock">${clock}</div></div><div class="interval-progress"><div id="intervalBar" style="width:${snap.progress}%"></div></div><div class="timer-actions">${interval.running?`<button class="timer-btn warn" onclick="pauseInterval(${p.day})">PAUSE INTERVALS</button>`:`<button class="timer-btn primary" onclick="startInterval(${p.day})">${snap.elapsed>0&&!snap.complete?"RESUME INTERVALS":"START INTERVALS"}</button>`}<button class="timer-btn" onclick="skipInterval(${p.day},-1)">← Back</button><button class="timer-btn" onclick="skipInterval(${p.day},1)">Skip →</button><button class="timer-btn danger" onclick="resetInterval(${p.day})">Reset intervals</button></div><details class="interval-editor" id="intervalEditor-${p.day}"><summary>Adjust interval sequence</summary><div class="preset-row">${preset?`<button onclick="loadRunPreset(${p.day})">Load today's Run/Walk preset</button>`:""}<button onclick="addIntervalDraftRow(${p.day})">+ Add interval</button></div><div class="interval-settings"><label>Transition countdown (seconds)<input type="number" min="0" max="30" value="${Number(draft.transitionSec??3)}" oninput="updateIntervalDraftTransition(${p.day},this.value)"></label></div><div class="cue-options"><label class="cue-toggle"><input type="checkbox" ${interval.soundEnabled!==false?"checked":""} onchange="setIntervalCueOption(${p.day},'soundEnabled',this.checked)"><span>🔊 Sound cues</span></label><label class="cue-toggle"><input type="checkbox" ${interval.vibrationEnabled!==false?"checked":""} onchange="setIntervalCueOption(${p.day},'vibrationEnabled',this.checked)"><span>📳 Vibration cues</span></label></div><div class="interval-rows">${rows||`<div class="muted">No intervals yet. Add one${preset?" or load today's preset":""}.</div>`}</div><div class="interval-confirm-row"><button class="timer-btn primary" onclick="confirmIntervalSettings(${p.day})">OK — SAVE INTERVALS</button><button class="timer-btn" onclick="cancelIntervalSettings(${p.day})">Cancel</button></div></details></div></div>`;
}


function launchWorkoutCelebration(dayNumber) {
  document.getElementById("workoutCelebration")?.remove();
  const overlay=document.createElement("div");
  overlay.id="workoutCelebration";
  overlay.className="celebration-overlay";
  const confetti=Array.from({length:60},(_,i)=>`<i class="confetti" style="--x:${Math.random()*100}%;--d:${Math.random()*.8}s;--r:${Math.random()*360}deg"></i>`).join("");
  overlay.innerHTML=`<div class="celebration-effects"><span class="firework fw1"></span><span class="firework fw2"></span><span class="firework fw3"></span>${confetti}</div><div class="celebration-card"><div class="trophy">🏆</div><div class="celebration-day">DAY ${dayNumber} COMPLETE</div><h2>Congratulations!</h2><p>Today's workout is completed.</p><button class="timer-btn primary" id="closeCelebration">DONE</button></div>`;
  document.body.appendChild(overlay);
  try {
    ensureCueAudio();
    if(cueAudioContext){
      [659.25,783.99,1046.5].forEach((f,i)=>{
        const o=cueAudioContext.createOscillator(),g=cueAudioContext.createGain(),t=cueAudioContext.currentTime+i*.12;
        o.frequency.value=f; g.gain.setValueAtTime(.0001,t); g.gain.exponentialRampToValueAtTime(.16,t+.01); g.gain.exponentialRampToValueAtTime(.0001,t+.18);
        o.connect(g);g.connect(cueAudioContext.destination);o.start(t);o.stop(t+.2);
      });
    }
    if("vibrate" in navigator) navigator.vibrate([120,60,120,60,220]);
  } catch(e){}
  const close=()=>overlay.remove();
  document.getElementById("closeCelebration")?.addEventListener("click",close);
  overlay.addEventListener("click",e=>{if(e.target===overlay)close()});
  setTimeout(()=>{if(document.body.contains(overlay))close()},6500);
}

function renderToday() {
  const p = PLAN[selected];
  const ds = dayState(p.day);

  const exercises = p.exercises.map((e, i) => `
    <div class="exercise">
      <input type="checkbox"
        ${ds.checks[i] ? "checked" : ""}
        onchange="toggleCheck(${p.day},${i},this.checked)">
      <div>
        <h3>${e.name}</h3>
        <div class="work">${e.work}</div>
        <div class="cue">${e.cue}</div>
      </div>
      ${e.video
        ? `<a class="watch" href="${e.video}" target="_blank" rel="noopener noreferrer">▶ Watch</a>`
        : ""}
    </div>
  `).join("");

  document.getElementById("todayView").innerHTML = `
    <div class="card">
      <div class="dayline">DAY ${p.day} OF 30 • ${p.dateLabel}</div>
      <h2>${p.title}</h2>
      <div class="muted">
        Target time: ${p.target} • Rest 60–90 sec between strength sets.
      </div>
    </div>

    ${renderTimerCard(p, ds)}

    <div class="card">
      ${exercises}
      <button class="complete ${ds.done ? "done" : ""}"
        onclick="completeDay(${p.day})">
        ${ds.done ? "✓ DAY COMPLETE — TAP TO REOPEN" : "COMPLETE DAY " + p.day}
      </button>
    </div>

    <div class="card">
      <h3>How difficult was today?</h3>
      <p class="muted">Tap one level after your workout. You can change it later.</p>

      <div class="difficulty-gauge" role="group" aria-label="Workout difficulty">
        ${[
          [1,"Very Easy"],
          [2,"Easy"],
          [3,"Moderate"],
          [4,"Hard"],
          [5,"Very Hard"]
        ].map(([value,label]) => `
          <button type="button"
            class="difficulty-option ${Number(ds.difficulty)===value ? "selected" : ""}"
            data-difficulty-day="${p.day}" data-difficulty-value="${value}"
            aria-pressed="${Number(ds.difficulty)===value ? "true" : "false"}">
            <span class="difficulty-number">${value}</span>
            <span>${label}</span>
          </button>
        `).join("")}
      </div>

      ${ds.difficulty
        ? `<div class="difficulty-selected">Saved: ${difficultyLabel(ds.difficulty)}</div>`
        : ""}

      <details class="optional-note">
        <summary>Add optional note</summary>
        <textarea placeholder="Optional: soreness, pain, equipment feeling too easy, etc."
          onchange="setField(${p.day},'notes',this.value)">${ds.notes || ""}</textarea>
      </details>
    </div>
  `;
}

window.toggleCheck = (dayNumber, index, value) => {
  dayState(dayNumber).checks[index] = value;
  scheduleSave();
  updateHeader();
};

window.completeDay = (dayNumber) => {
  const ds = dayState(dayNumber);
  const wasDone = Boolean(ds.done);
  ds.done = !ds.done;

  if (ds.done) {
    PLAN[dayNumber - 1].exercises.forEach((_, i) => { ds.checks[i] = true; });
    const total = sessionElapsedMs(ds);
    if (total > 0) ds.session.lastCompletedMs = total;
    ds.session.accumulatedMs = total;
    ds.session.running = false;
    ds.session.startedAt = null;
    if (ds.interval.running) {
      ds.interval.accumulatedMs = intervalElapsedMs(ds);
      ds.interval.running = false;
      ds.interval.startedAt = null;
    }
    const snap = intervalSnapshot(ds);
    if (snap.complete && snap.totalMs) ds.interval.lastCompletedMs = snap.totalMs;
  }

  scheduleSave();
  render();
  if (!wasDone && ds.done) requestAnimationFrame(() => launchWorkoutCelebration(dayNumber));
};

window.setField = (dayNumber, field, value) => {
  dayState(dayNumber)[field] = value;
  scheduleSave();
};

function renderCalendar() {
  document.getElementById("calendarView").innerHTML = `
    <div class="card">
      <h2>30-Day Calendar</h2>
      <p class="muted">
        Tap any day to open it.
        ${currentUser
          ? "Cloud sync is active."
          : "Progress is currently saved on this device."}
      </p>
      <div class="calendar">
        ${PLAN.map((p, i) => `
          <div class="daycard
            ${dayState(p.day).done ? "done" : ""}
            ${i === currentDayIndex() ? "current" : ""}"
            onclick="selected=${i};switchView('today')">
            <div class="n">
              Day ${p.day} ${dayState(p.day).done ? "✓" : ""}
            </div>
            <div>${p.dateLabel}</div>
            <div class="t">${p.title}</div>
            ${dayState(p.day).session?.lastCompletedMs ? `<div class="t">Workout time: ${formatTime(dayState(p.day).session.lastCompletedMs)}</div>` : ""}
            ${dayState(p.day).difficulty ? `<div class="t">Difficulty: ${difficultyLabel(dayState(p.day).difficulty)}</div>` : ""}
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderProgress() {
  const completed = PLAN.filter((p) => dayState(p.day).done).length;
  const difficultyValues = PLAN
    .map((p) => Number(dayState(p.day).difficulty))
    .filter((v) => v >= 1 && v <= 5);

  const averageDifficulty = difficultyValues.length
    ? (difficultyValues.reduce((a, b) => a + b, 0) / difficultyValues.length).toFixed(1)
    : "—";
  const hardestDifficulty = difficultyValues.length ? Math.max(...difficultyValues) : null;
  const easiestDifficulty = difficultyValues.length ? Math.min(...difficultyValues) : null;

  const durations = PLAN.map((p) => Number(dayState(p.day).session?.lastCompletedMs || 0)).filter((v) => v > 0);
  const totalTrainingMs = durations.reduce((a, b) => a + b, 0);
  const averageTrainingMs = durations.length ? totalTrainingMs / durations.length : 0;

  document.getElementById("progressView").innerHTML = `
    <div class="card">
      <h2>Your Progress</h2>
      <div class="bar">
        <div style="width:${completionPercent()}%"></div>
      </div>

      <div class="stats" style="margin-top:14px">
        <div class="stat">
          <b>${completed}</b>
          <span>Days complete</span>
        </div>
        <div class="stat">
          <b>${completionPercent()}%</b>
          <span>Program complete</span>
        </div>
        <div class="stat">
          <b>${averageDifficulty}</b>
          <span>Avg. difficulty / 5</span>
        </div>
        <div class="stat">
          <b>${hardestDifficulty ? hardestDifficulty + "/5" : "—"}</b>
          <span>Hardest rated day</span>
        </div>
        <div class="stat">
          <b>${easiestDifficulty ? easiestDifficulty + "/5" : "—"}</b>
          <span>Easiest rated day</span>
        </div>
        <div class="stat">
          <b>${durations.length ? formatTime(totalTrainingMs) : "—"}</b>
          <span>Total timed training</span>
        </div>
        <div class="stat">
          <b>${durations.length ? formatTime(averageTrainingMs) : "—"}</b>
          <span>Avg. workout time</span>
        </div>
      </div>
    </div>

    <div class="card cloud-note">
      <h3>${currentUser ? "Cloud sync active" : "Local saving active"}</h3>
      <p class="muted">
        ${currentUser
          ? `Signed in as ${currentUser.email}. Progress is saved locally and synced securely to your Firebase account.`
          : "Your existing local storage still works. Sign in to add cross-device cloud sync."}
      </p>
    </div>
  `;
}

function updateHeader() {
  document.getElementById("progressPct").textContent =
    completionPercent() + "%";
}

function switchView(name) {
  document.querySelectorAll(".view").forEach((el) => el.classList.add("hidden"));
  document.getElementById(name + "View").classList.remove("hidden");

  
document.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-difficulty-day][data-difficulty-value]");
  if (!btn) return;
  event.preventDefault();
  const dayNumber = Number(btn.dataset.difficultyDay);
  const value = Math.max(1, Math.min(5, Number(btn.dataset.difficultyValue || 0)));
  dayState(dayNumber).difficulty = value;
  scheduleSave();
  renderToday();
  renderProgress();
});

document.querySelectorAll(".tabs button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === name);
  });

  if (name === "today") renderToday();
  if (name === "calendar") renderCalendar();
  if (name === "progress") renderProgress();

  window.scrollTo({ top: 0, behavior: "smooth" });
}

window.switchView = switchView;


document.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-difficulty-day][data-difficulty-value]");
  if (!btn) return;
  event.preventDefault();
  const dayNumber = Number(btn.dataset.difficultyDay);
  const value = Math.max(1, Math.min(5, Number(btn.dataset.difficultyValue || 0)));
  dayState(dayNumber).difficulty = value;
  scheduleSave();
  renderToday();
  renderProgress();
});

document.querySelectorAll(".tabs button").forEach((button) => {
  button.onclick = () => switchView(button.dataset.view);
});

function render() {
  renderToday();
  renderCalendar();
  renderProgress();
  updateHeader();
}


function tickVisibleTimers() {
  const p = PLAN[selected];
  const ds = dayState(p.day);
  const sc = document.getElementById("sessionClock");
  if (sc) sc.textContent = formatTime(sessionElapsedMs(ds));
  const snap = intervalSnapshot(ds);
  const ic = document.getElementById("intervalClock");
  const ip = document.getElementById("intervalPhase");
  const inn = document.getElementById("intervalNext");
  const bar = document.getElementById("intervalBar");
  if (ic) ic.textContent = snap.complete && snap.totalMs ? formatTime(snap.totalMs) : snap.phase ? formatTime(snap.remainingMs) : "00:00";
  if (ip) ip.textContent = snap.complete && snap.totalMs ? "Interval workout complete" : snap.phase ? (snap.phase.type === "transition" ? `Transition • ${snap.phase.label}` : snap.phase.label) : "Ready";
  if (inn) inn.textContent = snap.phase ? (snap.next ? `Next: ${snap.next.label}` : "Final interval") : "";
  if (bar) bar.style.width = `${snap.progress}%`;
  if (ds.interval.running && snap.complete) {
    ds.interval.running = false;
    ds.interval.startedAt = null;
    ds.interval.accumulatedMs = snap.totalMs;
    ds.interval.lastCompletedMs = snap.totalMs;
    scheduleSave();
    renderToday();
  }
}
setInterval(tickVisibleTimers, 250);
document.addEventListener("visibilitychange", () => { if (!document.hidden) { render(); tickVisibleTimers(); } });
window.addEventListener("focus", () => { render(); tickVisibleTimers(); });

// Authentication modal
const modal = document.getElementById("authModal");
const authMessage = document.getElementById("authMessage");

function openAuth() {
  authMessage.textContent = "";
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function closeAuth() {
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

document.getElementById("signInBtn").onclick = openAuth;
document.getElementById("closeAuth").onclick = closeAuth;

modal.addEventListener("click", (event) => {
  if (event.target === modal) closeAuth();
});

async function authenticate(mode) {
  const email = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;
  authMessage.textContent = "";

  if (!email || password.length < 6) {
    authMessage.textContent =
      "Enter a valid email and a password with at least 6 characters.";
    return;
  }

  try {
    if (mode === "create") {
      await createUserWithEmailAndPassword(auth, email, password);
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }

    closeAuth();
  } catch (error) {
    console.error("Authentication error:", error);
    const code = (error.code || "").replace("auth/", "").replaceAll("-", " ");
    authMessage.textContent = code
      ? `Could not continue: ${code}.`
      : "Could not sign in. Check your details and try again.";
  }
}

document.getElementById("loginAction").onclick =
  () => authenticate("login");

document.getElementById("createAction").onclick =
  () => authenticate("create");

document.getElementById("signOutBtn").onclick =
  () => signOut(auth);

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  cloudReady = false;

  document.getElementById("signInBtn").classList.toggle("hidden", Boolean(user));
  document.getElementById("signOutBtn").classList.toggle("hidden", !user);

  if (user) {
    setAuthStatus(
      "syncing",
      `Signed in as ${user.email} • Connecting…`
    );
    await loadCloudProgress();
  } else {
    setAuthStatus(
      "",
      "Not signed in — progress is saving locally."
    );
    render();
  }
});

render();
