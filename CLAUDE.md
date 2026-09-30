# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Vanilla JS Tetris (HTML5 Canvas). No `package.json`, no build, no tests, no linter. UI text and README are in Spanish.

## Run

Open `index.html` directly, or serve statically: `python -m http.server 8000` then visit `http://localhost:8000`.

## Architecture

Three files: `index.html` (DOM + two canvases), `style.css`, `game.js` (all logic, global script, `'use strict'`, no modules).

- `game.js` keeps state in top-level `let` globals (`board`, `current`, `next`, `score`, `lines`, `level`, ...), all reset in `init()`. Restart button calls `init()`.
- Board is `ROWS x COLS` matrix; cell `0` = empty, `1-7` = piece type index into `COLORS`/`PIECES`. Piece shapes embed their own type index as cell value, so `merge()` writes it straight to the board.
- Piece lifecycle: `spawn()` promotes `next` to `current`; spawn collision triggers `endGame()`. `lockPiece()` = `merge()` -> `clearLines()` -> `spawn()`. Hard drop, soft drop and gravity in `loop()` all end in `lockPiece()`.
- `clearLines()` owns level/score/`dropInterval` updates. Gravity: `max(100, 1000 - (level-1)*90)` ms.
- Loop: `requestAnimationFrame` chain via global `animId`; pause and game over cancel it, unpause restarts it manually with `loop(performance.now())`.
- Rotation is `rotateCW` + simple horizontal kicks `[0,-1,1,-2,2]` in `tryRotate`; no SRS tables.

## Gotchas

- Canvas size is hardcoded in `index.html` (`300x600` board, `120x120` next). Changing `COLS`, `ROWS` or `BLOCK` in `game.js` requires updating the canvas `width`/`height` to match.
- HUD is updated by `updateHUD()`; call it after any score/lines/level change (keydown handler calls it after every key).
- Overlay element ids (`overlay`, `overlay-title`, `overlay-score`, `restart-btn`) are shared by pause and game over states.
