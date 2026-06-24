/* TÖR — Меню банкетных пакетов (V3, карточки)
 * Vanilla port of the Claude Design `DCLogic` component.
 * Behaviour preserved 1:1: price tabs, guest stepper, live total,
 * scroll-driven connected timeline (animated thread fill + node pulses + haptics),
 * and a WhatsApp CTA prefilled with the current selection. */

(function () {
  "use strict";

  // ----- Config -----
  var WHATSAPP_PHONE = "77000000000"; // TODO: replace with the real booking number (digits only, incl. country code)

  // ----- Data (verbatim from the design source) -----
  // Ordered high → low, matching the original rawPackages().
  var RAW_PACKAGES = [
    { priceNum: "25 000", sections: [
      { title: "Закуски и нарезки", dishes: [
        { name: "Хлебная корзина", note: "" },
        { name: "Национальное ассорти", note: "казы · тіл" },
        { name: "Рыбная нарезка", note: "красная рыба · скумбрия · белая рыба" },
        { name: "Куриный рулет и глазированные крылья", note: "" },
        { name: "Свежие овощи с сыром и зеленью", note: "" },
        { name: "Самса с мясом", note: "" },
      ]},
      { title: "Салаты", dishes: [
        { name: "Цезарь с курицей", note: "" },
        { name: "Тёплый салат", note: "" },
        { name: "Хрустящие баклажаны", note: "" },
      ]},
      { title: "Горячее", dishes: [
        { name: "Рыба гриль", set: true, items: ["Сёмга", "Скумбрия", "Судак", "Брокколи и цветная капуста", "Соус"] },
      ]},
      { title: "Завершение", dishes: [
        { name: "Фруктовая нарезка", note: "" },
      ]},
    ]},
    { priceNum: "20 000", sections: [
      { title: "Закуски и нарезки", dishes: [
        { name: "Хлебная корзина", note: "" },
        { name: "Сырная тарелка", note: "" },
        { name: "Национальное ассорти", note: "казы · тіл" },
        { name: "Рыбная нарезка", note: "красная рыба · скумбрия · белая рыба" },
        { name: "Свежие овощи с сыром и зеленью", note: "" },
        { name: "Куриный рулет и глазированные крылья", note: "" },
        { name: "Самса с мясом", note: "" },
      ]},
      { title: "Салаты", dishes: [
        { name: "Цезарь с курицей", note: "" },
        { name: "Руккола с креветками и спелым персиком", note: "" },
        { name: "Хрустящие баклажаны", note: "" },
      ]},
      { title: "Горячее", dishes: [
        { name: "Мясной сет", set: true, items: ["Баранина", "Куриная голень гриль", "Утка гриль", "Индейка гриль"] },
      ]},
      { title: "Завершение", dishes: [
        { name: "Фруктовая нарезка", note: "" },
      ]},
    ]},
    { priceNum: "15 000", sections: [
      { title: "Закуски и нарезки", dishes: [
        { name: "Хлебная корзина", note: "" },
        { name: "Сырная тарелка", note: "" },
        { name: "Национальное ассорти", note: "" },
        { name: "Рыбная нарезка", note: "" },
        { name: "Куриный рулет и глазированные крылья", note: "" },
        { name: "Свежие овощи с сыром", note: "" },
      ]},
      { title: "Салаты", dishes: [
        { name: "Цезарь с курицей", note: "" },
        { name: "Тёплый салат с говядиной", note: "" },
        { name: "Хрустящие баклажаны", note: "" },
      ]},
      { title: "Горячее", dishes: [
        { name: "Куриная голень и крылья", note: "" },
        { name: "Судак в кляре и куриные стрипсы", note: "" },
        { name: "Чебуреки с соусом", note: "" },
      ]},
      { title: "Завершение", dishes: [
        { name: "Фруктовая нарезка", note: "" },
      ]},
    ]},
  ];

  // Section title → icon key
  var ICON_MAP = {
    "Закуски и нарезки": "app",
    "Салаты": "salad",
    "Горячее": "hot",
    "Завершение": "finish",
  };

  var ICONS = {
    app:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v6a2 2 0 0 0 4 0V3"/><path d="M8 9v12"/><path d="M16.5 3C15 3 14 5 14 7.5S15 12 16.5 12V3z"/><path d="M16.5 12v9"/></svg>',
    salad:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><path d="M4 20c0-9 7-16 16-16 0 9-7 16-16 16z"/><path d="M6 18 14 10"/></svg>',
    hot:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 18h18"/><path d="M5 18a7 7 0 0 1 14 0"/><path d="M12 7V5"/></svg>',
    finish: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8h12v5a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z"/><path d="M17 9h2a2 2 0 0 1 0 4h-2"/><path d="M8 3v2M11 3v2"/></svg>',
  };

  // ----- Helpers -----
  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }
  function fmt(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // Map display tab (0:15k · 1:20k · 2:25k) → RAW_PACKAGES index (high→low)
  var ORDER = [2, 1, 0];

  function buildPackage(tab) {
    var pkg = RAW_PACKAGES[ORDER[tab]];
    var sections = pkg.sections.map(function (s, i) {
      var ic = ICON_MAP[s.title] || "app";
      return {
        title: s.title,
        icon: ic,
        n: String(i + 1).padStart(2, "0"),
        dishes: s.dishes,
      };
    });
    return { priceNum: pkg.priceNum, sections: sections };
  }

  // ----- State -----
  var state = { tab: 2, guests: 10 };

  // ----- Element refs -----
  var screen = document.getElementById("screen");
  var tabsEl = document.getElementById("tabs");
  var tabBtns = Array.prototype.slice.call(tabsEl.querySelectorAll(".tab"));
  var guestsEl = document.getElementById("guests");
  var bodyEl = document.getElementById("body");
  var ctaEl = document.getElementById("cta");

  var thread = { wrap: null, fill: null, nodes: [], reached: null, scroller: null };

  // ----- Rendering -----
  function renderBody(animate) {
    var pkg = buildPackage(state.tab);
    var guests = clampGuests(state.guests);
    var tierNum = parseInt(pkg.priceNum.replace(/\D/g, ""), 10) || 0;
    var total = fmt(tierNum * guests);
    var gWord = plural(guests, "гость", "гостя", "гостей");

    var frag = document.createDocumentFragment();

    var priceRow = el("div", "price-row");
    priceRow.appendChild(el("div", "price-total", esc(total)));
    priceRow.appendChild(el("div", "price-cur", "₸"));
    frag.appendChild(priceRow);

    frag.appendChild(el("div", "price-sub",
      "за " + guests + " " + gWord + " · " + esc(pkg.priceNum) + " ₸ на гостя"));

    frag.appendChild(el("div", "divider"));
    frag.appendChild(el("div", "eyebrow accent", "Меню для " + esc(pkg.priceNum) + " ₸"));
    frag.appendChild(el("div", "menu-note", "Состав меняется в зависимости от бюджета"));

    // Connected timeline
    var wrap = el("div", "thread-wrap");
    wrap.appendChild(el("div", "thread-base"));
    var fill = el("div", "thread-fill");
    wrap.appendChild(fill);

    pkg.sections.forEach(function (sec, idx) {
      var section = el("div", "section");

      var node = el("div", "node", '<span>' + esc(sec.n) + '</span>');
      node.setAttribute("data-node", String(idx));
      section.appendChild(node);

      var card = el("div", "card");
      var head = el("div", "card-head");
      head.appendChild(el("div", "card-title", esc(sec.title)));
      head.appendChild(el("div", "card-icon", ICONS[sec.icon] || ""));
      card.appendChild(head);

      sec.dishes.forEach(function (dish) {
        var d = el("div", "dish");
        if (dish.set) {
          var box = el("div", "set");
          var sh = el("div", "set-head");
          sh.appendChild(el("div", "set-name", esc(dish.name)));
          sh.appendChild(el("div", "set-badge", "сет"));
          box.appendChild(sh);
          (dish.items || []).forEach(function (it) {
            var row = el("div", "set-item");
            row.appendChild(el("div", "set-dot"));
            row.appendChild(el("div", "set-text", esc(it)));
            box.appendChild(row);
          });
          d.appendChild(box);
        } else {
          d.appendChild(el("div", "dish-name", esc(dish.name)));
          if (dish.note) d.appendChild(el("div", "dish-note", esc(dish.note)));
        }
        card.appendChild(d);
      });

      section.appendChild(card);
      wrap.appendChild(section);
    });

    frag.appendChild(wrap);

    bodyEl.innerHTML = "";
    bodyEl.appendChild(frag);

    // refresh thread refs
    thread.wrap = wrap;
    thread.fill = fill;
    thread.nodes = Array.prototype.slice.call(wrap.querySelectorAll("[data-node]"));
    thread.reached = new Set();

    // replay the fadeUp animation only on package (tab) change
    if (animate) {
      bodyEl.style.animation = "none";
      void bodyEl.offsetWidth; // force reflow
      bodyEl.style.animation = "";
    }

    updateCTA(pkg, guests, total);

    requestAnimationFrame(updateThread);
  }

  // Update only the guest-dependent numbers (no re-render, no animation replay)
  function updateTotals() {
    var pkg = buildPackage(state.tab);
    var guests = clampGuests(state.guests);
    var tierNum = parseInt(pkg.priceNum.replace(/\D/g, ""), 10) || 0;
    var total = fmt(tierNum * guests);
    var gWord = plural(guests, "гость", "гостя", "гостей");

    guestsEl.textContent = String(guests);
    var totalEl = bodyEl.querySelector(".price-total");
    var subEl = bodyEl.querySelector(".price-sub");
    if (totalEl) totalEl.textContent = total;
    if (subEl) subEl.textContent =
      "за " + guests + " " + gWord + " · " + pkg.priceNum + " ₸ на гостя";

    updateCTA(pkg, guests, total);
  }

  function updateCTA(pkg, guests, total) {
    var msg = "Здравствуйте! Хочу забронировать банкет TÖR.\n" +
      "Пакет: " + pkg.priceNum + " ₸ на гостя\n" +
      "Гостей: " + guests + "\n" +
      "Итого: " + total + " ₸";
    ctaEl.href = "https://wa.me/" + WHATSAPP_PHONE + "?text=" + encodeURIComponent(msg);
  }

  function setTabsUI() {
    tabBtns.forEach(function (btn) {
      var t = parseInt(btn.getAttribute("data-tab"), 10);
      btn.setAttribute("aria-selected", t === state.tab ? "true" : "false");
    });
  }

  function clampGuests(g) {
    return Math.max(1, Math.min(300, g | 0 || 0));
  }

  // ----- Scroll-driven thread (ported from updateThread) -----
  function findScroller() {
    var node = thread.wrap;
    while (node && node.parentElement) {
      node = node.parentElement;
      var oy = getComputedStyle(node).overflowY;
      if ((oy === "auto" || oy === "scroll") && node.scrollHeight > node.clientHeight + 4) return node;
    }
    return screen; // fallback
  }

  function updateThread() {
    var wrap = thread.wrap, fill = thread.fill;
    if (!thread.scroller) thread.scroller = findScroller();
    var sc = thread.scroller;
    if (!wrap || !fill || !sc) return;

    var wr = wrap.getBoundingClientRect();
    var sr = sc.getBoundingClientRect();
    var topInset = 22, bottomInset = 34;
    var lineLen = Math.max(1, wrap.clientHeight - topInset - bottomInset);
    var mid = sr.top + sr.height * 0.8;
    var geo = (mid - (wr.top + topInset)) / lineLen;
    var maxScroll = sc.scrollHeight - sc.clientHeight;
    var sp = maxScroll > 0 ? sc.scrollTop / maxScroll : 1;
    var clamped = Math.max(0, Math.min(1, Math.max(geo, sp)));
    if (maxScroll <= 0 || sc.scrollTop >= maxScroll - 4) clamped = 1;
    fill.style.height = (clamped * lineLen) + "px";

    var fillEndY = wr.top + topInset + clamped * lineLen;
    if (!thread.reached) thread.reached = new Set();
    var nodes = thread.nodes;
    var reachedArr = nodes.map(function (n) {
      var rc = n.getBoundingClientRect();
      return (rc.top + rc.height / 2) <= fillEndY + 1;
    });

    nodes.forEach(function (n, i) {
      var idx = n.getAttribute("data-node");
      if (reachedArr[i]) {
        n.style.background = "#7a232b";
        n.style.color = "#f6f1e8";
        n.style.borderColor = "transparent";
        n.style.boxShadow = "0 0 0 4px #f6f1e8";
        if (!thread.reached.has(idx)) {
          thread.reached.add(idx);
          n.style.transform = "scale(1.16)";
          (function (node) {
            setTimeout(function () { node.style.transform = "scale(1)"; }, 175);
          })(n);
          try { if (navigator.vibrate) navigator.vibrate(9); } catch (e) {}
        }
      } else {
        n.style.background = "#f6f1e8";
        n.style.color = "#7a232b";
        n.style.borderColor = "rgba(122,35,43,.32)";
        n.style.boxShadow = "0 0 0 4px #f6f1e8";
        thread.reached.delete(idx);
      }
    });
  }

  // ----- Events -----
  tabBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var t = parseInt(btn.getAttribute("data-tab"), 10);
      if (t === state.tab) return;
      state.tab = t;
      setTabsUI();
      renderBody(true);
    });
  });

  document.getElementById("inc").addEventListener("click", function () {
    state.guests = clampGuests(state.guests + 1);
    updateTotals();
  });
  document.getElementById("dec").addEventListener("click", function () {
    state.guests = clampGuests(state.guests - 1);
    updateTotals();
  });

  screen.addEventListener("scroll", function () { updateThread(); }, { passive: true });
  window.addEventListener("resize", function () {
    thread.scroller = null;
    updateThread();
  });

  // ----- Init -----
  setTabsUI();
  guestsEl.textContent = String(clampGuests(state.guests));
  renderBody(false);
  // settle the thread once fonts/layout land
  window.addEventListener("load", function () {
    thread.scroller = null;
    requestAnimationFrame(updateThread);
  });
})();
