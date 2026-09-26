/* ===== ช่องเลือก (select) แบบเดียวกับระบบงานอุบัติเหตุ =====
   แทนรายการเลือกของเบราว์เซอร์ด้วยรายการพื้นขาวขอบบาง แถวที่ชี้เป็นสีส้มอ่อน ตัวที่เลือกอยู่ตัวหนาพร้อมเครื่องหมาย ✓
   - ตัว <select> เดิมยังแสดงอยู่ที่เดิม หน้าตาเหมือนเดิม — เปลี่ยนเฉพาะรายการที่เด้งลงมาตอนกด
   - โค้ดเดิมที่อ่าน/ตั้งค่า .value หรือฟัง event change ทำงานเหมือนเดิมทุกอย่าง ช่องที่สร้างทีหลังก็ใช้ได้ทันที
   - บนมือถือ (แตะนิ้ว) ใช้ตัวเลือกของเครื่องตามปกติ
   - ไม่อยากให้ช่องไหนใช้แบบนี้ ใส่ data-native ที่ <select> นั้น
   ไฟล์นี้เหมือนกันทุกระบบ (งานบริหารหมวด / ระบบควบคุมงานโครงการ / รายงานประจำเดือน) แก้ที่หนึ่งให้คัดลอกไปอีกสองที่ด้วย */
(function () {
  'use strict';
  if (window.__dselInit) return;
  window.__dselInit = true;

  var css =
    '.dsel-menu{position:fixed;z-index:2147483000;box-sizing:border-box;width:max-content;max-width:min(420px,92vw);max-height:280px;overflow:auto;' +
    'background:#fff;border:1px solid #dfe2dd;border-radius:10px;box-shadow:0 12px 30px -10px rgba(0,0,0,.25);' +
    'font-family:"Sarabun",sans-serif;color:#182430;text-align:left}' +
    '.dsel-item{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:9px 12px;cursor:pointer;font-size:14px;line-height:1.35;border-bottom:1px solid #eceee9}' +
    '.dsel-item:last-child{border-bottom:0}' +
    '.dsel-item.active{background:#fdf1de}' +
    '.dsel-item.sel{font-weight:600}' +
    '.dsel-item.off{color:#8792a0;cursor:default}' +
    '.dsel-tick{color:#e0620f;font-size:13px;margin-left:12px;flex:none}';
  var st = document.createElement('style');
  st.textContent = css;
  (document.head || document.documentElement).appendChild(st);

  var menu = null, cur = null, active = -1, lastPointer = 'mouse', typed = '', typedTimer = null;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function eligible(sel) {
    return sel && sel.tagName === 'SELECT' && !sel.multiple && !(sel.size > 1) && !sel.disabled && !sel.hasAttribute('data-native');
  }
  function ensureMenu() {
    if (menu) return menu;
    menu = document.createElement('div');
    menu.className = 'dsel-menu';
    menu.setAttribute('role', 'listbox');
    menu.style.display = 'none';
    // กดในรายการไม่ให้ช่องเลือกหลุดโฟกัส
    menu.addEventListener('mousedown', function (e) { e.preventDefault(); });
    menu.addEventListener('click', function (e) {
      var el = e.target.closest('.dsel-item');
      if (el && !el.classList.contains('off')) choose(Number(el.dataset.i));
    });
    menu.addEventListener('mousemove', function (e) {
      var el = e.target.closest('.dsel-item');
      if (el && !el.classList.contains('off') && Number(el.dataset.i) !== active) { active = Number(el.dataset.i); paint(false); }
    });
    document.body.appendChild(menu);
    return menu;
  }
  function isOpen() { return !!(menu && cur && menu.style.display !== 'none'); }
  function paint(scroll) {
    [].forEach.call(menu.children, function (el) { el.classList.toggle('active', Number(el.dataset.i) === active); });
    var el = menu.querySelector('.dsel-item.active');
    if (el && scroll !== false) el.scrollIntoView({ block: 'nearest' });
  }
  function place() {
    var r = cur.getBoundingClientRect();
    menu.style.minWidth = r.width + 'px';
    menu.style.left = '0px'; menu.style.top = '0px';
    var h = menu.offsetHeight, w = menu.offsetWidth;
    var below = window.innerHeight - r.bottom, above = r.top;
    // ที่ว่างด้านล่างไม่พอ ให้เปิดขึ้นด้านบน
    var top = (below < h + 8 && above > below) ? Math.max(4, r.top - 4 - h) : r.bottom + 4;
    var left = Math.max(4, Math.min(r.left, window.innerWidth - w - 4));
    menu.style.top = top + 'px';
    menu.style.left = left + 'px';
  }
  function open(sel) {
    ensureMenu();
    cur = sel;
    var idx = sel.selectedIndex;
    menu.innerHTML = [].map.call(sel.options, function (o, i) {
      if (o.hidden) return '';
      return '<div class="dsel-item' + (i === idx ? ' sel' : '') + (o.disabled ? ' off' : '') + '" data-i="' + i + '" role="option">' +
        '<span>' + esc(o.textContent) + '</span>' + (i === idx ? '<span class="dsel-tick">✓</span>' : '') + '</div>';
    }).join('');
    menu.style.display = '';
    place();
    active = idx;
    paint();
  }
  function close() {
    if (menu) menu.style.display = 'none';
    cur = null; active = -1;
  }
  function choose(i) {
    var sel = cur;
    if (!sel || i < 0 || i >= sel.options.length || sel.options[i].disabled) return;
    var changed = i !== sel.selectedIndex;
    close();
    if (changed) {
      sel.selectedIndex = i;
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    try { sel.focus({ preventScroll: true }); } catch (e) { sel.focus(); }
  }
  function step(dir) {
    var opts = cur.options, i = active;
    for (var n = 0; n < opts.length; n++) {
      i += dir;
      if (i < 0 || i >= opts.length) return;
      if (!opts[i].disabled && !opts[i].hidden) { active = i; paint(); return; }
    }
  }

  document.addEventListener('pointerdown', function (e) { lastPointer = e.pointerType || 'mouse'; }, true);
  document.addEventListener('mousedown', function (e) {
    if (menu && menu.contains(e.target)) return;
    var sel = e.target.closest ? e.target.closest('select') : null;
    if (!eligible(sel) || e.button !== 0 || lastPointer === 'touch') { if (sel !== cur) close(); return; }
    e.preventDefault();   // ไม่ให้รายการของเบราว์เซอร์เด้งขึ้น
    if (cur === sel) { close(); return; }
    try { sel.focus({ preventScroll: true }); } catch (err) { sel.focus(); }
    open(sel);
  }, true);
  document.addEventListener('keydown', function (e) {
    var sel = e.target;
    if (!eligible(sel)) return;
    if (!isOpen() || cur !== sel) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' ', 'F4'].indexOf(e.key) >= 0 && !e.ctrlKey && !e.metaKey) { e.preventDefault(); open(sel); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); step(1); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); return; }
    if (e.key === 'Home') { e.preventDefault(); active = -1; step(1); return; }
    if (e.key === 'End') { e.preventDefault(); active = cur.options.length; step(-1); return; }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(active); return; }
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'Tab') { close(); return; }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {   // พิมพ์ตัวอักษรเพื่อข้ามไปตัวเลือกที่ขึ้นต้นด้วยตัวนั้น
      e.preventDefault();
      typed += e.key.toLowerCase(); clearTimeout(typedTimer); typedTimer = setTimeout(function () { typed = ''; }, 700);
      var i = [].findIndex.call(cur.options, function (o) { return !o.disabled && !o.hidden && o.textContent.trim().toLowerCase().indexOf(typed) === 0; });
      if (i >= 0) { active = i; paint(); }
    }
  }, true);
  document.addEventListener('focusout', function (e) { if (e.target === cur) setTimeout(function () { if (cur && document.activeElement !== cur) close(); }, 0); }, true);
  document.addEventListener('scroll', function (e) { if (isOpen() && e.target !== menu) close(); }, true);
  window.addEventListener('resize', function () { if (isOpen()) close(); });
  window.addEventListener('blur', function () { if (isOpen()) close(); });
})();
