'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#7986cb', // J - indigo
  '#ffb74d', // L - orange
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const ENERGY_MAX = 10;
const QUEUE_SIZE = 5;
const SLOW_MS = 10000;
const SLOW_FACTOR = 2;
const SKILLS = ['preview', 'swap', 'slow', 'undo', 'hold'];
const RECORDS_KEY = 'tetris-records';
const TOP_SIZE = 5;
const NAME_MAX = 12;

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const holdCanvas = document.getElementById('hold-canvas');
const holdCtx = holdCanvas.getContext('2d');
const holdSection = document.getElementById('hold-section');
const holdHintEl = document.getElementById('hold-hint');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const energyBar = document.getElementById('energy-bar');
const energyFill = document.getElementById('energy-fill');
const energyText = document.getElementById('energy-text');
const slowEl = document.getElementById('slow-status');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const skillMenu = document.getElementById('skill-menu');
const skillTitle = document.getElementById('skill-title');
const skillList = document.getElementById('skill-list');
const swapList = document.getElementById('swap-list');
const startScreen = document.getElementById('start-screen');
const startRecords = document.getElementById('start-records');
const overRecords = document.getElementById('over-records');
const nameForm = document.getElementById('name-form');
const nameInput = document.getElementById('name-input');

let board, current, queue, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let combo, bestCombo, startOpen, pendingRank, savedRank;
let energy, menuOpen, menuMode, previewCount, slowMs, slowSecShown, holdState, heldPiece, undoSnapshot;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function makePiece(type) {
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function randomPiece() {
  return makePiece(Math.floor(Math.random() * 7) + 1);
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  combo = cleared ? combo + 1 : 0;
  bestCombo = Math.max(bestCombo, combo);
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    energy = Math.min(ENERGY_MAX, energy + cleared);
    updateHUD();
  }
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  // Snapshot before merge so the "undo" skill can roll this placement back.
  // Energy is not stored: activating a skill always spends it all.
  undoSnapshot = {
    board: board.map(row => [...row]),
    score, lines, level, dropInterval,
    type: current.type,
  };
  merge();
  clearLines();
  spawn();
}

function spawn() {
  current = queue.shift();
  while (queue.length < QUEUE_SIZE) queue.push(randomPiece());
  if (previewCount > 0) previewCount--;
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;

  energyFill.style.width = `${(energy / ENERGY_MAX) * 100}%`;
  energyBar.classList.toggle('full', energy >= ENERGY_MAX);
  energyText.textContent = energy >= ENERGY_MAX ? 'LISTA · pulsa E' : `${energy}/${ENERGY_MAX}`;

  slowSecShown = Math.ceil(slowMs / 1000);
  slowEl.textContent = slowMs > 0 ? `LENTO ${slowSecShown}s` : '';

  holdSection.classList.toggle('locked', holdState === null);
  holdHintEl.textContent =
    holdState === 'ready' ? 'pulsa C para guardar' :
    holdState === 'holding' ? 'pulsa C para recuperar' : 'bloqueado';
  drawHold();
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = '#22222e';
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

// Draws a piece centered in a 120px-wide preview canvas. Each slot is 4 cells tall.
function drawPreviewPiece(context, shape, size, slot) {
  const offX = Math.floor((120 / size - shape[0].length) / 2);
  const offY = slot * 4 + Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(context, offX + c, offY + r, shape[r][c], size);
}

function drawNext() {
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  if (previewCount > 0) {
    for (let i = 0; i < QUEUE_SIZE; i++) drawPreviewPiece(nextCtx, queue[i].shape, 15, i);
  } else {
    drawPreviewPiece(nextCtx, queue[0].shape, 30, 0);
  }
}

function drawHold() {
  holdCtx.clearRect(0, 0, holdCanvas.width, holdCanvas.height);
  if (heldPiece) drawPreviewPiece(holdCtx, heldPiece.shape, 30, 0);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  const rec = loadRecords();
  rec.bestCombo = Math.max(rec.bestCombo, bestCombo);
  rec.maxLines = Math.max(rec.maxLines, lines);
  saveRecords(rec);
  pendingRank = score > 0 ? rankFor(rec, score) : -1;
  savedRank = -1;
  nameForm.hidden = pendingRank < 0;
  nameInput.value = '';
  renderRecords(overRecords, rec, pendingRank, true);
  overRecords.hidden = false;
  overlay.classList.remove('hidden');
  if (pendingRank >= 0) nameInput.focus();
}

/* ---- Records ---- */

function loadRecords() {
  const empty = { scores: [], bestCombo: 0, maxLines: 0 };
  try {
    const data = JSON.parse(localStorage.getItem(RECORDS_KEY));
    if (!data || !Array.isArray(data.scores)) return empty;
    return {
      scores: data.scores.slice(0, TOP_SIZE),
      bestCombo: Number(data.bestCombo) || 0,
      maxLines: Number(data.maxLines) || 0,
    };
  } catch (err) {
    return empty;
  }
}

function saveRecords(rec) {
  try { localStorage.setItem(RECORDS_KEY, JSON.stringify(rec)); } catch (err) { /* storage unavailable */ }
}

// Position the score would take in the top (ties go below), or -1 if it does not qualify.
function rankFor(rec, pts) {
  let i = rec.scores.findIndex(r => pts > r.score);
  if (i < 0) i = rec.scores.length;
  return i < TOP_SIZE ? i : -1;
}

// highlight: row index to mark; provisional: that row is still waiting for a name.
function renderRecords(container, rec, highlight, provisional) {
  container.replaceChildren();
  const title = document.createElement('span');
  title.className = 'records-title';
  title.textContent = 'MEJORES PUNTUACIONES';
  const list = document.createElement('ol');
  list.className = 'records-list';
  const rows = rec.scores.map(r => ({ name: r.name, score: r.score }));
  if (provisional && highlight >= 0) rows.splice(highlight, 0, { name: '(tú)', score });
  for (let i = 0; i < TOP_SIZE; i++) {
    const li = document.createElement('li');
    const row = rows[i];
    li.className = row ? '' : 'empty';
    if (row && i === highlight) li.classList.add('current');
    for (const text of [`${i + 1}.`, row ? row.name : '---', row ? row.score.toLocaleString() : '']) {
      const span = document.createElement('span');
      span.textContent = text;
      li.appendChild(span);
    }
    list.appendChild(li);
  }
  const stats = document.createElement('div');
  stats.className = 'records-stats';
  stats.innerHTML = '<span>Mejor combo: <b></b></span><span>Líneas máx: <b></b></span>';
  const values = stats.querySelectorAll('b');
  values[0].textContent = rec.bestCombo;
  values[1].textContent = rec.maxLines;
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'reset-btn';
  reset.textContent = 'Borrar récords';
  reset.addEventListener('click', resetRecords);
  container.append(title, list, stats, reset);
}

function commitRecord() {
  if (pendingRank < 0) return;
  const rec = loadRecords();
  const name = nameInput.value.trim().slice(0, NAME_MAX) || 'Anónimo';
  savedRank = rankFor(rec, score);
  if (savedRank >= 0) {
    rec.scores.splice(savedRank, 0, { name, score });
    rec.scores.length = Math.min(rec.scores.length, TOP_SIZE);
    saveRecords(rec);
  }
  pendingRank = -1;
  nameForm.hidden = true;
  renderRecords(overRecords, rec, savedRank, false);
}

function resetRecords() {
  if (!confirm('¿Borrar todos los récords?')) return;
  try { localStorage.removeItem(RECORDS_KEY); } catch (err) { /* storage unavailable */ }
  const rec = loadRecords();
  pendingRank = -1;
  savedRank = -1;
  nameForm.hidden = true;
  renderRecords(startRecords, rec, -1, false);
  renderRecords(overRecords, rec, -1, false);
}

function showStartScreen() {
  startOpen = true;
  cancelAnimationFrame(animId);
  renderRecords(startRecords, loadRecords(), -1, false);
  startScreen.classList.remove('hidden');
}

function togglePause() {
  if (gameOver || menuOpen) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    nameForm.hidden = true;
    overRecords.hidden = true;
    overlay.classList.remove('hidden');
  }
}

/* ---- Habilidades ---- */

// Each skill returns true when it was applied (and so should spend the energy).
function skillPreview() {
  previewCount = QUEUE_SIZE;
  drawNext();
  return true;
}

function skillSwap(type) {
  const inPlace = { ...makePiece(type), x: current.x, y: current.y };
  const spawned = makePiece(type);
  if (!collide(inPlace.shape, inPlace.x, inPlace.y)) current = inPlace;
  else if (!collide(spawned.shape, spawned.x, spawned.y)) current = spawned;
  else return false;
  return true;
}

function skillSlow() {
  slowMs = SLOW_MS;
  return true;
}

function skillUndo() {
  if (!undoSnapshot) return false;
  const restored = makePiece(undoSnapshot.type);
  if (collide(restored.shape, restored.x, restored.y)) return false;
  ({ score, lines, level, dropInterval } = undoSnapshot);
  board = undoSnapshot.board;
  queue.unshift(makePiece(current.type));
  current = restored;
  undoSnapshot = null;
  dropAccum = 0;
  drawNext();
  return true;
}

function skillHold() {
  holdState = 'ready';
  return true;
}

function useHold() {
  if (holdState === 'ready') {
    heldPiece = makePiece(current.type);
    holdState = 'holding';
    spawn();
  } else if (holdState === 'holding') {
    const recovered = makePiece(heldPiece.type);
    if (collide(recovered.shape, recovered.x, recovered.y)) return;
    queue.unshift(makePiece(current.type));
    current = recovered;
    heldPiece = null;
    holdState = null;
    drawNext();
  }
}

function skillAvailable(id) {
  if (id === 'undo') return undoSnapshot !== null;
  if (id === 'hold') return holdState === null;
  return true;
}

/* ---- Menú de habilidades ---- */

function showSkillList() {
  menuMode = 'skills';
  skillTitle.textContent = 'ENERGÍA';
  skillList.hidden = false;
  swapList.hidden = true;
  for (const btn of skillList.querySelectorAll('.skill-btn'))
    btn.disabled = !skillAvailable(btn.dataset.skill);
}

function showSwapList() {
  menuMode = 'swap';
  skillTitle.textContent = 'CAMBIAR PIEZA';
  skillList.hidden = true;
  swapList.hidden = false;
  for (const btn of swapList.querySelectorAll('.swap-btn'))
    btn.disabled = Number(btn.dataset.type) === current.type;
}

function openMenu() {
  if (menuOpen || paused || gameOver || energy < ENERGY_MAX) return;
  menuOpen = true;
  cancelAnimationFrame(animId);
  showSkillList();
  skillMenu.classList.remove('hidden');
}

function closeMenu() {
  menuOpen = false;
  skillMenu.classList.add('hidden');
  lastTime = performance.now();
  loop(lastTime);
}

function finishSkill(applied) {
  if (applied) energy = 0;
  updateHUD();
  closeMenu();
}

function chooseSkill(id) {
  if (!skillAvailable(id)) return;
  switch (id) {
    case 'preview': finishSkill(skillPreview()); break;
    case 'swap':    showSwapList(); break;
    case 'slow':    finishSkill(skillSlow()); break;
    case 'undo':    finishSkill(skillUndo()); break;
    case 'hold':    finishSkill(skillHold()); break;
  }
}

function chooseSwap(type) {
  if (type === current.type) return;
  finishSkill(skillSwap(type));
}

function handleMenuKey(e) {
  if (e.code === 'Escape') {
    e.preventDefault();
    if (menuMode === 'swap') showSkillList();
    else closeMenu();
    return;
  }
  const n = Number(e.key);
  if (!Number.isInteger(n)) return;
  if (menuMode === 'skills' && n >= 1 && n <= SKILLS.length) chooseSkill(SKILLS[n - 1]);
  else if (menuMode === 'swap' && n >= 1 && n <= 7) chooseSwap(n);
}

function buildSwapList() {
  for (let type = 1; type <= 7; type++) {
    const btn = document.createElement('button');
    btn.className = 'swap-btn';
    btn.dataset.type = type;
    btn.style.setProperty('--piece-color', COLORS[type]);
    btn.innerHTML = `<kbd>${type}</kbd><span class="swatch"></span>`;
    swapList.appendChild(btn);
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (slowMs > 0) {
    slowMs = Math.max(0, slowMs - dt);
    if (Math.ceil(slowMs / 1000) !== slowSecShown) updateHUD();
  }
  const interval = slowMs > 0 ? dropInterval * SLOW_FACTOR : dropInterval;
  if (dropAccum >= interval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  if (gameOver) return;
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  combo = 0;
  bestCombo = 0;
  startOpen = false;
  pendingRank = -1;
  savedRank = -1;
  energy = 0;
  menuOpen = false;
  menuMode = 'skills';
  previewCount = 0;
  slowMs = 0;
  slowSecShown = 0;
  holdState = null;
  heldPiece = null;
  undoSnapshot = null;
  queue = Array.from({ length: QUEUE_SIZE }, () => randomPiece());
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  skillMenu.classList.add('hidden');
  startScreen.classList.add('hidden');
  if (document.activeElement) document.activeElement.blur();
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (startOpen) {
    if (e.code === 'Enter') { e.preventDefault(); init(); }
    return;
  }
  if (menuOpen) { handleMenuKey(e); return; }
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
    case 'KeyE':
      openMenu();
      break;
    case 'KeyC':
      useHold();
      break;
  }
  updateHUD();
});

skillList.addEventListener('click', e => {
  const btn = e.target.closest('.skill-btn');
  if (btn && menuOpen) chooseSkill(btn.dataset.skill);
});

swapList.addEventListener('click', e => {
  const btn = e.target.closest('.swap-btn');
  if (btn && menuOpen) chooseSwap(Number(btn.dataset.type));
});

document.getElementById('skill-cancel').addEventListener('click', () => {
  if (!menuOpen) return;
  if (menuMode === 'swap') showSkillList();
  else closeMenu();
});

restartBtn.addEventListener('click', () => {
  commitRecord();
  init();
});

nameForm.addEventListener('submit', e => {
  e.preventDefault();
  commitRecord();
  restartBtn.focus();
});

document.getElementById('start-btn').addEventListener('click', init);

buildSwapList();
init();
showStartScreen();
