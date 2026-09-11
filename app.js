(() => {
  const KEY = "notes-for-life";
  const PAPERS = [
    { paper: "#9A73EF", band: "#8660d9" },
    { paper: "#F6A89B", band: "#e89588" },
    { paper: "#64D183", band: "#52be71" },
    { paper: "#66A9ED", band: "#5498d9" },
    { paper: "#F3CD6F", band: "#e0ba5a" },
    { paper: "#D4C8C5", band: "#c0b4b1" },
    { paper: "#F8C89D", band: "#e5b58a" },
    { paper: "#FFBDF2", band: "#e8a8dd" },
  ];

  const board = document.getElementById("board");
  const world = document.getElementById("world");
  const add = document.getElementById("add");
  const dock = document.getElementById("dock");
  const reset = document.getElementById("reset");
  const viewToggle = document.getElementById("viewToggle");
  const DOCK_PAPER = 120;
  const DRAG_THRESHOLD = 6;
  let dockPapers = [];
  let dockColors = [];
  let topWrap = null;

  const ZOOM = 0.86;
  const ZOOM_MIN = 0.35;
  const ZOOM_MAX = 2.4;
  const cam = { x: 0, y: 0, z: ZOOM };
  const pointers = new Map();
  let notes = load();
  let zTop = 5;
  let lastPinch = null;
  let animId = 0;
  let dockDrag = null;
  let viewMode = "wall"; // wall | stack
  let stackOrder = [];
  let stackBackup = null;
  let stackCam = null;
  let stackBusy = false;
  let wheelAcc = 0;
  const STACK_PEEK = 6;
  const STACK_DEPTH = 5;
  const STACK_FADE_UNDER_MS = 500;
  const STACK_VIEW_MS = 780;
  const STACK_VIEW_EASE = "cubic-bezier(0.22, 0.61, 0.36, 1)";
  let stackPeelMs = 1000;
  let viewTransitioning = false;
  const peelSound = new Audio("sounds/sticky-note-peel.wav");
  peelSound.preload = "auto";
  /** Next peel-away flies top-left or top-right. */
  let nextStackPeelSide = "left";

  // Tuned top-left peel; top-right is the horizontal mirror.
  const PEEL_LAB_DEFAULTS = {
    flyX: -100,
    flyY: -123,
    flyScale: 1.3,
    ms: 1000,
    originX: 12,
    originY: 10,
    rx: 59,
    sky: -26,
    skx: 6,
    rz: 16,
    tlX: 0,
    tlY: 0,
    trX: 100,
    trY: 0,
    brX: 158,
    brY: 148,
    blX: 0,
    blY: 100,
  };

  function mirrorPeelValues(left) {
    return {
      ...left,
      flyX: -left.flyX,
      originX: 100 - left.originX,
      sky: -left.sky,
      skx: -left.skx,
      rz: -left.rz,
      tlX: 100 - left.trX,
      tlY: left.trY,
      trX: 100 - left.tlX,
      trY: left.tlY,
      brX: 100 - left.blX,
      brY: left.blY,
      blX: 100 - left.brX,
      blY: left.brY,
    };
  }

  function peelValuesForSide(side) {
    const left = readPeelLabValues();
    return side === "right" ? mirrorPeelValues(left) : left;
  }

  function applyPeelSide(side) {
    applyPeelLabVars(peelValuesForSide(side));
  }

  function applyPeelLabVars(values) {
    const root = document.documentElement;
    root.style.setProperty("--stack-fly-x", `${values.flyX}%`);
    root.style.setProperty("--stack-fly-y", `${values.flyY}%`);
    root.style.setProperty("--stack-fly-scale", String(values.flyScale));
    root.style.setProperty("--stack-ms", `${values.ms}ms`);
    root.style.setProperty("--stack-origin-x", `${values.originX}%`);
    root.style.setProperty("--stack-origin-y", `${values.originY}%`);
    root.style.setProperty("--stack-rx", `${values.rx}deg`);
    root.style.setProperty("--stack-sky", `${values.sky}deg`);
    root.style.setProperty("--stack-skx", `${values.skx}deg`);
    root.style.setProperty("--stack-rz", `${values.rz}deg`);
    root.style.setProperty("--stack-tl-x", `${values.tlX}%`);
    root.style.setProperty("--stack-tl-y", `${values.tlY}%`);
    root.style.setProperty("--stack-tr-x", `${values.trX}%`);
    root.style.setProperty("--stack-tr-y", `${values.trY}%`);
    root.style.setProperty("--stack-br-x", `${values.brX}%`);
    root.style.setProperty("--stack-br-y", `${values.brY}%`);
    root.style.setProperty("--stack-bl-x", `${values.blX}%`);
    root.style.setProperty("--stack-bl-y", `${values.blY}%`);
    stackPeelMs = values.ms;
  }

  function readPeelLabValues() {
    const lab = document.getElementById("peelLab");
    if (!lab) return { ...PEEL_LAB_DEFAULTS };
    const values = { ...PEEL_LAB_DEFAULTS };
    lab.querySelectorAll("label[data-key]").forEach((label) => {
      const key = label.dataset.key;
      const input = label.querySelector("input");
      if (!key || !input) return;
      values[key] = Number(input.value);
    });
    return values;
  }

  function formatPeelLabOutput(key, value) {
    if (key === "flyScale") return value.toFixed(2);
    if (key === "ms") return `${Math.round(value)}ms`;
    if (key === "rx" || key === "sky" || key === "skx" || key === "rz") {
      return `${Math.round(value)}°`;
    }
    return `${Math.round(value)}%`;
  }

  function syncPeelLabOutputs(changedKey) {
    const lab = document.getElementById("peelLab");
    if (!lab) return;
    lab.querySelectorAll("label[data-key]").forEach((label) => {
      const key = label.dataset.key;
      const input = label.querySelector("input");
      const output = label.querySelector("output");
      if (!key || !input || !output) return;
      const value = Number(input.value);
      const def = PEEL_LAB_DEFAULTS[key];
      const dirty =
        key === "flyScale" ? Math.abs(value - def) > 0.001 : value !== def;
      output.textContent = formatPeelLabOutput(key, value);
      label.classList.toggle("is-dirty", dirty);
      label.classList.toggle("is-changed", changedKey === key);
    });
  }

  function initPeelLab() {
    const lab = document.getElementById("peelLab");
    if (!lab) return;

    const applyFromUi = (changedKey) => {
      const values = readPeelLabValues();
      applyPeelLabVars(values);
      syncPeelLabOutputs(changedKey);
    };

    lab.querySelectorAll("label[data-key] input").forEach((input) => {
      input.addEventListener("input", () => {
        applyFromUi(input.closest("label")?.dataset.key);
      });
    });

    document.getElementById("peelLabReset")?.addEventListener("click", () => {
      lab.querySelectorAll("label[data-key]").forEach((label) => {
        const key = label.dataset.key;
        const input = label.querySelector("input");
        if (!key || !input || PEEL_LAB_DEFAULTS[key] === undefined) return;
        input.value = String(PEEL_LAB_DEFAULTS[key]);
      });
      applyFromUi(null);
    });

    document.getElementById("peelLabTestOut")?.addEventListener("click", () => {
      if (viewMode !== "stack") enterStackView();
      peelStack(1);
    });

    document.getElementById("peelLabTestIn")?.addEventListener("click", () => {
      if (viewMode !== "stack") enterStackView();
      peelStack(-1);
    });

    applyFromUi(null);
  }

  function playPeelSound() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    try {
      peelSound.currentTime = 0;
      void peelSound.play();
    } catch {
      /* autoplay / missing file */
    }
  }

  applyCam();
  initDock();
  initPeelLab();
  notes.forEach((note) => mount(note));
  // Browsers may restore focus into a note after refresh; keep startup unselected.
  releaseNoteFocus();
  window.addEventListener("pageshow", releaseNoteFocus);

  reset.addEventListener("click", () => {
    if (!window.confirm("Start over? This clears every note on this board.")) return;
    if (viewMode === "stack") exitStackView({ restore: false });
    localStorage.removeItem(KEY);
    world.querySelectorAll(".note").forEach((el) => el.remove());
    notes = [];
    zTop = 5;
    cam.x = 0;
    cam.y = 0;
    cam.z = ZOOM;
    applyCam();
    resetDockColors();
  });

  function syncViewToggle() {
    const wallBtn = viewToggle?.querySelector('[data-view="wall"]');
    const stackBtn = viewToggle?.querySelector('[data-view="stack"]');
    const onStack = viewMode === "stack";
    wallBtn?.setAttribute("aria-pressed", onStack ? "false" : "true");
    stackBtn?.setAttribute("aria-pressed", onStack ? "true" : "false");
    viewToggle?.setAttribute("aria-label", onStack ? "Stack view" : "Board view");
    viewToggle?.classList.toggle("is-stack", onStack);
  }

  viewToggle?.addEventListener("click", (event) => {
    if (viewTransitioning) return;
    const btn = event.target.closest(".view-toggle-btn");
    if (!(btn instanceof HTMLElement)) return;
    const next = btn.dataset.view;
    if (next === "stack" && viewMode !== "stack") enterStackView();
    else if (next === "wall" && viewMode !== "wall") exitStackView();
  });

  board.addEventListener("pointerdown", (event) => {
    if (viewMode === "stack" || viewTransitioning) return;
    if (dockDrag) return;
    if (event.target.closest(".note") || event.target.closest("#add")) return;
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
      if (viewMode === "stack") {
        onStackWheel(event);
        return;
      }
      if (viewTransitioning || board.classList.contains("is-focusing") || dockDrag) return;
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

  function paletteFor(paper) {
    return PAPERS.find((item) => item.paper === paper) || PAPERS[notes.length % PAPERS.length];
  }

  function screenToWorld(clientX, clientY) {
    return {
      x: (clientX - window.innerWidth / 2 - cam.x) / cam.z,
      y: (clientY - window.innerHeight / 2 - cam.y) / cam.z,
    };
  }

  function createNote({ x = 0, y = 0, paper, band } = {}) {
    const palette = paper
      ? paletteFor(paper)
      : PAPERS[notes.length % PAPERS.length];
    const note = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(),
      text: "",
      source: "",
      createdAt: new Date().toISOString(),
      x,
      y,
      paper: paper || palette.paper,
      band: band || palette.band,
    };
    notes.push(note);
    return note;
  }

  function mount(note, { autofocus = false } = {}) {
    const el = document.createElement("article");
    el.className = "note";
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

    const main = document.createElement("div");
    main.className = "note-main";

    const dateEl = document.createElement("time");
    dateEl.className = "note-date";
    if (note.createdAt) {
      dateEl.dateTime = note.createdAt;
      dateEl.textContent = formatCreated(note.createdAt);
    } else {
      dateEl.hidden = true;
    }

    const source = document.createElement("input");
    source.type = "text";
    source.className = "note-source";
    source.value = note.source || "";
    source.placeholder = "source";
    source.maxLength = 160;
    source.autocomplete = "off";
    source.spellcheck = false;
    source.setAttribute("aria-label", "Source");
    source.tabIndex = -1;

    const trash = document.createElement("button");
    trash.type = "button";
    trash.className = "note-delete";
    trash.setAttribute("aria-label", "Delete note");
    trash.tabIndex = -1;
    trash.innerHTML =
      '<span class="material-symbols-outlined" aria-hidden="true">delete</span>';

    const stackGrip = document.createElement("div");
    stackGrip.className = "note-stack-grip";
    stackGrip.setAttribute("aria-hidden", "true");

    let firstEdit = !note.text.trim();
    if (firstEdit) el.classList.add("is-first-edit");
    let selected = false;

    el.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      if (event.target.closest(".note-delete") || event.target === source) return;
      if (event.button != null && event.button !== 0) return;

      // Editing: keep typing; chrome click refocuses the field.
      if (el.matches(":focus-within")) {
        if (event.target !== field && event.target !== source) field.focus();
        return;
      }

      // Stack view: top band peels like scroll; rest of the note opens edit.
      if (viewMode === "stack") {
        if (stackFront() !== note) return;
        if (event.target.closest(".note-stack-grip")) {
          const startX = event.clientX;
          const startY = event.clientY;
          let moved = false;
          el.setPointerCapture(event.pointerId);

          const onMove = (ev) => {
            if (
              !moved &&
              Math.hypot(ev.clientX - startX, ev.clientY - startY) >= DRAG_THRESHOLD
            ) {
              moved = true;
            }
          };
          const onUp = (ev) => {
            el.releasePointerCapture(event.pointerId);
            el.removeEventListener("pointermove", onMove);
            el.removeEventListener("pointerup", onUp);
            el.removeEventListener("pointercancel", onUp);
            const dy = ev.clientY - startY;
            // Match wheel: down → peel away, up → peel back; bare click peels away.
            if (!moved) peelStack(1);
            else if (Math.abs(dy) >= DRAG_THRESHOLD) peelStack(dy > 0 ? 1 : -1);
            else peelStack(1);
          };

          el.addEventListener("pointermove", onMove);
          el.addEventListener("pointerup", onUp);
          el.addEventListener("pointercancel", onUp);
          return;
        }
        field.focus();
        return;
      }

      // Stuck: drag to move, or click to enter edit.
      const startX = event.clientX;
      const startY = event.clientY;
      const originX = note.x;
      const originY = note.y;
      let moved = false;
      el.setPointerCapture(event.pointerId);

      const onMove = (ev) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        if (!moved) el.style.zIndex = String(++zTop);
        moved = true;
        el.classList.add("is-dragging");
        note.x = originX + dx / cam.z;
        note.y = originY + dy / cam.z;
        el.style.left = `${note.x}px`;
        el.style.top = `${note.y}px`;
      };

      const onUp = () => {
        el.releasePointerCapture(event.pointerId);
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointercancel", onUp);
        el.classList.remove("is-dragging");
        if (moved) persist();
        else field.focus();
      };

      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onUp);
    });

    const onSelect = () => {
      // Stack layout owns z-index; bumping zTop would drop the front note under the peek.
      if (viewMode !== "stack") el.style.zIndex = String(++zTop);
      source.tabIndex = 0;
      trash.tabIndex = 0;
      if (!selected) {
        selected = true;
        // Match peel animation: skip on first edit / stack edit (no unstick peel sound).
        if (viewMode !== "stack" && !el.classList.contains("is-first-edit")) {
          playPeelSound();
        }
      }
      focusNote(note);
    };
    field.addEventListener("focus", onSelect);
    source.addEventListener("focus", onSelect);
    field.addEventListener("input", () => {
      note.text = field.value;
      sizeField(field, note.text);
      persist();
    });
    source.addEventListener("input", () => {
      note.source = source.value;
      persist();
    });
    field.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey) return;
      event.preventDefault();
      field.blur();
    });
    source.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      source.blur();
    });
    trash.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    trash.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      removeNote(note, el);
    });
    const onBlur = () => {
      window.setTimeout(() => {
        if (el.contains(document.activeElement)) return;
        selected = false;
        if (note.text.trim()) {
          firstEdit = false;
          el.classList.remove("is-first-edit");
        }
        source.tabIndex = -1;
        trash.tabIndex = -1;
        clearDim();
        if (viewMode === "stack") applyStackLayout();
      }, 0);
    };
    field.addEventListener("blur", onBlur);
    source.addEventListener("blur", onBlur);

    main.appendChild(field);
    paper.appendChild(dateEl);
    paper.appendChild(main);
    paper.appendChild(source);
    paper.appendChild(trash);
    paper.appendChild(stackGrip);
    const sheet = document.createElement("div");
    sheet.className = "note-sheet";
    sheet.appendChild(paper);
    sheet.appendChild(fold);
    const back = document.createElement("div");
    back.className = "note-back";
    back.setAttribute("aria-hidden", "true");
    el.appendChild(sheet);
    el.appendChild(back);
    world.appendChild(el);
    const markMounted = () => el.classList.add("is-mounted");
    el.addEventListener("animationend", (event) => {
      if (event.target === el && event.animationName === "place") markMounted();
    });
    window.setTimeout(markMounted, 400);
    if (autofocus) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => field.focus());
      });
    }
    return el;
  }

  function initDock() {
    if (!dock) return;
    dock.innerHTML = "";
    dockPapers = [];
    dockColors = PAPERS.slice(0, 4).map((item) => item.paper);
    for (let i = 0; i < 4; i++) {
      const wrap = document.createElement("div");
      wrap.className = "paper-wrapper" + (i === 3 ? " paper-wrapper--top" : "");
      if (i === 3) {
        wrap.setAttribute("role", "button");
        wrap.setAttribute("aria-label", "Drag to add a note");
        wrap.tabIndex = 0;
      }
      const paper = createDockPaper(DOCK_PAPER, dockColors[i], i === 3);
      wrap.appendChild(paper.svg);
      dock.appendChild(wrap);
      dockPapers.push(paper);
    }
    topWrap = dock.querySelector(".paper-wrapper--top");
    bindDockDrag();
    paintDock();
  }

  function bindDockDrag() {
    if (!topWrap || !dock) return;

    const onPointerDown = (event) => {
      if (viewMode === "stack") return;
      if (event.button != null && event.button !== 0) return;
      if (dockDrag) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = dock.getBoundingClientRect();
      dockDrag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        rect,
        out: false,
      };
      dock.classList.add("dragging");
      add.classList.add("dragging");
      topWrap.style.setProperty("--x", "0px");
      topWrap.style.setProperty("--y", "0px");
      dockPapers[3]?.setRoll(false, 330);
      playPeelSound();
      topWrap.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event) => {
      if (!dockDrag || event.pointerId !== dockDrag.pointerId) return;
      const x = event.clientX - dockDrag.startX;
      const y = event.clientY - dockDrag.startY;
      topWrap.style.setProperty("--x", `${x}px`);
      topWrap.style.setProperty("--y", `${y}px`);
      const { rect } = dockDrag;
      const isOut =
        event.clientY < rect.top ||
        event.clientX < rect.left ||
        event.clientX > rect.right;
      if (isOut !== dockDrag.out) {
        dockDrag.out = isOut;
        dock.classList.toggle("out", isOut);
        add.classList.toggle("out", isOut);
        dockPapers[2]?.setRoll(isOut, isOut ? 300 : 0);
        if (!isOut) dockPapers[3]?.setRoll(false, 300);
      }
    };

    const endDockDrag = (event) => {
      if (!dockDrag || event.pointerId !== dockDrag.pointerId) return;
      const wasOut = dockDrag.out;
      const dropRect = topWrap.getBoundingClientRect();
      try {
        topWrap.releasePointerCapture(dockDrag.pointerId);
      } catch {
        /* already released */
      }
      dockDrag = null;

      if (wasOut) {
        const used = dockColors[3];
        const palette = paletteFor(used);
        const pos = screenToWorld(
          dropRect.left + dropRect.width / 2,
          dropRect.top + dropRect.height / 2
        );

        // Hide the dragged sheet so it doesn't snap back into the dock.
        // Hide the promoted under-sheet so it doesn't flash home into the fan.
        // Freeze transforms, then jump to the resting stack.
        const promoted = dock.querySelector(".paper-wrapper:nth-child(3)");
        topWrap.style.opacity = "0";
        if (promoted) promoted.style.opacity = "0";
        dock.classList.add("is-settling");
        add.classList.add("is-settling");
        topWrap.style.setProperty("--x", "0px");
        topWrap.style.setProperty("--y", "0px");
        dock.classList.remove("dragging", "out");
        add.classList.remove("dragging", "out");

        const note = createNote({
          x: pos.x,
          y: pos.y,
          paper: palette.paper,
          band: palette.band,
        });
        // Advance stack only on create — delete never puts a sheet back.
        dockColors = [nextStackColor(), ...dockColors.slice(0, 3)];
        paintDock();
        persist();
        mount(note, { autofocus: true });

        requestAnimationFrame(() => {
          topWrap.style.opacity = "";
          if (promoted) promoted.style.opacity = "";
          dock.classList.remove("is-settling");
          add.classList.remove("is-settling");
        });
      } else {
        dock.classList.remove("dragging", "out");
        add.classList.remove("dragging", "out");
        topWrap.style.setProperty("--x", "0px");
        topWrap.style.setProperty("--y", "0px");
        dockPapers[3]?.setRoll(true, 330);
        dockPapers[2]?.setRoll(false, 300);
      }
    };

    topWrap.addEventListener("pointerdown", onPointerDown);
    topWrap.addEventListener("pointermove", onPointerMove);
    topWrap.addEventListener("pointerup", endDockDrag);
    topWrap.addEventListener("pointercancel", endDockDrag);
  }

  function nextStackColor() {
    return PAPERS[Math.floor(Math.random() * PAPERS.length)].paper;
  }

  function resetDockColors() {
    dockColors = PAPERS.slice(0, 4).map((item) => item.paper);
    paintDock();
  }

  function paintDock() {
    if (!dockPapers.length) return;
    dockPapers.forEach((paper, i) => {
      paper.setColor(dockColors[i]);
      paper.setRoll(i === 3, 0);
    });
  }

  function createDockPaper(size, color, rolled) {
    const NS = "http://www.w3.org/2000/svg";
    const uid = Math.random().toString(36).slice(2, 9);
    const maskId = `dock-mask-${uid}`;
    const gradientId = `dock-grad-${uid}`;
    const blurId = `dock-blur-${uid}`;

    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "paper");
    svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("aria-hidden", "true");

    const defs = document.createElementNS(NS, "defs");
    defs.innerHTML = `
      <linearGradient id="${gradientId}" x1="0.48" x2="0.6" y1="0.45" y2="0.6">
        <stop offset="0%" stop-color="#ffffff60"></stop>
        <stop offset="100%" stop-color="${color}"></stop>
      </linearGradient>
      <filter id="${blurId}" x="-58" y="-46" width="${size}" height="${size}"
        filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
        <feFlood flood-opacity="0" result="BackgroundImageFix"></feFlood>
        <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"></feBlend>
        <feGaussianBlur stdDeviation="${size / 10}" result="blur"></feGaussianBlur>
      </filter>
      <mask id="${maskId}"><path fill="white"></path></mask>
    `;
    svg.appendChild(defs);

    const group = document.createElementNS(NS, "g");
    group.setAttribute("mask", `url(#${maskId})`);
    const rect = document.createElementNS(NS, "rect");
    rect.setAttribute("width", String(size));
    rect.setAttribute("height", String(size));
    rect.setAttribute("fill", color);
    const shadow = document.createElementNS(NS, "path");
    shadow.setAttribute("fill", "black");
    shadow.setAttribute("fill-opacity", "0.3");
    shadow.setAttribute("filter", `url(#${blurId})`);
    const roll = document.createElementNS(NS, "path");
    roll.setAttribute("fill", color);
    const rollLight = document.createElementNS(NS, "path");
    rollLight.setAttribute("fill", `url(#${gradientId})`);
    group.append(rect, shadow, roll, rollLight);
    svg.appendChild(group);

    const maskPath = defs.querySelector("mask path");
    const gradStop = defs.querySelector(`#${gradientId} stop:last-child`);
    let distance = dockRollDistance(size, rolled);
    let animIdLocal = 0;

    const paint = () => {
      maskPath.setAttribute("d", dockMaskD(distance, size));
      roll.setAttribute("d", dockRollD(distance, size));
      rollLight.setAttribute("d", dockRollD(distance, size));
      shadow.setAttribute("d", dockShadowD(distance, size));
    };
    paint();

    return {
      svg,
      setColor(next) {
        rect.setAttribute("fill", next);
        roll.setAttribute("fill", next);
        if (gradStop) gradStop.setAttribute("stop-color", next);
      },
      setRoll(nextRoll, duration = 300) {
        const target = dockRollDistance(size, nextRoll);
        if (!duration || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          distance = target;
          paint();
          return;
        }
        const id = ++animIdLocal;
        const from = distance;
        const start = performance.now();
        const tick = (now) => {
          if (id !== animIdLocal) return;
          const t = Math.min(1, (now - start) / duration);
          const e = 1 - (1 - t) ** 3;
          distance = from + (target - from) * e;
          paint();
          if (t < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
    };
  }

  function dockRollDistance(size, roll) {
    return roll ? size / 6 : 0;
  }

  function dockShadowD(distance, size) {
    if (!distance) return "M0 0Z";
    const c1 = (distance * 2 + size / 6) * (distance / (size / 6));
    return `M0 0L0 ${c1}L${c1} 0Z`;
  }

  function dockMaskD(distance, size) {
    const c1 = distance * 2 + size / 10;
    if (!distance) {
      return `M0 0H${size}V${size}H0Z`;
    }
    return [
      `M0 ${c1}`,
      `C0 ${distance * 2} 0 ${distance * 2} ${distance} ${distance}`,
      `C${distance * 2} 0 ${distance * 2} 0 ${c1} 0`,
      `H${size}V${size}H0Z`,
    ].join("");
  }

  function dockRollD(distance, size) {
    if (!distance) return "M0 0Z";
    const c1 = distance;
    const px = distance * 1.5;
    const py = distance * 1.3;
    return [
      `M${px} ${py}`,
      `C${px} ${py} ${distance - c1 / 2 - 2} ${distance + c1 / 2 - 2} ${distance - c1 - 2} ${distance + c1 - 2}`,
      `L${distance + c1} ${distance - c1}`,
      `C${distance + c1 / 2 - 2} ${distance - c1 / 2 - 2} ${px} ${py} ${px} ${py}Z`,
    ].join("");
  }

  function removeNote(note, el) {
    if (el.classList.contains("is-tearing")) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finishRemove(note, el);
      return;
    }
    tearAwayNote(note, el);
  }

  function finishRemove(note, el) {
    notes = notes.filter((item) => item !== note);
    el.remove();
    clearDim();
    if (viewMode === "stack") {
      stackOrder = stackOrder.filter((item) => item !== note);
      stackBackup = stackBackup?.filter((item) => item.id !== note.id) || null;
      if (!stackOrder.length) exitStackView({ restore: false });
      else applyStackLayout();
    }
    if (!notes.length) {
      cam.x = 0;
      cam.y = 0;
      applyCam();
    }
    persist();
  }

  function buildTearPoints(steps = 18) {
    const pts = [];
    const seed = Math.random() * Math.PI * 2;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const y = t * 100;
      const x =
        50 +
        Math.sin(seed + t * 9.2) * 5.5 +
        Math.sin(seed * 1.7 + t * 21) * 2.8 +
        (Math.random() * 3.2 - 1.6);
      pts.push({ x: Math.min(62, Math.max(38, x)), y });
    }
    return pts;
  }

  function tearClipLeft(pts) {
    const parts = ["0% 0%"];
    pts.forEach((p) => parts.push(`${p.x.toFixed(2)}% ${p.y.toFixed(2)}%`));
    parts.push("0% 100%");
    return `polygon(${parts.join(", ")})`;
  }

  function tearClipRight(pts) {
    const parts = ["100% 0%"];
    pts.forEach((p) => parts.push(`${p.x.toFixed(2)}% ${p.y.toFixed(2)}%`));
    parts.push("100% 100%");
    return `polygon(${parts.join(", ")})`;
  }

  function tearAwayNote(note, el) {
    el.classList.add("is-tearing");
    const active = document.activeElement;
    if (active instanceof HTMLElement && el.contains(active)) active.blur();
    clearDim();

    const rect = el.getBoundingClientRect();
    const localW = Math.max(1, el.offsetWidth);
    const localH = Math.max(1, el.offsetHeight);
    const sx = rect.width / localW;
    const sy = rect.height / localH;
    const pts = buildTearPoints();

    const layer = document.createElement("div");
    layer.className = "note-tear-layer";
    layer.style.left = `${rect.left}px`;
    layer.style.top = `${rect.top}px`;
    layer.style.width = `${rect.width}px`;
    layer.style.height = `${rect.height}px`;

    const makeHalf = (side) => {
      const half = document.createElement("div");
      half.className = `note-tear-half note-tear-${side}`;
      half.style.clipPath = side === "left" ? tearClipLeft(pts) : tearClipRight(pts);

      const clone = el.cloneNode(true);
      clone.classList.remove("is-tearing");
      clone.style.left = "0";
      clone.style.top = "0";
      clone.style.width = `${localW}px`;
      clone.style.height = `${localH}px`;
      clone.style.transform = `scale(${sx}, ${sy})`;
      clone.style.transformOrigin = "0 0";
      clone.style.margin = "0";
      clone.style.zIndex = "1";
      clone.querySelectorAll("textarea, input, button").forEach((node) => {
        node.tabIndex = -1;
        node.disabled = true;
      });
      half.appendChild(clone);
      return half;
    };

    const left = makeHalf("left");
    const right = makeHalf("right");
    layer.append(left, right);
    document.body.appendChild(layer);

    el.style.visibility = "hidden";
    el.style.pointerEvents = "none";

    // Remove from data immediately so dock/board state stays correct mid-animation.
    notes = notes.filter((item) => item !== note);
    if (viewMode === "stack") {
      stackOrder = stackOrder.filter((item) => item !== note);
      stackBackup = stackBackup?.filter((item) => item.id !== note.id) || null;
    }
    persist();

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        left.classList.add("is-torn");
        right.classList.add("is-torn");
      });
    });

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      layer.remove();
      el.remove();
      if (viewMode === "stack") {
        if (!stackOrder.length) exitStackView({ restore: false });
        else applyStackLayout();
      }
      if (!notes.length) {
        cam.x = 0;
        cam.y = 0;
        applyCam();
      }
    };
    layer.addEventListener("transitionend", (event) => {
      if (event.target !== left && event.target !== right) return;
      finish();
    });
    window.setTimeout(finish, 900);
  }

  function persist() {
    const data = notes.map(({ id, text, source, createdAt, x, y, paper, band }) => ({
      id,
      text,
      source: source || "",
      createdAt: createdAt || null,
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
      if (!Array.isArray(saved)) return [];
      return saved.map((note) => ({
        ...note,
        text: typeof note.text === "string" ? note.text : "",
        source: typeof note.source === "string" ? note.source : "",
        createdAt: typeof note.createdAt === "string" ? note.createdAt : null,
        x: typeof note.x === "number" ? note.x : 0,
        y: typeof note.y === "number" ? note.y : 0,
      }));
    } catch {
      return [];
    }
  }

  function formatCreated(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
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

  function focusNote(note) {
    dimAround(note.id);
    if (viewMode === "stack") return;
    easeCam(-note.x * cam.z, -note.y * cam.z);
  }

  function stackPoseForDepth(depth) {
    if (depth === 0) {
      return {
        transform: "translate(-50%, -50%)",
        opacity: "1",
        visibility: "visible",
        zIndex: "200",
      };
    }
    if (depth <= STACK_DEPTH) {
      return {
        transform: `translate(-50%, -50%) translateY(${depth * STACK_PEEK}px)`,
        opacity: "1",
        visibility: "visible",
        zIndex: String(200 - depth),
      };
    }
    return {
      transform: `translate(-50%, -50%) translateY(${STACK_DEPTH * STACK_PEEK}px)`,
      opacity: "0",
      visibility: "hidden",
      zIndex: "1",
    };
  }

  function enterStackView() {
    if (!notes.length || viewTransitioning) return;
    releaseNoteFocus();
    cancelEase();
    viewMode = "stack";
    viewTransitioning = true;
    document.body.classList.add("is-stack-view");
    syncViewToggle();

    stackBackup = notes.map((note) => ({ id: note.id, x: note.x, y: note.y }));
    stackCam = { x: cam.x, y: cam.y, z: cam.z };

    stackOrder = [...notes].sort((a, b) => {
      const ta = Date.parse(a.createdAt || "") || 0;
      const tb = Date.parse(b.createdAt || "") || 0;
      return ta - tb;
    });
    stackBusy = true;
    wheelAcc = 0;
    nextStackPeelSide = "left";

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const front = stackOrder.length - 1;

    // Start from current board poses; then fly into the deck.
    stackOrder.forEach((note, i) => {
      const el = world.querySelector(`[data-id="${note.id}"]`);
      if (!el) return;
      const depth = front - i;
      const pose = stackPoseForDepth(depth);
      el.classList.add("is-stack-item");
      el.classList.remove(
        "is-stack-front",
        "is-stack-behind",
        "is-stack-gone",
        "is-stack-peeling",
        "is-stack-peeling-in",
        "is-stack-peel-seed",
        "is-stack-fade-under"
      );
      if (depth === 0) el.classList.add("is-stack-front");
      else el.classList.add("is-stack-behind");
      el.style.transition = "none";
      el.style.animation = "none";
      el.style.left = `${note.x}px`;
      el.style.top = `${note.y}px`;
      el.style.transform = "translate(-50%, -50%)";
      el.style.opacity = "1";
      el.style.visibility = "visible";
      el.style.zIndex = pose.zIndex;
      el.style.setProperty("--peel", "0");
    });

    if (reduced) {
      cam.x = 0;
      cam.y = 0;
      cam.z = ZOOM;
      applyCam();
      applyStackLayout();
      stackBusy = false;
      viewTransitioning = false;
      return;
    }

    void world.offsetWidth;

    easeCamTo(0, 0, ZOOM, STACK_VIEW_MS);

    stackOrder.forEach((note, i) => {
      const el = world.querySelector(`[data-id="${note.id}"]`);
      if (!el) return;
      const depth = front - i;
      const pose = stackPoseForDepth(depth);
      const delay = Math.min(160, Math.hypot(note.x, note.y) * 0.12);
      el.style.transition = [
        `left ${STACK_VIEW_MS}ms ${STACK_VIEW_EASE} ${delay}ms`,
        `top ${STACK_VIEW_MS}ms ${STACK_VIEW_EASE} ${delay}ms`,
        `transform ${STACK_VIEW_MS}ms ${STACK_VIEW_EASE} ${delay}ms`,
        `opacity ${STACK_VIEW_MS}ms ${STACK_VIEW_EASE} ${delay}ms`,
      ].join(", ");
      note.x = 0;
      note.y = 0;
      el.style.left = "0px";
      el.style.top = "0px";
      el.style.transform = pose.transform;
      el.style.opacity = pose.opacity;
    });

    window.setTimeout(() => {
      // Settle without wiping styles (clearing animation/transform flashes notes).
      stackOrder.forEach((note, i) => {
        const el = world.querySelector(`[data-id="${note.id}"]`);
        if (!el) return;
        const depth = front - i;
        const pose = stackPoseForDepth(depth);
        el.style.transition = "none";
        el.style.animation = "none";
        el.classList.add("is-mounted", "is-stack-item");
        el.classList.toggle("is-stack-front", depth === 0);
        el.classList.toggle("is-stack-behind", depth > 0);
        el.style.left = "0px";
        el.style.top = "0px";
        el.style.transform = pose.transform;
        el.style.opacity = pose.opacity;
        el.style.visibility = pose.visibility;
        el.style.zIndex = pose.zIndex;
        note.x = 0;
        note.y = 0;
      });
      stackBusy = false;
      viewTransitioning = false;
    }, STACK_VIEW_MS + 180);
  }

  function exitStackView({ restore = true } = {}) {
    if (viewMode !== "stack" || viewTransitioning) return;
    releaseNoteFocus();
    viewMode = "wall";
    syncViewToggle();

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const backup = restore ? stackBackup : null;
    const savedCam = restore ? stackCam : null;

    const finishExit = () => {
      // Lock final wall poses first, then drop stack chrome — no style wipe flash.
      if (backup) {
        backup.forEach(({ id, x, y }) => {
          const note = notes.find((item) => item.id === id);
          const el = world.querySelector(`[data-id="${id}"]`);
          if (!note || !el) return;
          note.x = x;
          note.y = y;
          el.style.transition = "none";
          el.style.animation = "none";
          el.style.left = `${x}px`;
          el.style.top = `${y}px`;
          el.style.transform = "translate(-50%, -50%) scale(1)";
          el.style.opacity = "1";
          el.style.visibility = "visible";
          el.style.boxShadow = "0 1px 1px rgba(42, 36, 28, 0.05)";
          el.style.zIndex = "";
        });
      }
      void world.offsetWidth;

      document.body.classList.remove("is-stack-view");
      world.querySelectorAll(".note").forEach((el) => {
        el.classList.remove(
          "is-stack-item",
          "is-stack-front",
          "is-stack-behind",
          "is-stack-gone",
          "is-stack-peeling",
          "is-stack-peeling-in",
          "is-stack-peel-seed",
          "is-stack-fade-under"
        );
        el.classList.add("is-mounted");
        el.style.transition = "none";
        el.style.animation = "none";
        el.style.transform = "translate(-50%, -50%) scale(1)";
        el.style.opacity = "1";
        el.style.visibility = "visible";
        el.style.boxShadow = "";
        el.style.setProperty("--peel", "0");
        el.style.removeProperty("--peel-size");
        // Drop inline transform after paint so CSS default matches exactly.
        void el.offsetWidth;
        el.style.transform = "";
        el.style.opacity = "";
        el.style.visibility = "";
        el.style.transition = "";
        el.style.animation = "";
      });
      if (savedCam) {
        cam.x = savedCam.x;
        cam.y = savedCam.y;
        cam.z = savedCam.z;
        applyCam();
      }
      stackBackup = null;
      stackCam = null;
      stackOrder = [];
      stackBusy = false;
      wheelAcc = 0;
      viewTransitioning = false;
      persist();
    };

    if (!restore || reduced || !backup || !savedCam) {
      cancelEase();
      finishExit();
      return;
    }

    viewTransitioning = true;
    stackBusy = true;
    cancelEase();

    // Fly from the deck back to saved board spots while the camera restores.
    world.querySelectorAll(".note").forEach((el) => {
      el.classList.remove(
        "is-stack-peeling",
        "is-stack-peeling-in",
        "is-stack-peel-seed",
        "is-stack-fade-under"
      );
      el.style.animation = "none";
      el.style.transition = "none";
      el.style.visibility = "visible";
      el.style.opacity = "1";
    });
    void world.offsetWidth;

    easeCamTo(savedCam.x, savedCam.y, savedCam.z, STACK_VIEW_MS);

    backup.forEach(({ id, x, y }) => {
      const note = notes.find((item) => item.id === id);
      const el = world.querySelector(`[data-id="${id}"]`);
      if (!note || !el) return;
      const delay = Math.min(160, Math.hypot(x, y) * 0.12);
      el.style.transition = [
        `left ${STACK_VIEW_MS}ms ${STACK_VIEW_EASE} ${delay}ms`,
        `top ${STACK_VIEW_MS}ms ${STACK_VIEW_EASE} ${delay}ms`,
        `transform ${STACK_VIEW_MS}ms ${STACK_VIEW_EASE} ${delay}ms`,
        `opacity ${STACK_VIEW_MS}ms ${STACK_VIEW_EASE} ${delay}ms`,
        `box-shadow ${STACK_VIEW_MS}ms ${STACK_VIEW_EASE} ${delay}ms`,
      ].join(", ");
      note.x = x;
      note.y = y;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.transform = "translate(-50%, -50%) scale(1)";
      el.style.opacity = "1";
      el.style.boxShadow = "0 1px 1px rgba(42, 36, 28, 0.05)";
      el.style.zIndex = String(++zTop);
    });

    window.setTimeout(finishExit, STACK_VIEW_MS + 180);
  }

  function stackFront() {
    return stackOrder.length ? stackOrder[stackOrder.length - 1] : null;
  }

  function applyStackLayout({ fadeInId = null } = {}) {
    const front = stackOrder.length - 1;
    stackOrder.forEach((note, i) => {
      const el = world.querySelector(`[data-id="${note.id}"]`);
      if (!el) return;
      note.x = 0;
      note.y = 0;
      el.style.left = "0px";
      el.style.top = "0px";
      el.classList.add("is-stack-item");
      el.classList.remove(
        "is-stack-front",
        "is-stack-behind",
        "is-stack-gone",
        "is-stack-peeling",
        "is-stack-peeling-in",
        "is-stack-peel-seed",
        "is-stack-fade-under"
      );
      el.style.opacity = "";
      el.style.visibility = "";
      el.style.transition = "none";
      el.style.animation = "none";
      el.style.boxShadow = "";
      el.style.transform = "";
      el.classList.add("is-mounted");
      el.style.setProperty("--peel", "0");
      el.style.removeProperty("--peel-size");

      const depth = front - i;
      const fadingIn = fadeInId && note.id === fadeInId;

      if (depth === 0) {
        el.classList.add("is-stack-front");
        el.style.zIndex = "200";
        el.style.transform = "translate(-50%, -50%)";
        el.style.opacity = "1";
        el.style.visibility = "visible";
        return;
      }

      el.classList.add("is-stack-behind");
      if (depth <= STACK_DEPTH) {
        el.style.zIndex = String(200 - depth);
        el.style.transform = `translate(-50%, -50%) translateY(${depth * STACK_PEEK}px)`;
        el.style.visibility = "visible";
        if (fadingIn) {
          el.style.transition = "none";
          el.style.opacity = "0";
        } else {
          el.style.opacity = "1";
        }
      } else {
        el.style.zIndex = "1";
        el.style.transform = `translate(-50%, -50%) translateY(${STACK_DEPTH * STACK_PEEK}px)`;
        el.style.opacity = "0";
        el.style.visibility = "hidden";
      }
    });
  }

  function fadeNoteIntoStack(el) {
    if (!el) return;
    el.style.transition = "none";
    el.style.animation = "none";
    el.style.visibility = "visible";
    el.style.opacity = "0";
    void el.offsetWidth;
    el.style.transition = `opacity ${STACK_FADE_UNDER_MS}ms ease`;
    el.style.opacity = "1";
    window.setTimeout(() => {
      if (el.isConnected) el.style.transition = "";
    }, STACK_FADE_UNDER_MS);
  }

  function onStackWheel(event) {
    if (stackBusy || stackOrder.length < 2) return;
    wheelAcc += event.deltaY;
    if (Math.abs(wheelAcc) < 40) return;
    const dir = wheelAcc > 0 ? 1 : -1;
    wheelAcc = 0;
    peelStack(dir);
  }

  function peelStack(dir) {
    if (stackBusy || stackOrder.length < 2) return;

    const frontIndex = stackOrder.length - 1;
    const fromNote = stackOrder[frontIndex];
    const toNote = dir > 0 ? stackOrder[frontIndex - 1] : stackOrder[0];
    const fromEl = world.querySelector(`[data-id="${fromNote.id}"]`);
    const toEl = world.querySelector(`[data-id="${toNote.id}"]`);
    if (!fromEl || !toEl) return;

    stackBusy = true;
    releaseNoteFocus();
    playPeelSound();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ms = reduced ? 0 : stackPeelMs;

    if (dir > 0) {
      // Alternate top-left / top-right peel each time.
      const side = nextStackPeelSide;
      nextStackPeelSide = side === "left" ? "right" : "left";
      applyPeelSide(side);

      // Lift the top note off the deck immediately so the stack can move up.
      const peeled = stackOrder.pop();
      if (!peeled) {
        stackBusy = false;
        return;
      }

      fromEl.classList.remove("is-stack-front");
      fromEl.style.transform = "translate(-50%, -50%) scale(1)";
      fromEl.style.transition = "none";
      fromEl.style.animation = "";
      fromEl.style.opacity = "";
      void fromEl.offsetWidth;
      fromEl.style.transition = "";
      fromEl.classList.add("is-stack-peeling");
      fromEl.style.zIndex = "300";

      applyStackLayout();

      window.setTimeout(() => {
        stackOrder.unshift(peeled);

        fromEl.style.transition = "none";
        fromEl.style.animation = "none";
        fromEl.style.opacity = "0";
        fromEl.classList.remove("is-stack-peeling");

        applyStackLayout({ fadeInId: peeled.id });
        const depth = stackOrder.length - 1;
        if (depth >= 1 && depth <= STACK_DEPTH) fadeNoteIntoStack(fromEl);
        stackBusy = false;
      }, ms);
    } else {
      // Match the side of the note coming back (last peel-away).
      applyPeelSide(nextStackPeelSide === "left" ? "right" : "left");

      fromEl.classList.remove("is-stack-front");
      fromEl.classList.add("is-stack-behind");
      fromEl.style.zIndex = "199";
      fromEl.style.transform = `translate(-50%, -50%) translateY(${STACK_PEEK}px)`;
      toEl.classList.remove("is-stack-behind", "is-stack-gone");
      toEl.style.visibility = "visible";
      toEl.style.zIndex = "300";
      toEl.style.opacity = "0";
      toEl.style.transform = "";
      toEl.style.boxShadow = "";
      toEl.style.animation = "";
      toEl.style.transition = "";
      toEl.style.setProperty("--peel", "0");
      toEl.classList.add("is-stack-peeling-in", "is-stack-peel-seed");
      void toEl.offsetWidth;
      toEl.classList.remove("is-stack-peel-seed");
      window.setTimeout(() => {
        const restored = stackOrder.shift();
        if (restored) stackOrder.push(restored);
        applyStackLayout();
        stackBusy = false;
      }, ms);
    }
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
    const dx = targetX - cam.x;
    const dy = targetY - cam.y;
    if (Math.hypot(dx, dy) < 0.5) {
      cam.x = targetX;
      cam.y = targetY;
      applyCam();
      return;
    }
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
    const duration = 520;
    const tick = (now) => {
      if (id !== animId) return;
      const t = Math.min(1, (now - start) / duration);
      const e = 1 - (1 - t) ** 3;
      cam.x = fromX + (targetX - fromX) * e;
      cam.y = fromY + (targetY - fromY) * e;
      applyCam();
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function easeCamTo(targetX, targetY, targetZ, duration) {
    cancelEase();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      cam.x = targetX;
      cam.y = targetY;
      cam.z = targetZ;
      applyCam();
      return;
    }
    const id = ++animId;
    const fromX = cam.x;
    const fromY = cam.y;
    const fromZ = cam.z;
    const start = performance.now();
    const tick = (now) => {
      if (id !== animId) return;
      const t = Math.min(1, (now - start) / duration);
      const e = 1 - (1 - t) ** 3;
      cam.x = fromX + (targetX - fromX) * e;
      cam.y = fromY + (targetY - fromY) * e;
      cam.z = fromZ + (targetZ - fromZ) * e;
      applyCam();
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function cancelEase() {
    animId += 1;
  }
})();
