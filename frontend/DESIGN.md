# Clinic OS — Design System

The brief: software used **standing up, at speed**, by a receptionist with a queue of
people watching her, and by a clinician between patients. Every decision below serves
two things and nothing else — **legibility at a glance**, and **confidence in the
number on screen**.

Live preview of the reception day view (light + dark, interactive):
`design/reception-preview.html` — published at
https://claude.ai/code/artifact/75607baa-6bcb-4d98-80fd-db45aad4b1f9

---

## 1. The one rule that matters most

**`--money` appears on monetary values and nowhere else.** Not on a button label, not
on an icon, not on a heading, not on a "premium" badge. When a receptionist scans the
screen, gold means money. That consistency is worth more than any other decision in
this document, and it is the first thing to break under pressure — every time someone
wants "just a small gold accent" on something that isn't currency, the answer is no.

Consequence: **state is encoded by position and form, never by adding colours.**
Waiting / in session / done are three grouped bands in one column, not three hues. If
we solved state with colour we would need 3–4 more hues, and gold would stop meaning
money within a week.

| State | How it reads | Colour |
|---|---|---|
| Waiting | in the top band, live wait time counting up | neutral |
| In session | in the middle band, jade-washed row, jade border | `--jade` |
| Done | bottom band, no shadow, de-emphasised text | `--muted` |
| No-show | in Done, brick border + brick label | `--brick` |
| Owes money | gold chip, wherever the patient appears | `--money` |

---

## 2. Palette

Derived from the clinic's own materials — plaster, linen, jade surgical drape, aged
brass. Deliberately not the cream + serif + terracotta that generated design defaults
to.

### Light (working default — front desk, bright room)

```css
--ground:     #F6F7F5;  /* clinic linen — faintly cool, NOT cream */
--raised:     #FFFFFF;
--sunken:     #EFF1EE;
--ink:        #17302A;  /* deep pine — the only full-weight text colour */
--muted:      #5F726C;
--line:       #E1E5E1;
--line-soft:  #EAEDEA;
--jade:       #2F6F62;  /* interactive + active. calm, clinical, not corporate blue */
--jade-wash:  #EAF1EE;
--money:      #8A6D1F;  /* aged brass. CURRENCY ONLY. */
--money-wash: #F6F0DE;
--brick:      #A32B1E;  /* overdue, no-show, conflict */
--brick-wash: #F8EBE8;
--on-fill:    #FFFFFF;
```

### Dark (treatment room — designed, not inverted)

The dark ground is biased toward the jade accent rather than being neutral grey, so
the two themes read as one family. Jade, gold and brick are all lifted in lightness —
the light-theme values fail contrast on a dark ground.

```css
--ground:     #0F1714;
--raised:     #1C2823;
--sunken:     #0A100E;
--ink:        #E9EEEA;
--muted:      #94A59E;
--line:       #27332E;
--line-soft:  #212C27;
--jade:       #5AA894;
--jade-wash:  #172A25;
--money:      #CBA24E;
--money-wash: #2A2415;
--brick:      #E0705E;
--brick-wash: #2C1815;
--on-fill:    #0B120F;
```

### Contrast — verified, not assumed

Every pair below was computed, not eyeballed. WCAG AA needs 4.5:1 for body text.

| Pair | Light | Dark |
|---|---|---|
| ink on ground | 13.09 | 15.51 |
| ink on raised | 14.07 | 14.06 |
| muted on ground | 4.75 | 7.06 |
| **money on raised** | **4.90** | **6.93** |
| **money on ground** | **4.56** | **7.65** |
| jade on raised | 5.88 | 5.87 |
| brick on raised | 7.19 | 5.23 |
| on-fill on jade (button) | 5.88 | 6.47 |

Money-on-linen at 4.56 is the tightest pair in the system. It passes, but it is the
one value that cannot be lightened — if a future tweak pushes `--money` any lighter,
the most important colour in the product stops being readable. `--raised` in dark was
tuned to `#1C2823` specifically to keep card elevation visible (1.19 separation from
ground) without pushing gold below 6.4.

---

## 3. Typography

| Role | Face | Weights |
|---|---|---|
| Display / headings | **Almarai** | 700, 800 |
| Body / UI | **IBM Plex Sans Arabic** | 400, 500, 600 |
| Data, money, time | **IBM Plex Mono** | 400, 500, 600 |

```css
--display: "Almarai", "Segoe UI", Tahoma, sans-serif;
--body:    "IBM Plex Sans Arabic", "Segoe UI", Tahoma, sans-serif;
--data:    "IBM Plex Mono", ui-monospace, monospace;
```

Two non-negotiables:

1. **Money and times are always tabular figures.** `font-variant-numeric: tabular-nums`.
   A column of prices that doesn't align on the decimal makes an owner distrust the
   whole system — and they are right to.
2. **Western numerals (123), not Arabic-Indic (١٢٣).** Egyptian clinic and accounting
   practice uses Western digits; mixing the two across a financial screen is genuinely
   unreadable. Arabic *copy*, Western *digits*.

Type scale (rem): `0.75 · 0.875 · 1 · 1.25 · 1.625 · 2.25`. Headings get
`text-wrap: balance` and `letter-spacing: -0.01em`; uppercase eyebrows get `+0.07em`.

---

## 4. The signature: the arc

The recurring device is the **arc** — the range-of-motion sweep, the physiotherapist's
native geometry. Package progress, plan-of-care completion, clinician utilisation and
recovery trajectory all render as arcs. **Never bars.**

A 220° sweep, radius-normalised, `stroke-linecap: round`, drawn with `pathLength="100"`
so the value is literally the percentage:

```html
<path d="M 8.05 51.63 A 34 34 0 1 1 71.95 51.63" pathLength="100"
      stroke-dasharray="86 100" />
```

Two sizes only: **80×58** (dashboard) and **32×22** (inline, in a row chip). The arc is
the single place in this system where we spend boldness. Everything around it stays
quiet — that is what makes it read as a decision rather than decoration.

---

## 5. Density and interaction

- **Touch targets ≥44px.** Reception runs this on a tablet, standing, in a hurry.
- **The three most frequent actions — mark arrived, mark no-show, take payment — are
  one tap from the day view.** Never behind a modal or a detail page. This constraint
  outranks visual tidiness; if the row gets crowded, something else moves.
- **Financial and destructive actions get their own button style** (`.btn-money`:
  gold-washed, gold-bordered, mono label). They must never share the style of "وصل".
  A receptionist should not be able to take a payment by muscle memory.
- **Full keyboard operation on desktop:** `/` focuses search, `Esc` closes, arrows move
  the queue selection, Enter confirms.
- Radii: `7 / 11 / 15 / 20px`. Not `rounded-lg` on everything — the scale carries
  hierarchy (control → row → panel → sheet).

## 6. Motion

**One orchestrated moment:** the arrival settle. A waiting row lifts out (260ms,
ease-in), reappears at the bottom of "in session" (420ms, ease-out spring) with a single
jade sweep across it. That is the moment the receptionist's action becomes visible, and
it is the only place motion is allowed to be noticeable.

Everything else: 120–160ms opacity and transform, ease-out. `prefers-reduced-motion`
kills all of it. Scattered micro-animation is the clearest tell of generated UI.

## 7. Copy

Written from the user's side of the screen, in Arabic natively — not translated from
English strings.

| Not this | This | Why |
|---|---|---|
| "Submit" | **"اقبض 300 ج.م"** | the button names the outcome, with the amount |
| "Notification jobs" | **"التذكيرات"** | a person manages reminders, not jobs |
| "No data" | **"مفيش مواعيد النهاردة"** | empty states are written, not blank |
| "Error: constraint violation" | **"الأخصائي محجوز في الوقت ده"** | says what happened, in the user's terms |

The verb survives the flow: "اقبض" produces "اتقبضت". Errors never apologise.

---

## 8. What was changed from the original brief, and why

The palette, the arc motif and the gold rule came from the brief and were kept. Three
gaps were filled:

1. **No state colours existed.** If jade were both "interactive" and "in session", the
   meaning of jade would blur, and the pressure to add more hues would eventually break
   the gold rule. Resolved by encoding state in position and form (§1) instead.
2. **No dark theme existed.** A clinician reviewing notes in a dim treatment room and a
   receptionist under fluorescent light are different lighting problems. The dark theme
   is derived, contrast-verified, and hue-biased to the accent — not an inversion.
3. **Contrast was unverified.** Gold on linen turned out to be the system's tightest
   pair at 4.56:1. It passes, but now it is documented as a floor rather than a
   coincidence.

## 9. Honest assessment of the direction

**What makes this not generic:** the gold-means-money rule is a real information-design
constraint that changes what the screen can look like, and it holds throughout. The arc
is grounded in the subject's own geometry rather than picked for looks. State is solved
structurally instead of chromatically. The palette avoids all three looks AI design
defaults to.

**Where the risk is:** jade + brass + brick on linen sits close to an
"apothecary/heritage" register. It stays clinical here because saturation is low and the
type is a contemporary geometric sans rather than a serif — but if a future change adds
a serif display face or warms the linen toward cream, it will tip into that register
fast. The linen is cool (`#F6F7F5`) on purpose. Keep it there.

**What to judge it against:** open the preview, toggle dark mode, click "وصل" on a
waiting row, and click "قبض". If the gold reads as money instantly and the arc reads as
progress without a legend, the direction works.
