(() => {
  const KEY = "notes-for-life";
  const PAPERS = [
    { paper: "#ffe566", band: "#e0c63a" },
    { paper: "#ffb8c6", band: "#ee9eae" },
    { paper: "#c6ea72", band: "#b1d45c" },
    { paper: "#9fd6f5", band: "#82c3e6" },
    { paper: "#ffd48a", band: "#eebf6c" },
  ];

  const board = document.getElementById("board");
  const world = document.getElementById("world");
  const add = document.getElementById("add");
  const reset = document.getElementById("reset");

  const ZOOM = 0.86;
  const ZOOM_MIN = 0.35;
  const ZOOM_MAX = 2.4;
  const cam = { x: 0, y: 0, z: ZOOM };
  const pointers = new Map();
  let notes = load();
  let zTop = 5;
  let lastPinch = null;
  let lastPush = null;
  let animId = 0;

  let drawing = false;

  applyCam();
  if (notes.length) {
    notes.forEach((note) => mount(note));
  } else {
    mount(createNote());
  }
  syncAdd();
  // Browsers may restore focus into a note after refresh; keep startup unselected.
  releaseNoteFocus();
  window.addEventListener("pageshow", releaseNoteFocus);

  add.addEventListener("click", () => {
    const draft = notes.find((note) => !note.text.trim());
    if (draft) {
      bringToCenter(draft);
      world.querySelector(`[data-id="${draft.id}"] textarea`)?.focus();
      return;
    }
    if (drawing) return;
    const note = createNote();
    drawFromStack(note);
  });

  reset.addEventListener("click", () => {
    if (!window.confirm("Start over? This clears every note on this board.")) return;
    localStorage.removeItem(KEY);
    world.querySelectorAll(".note").forEach((el) => el.remove());
    notes = [];
    lastPush = null;
    zTop = 5;
    cam.x = 0;
    cam.y = 0;
    cam.z = ZOOM;
    applyCam();
    mount(createNote());
    syncAdd();
  });

  board.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".note") || event.target.closest(".add-note")) return;
    if (board.classList.contains("is-focusing")) {
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
      else clearDim();
      return;
    }
    cancelEase();
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    board.setPointerCapture(event.pointerId);
    board.classList.add("panning");
  });

  board.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId)) return;
    if (board.classList.contains("is-focusing")) return;
    const previous = pointers.get(event.pointerId);
    const current = { x: event.clientX, y: event.clientY };
    pointers.set(event.pointerId, current);

    if (pointers.size === 1) {
      cam.x += current.x - previous.x;
      cam.y += current.y - previous.y;
    } else if (pointers.size === 2) {
      const pinch = pinchInfo();
      if (lastPinch) {
        cam.x += pinch.mid.x - lastPinch.mid.x;
        cam.y += pinch.mid.y - lastPinch.mid.y;
        zoomAt(pinch.mid.x, pinch.mid.y, pinch.dist / lastPinch.dist);
      }
      lastPinch = pinch;
    }
    applyCam();
  });

  const endPointer = (event) => {
    pointers.delete(event.pointerId);
    lastPinch = pointers.size === 2 ? pinchInfo() : null;
    if (!pointers.size) board.classList.remove("panning");
  };

  board.addEventListener("pointerup", endPointer);
  board.addEventListener("pointercancel", endPointer);

  board.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      if (board.classList.contains("is-focusing")) return;
      cancelEase();
      if (event.ctrlKey) {
        zoomAt(event.clientX, event.clientY, Math.exp(-event.deltaY * 0.01));
      } else {
        cam.x -= event.deltaX;
        cam.y -= event.deltaY;
      }
      applyCam();
    },
    { passive: false }
  );

  window.addEventListener("resize", applyCam);

  function releaseNoteFocus() {
    const run = () => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !active.closest(".note")) return;
      active.blur();
      clearDim();
    };
    run();
    requestAnimationFrame(run);
    setTimeout(run, 0);
  }

  function createNote() {
    const slot = notes.length;
    const palette = PAPERS[slot % PAPERS.length];
    const note = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(),
      text: "",
      slot,
      x: 0,
      y: 0,
      paper: palette.paper,
      band: palette.band,
    };
    place(note, slot);
    notes.push(note);
    return note;
  }

  function place(note, slot) {
    const pos = cell(slot);
    note.slot = slot;
    note.x = pos.x;
    note.y = pos.y;
  }

  function mount(note, { autofocus = false, spawned = false } = {}) {
    const el = document.createElement("article");
    el.className = spawned ? "note is-spawned" : "note";
    el.dataset.id = note.id;
    el.style.setProperty("--paper", note.paper);
    el.style.setProperty("--band", note.band);
    el.style.left = `${note.x}px`;
    el.style.top = `${note.y}px`;

    const paper = document.createElement("div");
    paper.className = "note-paper";

    const fold = document.createElement("div");
    fold.className = "note-fold";
    fold.setAttribute("aria-hidden", "true");

    const field = document.createElement("textarea");
    field.value = note.text;
    field.placeholder = "a note worth keeping";
    field.maxLength = 240;
    field.autocomplete = "off";
    field.setAttribute("aria-label", "Note");
    sizeField(field, note.text);
    el.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      field.focus();
    });
    field.addEventListener("focus", () => {
      el.classList.remove("is-sticking");
      el.style.zIndex = String(++zTop);
      focusNote(note);
    });
    field.addEventListener("input", () => {
      note.text = field.value;
      sizeField(field, note.text);
      persist();
      syncAdd();
    });
    field.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey) return;
      event.preventDefault();
      field.blur();
    });
    field.addEventListener("blur", () => {
      el.classList.add("is-sticking");
      window.setTimeout(() => el.classList.remove("is-sticking"), 550);
      if (lastPush?.draftId === note.id && note.text.trim()) lastPush = null;
      clearDim();
      pruneEmpty(note, el);
    });

    paper.appendChild(field);
    el.appendChild(paper);
    el.appendChild(fold);
    world.appendChild(el);
    if (autofocus) requestAnimationFrame(() => field.focus());
  }

  function pruneEmpty(note, el) {
    if (note.text.trim()) return;
    const filled = notes.filter((item) => item.text.trim());
    if (!filled.length) {
      notes.forEach((item) => {
        if (item !== note) world.querySelector(`[data-id="${item.id}"]`)?.remove();
      });
      notes = [note];
      place(note, 0);
      lastPush = null;
      clearDim();
      cam.x = 0;
      cam.y = 0;
      applyCam();
      applyPositions();
      persist();
      syncAdd();
      return;
    }
    notes = notes.filter((item) => item !== note);
    el.remove();
    if (lastPush?.draftId === note.id) {
      lastPush.previous.forEach(({ id, x, y }) => {
        const item = notes.find((entry) => entry.id === id);
        if (!item) return;
        item.x = x;
        item.y = y;
      });
      lastPush = null;
    }
    clearDim();
    applyPositions();
    persist();
    syncAdd();
  }

  function persist() {
    const data = notes
      .filter((note) => note.text.trim())
      .map(({ id, text, slot, x, y, paper, band }) => ({
        id,
        text,
        slot,
        x,
        y,
        paper,
        band,
      }));
    localStorage.setItem(KEY, JSON.stringify(data));
  }

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  }

  function syncAdd() {
    add.hidden = !notes.some((note) => note.text.trim());
  }

  function sizeField(field, text) {
    field.style.fontSize = `${fontSizeFor(text)}rem`;
  }

  function fontSizeFor(text) {
    const len = text.trim().length;
    if (len <= 40) return 1.85;
    if (len <= 100) return 1.5;
    if (len <= 170) return 1.25;
    return 1.05;
  }

  function drawFromStack(note) {
    drawing = true;
    add.classList.add("is-drawing");
    bringToCenter(note);

    const finish = () => {
      mount(note, { autofocus: true, spawned: true });
      add.classList.remove("is-drawing");
      drawing = false;
    };

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finish();
      return;
    }

    const stack = add.querySelector(".add-sheet--top") || add;
    const from = stack.getBoundingClientRect();
    const flyer = document.createElement("div");
    flyer.className = "note-flyer";
    flyer.style.setProperty("--paper", note.paper);
    flyer.style.setProperty("--band", note.band);
    flyer.style.left = `${from.left + from.width / 2}px`;
    flyer.style.top = `${from.top + from.height / 2}px`;
    document.body.appendChild(flyer);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        flyer.classList.add("is-flying");
        flyer.style.left = `${window.innerWidth / 2}px`;
        flyer.style.top = `${window.innerHeight / 2}px`;
      });
    });

    const done = () => {
      if (!flyer.isConnected) return;
      flyer.remove();
      finish();
    };
    flyer.addEventListener("transitionend", (event) => {
      if (event.propertyName !== "transform" && event.propertyName !== "left") return;
      done();
    });
    window.setTimeout(done, 700);
  }

  function focusNote(note) {
    dimAround(note.id);
    easeCam(-note.x * cam.z, -note.y * cam.z);
  }

  function bringToCenter(note) {
    if (lastPush?.draftId !== note.id) {
      lastPush = {
        draftId: note.id,
        previous: notes
          .filter((item) => item !== note)
          .map((item) => ({ id: item.id, x: item.x, y: item.y })),
      };
    }
    note.x = -cam.x / cam.z;
    note.y = -cam.y / cam.z;
    pushAway(note);
    applyPositions();
    persist();
    dimAround(note.id);
  }

  function pushAway(hero) {
    const minDist = step();
    const others = notes.filter((item) => item !== hero);
    others.forEach((item, i) => {
      let dx = item.x - hero.x;
      let dy = item.y - hero.y;
      let dist = Math.hypot(dx, dy);
      if (dist < 1) {
        const angle = (i + 1) * 2.399963229728653;
        dx = Math.cos(angle);
        dy = Math.sin(angle);
        dist = 1;
      }
      const radius = Math.max(minDist, dist) + minDist * 0.2;
      item.x = hero.x + (dx / dist) * radius;
      item.y = hero.y + (dy / dist) * radius;
    });
    for (let pass = 0; pass < 8; pass++) {
      for (let i = 0; i < others.length; i++) {
        for (let j = i + 1; j < others.length; j++) {
          const a = others[i];
          const b = others[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let dist = Math.hypot(dx, dy);
          if (dist >= minDist) continue;
          if (dist < 1) {
            dx = 1;
            dy = 0;
            dist = 1;
          }
          const push = (minDist - dist) / 2;
          a.x -= (dx / dist) * push;
          a.y -= (dy / dist) * push;
          b.x += (dx / dist) * push;
          b.y += (dy / dist) * push;
        }
      }
      others.forEach((item, i) => {
        let dx = item.x - hero.x;
        let dy = item.y - hero.y;
        let dist = Math.hypot(dx, dy);
        if (dist >= minDist) return;
        if (dist < 1) {
          const angle = (i + 1) * 2.399963229728653;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          dist = 1;
        }
        item.x = hero.x + (dx / dist) * minDist;
        item.y = hero.y + (dy / dist) * minDist;
      });
    }
  }

  function applyPositions() {
    notes.forEach((note) => {
      const el = world.querySelector(`[data-id="${note.id}"]`);
      if (!el) return;
      el.style.left = `${note.x}px`;
      el.style.top = `${note.y}px`;
    });
  }

  function dimAround(id) {
    board.classList.add("is-focusing");
    world.querySelectorAll(".note").forEach((el) => {
      el.classList.toggle("is-dim", el.dataset.id !== id);
    });
  }

  function clearDim() {
    board.classList.remove("is-focusing");
    world.querySelectorAll(".note").forEach((el) => el.classList.remove("is-dim"));
  }

  function step() {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const size = rem * (window.matchMedia("(max-width: 640px)").matches ? 13.25 : 15);
    return size * 1.35;
  }

  function cell(index) {
    const gap = step();
    const { q, r } = axial(index);
    return {
      x: (q + r / 2) * gap,
      y: r * gap * 0.86602540378,
    };
  }

  function axial(index) {
    if (index === 0) return { q: 0, r: 0 };
    let ring = 1;
    let start = 1;
    while (start + 6 * ring <= index) {
      start += 6 * ring;
      ring += 1;
    }
    const offset = index - start;
    const walk = [
      [-1, 1],
      [-1, 0],
      [0, -1],
      [1, -1],
      [1, 0],
      [0, 1],
    ];
    let q = ring;
    let r = 0;
    let stepCount = 0;
    for (const [dq, dr] of walk) {
      for (let i = 0; i < ring; i++) {
        if (stepCount === offset) return { q, r };
        q += dq;
        r += dr;
        stepCount += 1;
      }
    }
    return { q, r };
  }

  function applyCam() {
    world.style.transform = `translate(${window.innerWidth / 2 + cam.x}px, ${window.innerHeight / 2 + cam.y}px) scale(${cam.z})`;
  }

  function zoomAt(screenX, screenY, factor) {
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, cam.z * factor));
    if (next === cam.z) return;
    const worldX = (screenX - window.innerWidth / 2 - cam.x) / cam.z;
    const worldY = (screenY - window.innerHeight / 2 - cam.y) / cam.z;
    cam.z = next;
    cam.x = screenX - window.innerWidth / 2 - worldX * cam.z;
    cam.y = screenY - window.innerHeight / 2 - worldY * cam.z;
  }

  function pinchInfo() {
    const [a, b] = [...pointers.values()];
    return {
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  }

  function easeCam(targetX, targetY) {
    cancelEase();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      cam.x = targetX;
      cam.y = targetY;
      applyCam();
      return;
    }
    const id = ++animId;
    const fromX = cam.x;
    const fromY = cam.y;
    const start = performance.now();
    const tick = (now) => {
      if (id !== animId) return;
      const t = Math.min(1, (now - start) / 380);
      const e = 1 - (1 - t) ** 3;
      cam.x = fromX + (targetX - fromX) * e;
      cam.y = fromY + (targetY - fromY) * e;
      applyCam();
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function cancelEase() {
    animId += 1;
  }
})();
