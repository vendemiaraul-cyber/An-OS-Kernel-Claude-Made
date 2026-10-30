/* Pocket Arcade touch layer for Voxel Sandbox (iPhone / iPad).
   Uses the game's own globals: player, keys, locked, fallbackMode, setActive, doAction, selectSlot. */
(function () {
  'use strict';
  var touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  if (!touch) return;

  var css = document.createElement('style');
  css.textContent = [
    '#pa-pad{position:fixed;inset:0;z-index:40;touch-action:none;-webkit-user-select:none;user-select:none}',
    '#pa-pad[hidden]{display:none}',
    '#pa-stick{position:absolute;left:calc(16px + env(safe-area-inset-left,0px));bottom:calc(86px + env(safe-area-inset-bottom,0px));width:124px;height:124px;border-radius:50%;background:rgba(20,22,30,.35);border:1px solid rgba(255,255,255,.35)}',
    '#pa-knob{position:absolute;left:50%;top:50%;width:52px;height:52px;margin:-26px 0 0 -26px;border-radius:50%;background:rgba(255,255,255,.3);border:1px solid rgba(255,255,255,.6);pointer-events:none}',
    '.pa-btns{position:absolute;right:calc(16px + env(safe-area-inset-right,0px));bottom:calc(86px + env(safe-area-inset-bottom,0px));display:grid;grid-template-columns:repeat(2,60px);gap:10px}',
    '.pa-btns button,.pa-top button{font:600 11px system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#fff;background:rgba(20,22,30,.5);border:1px solid rgba(255,255,255,.4);border-radius:50%;width:60px;height:60px;touch-action:none}',
    '.pa-btns button.on,.pa-top button.on{background:#ffb547;color:#2a1a00}',
    '.pa-top{position:absolute;top:calc(10px + env(safe-area-inset-top,0px));left:calc(12px + env(safe-area-inset-left,0px));display:flex;gap:8px}',
    '.pa-top button{border-radius:9px;width:auto;height:34px;padding:0 10px}',
    '#hotbar{z-index:45!important}'
  ].join('');
  document.head.appendChild(css);

  var pad = document.createElement('div');
  pad.id = 'pa-pad'; pad.hidden = true;
  pad.innerHTML =
    '<div class="pa-top"><button type="button" data-a="menu">Menu</button><button type="button" data-a="fly">Fly</button></div>' +
    '<div id="pa-stick"><div id="pa-knob"></div></div>' +
    '<div class="pa-btns">' +
      '<button type="button" data-a="break">Break</button>' +
      '<button type="button" data-a="place">Place</button>' +
      '<button type="button" data-a="down">Down</button>' +
      '<button type="button" data-a="jump">Jump</button>' +
    '</div>';
  document.body.appendChild(pad);

  function setKey(code, on) { try { keys[code] = on; } catch (e) {} }
  function keyEvent(code) {
    try { dispatchEvent(new KeyboardEvent('keydown', { code: code, key: code, bubbles: true })); } catch (e) {}
    setTimeout(function () { setKey(code, false); try { dispatchEvent(new KeyboardEvent('keyup', { code: code, key: code, bubbles: true })); } catch (e) {} }, 60);
  }

  // Start: centre-aim mode with a crosshair, no pointer lock needed.
  function activate() {
    try { fallbackMode = false; setActive(true); document.getElementById('crosshair').hidden = false; } catch (e) {}
    pad.hidden = false;
  }
  var playBtn = document.getElementById('playBtn');
  if (playBtn) {
    playBtn.textContent = 'TAP TO PLAY';
    playBtn.addEventListener('click', function () { setTimeout(activate, 450); });
  }
  setInterval(function () { try { if (!locked) pad.hidden = true; } catch (e) {} }, 300);

  // Buttons
  pad.querySelectorAll('button').forEach(function (b) {
    var a = b.getAttribute('data-a');
    b.addEventListener('touchstart', function (e) {
      e.preventDefault(); e.stopPropagation(); b.classList.add('on');
      if (a === 'jump') { setKey('Space', true); keyEvent('Space'); setKey('Space', true); }
      else if (a === 'down') setKey('ShiftLeft', true);
      else if (a === 'break') { try { doAction(0); } catch (x) {} }
      else if (a === 'place') { try { doAction(2); } catch (x) {} }
      else if (a === 'fly') keyEvent('KeyF');
      else if (a === 'menu') { pad.hidden = true; try { setActive(false); } catch (x) {} }
    }, { passive: false });
    b.addEventListener('touchend', function (e) {
      e.preventDefault(); b.classList.remove('on');
      if (a === 'jump') setKey('Space', false);
      if (a === 'down') setKey('ShiftLeft', false);
    }, { passive: false });
  });

  // Stick: W/A/S/D
  var stick = document.getElementById('pa-stick'), knob = document.getElementById('pa-knob');
  var sid = null, cx = 0, cy = 0, r = 62;
  function setStick(dx, dy) {
    var nx = dx / r, ny = dy / r, d = 0.3;
    setKey('KeyA', nx < -d); setKey('KeyD', nx > d); setKey('KeyW', ny < -d); setKey('KeyS', ny > d);
    var m = Math.min(1, Math.hypot(nx, ny)), ang = Math.atan2(ny, nx);
    knob.style.transform = 'translate(' + Math.cos(ang) * m * 36 + 'px,' + Math.sin(ang) * m * 36 + 'px)';
  }
  stick.addEventListener('touchstart', function (e) {
    e.preventDefault(); e.stopPropagation();
    var t = e.changedTouches[0], rc = stick.getBoundingClientRect();
    sid = t.identifier; cx = rc.left + rc.width / 2; cy = rc.top + rc.height / 2; r = rc.width / 2;
    setStick(t.clientX - cx, t.clientY - cy);
  }, { passive: false });

  // Look: drag anywhere else on the screen
  var lid = null, lx = 0, ly = 0;
  pad.addEventListener('touchstart', function (e) {
    e.preventDefault();
    if (lid !== null) return;
    var t = e.changedTouches[0]; lid = t.identifier; lx = t.clientX; ly = t.clientY;
  }, { passive: false });

  pad.addEventListener('touchmove', function (e) {
    e.preventDefault();
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      if (t.identifier === sid) setStick(t.clientX - cx, t.clientY - cy);
      else if (t.identifier === lid) {
        try {
          player.yaw -= (t.clientX - lx) * 0.006;
          player.pitch -= (t.clientY - ly) * 0.006;
          player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch));
        } catch (x) {}
        lx = t.clientX; ly = t.clientY;
      }
    }
  }, { passive: false });
  function end(e) {
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      if (t.identifier === sid) { sid = null; setStick(0, 0); }
      if (t.identifier === lid) lid = null;
    }
  }
  pad.addEventListener('touchend', end);
  pad.addEventListener('touchcancel', end);
  document.addEventListener('visibilitychange', function () {
    ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft'].forEach(function (k) { setKey(k, false); });
  });
})();
