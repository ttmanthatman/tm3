import { makeSample } from "./samples.js";

const MAX_CHARACTERS = 30;
const MAX_POINTS = 6000;
const MAX_BYTES = 131072;
const SCALE = 10000;
const encoder = new TextEncoder();
const $ = (id) => document.getElementById(id);

const state = {
  characters: [],
  current: { strokes: [] },
  active: null,
  firstPointAt: null,
  sent: [],
  playback: null,
  lastFocus: null,
};

const pad = $("writing-pad");
const modal = $("modal-backdrop");
const confirm = $("confirm-backdrop");

function makePayload(characters) {
  return { kind: "handwriting", version: 1, characters };
}

function snapshotCharacters() {
  const characters = structuredClone(state.characters);
  if (state.current.strokes.length) characters.push(structuredClone(state.current));
  return characters;
}

function countStrokes(characters) {
  return characters.reduce((sum, character) => sum + character.strokes.length, 0);
}

function countPoints(characters) {
  return characters.reduce((sum, character) => sum + character.strokes.reduce((n, stroke) => n + stroke.points.length, 0), 0);
}

function draftPointCount() {
  return countPoints(state.characters) + countPoints([state.current]);
}

function bytes(payload) {
  return encoder.encode(JSON.stringify(payload)).length;
}

function setHint(message, error = false) {
  const element = $("hint-line");
  element.textContent = message;
  element.classList.toggle("error", error);
}

function configureCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const ratio = Math.min(window.devicePixelRatio || 1, 3);
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  context.setTransform(width / SCALE, 0, 0, height / SCALE, 0, 0);
  context.fillStyle = "#263b33";
  return context;
}

function pointWidths(points) {
  const widths = [420];
  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1];
    const point = points[i];
    const distance = Math.hypot(point[0] - previous[0], point[1] - previous[1]);
    const elapsed = Math.max(8, point[2] - previous[2]);
    const target = Math.max(185, Math.min(620, 620 - (distance / elapsed) * 7));
    widths.push(widths[i - 1] * 0.52 + target * 0.48);
  }
  return widths;
}

function drawSegment(context, from, to, fromWidth, toWidth) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const distance = Math.hypot(dx, dy);
  if (!distance) return;
  const nx = -dy / distance;
  const ny = dx / distance;
  const start = fromWidth / 2;
  const end = toWidth / 2;
  context.beginPath();
  context.moveTo(from[0] + nx * start, from[1] + ny * start);
  context.lineTo(to[0] + nx * end, to[1] + ny * end);
  context.lineTo(to[0] - nx * end, to[1] - ny * end);
  context.lineTo(from[0] - nx * start, from[1] - ny * start);
  context.closePath();
  context.fill();
  context.beginPath();
  context.arc(to[0], to[1], end, 0, Math.PI * 2);
  context.fill();
}

function drawStroke(context, points, visibleCount = points.length) {
  if (!visibleCount) return;
  const widths = pointWidths(points);
  context.beginPath();
  context.arc(points[0][0], points[0][1], widths[0] / 2, 0, Math.PI * 2);
  context.fill();
  for (let i = 1; i < visibleCount; i += 1) drawSegment(context, points[i - 1], points[i], widths[i - 1], widths[i]);
}

function drawCharacter(canvas, character) {
  const context = configureCanvas(canvas);
  if (!context) return;
  context.clearRect(0, 0, SCALE, SCALE);
  for (const stroke of character.strokes) drawStroke(context, stroke.points);
}

function makeCell(character, className = "ink-cell") {
  const cell = document.createElement("div");
  cell.className = className;
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  cell.append(canvas);
  requestAnimationFrame(() => drawCharacter(canvas, character));
  return cell;
}

function stopPlayback() {
  if (!state.playback) return;
  cancelAnimationFrame(state.playback.frame);
  state.playback = null;
}

function renderDraft() {
  stopPlayback();
  const strip = $("character-strip");
  strip.replaceChildren();
  if (!state.characters.length) {
    const empty = document.createElement("div");
    empty.className = "strip-empty";
    empty.textContent = "写好一个字后，点“完成此字”";
    strip.append(empty);
  }
  state.characters.forEach((character, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "character-tile";
    button.setAttribute("aria-label", `删除第 ${index + 1} 个字格`);
    button.title = `删除第 ${index + 1} 个字格`;
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    button.append(canvas);
    button.addEventListener("click", () => {
      state.characters.splice(index, 1);
      setHint(`已删除第 ${index + 1} 个字格，可继续书写。`);
      renderDraft();
    });
    strip.append(button);
    requestAnimationFrame(() => drawCharacter(canvas, character));
  });
  $("character-count").textContent = `${state.characters.length} / ${MAX_CHARACTERS}`;
  drawCharacter(pad, state.current);
  const preview = $("preview-grid");
  preview.replaceChildren();
  const characters = snapshotCharacters();
  if (!characters.length) {
    const empty = document.createElement("div");
    empty.className = "preview-empty";
    empty.textContent = "笔迹会在这里组成完整消息";
    preview.append(empty);
  } else {
    for (const character of characters) preview.append(makeCell(character));
  }
  const payload = makePayload(characters);
  $("draft-stats").textContent = `草稿：${characters.length} 字 · ${countStrokes(characters)} 笔 · ${countPoints(characters)} 点 · ${bytes(payload).toLocaleString()} 字节`;
  $("undo-stroke").disabled = !state.current.strokes.length;
  $("clear-current").disabled = !state.current.strokes.length;
  $("finish-character").disabled = !state.current.strokes.length || state.characters.length >= MAX_CHARACTERS;
  $("clear-all").disabled = !characters.length;
  $("preview-play").disabled = !characters.length;
  $("send-handwriting").disabled = !characters.length;
}

function coordinates(event) {
  const rect = pad.getBoundingClientRect();
  return [
    Math.round(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * SCALE),
    Math.round(Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) * SCALE),
  ];
}

function appendPoint(event, force = false, paint = true) {
  if (!state.active || state.active.pointerId !== event.pointerId) return;
  const [x, y] = coordinates(event);
  const points = state.active.stroke.points;
  const last = points.at(-1);
  let time = Math.max(last[2], Math.round(event.timeStamp - state.firstPointAt));
  time = Math.min(time, 600000);
  const distance = Math.hypot(x - last[0], y - last[1]);
  if (distance === 0) return;
  if (!force && distance < 32 && time - last[2] < 12) return;
  if (draftPointCount() >= MAX_POINTS) {
    setHint("已达到 6000 点原型保护上限，请撤销一笔或分成多条。", true);
    return;
  }
  points.push([x, y, time]);
  if (paint) drawCharacter(pad, state.current);
  return true;
}

function finishPointer(event) {
  if (!state.active || state.active.pointerId !== event.pointerId) return;
  if (event.type === "pointerup") appendPoint(event, true, false);
  state.active = null;
  if (pad.hasPointerCapture(event.pointerId)) pad.releasePointerCapture(event.pointerId);
  renderDraft();
}

pad.addEventListener("pointerdown", (event) => {
  if (state.active || (event.pointerType === "mouse" && event.button !== 0)) return;
  if (state.characters.length >= MAX_CHARACTERS) {
    setHint("已完成 30 字。请删除一个字格或发送这一条。", true);
    return;
  }
  if (draftPointCount() >= MAX_POINTS) {
    setHint("已达到 6000 点原型保护上限，请撤销一笔或分成多条。", true);
    return;
  }
  event.preventDefault();
  const [x, y] = coordinates(event);
  if (state.firstPointAt === null) state.firstPointAt = event.timeStamp;
  const lastStroke = state.current.strokes.at(-1);
  const lastTime = lastStroke?.points.at(-1)?.[2] ?? 0;
  const time = state.current.strokes.length ? Math.max(lastTime, Math.min(600000, Math.round(event.timeStamp - state.firstPointAt))) : 0;
  const stroke = { points: [[x, y, time]] };
  state.current.strokes.push(stroke);
  state.active = { pointerId: event.pointerId, stroke };
  pad.setPointerCapture(event.pointerId);
  drawCharacter(pad, state.current);
});
pad.addEventListener("pointermove", (event) => {
  const events = event.getCoalescedEvents?.() || [];
  if (events.length) {
    let changed = false;
    for (const sample of events) changed = appendPoint(sample, false, false) || changed;
    if (changed) drawCharacter(pad, state.current);
  } else appendPoint(event);
});
pad.addEventListener("pointerup", finishPointer);
pad.addEventListener("pointercancel", finishPointer);
pad.addEventListener("lostpointercapture", (event) => {
  if (state.active?.pointerId === event.pointerId) {
    state.active = null;
    renderDraft();
  }
});
window.addEventListener("blur", () => {
  if (state.active) {
    const pointerId = state.active.pointerId;
    state.active = null;
    if (pad.hasPointerCapture(pointerId)) pad.releasePointerCapture(pointerId);
    renderDraft();
  }
});

function openModal() {
  $("more-menu").hidden = true;
  state.lastFocus = document.activeElement;
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  renderDraft();
  $("close-dialog").focus();
}

function closeModal() {
  if (state.active) state.active = null;
  stopPlayback();
  modal.hidden = true;
  document.body.style.overflow = "";
  state.lastFocus?.focus();
}

$("open-composer").addEventListener("click", openModal);
$("open-more").addEventListener("click", () => { $("more-menu").hidden = !$("more-menu").hidden; });
$("open-from-more").addEventListener("click", openModal);
$("close-dialog").addEventListener("click", closeModal);
modal.addEventListener("click", (event) => { if (event.target === modal) closeModal(); });
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!confirm.hidden) closeConfirm();
  else if (!modal.hidden) closeModal();
});

$("undo-stroke").addEventListener("click", () => {
  state.current.strokes.pop();
  if (!state.current.strokes.length) state.firstPointAt = null;
  renderDraft();
});
$("clear-current").addEventListener("click", () => {
  state.current = { strokes: [] };
  state.firstPointAt = null;
  renderDraft();
});
function finishCharacter() {
  if (!state.current.strokes.length) return;
  if (state.characters.length >= MAX_CHARACTERS) {
    setHint("最多 30 字，请删除字格或发送。", true);
    return;
  }
  state.characters.push(state.current);
  state.current = { strokes: [] };
  state.firstPointAt = null;
  setHint("已完成一个字。继续写下一个字，或直接发送。", false);
  renderDraft();
}
$("finish-character").addEventListener("pointerup", (event) => {
  if (event.pointerType !== "touch") return;
  event.preventDefault();
  finishCharacter();
});
$("finish-character").addEventListener("click", finishCharacter);

function closeConfirm() {
  confirm.hidden = true;
  $("clear-all").focus();
}
$("clear-all").addEventListener("click", () => { confirm.hidden = false; $("cancel-clear").focus(); });
$("cancel-clear").addEventListener("click", closeConfirm);
$("confirm-clear").addEventListener("click", () => {
  state.characters = [];
  state.current = { strokes: [] };
  state.firstPointAt = null;
  closeConfirm();
  setHint("草稿已清空。", false);
  renderDraft();
});

function timeline(characters) {
  const events = [];
  let cursor = 0;
  for (const [characterIndex, character] of characters.entries()) {
    if (characterIndex) cursor += 250;
    let previousEnd = 0;
    for (const stroke of character.strokes) {
      const widths = pointWidths(stroke.points);
      const first = stroke.points[0][2];
      const idle = Math.max(0, first - previousEnd);
      cursor += idle > 1000 ? 500 : idle;
      for (const [pointIndex, point] of stroke.points.entries()) {
        const previous = stroke.points[pointIndex - 1];
        if (previous) cursor += Math.max(0, point[2] - previous[2]);
        events.push({ characterIndex, stroke, widths, pointIndex, at: cursor });
      }
      previousEnd = stroke.points.at(-1)[2];
    }
  }
  const scale = cursor > 15000 ? 15000 / cursor : 1;
  for (const event of events) event.at *= scale;
  return { events, duration: cursor * scale };
}

function play(container, characters) {
  stopPlayback();
  const canvases = [...container.querySelectorAll(".ink-cell canvas")];
  if (!canvases.length) return;
  const { events, duration } = timeline(characters);
  const contexts = canvases.map((canvas) => configureCanvas(canvas));
  for (const context of contexts) context.clearRect(0, 0, SCALE, SCALE);
  let next = 0;
  const started = performance.now();
  const playback = { frame: 0 };
  state.playback = playback;
  const step = (now) => {
    if (state.playback !== playback) return;
    const elapsed = now - started;
    while (next < events.length && events[next].at <= elapsed) {
      const { characterIndex, stroke, widths, pointIndex } = events[next];
      const context = contexts[characterIndex];
      if (pointIndex === 0) drawStroke(context, stroke.points, 1);
      else {
        drawSegment(context, stroke.points[pointIndex - 1], stroke.points[pointIndex], widths[pointIndex - 1], widths[pointIndex]);
      }
      next += 1;
    }
    if (next < events.length && elapsed < duration + 50) playback.frame = requestAnimationFrame(step);
    else {
      canvases.forEach((canvas, index) => drawCharacter(canvas, characters[index]));
      state.playback = null;
    }
  };
  playback.frame = requestAnimationFrame(step);
}

$("preview-play").addEventListener("click", () => play($("preview-grid"), snapshotCharacters()));

$("send-handwriting").addEventListener("click", () => {
  const characters = snapshotCharacters();
  if (!characters.length) return;
  if (characters.length > MAX_CHARACTERS) {
    setHint("已超过 30 字，请删除一个字格再发送。", true);
    return;
  }
  const payload = makePayload(characters);
  if (countPoints(characters) > MAX_POINTS || bytes(payload) > MAX_BYTES) {
    setHint("草稿超过点数或 128 KiB 预算，请撤销、删字或分成多条。", true);
    return;
  }
  state.sent.push(structuredClone(payload));
  state.characters = [];
  state.current = { strokes: [] };
  state.firstPointAt = null;
  closeModal();
  renderDraft();
  $("empty-hint").hidden = true;
  const message = document.createElement("div");
  message.className = "message message-outgoing";
  const ink = document.createElement("div");
  ink.className = "handwriting-card";
  ink.tabIndex = 0;
  ink.setAttribute("role", "button");
  ink.setAttribute("aria-label", `手写消息，${characters.length} 字；长按打开重播`);
  const replay = document.createElement("button");
  replay.type = "button";
  replay.className = "handwriting-replay";
  replay.textContent = "重播";
  replay.setAttribute("aria-label", `重播 ${characters.length} 字手写消息`);
  replay.hidden = true;
  const grid = document.createElement("div");
  grid.className = "handwriting-grid";
  grid.style.setProperty("--columns", String(Math.min(characters.length, 5)));
  for (const character of characters) grid.append(makeCell(character));
  ink.append(grid, replay);
  message.append(ink);
  $("sent-messages").append(message);
  const closeReplay = () => { replay.hidden = true; };
  const openReplay = () => { replay.hidden = false; };
  let pressTimer = null;
  let pressStart = null;
  const cancelPress = () => { clearTimeout(pressTimer); pressTimer = null; };
  ink.addEventListener("pointerdown", (event) => {
    if (event.target === replay) return;
    closeReplay();
    pressStart = [event.clientX, event.clientY];
    pressTimer = setTimeout(openReplay, 500);
  });
  ink.addEventListener("pointermove", (event) => {
    if (pressStart && Math.hypot(event.clientX - pressStart[0], event.clientY - pressStart[1]) > 12) cancelPress();
  });
  ink.addEventListener("pointerup", cancelPress);
  ink.addEventListener("pointercancel", cancelPress);
  ink.addEventListener("pointerleave", cancelPress);
  ink.addEventListener("contextmenu", (event) => { event.preventDefault(); cancelPress(); openReplay(); });
  ink.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " " || event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      openReplay();
    }
  });
  document.addEventListener("pointerdown", (event) => { if (!ink.contains(event.target)) closeReplay(); });
  replay.addEventListener("click", () => { closeReplay(); play(grid, characters); });
  requestAnimationFrame(() => { play(grid, characters); message.scrollIntoView({ block: "nearest", behavior: "smooth" }); });
});

const resizeObserver = new ResizeObserver(() => {
  if (!modal.hidden) {
    drawCharacter(pad, state.current);
    document.querySelectorAll(".character-tile canvas").forEach((canvas, index) => drawCharacter(canvas, state.characters[index]));
    const preview = snapshotCharacters();
    $("preview-grid").querySelectorAll(".ink-cell canvas").forEach((canvas, index) => drawCharacter(canvas, preview[index]));
  }
  $("sent-messages").querySelectorAll(".handwriting-grid").forEach((grid, index) => {
    grid.querySelectorAll("canvas").forEach((canvas, characterIndex) => drawCharacter(canvas, state.sent[index].characters[characterIndex]));
  });
});
resizeObserver.observe(pad);
resizeObserver.observe($("conversation-body"));
window.addEventListener("resize", () => {
  if (!modal.hidden) renderDraft();
  $("sent-messages").querySelectorAll(".handwriting-grid").forEach((grid, index) => {
    grid.querySelectorAll("canvas").forEach((canvas, characterIndex) => drawCharacter(canvas, state.sent[index].characters[characterIndex]));
  });
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopPlayback();
    if (state.active) {
      state.active = null;
      renderDraft();
    }
  }
});

for (const count of [2, 10, 30]) {
  const payload = makeSample(count);
  const tile = document.createElement("div");
  tile.className = "sample-tile";
  const title = document.createElement("strong");
  title.textContent = `${count} 字`;
  const summary = document.createElement("span");
  summary.textContent = `${countStrokes(payload.characters)} 笔 · ${countPoints(payload.characters)} 点 · ${bytes(payload).toLocaleString()} 字节`;
  const ink = document.createElement("div");
  ink.className = "sample-ink-grid";
  for (const character of payload.characters) ink.append(makeCell(character));
  tile.append(title, summary, ink);
  $("sample-grid").append(tile);
}

// Read-only diagnostics for local browser verification.
window.handwritingPrototype = { snapshot: () => makePayload(snapshotCharacters()), sent: () => structuredClone(state.sent), timeline, brushWidths: pointWidths };
