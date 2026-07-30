(() => {
  const DURATIONS = { work: 25 * 60, short: 5 * 60, long: 15 * 60 };
  const RING_CIRCUMFERENCE = 2 * Math.PI * 100;
  const STORAGE_KEY = "focusSprint.v1";

  const el = {
    timeLabel: document.getElementById("timeLabel"),
    currentTaskLabel: document.getElementById("currentTaskLabel"),
    ringProgress: document.getElementById("ringProgress"),
    startBtn: document.getElementById("startBtn"),
    resetBtn: document.getElementById("resetBtn"),
    skipBtn: document.getElementById("skipBtn"),
    modeTabs: document.querySelectorAll(".mode-tab"),
    sprintCount: document.getElementById("sprintCount"),
    streakCount: document.getElementById("streakCount"),
    taskForm: document.getElementById("taskForm"),
    taskInput: document.getElementById("taskInput"),
    taskList: document.getElementById("taskList"),
    emptyHint: document.getElementById("emptyHint"),
    celebration: document.getElementById("celebration"),
    celebrationText: document.getElementById("celebrationText"),
    burst: document.getElementById("burst"),
    authArea: document.getElementById("authArea"),
    accountArea: document.getElementById("accountArea"),
    accountEmail: document.getElementById("accountEmail"),
    signInBtn: document.getElementById("signInBtn"),
    signUpBtn: document.getElementById("signUpBtn"),
    logOutBtn: document.getElementById("logOutBtn"),
    authModal: document.getElementById("authModal"),
    authModalClose: document.getElementById("authModalClose"),
    authForm: document.getElementById("authForm"),
    authEmail: document.getElementById("authEmail"),
    authPassword: document.getElementById("authPassword"),
    authError: document.getElementById("authError"),
    authSubmit: document.getElementById("authSubmit"),
    modalTabs: document.querySelectorAll(".modal-tab"),
    syncBanner: document.getElementById("syncBanner"),
  };

  let state = loadState();
  let session = { loggedIn: false, user: null };
  let authMode = "signin";

  let mode = "work";
  let secondsLeft = DURATIONS.work;
  let running = false;
  let intervalId = null;
  let activeTaskId = state.activeTaskId || null;

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { tasks: [], sprintsToday: 0, lastSprintDate: null, streak: 0, activeTaskId: null };
  }

  function saveState() {
    state.activeTaskId = activeTaskId;
    if (session.loggedIn) {
      syncStateToServer();
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
  }

  let syncTimer = null;
  function syncStateToServer() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
      try {
        const res = await fetch("/api/state", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(state),
        });
        if (!res.ok) throw new Error("save failed");
        showSyncBanner("", false);
      } catch (e) {
        showSyncBanner("Couldn't sync to your account — changes are only saved locally for now.", true);
      }
    }, 250);
  }

  function showSyncBanner(message, isError) {
    if (!message) {
      el.syncBanner.classList.add("hidden");
      return;
    }
    el.syncBanner.textContent = message;
    el.syncBanner.classList.toggle("error", isError);
    el.syncBanner.classList.remove("hidden");
  }

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function ensureTodayCounters() {
    if (state.lastSprintDate !== todayStr()) {
      state.sprintsToday = 0;
    }
  }

  ensureTodayCounters();

  // ---------- Rendering ----------

  function formatTime(sec) {
    const m = Math.floor(sec / 60).toString().padStart(2, "0");
    const s = Math.floor(sec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  function render() {
    el.timeLabel.textContent = formatTime(secondsLeft);
    const total = DURATIONS[mode];
    const fraction = 1 - secondsLeft / total;
    el.ringProgress.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - fraction));

    el.startBtn.textContent = running ? "Pause" : "Start";

    el.modeTabs.forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.mode === mode);
    });

    document.body.classList.toggle("mode-short", mode === "short");
    document.body.classList.toggle("mode-long", mode === "long");
    document.body.classList.toggle("mode-work", mode === "work");

    el.sprintCount.textContent = `${state.sprintsToday} sprint${state.sprintsToday === 1 ? "" : "s"} today`;
    el.streakCount.textContent = state.streak;

    const activeTask = state.tasks.find((t) => t.id === activeTaskId);
    el.currentTaskLabel.textContent = activeTask ? activeTask.text : "No task selected";

    renderTasks();
  }

  function renderTasks() {
    el.taskList.innerHTML = "";
    state.tasks.forEach((task) => {
      const li = document.createElement("li");
      li.className = "task-item" + (task.done ? " done" : "") + (task.id === activeTaskId ? " active" : "");
      li.dataset.id = task.id;

      const check = document.createElement("span");
      check.className = "task-check";
      check.textContent = "✓";

      const text = document.createElement("span");
      text.className = "task-text";
      text.textContent = task.text;

      const pomos = document.createElement("span");
      pomos.className = "task-pomos";
      pomos.textContent = task.pomos > 0 ? `🍅${task.pomos}` : "";

      const remove = document.createElement("button");
      remove.className = "task-remove";
      remove.type = "button";
      remove.textContent = "×";
      remove.title = "Remove task";

      li.append(check, text, pomos, remove);
      el.taskList.appendChild(li);

      check.addEventListener("click", (e) => {
        e.stopPropagation();
        task.done = !task.done;
        saveState();
        renderTasks();
      });

      remove.addEventListener("click", (e) => {
        e.stopPropagation();
        state.tasks = state.tasks.filter((t) => t.id !== task.id);
        if (activeTaskId === task.id) activeTaskId = null;
        saveState();
        render();
      });

      li.addEventListener("click", () => {
        activeTaskId = task.id === activeTaskId ? null : task.id;
        saveState();
        render();
      });
    });
  }

  // ---------- Timer logic ----------

  function setMode(newMode, resetTimer = true) {
    mode = newMode;
    if (resetTimer) secondsLeft = DURATIONS[mode];
    render();
  }

  function tick() {
    secondsLeft -= 1;
    if (secondsLeft <= 0) {
      completeSprint();
      return;
    }
    render();
  }

  function start() {
    if (running) return;
    running = true;
    intervalId = setInterval(tick, 1000);
    render();
  }

  function pause() {
    running = false;
    clearInterval(intervalId);
    render();
  }

  function toggleStart() {
    if (running) pause();
    else start();
  }

  function reset() {
    pause();
    secondsLeft = DURATIONS[mode];
    render();
  }

  function skip() {
    pause();
    advanceMode();
  }

  function completeSprint() {
    pause();
    secondsLeft = 0;
    render();

    if (mode === "work") {
      registerCompletedPomodoro();
      celebrate("Sprint complete! Take a break.");
    } else {
      celebrate("Break's over. Ready to focus?");
    }

    setTimeout(() => advanceMode(), 1400);
  }

  function advanceMode() {
    if (mode === "work") {
      const nextIsLong = state.sprintsToday > 0 && state.sprintsToday % 4 === 0;
      setMode(nextIsLong ? "long" : "short");
    } else {
      setMode("work");
    }
  }

  function registerCompletedPomodoro() {
    const today = todayStr();
    ensureTodayCounters();
    state.sprintsToday += 1;

    if (state.lastSprintDate !== today) {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      if (state.lastSprintDate === yesterday) {
        state.streak += 1;
      } else {
        state.streak = 1;
      }
      state.lastSprintDate = today;
    }

    const activeTask = state.tasks.find((t) => t.id === activeTaskId);
    if (activeTask) activeTask.pomos = (activeTask.pomos || 0) + 1;

    saveState();
  }

  // ---------- Celebration ----------

  function celebrate(message) {
    playChime();
    el.celebrationText.textContent = message;
    el.celebration.classList.add("show");
    spawnConfetti();
    setTimeout(() => el.celebration.classList.remove("show"), 1300);
  }

  function spawnConfetti() {
    el.burst.innerHTML = "";
    const colors = ["#6c8dff", "#4fd1a5", "#ffd166", "#ff6c7c"];
    for (let i = 0; i < 24; i++) {
      const piece = document.createElement("div");
      piece.className = "confetti-piece";
      const angle = Math.random() * Math.PI * 2;
      const dist = 80 + Math.random() * 140;
      piece.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
      piece.style.setProperty("--dy", `${Math.sin(angle) * dist}px`);
      piece.style.setProperty("--rot", `${Math.random() * 360}deg`);
      piece.style.background = colors[i % colors.length];
      piece.style.animationDelay = `${Math.random() * 0.1}s`;
      el.burst.appendChild(piece);
    }
  }

  let audioCtx = null;
  function playChime() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const now = audioCtx.currentTime;
      [523.25, 659.25, 783.99].forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, now + i * 0.12);
        gain.gain.linearRampToValueAtTime(0.15, now + i * 0.12 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.5);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(now + i * 0.12);
        osc.stop(now + i * 0.12 + 0.5);
      });
    } catch (e) {}
  }

  // ---------- Tasks ----------

  function addTask(text) {
    const task = { id: crypto.randomUUID(), text, done: false, pomos: 0 };
    state.tasks.push(task);
    if (!activeTaskId) activeTaskId = task.id;
    saveState();
    render();
  }

  // ---------- Auth ----------

  function setSession(user) {
    session = { loggedIn: !!user, user: user || null };
    el.authArea.classList.toggle("hidden", session.loggedIn);
    el.accountArea.classList.toggle("hidden", !session.loggedIn);
    if (user) el.accountEmail.textContent = user.email;
  }

  function openAuthModal(tab) {
    authMode = tab;
    el.modalTabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
    el.authSubmit.textContent = tab === "signin" ? "Sign in" : "Sign up";
    el.authPassword.autocomplete = tab === "signin" ? "current-password" : "new-password";
    el.authError.classList.add("hidden");
    el.authForm.reset();
    el.authModal.classList.remove("hidden");
    el.authEmail.focus();
  }

  function closeAuthModal() {
    el.authModal.classList.add("hidden");
  }

  async function submitAuth(email, password) {
    const endpoint = authMode === "signin" ? "/api/login" : "/api/signup";
    const body = { email, password };
    if (authMode === "signup" && (state.tasks.length > 0 || state.sprintsToday > 0)) {
      body.initialState = state;
    }

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || "Something went wrong");
    }

    setSession(data.user);
    closeAuthModal();

    if (authMode === "signup" && body.initialState) {
      state = body.initialState;
    } else {
      const stateRes = await fetch("/api/state");
      const stateData = await stateRes.json();
      state = stateData.state;
    }
    activeTaskId = state.activeTaskId || null;
    ensureTodayCounters();
    pause();
    setMode("work");
  }

  async function logOut() {
    await fetch("/api/logout", { method: "POST" }).catch(() => {});
    setSession(null);
    state = loadState();
    activeTaskId = state.activeTaskId || null;
    ensureTodayCounters();
    pause();
    setMode("work");
  }

  async function initAuth() {
    try {
      const res = await fetch("/api/me");
      if (!res.ok) return;
      const data = await res.json();
      setSession(data.user);
      const stateRes = await fetch("/api/state");
      const stateData = await stateRes.json();
      state = stateData.state;
      activeTaskId = state.activeTaskId || null;
      ensureTodayCounters();
      render();
    } catch (e) {
      // No backend reachable — continue in local-only guest mode.
    }
  }

  // ---------- Events ----------

  el.startBtn.addEventListener("click", toggleStart);
  el.resetBtn.addEventListener("click", reset);
  el.skipBtn.addEventListener("click", skip);

  el.modeTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      pause();
      setMode(tab.dataset.mode);
    });
  });

  el.taskForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = el.taskInput.value.trim();
    if (!text) return;
    addTask(text);
    el.taskInput.value = "";
  });

  document.addEventListener("keydown", (e) => {
    if (e.code !== "Space") return;
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea") return;
    e.preventDefault();
    toggleStart();
  });

  el.signInBtn.addEventListener("click", () => openAuthModal("signin"));
  el.signUpBtn.addEventListener("click", () => openAuthModal("signup"));
  el.authModalClose.addEventListener("click", closeAuthModal);
  el.authModal.addEventListener("click", (e) => {
    if (e.target === el.authModal) closeAuthModal();
  });
  el.modalTabs.forEach((tab) => {
    tab.addEventListener("click", () => openAuthModal(tab.dataset.tab));
  });
  el.logOutBtn.addEventListener("click", logOut);

  el.authForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    el.authError.classList.add("hidden");
    el.authSubmit.disabled = true;
    try {
      await submitAuth(el.authEmail.value.trim(), el.authPassword.value);
    } catch (err) {
      el.authError.textContent = err.message;
      el.authError.classList.remove("hidden");
    } finally {
      el.authSubmit.disabled = false;
    }
  });

  render();
  initAuth();
})();
