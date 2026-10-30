/* Pocket Arcade touch kit: turns on-screen buttons into keyboard events
   that SDL-based WebAssembly engines understand. */
(function (global) {
  'use strict';
  var KEYS = {
    up: ['ArrowUp', 'ArrowUp', 38], down: ['ArrowDown', 'ArrowDown', 40],
    left: ['ArrowLeft', 'ArrowLeft', 37], right: ['ArrowRight', 'ArrowRight', 39],
    ctrl: ['Control', 'ControlLeft', 17], shift: ['Shift', 'ShiftLeft', 16],
    alt: ['Alt', 'AltLeft', 18], space: [' ', 'Space', 32], enter: ['Enter', 'Enter', 13],
    esc: ['Escape', 'Escape', 27], tab: ['Tab', 'Tab', 9], y: ['y', 'KeyY', 89], n: ['n', 'KeyN', 78],
    w: ['w', 'KeyW', 87], a: ['a', 'KeyA', 65], s: ['s', 'KeyS', 83], d: ['d', 'KeyD', 68],
    e: ['e', 'KeyE', 69], f: ['f', 'KeyF', 70], v: ['v', 'KeyV', 86], c: ['c', 'KeyC', 67],
    pgup: ['PageUp', 'PageUp', 33], pgdn: ['PageDown', 'PageDown', 34], end: ['End', 'End', 35],
    del: ['Delete', 'Delete', 46], backquote: ['`', 'Backquote', 192],
    comma: [',', 'Comma', 188], period: ['.', 'Period', 190],
    f1: ['F1', 'F1', 112], f2: ['F2', 'F2', 113], f3: ['F3', 'F3', 114], f6: ['F6', 'F6', 117], f9: ['F9', 'F9', 120]
  };
  for (var i = 0; i <= 9; i++) KEYS[String(i)] = [String(i), 'Digit' + i, 48 + i];

  var held = {};
  var target = global;

  function fire(type, name) {
    var k = KEYS[name];
    if (!k) return;
    var ev;
    try {
      ev = new KeyboardEvent(type, { key: k[0], code: k[1], bubbles: true, cancelable: true });
    } catch (e) {
      ev = document.createEvent('Event');
      ev.initEvent(type, true, true);
      ev.key = k[0]; ev.code = k[1];
    }
    try {
      Object.defineProperty(ev, 'keyCode', { get: function () { return k[2]; } });
      Object.defineProperty(ev, 'which', { get: function () { return k[2]; } });
      Object.defineProperty(ev, 'charCode', { get: function () { return type === 'keypress' ? k[2] : 0; } });
    } catch (e) {}
    (target.dispatchEvent ? target : global).dispatchEvent(ev);
  }

  function press(name) { if (held[name]) return; held[name] = true; fire('keydown', name); if (name.length === 1) fire('keypress', name); }
  function release(name) { if (!held[name]) return; held[name] = false; fire('keyup', name); }
  function tap(name, ms) { press(name); setTimeout(function () { release(name); }, ms || 90); }
  function releaseAll() { Object.keys(held).forEach(release); }

  /* Type text as real key presses (for cheat codes and console commands). */
  function charKey(ch) {
    var c = ch.toLowerCase();
    if (/[a-z]/.test(c)) return [c, 'Key' + c.toUpperCase(), c.toUpperCase().charCodeAt(0), c.charCodeAt(0)];
    if (/[0-9]/.test(c)) return [c, 'Digit' + c, c.charCodeAt(0), c.charCodeAt(0)];
    if (c === ' ') return [' ', 'Space', 32, 32];
    if (c === '_') return ['_', 'Minus', 189, 95];
    return null;
  }
  function fireRaw(type, k) {
    var ev;
    try { ev = new KeyboardEvent(type, { key: k[0], code: k[1], bubbles: true, cancelable: true }); } catch (e) { return; }
    try {
      Object.defineProperty(ev, 'keyCode', { get: function () { return type === 'keypress' ? k[3] : k[2]; } });
      Object.defineProperty(ev, 'which', { get: function () { return type === 'keypress' ? k[3] : k[2]; } });
      Object.defineProperty(ev, 'charCode', { get: function () { return type === 'keypress' ? k[3] : 0; } });
    } catch (e) {}
    (target.dispatchEvent ? target : global).dispatchEvent(ev);
  }
  function typeText(text, gap) {
    gap = gap || 70;
    return text.split('').reduce(function (p, ch) {
      return p.then(function () {
        var k = charKey(ch); if (!k) return;
        fireRaw('keydown', k); fireRaw('keypress', k);
        return new Promise(function (r) { setTimeout(function () { fireRaw('keyup', k); setTimeout(r, gap); }, gap); });
      });
    }, Promise.resolve());
  }
  function tapAsync(name, ms) { return new Promise(function (r) { tap(name, ms || 90); setTimeout(r, (ms || 90) + 120); }); }

  /* Bind every [data-key] button inside root. data-key may list several keys ("ctrl shift").
     data-mode="tap" sends a short press; data-mode="toggle" latches. */
  function bind(root) {
    root.querySelectorAll('[data-key]').forEach(function (b) {
      var names = b.getAttribute('data-key').split(/\s+/);
      var mode = b.getAttribute('data-mode') || 'hold';
      var on = false;
      function down(ev) {
        ev.preventDefault();
        if (mode === 'toggle') { on = !on; b.classList.toggle('on', on); names.forEach(on ? press : release); return; }
        b.classList.add('on');
        if (mode === 'tap') { names.forEach(function (n) { tap(n); }); return; }
        names.forEach(press);
        if (b.setPointerCapture) try { b.setPointerCapture(ev.pointerId); } catch (e) {}
      }
      function up(ev) {
        if (mode === 'toggle') return;
        b.classList.remove('on');
        if (mode !== 'tap') names.forEach(release);
      }
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('lostpointercapture', up);
      b.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    });
  }

  /* A virtual joystick: dragging inside el presses up/down/left/right style keys. */
  function stick(el, map, dead) {
    var knob = el.querySelector('.knob');
    var id = null, cx = 0, cy = 0, r = 1;
    dead = dead || 0.3;
    function set(dx, dy) {
      var nx = dx / r, ny = dy / r;
      (nx < -dead ? press : release)(map.left);
      (nx > dead ? press : release)(map.right);
      (ny < -dead ? press : release)(map.up);
      (ny > dead ? press : release)(map.down);
      if (knob) {
        var m = Math.min(1, Math.hypot(nx, ny)), a = Math.atan2(ny, nx);
        knob.style.transform = 'translate(' + (Math.cos(a) * m * r * 0.55) + 'px,' + (Math.sin(a) * m * r * 0.55) + 'px)';
      }
    }
    el.addEventListener('pointerdown', function (e) {
      e.preventDefault(); id = e.pointerId;
      var rc = el.getBoundingClientRect(); cx = rc.left + rc.width / 2; cy = rc.top + rc.height / 2; r = rc.width / 2;
      try { el.setPointerCapture(id); } catch (x) {}
      set(e.clientX - cx, e.clientY - cy);
    });
    el.addEventListener('pointermove', function (e) { if (e.pointerId === id) set(e.clientX - cx, e.clientY - cy); });
    function end(e) { if (e.pointerId !== id) return; id = null; set(0, 0); }
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  /* A look pad: horizontal drag holds turn keys, vertical drag holds look keys. */
  function lookpad(el, map) {
    var id = null, sx = 0, sy = 0;
    var step = 14;
    el.addEventListener('pointerdown', function (e) {
      if (e.target !== el) return;
      e.preventDefault(); id = e.pointerId; sx = e.clientX; sy = e.clientY;
      try { el.setPointerCapture(id); } catch (x) {}
    });
    el.addEventListener('pointermove', function (e) {
      if (e.pointerId !== id) return;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      (dx < -step ? press : release)(map.left);
      (dx > step ? press : release)(map.right);
      if (map.up) { (dy < -step * 1.6 ? press : release)(map.up); (dy > step * 1.6 ? press : release)(map.down); }
    });
    function end(e) {
      if (e.pointerId !== id) return; id = null;
      release(map.left); release(map.right); if (map.up) { release(map.up); release(map.down); }
    }
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  document.addEventListener('visibilitychange', function () { if (document.hidden) releaseAll(); });
  global.addEventListener('blur', releaseAll);

  global.TouchKit = {
    setTarget: function (t) { target = t || global; },
    press: press, release: release, tap: tap, releaseAll: releaseAll, typeText: typeText, tapAsync: tapAsync,
    bind: bind, stick: stick, lookpad: lookpad,
    isTouch: function () { return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in global; }
  };
})(window);
