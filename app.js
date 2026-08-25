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
  apiKey: "AIzaSyCkQ2ou_Bbmk8N-c5NZL36zLFkeQT-0SwM",
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

function dayState(dayNumber) {
  state.days ??= {};
  state.days[dayNumber] ??= { checks: {}, done: false, feel: "", notes: "" };
  return state.days[dayNumber];
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

    <div class="card">
      ${exercises}
      <button class="complete ${ds.done ? "done" : ""}"
        onclick="completeDay(${p.day})">
        ${ds.done ? "✓ DAY COMPLETE — TAP TO REOPEN" : "COMPLETE DAY " + p.day}
      </button>
    </div>

    <div class="card">
      <h3>Quick Check-In</h3>
      <div class="metrics">
        <label>
          How I felt (1–10)
          <input type="number" min="1" max="10"
            value="${ds.feel || ""}"
            onchange="setField(${p.day},'feel',this.value)">
        </label>
        <label>
          Notes
          <textarea onchange="setField(${p.day},'notes',this.value)">${ds.notes || ""}</textarea>
        </label>
      </div>
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
  ds.done = !ds.done;

  if (ds.done) {
    PLAN[dayNumber - 1].exercises.forEach((_, i) => {
      ds.checks[i] = true;
    });
  }

  scheduleSave();
  render();
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
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderProgress() {
  const completed = PLAN.filter((p) => dayState(p.day).done).length;
  const feelings = PLAN
    .map((p) => Number(dayState(p.day).feel))
    .filter(Boolean);

  const average = feelings.length
    ? (feelings.reduce((a, b) => a + b, 0) / feelings.length).toFixed(1)
    : "—";

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
          <b>${average}</b>
          <span>Avg. feeling</span>
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

  document.querySelectorAll(".tabs button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === name);
  });

  if (name === "today") renderToday();
  if (name === "calendar") renderCalendar();
  if (name === "progress") renderProgress();

  window.scrollTo({ top: 0, behavior: "smooth" });
}

window.switchView = switchView;

document.querySelectorAll(".tabs button").forEach((button) => {
  button.onclick = () => switchView(button.dataset.view);
});

function render() {
  renderToday();
  renderCalendar();
  renderProgress();
  updateHeader();
}

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
