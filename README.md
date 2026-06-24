# TÖR — Меню банкетных пакетов (V3, карточки)

Mobile menu for the TÖR banquet packages. A faithful static port of the
Claude Design preview **«Меню - пакеты V3 - карточки»**
([project](https://claude.ai/design/p/7cc5fc73-10ed-4ca0-b211-6b128bcee5b7)).

## Features

- **Price tabs** — per-guest budget: 15 000 · 20 000 · 25 000 ₸. Each tier has its own menu.
- **Guest stepper** — 1…300 guests with correct Russian pluralization (гость / гостя / гостей).
- **Live total** — tier × guests, formatted with thin-space thousands.
- **Connected timeline** — numbered cards (закуски → салаты → горячее → завершение) on a
  vertical thread whose fill and nodes animate as you scroll; reaching a node pulses it and
  fires a light haptic (`navigator.vibrate`).
- **Set dishes** — grouped "сет" cards with bulleted components.
- **WhatsApp CTA** — opens a `wa.me` chat prefilled with the chosen package, guest count and total.

## Run locally

It's a zero-build static site — open `index.html`, or serve the folder:

```bash
python3 -m http.server 4173
# → http://localhost:4173/
```

## Configure

Set the booking number in [`app.js`](app.js):

```js
var WHATSAPP_PHONE = "77000000000"; // digits only, incl. country code
```

## Files

| File | Purpose |
|------|---------|
| `index.html` | Markup shell (fonts, phone frame, static chrome) |
| `styles.css` | All styling and the `fadeUp` animation |
| `app.js` | Menu data + rendering + scroll-thread logic (ported from the design's `DCLogic`) |
