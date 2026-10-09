#!/usr/bin/env python3
"""Build ar/index.html from ar/config.json.

One command, no dependencies, no build step, no network:

    python3 make.py

Why this exists and is not a hand-edited HTML file: the WhatsApp number, the
prices and the delivery fee are all still owned by someone else (Founder, Supply,
Ops) and all three will change. A value that changes twice by hand is a bug in
the company. Here every one of them lives in exactly one place in config.json.

Safety rails, deliberate:
  * whatsapp empty      -> order buttons render disabled, page says why. No dead button.
  * public false        -> pre-launch banner + noindex. Nothing public by accident.
  * prices_approved false -> prices show with an "not final" marker.
  * cod_cap_today 0/absent -> cash on delivery is absent from the page entirely.
A page that quietly ships a broken order button is worse than no page.
"""

import json
import pathlib
import urllib.parse

HERE = pathlib.Path(__file__).parent
CFG = json.loads((HERE / "config.json").read_text(encoding="utf-8"))

WA = str(CFG.get("whatsapp") or "").strip()
PUBLIC = bool(CFG.get("public"))
PRICES_OK = bool(CFG.get("prices_approved"))
DELIVERY = CFG.get("delivery_iqd")
LIVE = PUBLIC and bool(WA) and PRICES_OK

# The person a customer is trusting with a prepayment, and the price-review
# date. Both are answers that belong to someone else (Founder on BOR-45, Supply
# cost on BOR-43). Empty is a valid state for both: a missing name is absent
# from the page, never guessed.
PERSON = str(CFG.get("person_ar") or "").strip()
PRICE_DATE = str(CFG.get("prices_review_at") or "").strip()
ADDRESS = str(CFG.get("address_ar") or "").strip()

# COD switch, BOR-30. Ops publishes the cap; we only read it. Default closed:
# anything that is not a positive integer means cash on delivery is absent from
# the page. A bug that opens COD spends money we do not hold, so the failure
# direction is chosen deliberately.
_CAP = CFG.get("cod_cap_today")
COD_CAP = _CAP if isinstance(_CAP, int) and not isinstance(_CAP, bool) else 0
COD_OPEN = COD_CAP > 0


def iqd(n):
    return f"{n:,}"


# ---------------------------------------------------------------- box art
# Inline SVG only. Zero external requests is the whole speed budget.
def art(kind, color):
    dark = {
        "#b4442c": "#9c3722", "#5c6b2e": "#4a5625", "#2f3b4a": "#232c38",
        "#1d6f6f": "#165757", "#c0557a": "#a44463", "#8a5a1f": "#714918",
    }.get(color, "#000")
    shapes = {
        "dots": '<g fill="#fbf8f4" opacity=".92"><circle cx="135" cy="140" r="21"/><circle cx="200" cy="124" r="14"/><circle cx="262" cy="145" r="25"/><circle cx="148" cy="196" r="15"/><circle cx="215" cy="190" r="23"/><circle cx="275" cy="200" r="13"/></g>',
        "cards": '<g fill="#fbf8f4" opacity=".92"><rect x="110" y="120" width="48" height="76" rx="5" transform="rotate(-9 134 158)"/><rect x="172" y="116" width="48" height="76" rx="5"/><rect x="234" y="120" width="48" height="76" rx="5" transform="rotate(9 258 158)"/></g>',
        "skull": '<g fill="#fbf8f4" opacity=".93"><path d="M200 112c-38 0-62 26-62 56 0 18 10 28 18 34v18h88v-18c8-6 18-16 18-34 0-30-24-56-62-56z"/><circle cx="180" cy="166" r="11" fill="'
                 + dark + '"/><circle cx="220" cy="166" r="11" fill="' + dark + '"/></g>',
        "waves": '<g stroke="#fbf8f4" stroke-width="9" fill="none" opacity=".9" stroke-linecap="round"><path d="M104 140h60M104 170h120M104 200h80"/></g><g fill="#fbf8f4" opacity=".9"><circle cx="276" cy="140" r="10"/><circle cx="276" cy="200" r="10"/></g>',
        "tiles": '<g fill="#fbf8f4"><rect x="118" y="120" width="40" height="40" rx="12" opacity=".95"/><rect x="166" y="120" width="40" height="40" rx="12" opacity=".7"/><rect x="214" y="120" width="40" height="40" rx="12" opacity=".95"/><rect x="262" y="120" width="40" height="40" rx="12" opacity=".6"/><rect x="118" y="168" width="40" height="40" rx="12" opacity=".65"/><rect x="166" y="168" width="40" height="40" rx="12" opacity=".95"/><rect x="214" y="168" width="40" height="40" rx="12" opacity=".8"/><rect x="262" y="168" width="40" height="40" rx="12" opacity=".9"/></g>',
        "grid": '<g fill="#fbf8f4" opacity=".92"><rect x="96" y="118" width="52" height="34" rx="4"/><rect x="156" y="118" width="52" height="34" rx="4"/><rect x="216" y="118" width="52" height="34" rx="4"/><rect x="276" y="118" width="32" height="34" rx="4"/><rect x="96" y="162" width="52" height="34" rx="4"/><rect x="156" y="162" width="52" height="34" rx="4"/><rect x="216" y="162" width="52" height="34" rx="4"/><rect x="276" y="162" width="32" height="34" rx="4"/></g>',
    }[kind]
    return (
        '<svg class="art" viewBox="0 0 400 300" aria-hidden="true">'
        '<rect width="400" height="300" fill="#f2ece4"/>'
        f'<rect x="58" y="62" width="284" height="176" rx="10" fill="{color}"/>'
        f'<rect x="58" y="62" width="284" height="34" rx="10" fill="{dark}"/>'
        f"{shapes}</svg>"
    )


# ------------------------------------------------------- the order button
def order_link(game):
    """One tap, pre-filled, in Arabic, naming the exact game. Three steps total."""
    msg = (
        f"السلام عليكم، أريد أطلب من {CFG['brand_ar']}:\n"
        f"اللعبة: {game['ar']} ({game['latin']}) — {iqd(game['price_iqd'])} د.ع\n"
        f"اسمي:\n"
        f"منطقتي ببغداد:"
    )
    return f"https://wa.me/{WA}?text={urllib.parse.quote(msg)}"


def order_button(game):
    label = f"اطلب {game['ar']} على واتساب"
    if LIVE:
        return f'<a class="btn" href="{order_link(game)}" rel="noopener">{label}</a>'
    # No date in this copy. The number arrives when the Founder answers the card
    # on BOR-45, and a promise of "today" that slips is worse than no promise.
    return '<span class="btn off" role="note">الطلب مغلق مؤقتاً — ينفتح يوم ينشر رقم الواتساب</span>'


cards = []
for g in CFG["games"]:
    price = f'{iqd(g["price_iqd"])} <small>د.ع</small>'
    if not PRICES_OK:
        price += ' <em class="prov">السعر غير نهائي</em>'
    cards.append(f"""  <article class="card">
    {art(g["art"], g["color"])}
    <div class="body">
      <h3>{g["ar"]} <span class="lat">{g["latin"]}</span></h3>
      <p class="why">{g["why"]}</p>
      <ul class="meta">
        <li>{g["players"]}</li><li>{g["play"]}</li>
        <li>{g["teach"]}</li><li>{g["loud"]}</li>
      </ul>
      <p class="price">{price}</p>
      {order_button(g)}
    </div>
  </article>""")

# ------------------------------------------- delivery, from Ops' zone table
# Every cell here is Ops & Fulfilment Lead's (BOR-13 delivery-zones). We render
# it, we never invent it. Day counts are WORKING days — Friday is closed, so a
# calendar count would be a promise we break roughly one week in one.
ZONES = [z for z in (CFG.get("delivery_zones") or []) if isinstance(z, dict)]
SELLABLE_ZONES = [z for z in ZONES if z.get("sellable") and isinstance(z.get("price_iqd"), int)]
CLOSED_ZONES = [z for z in ZONES if not z.get("sellable")]
CITY = next((z for z in SELLABLE_ZONES if z.get("zone") == "baghdad_city"), None)

# Two delivery models exist and they do not agree. Orders 1-10 are hand
# delivered (Founder's BOR-45 ruling, Ops' own BOR-35 commitment, ~2 days); the
# courier zone table is the model from order 11. The page promises exactly one
# of them, and the default is the one the Founder ruled on. A customer who can
# find two different answers from us has caught us lying once.
MODEL = str(CFG.get("delivery_model") or "hand_delivery_first_10").strip()
COURIER = MODEL == "courier_zones"

if not COURIER:
    delivery_line = "التوصيل داخل بغداد بس، ونوصلها باليد خلال يومين من الدفع."
    zones_note = "أجرة التوصيل نقولها لك بالواتساب قبل ما تأكد الطلب — ما نفاجئك بسعر عند الباب."
elif CITY:
    delivery_line = (
        f'التوصيل داخل بغداد: {iqd(CITY["price_iqd"])} د.ع — '
        f'يوصلك خلال {CITY["min_days"]}–{CITY["max_days"]} أيام عمل.'
    )
    zones_note = ""
elif isinstance(DELIVERY, int):
    delivery_line = f"التوصيل داخل بغداد: {iqd(DELIVERY)} د.ع."
    zones_note = ""
else:
    delivery_line = "أجرة التوصيل داخل بغداد نقولها لك بالواتساب قبل ما تأكد الطلب — ما نفاجئك بسعر عند الباب."
    zones_note = ""

# Ops killed "order before 14:00 and it ships today" and was right: we hold no
# stock, so on a day with no wholesaler run nothing can leave the house. "We
# start your order" is true every single day. The cut-off still earns its place
# because it decides whether today is day zero.
CUTOFF = str(CFG.get("ship_cutoff_local") or "").strip()
cutoff_line = (
    f"<b>اطلب قبل {CUTOFF} ونبدي بطلبك نفس اليوم.</b>"
    "<span>الجمعة مغلق. أيام العمل من السبت للخميس، وكل المدد المكتوبة أيام عمل مو أيام تقويم.</span>"
    if CUTOFF
    else ""
)

# Zones we cannot serve are named, not priced, and never silently absent: a
# customer in a closed district should read "not yet" from us, not discover it
# after they have paid.
closed_line = (
    "<b>" + "، ".join(z["label_ar"] for z in CLOSED_ZONES) + ": ما نوصل لهنا بعد.</b>"
    "<span>تكدر تكتب لنا على الواتساب ونخبرك يوم نفتحها.</span>"
    if CLOSED_ZONES
    else ""
)

other_zones = [z for z in SELLABLE_ZONES if z is not CITY]
zones_line = (
    "<b>" + " · ".join(
        f'{z["label_ar"]}: {iqd(z["price_iqd"])} د.ع، {z["min_days"]}–{z["max_days"]} أيام عمل'
        for z in other_zones
    ) + "</b>"
    if other_zones
    else ""
)

# When COD is closed the option is absent, not disabled and not promised for
# later. A visible-but-dead choice is one support message per order, and a
# promise of a future payment method is a promise we have not earned yet.
pay_line = (
    "<b>الدفع: حوالة أو محفظة إلكترونية، أو نقداً عند الاستلام.</b>"
    if COD_OPEN
    else "<b>الدفع: حوالة أو محفظة إلكترونية.</b>"
    "<span>نكتب لك الطريقة بالواتساب، وما نطلب منك أي رقم بطاقة.</span>"
)

# ------------------------------------------------- the price-review date
_AR_DIGITS = str.maketrans("0123456789", "٠١٢٣٤٥٦٧٨٩")
_AR_MONTHS = {
    1: "كانون الثاني", 2: "شباط", 3: "آذار", 4: "نيسان", 5: "أيار", 6: "حزيران",
    7: "تموز", 8: "آب", 9: "أيلول", 10: "تشرين الأول", 11: "تشرين الثاني", 12: "كانون الأول",
}


def ar_date(stamp):
    """'2026-10-13 21:00' -> '١٣ تشرين الأول'. Empty or unparseable -> ''."""
    try:
        y, m, d = (int(p) for p in stamp.split(" ")[0].split("-"))
        return f"{str(d).translate(_AR_DIGITS)} {_AR_MONTHS[m]}"
    except (ValueError, KeyError, IndexError):
        return ""


_price_when = ar_date(PRICE_DATE)
price_wait = (
    f"الأسعار تحت المراجعة وتتثبت بعد {_price_when}."
    if _price_when
    else "الأسعار النهائية تنتظر موافقة."
)

# A line with nothing in it is not rendered as an empty bullet. Every item in
# this list is a value someone owns, and an owner who has not answered yet
# leaves no trace on the page rather than an empty promise.
trust_items = "\n".join(
    f"    <li>{line}</li>"
    for line in [
        f"<b>{delivery_line}</b>" + (f"<span>{zones_line}</span>" if zones_line else ""),
        cutoff_line,
        pay_line,
        closed_line,
        "<b>إذا وصلتك ناقصة أو مكسورة، نبدلها.</b><span>ترجعها خلال ١٤ يوم.</span>",
    ]
    if line
)

banner = "" if LIVE else f"""<p class="pre">
  <b>هذي الصفحة مو منشورة بعد.</b>
  {price_wait} لا تطلب من هنا اليوم.
</p>"""

# A stranger prepaying a shop with no reviews is trusting a person, not a logo.
# So when we have a name, it goes first, above everything else on the trust list.
# When we do not, the line is absent — a placeholder name is worse than silence.
person_line = (
    f'    <li><b>المسؤول عن طلبك: {PERSON}.</b>'
    "<span>اسم وشخص تحچيه، مو شركة بلا وجه.</span></li>\n"
    if PERSON
    else ""
)

robots = "" if LIVE else '\n<meta name="robots" content="noindex,nofollow">'

hero_cta = (
    f'<a class="btn big" href="https://wa.me/{WA}?text={urllib.parse.quote("السلام عليكم، أريد أسأل عن الألعاب")}" rel="noopener">اطلب أو اسأل على واتساب</a>'
    if LIVE
    else '<span class="btn big off" role="note">زر الطلب يشتغل يوم ينشر الرقم</span>'
)

html = f"""<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">{robots}
<title>{CFG["brand_ar"]} — ما نبيع كارتون، نبيع سهرة</title>
<meta name="description" content="ألعاب لوحية مختارة للسهرة مو للرف. توصيل داخل بغداد، وإنسان يرد عليك على الواتساب.">
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
:root{{--ink:#14110f;--ink2:#5a524c;--line:#e6e0d8;--bg:#fbf8f4;--card:#fff;
--accent:#b4442c;--wa:#1d7d4f;--r:14px;--pad:16px}}
html{{-webkit-text-size-adjust:100%}}
body{{font:16px/1.6 "Segoe UI",Tahoma,Arial,sans-serif;color:var(--ink);background:var(--bg)}}
svg{{display:block;max-width:100%}}
.wrap{{max-width:720px;margin:0 auto;padding:0 var(--pad)}}
.pre{{background:#14110f;color:#fbf8f4;font-size:13.5px;padding:10px var(--pad);text-align:center}}
.pre b{{color:#f0b429}}
header{{border-bottom:1px solid var(--line);background:var(--card)}}
.bar{{max-width:720px;margin:0 auto;padding:13px var(--pad);display:flex;align-items:baseline;gap:9px}}
.logo{{font-size:21px;font-weight:700}}
.logo .lt{{font-size:12.5px;color:var(--ink2);font-weight:400;letter-spacing:.04em}}
.hero{{padding:26px 0 18px}}
.hero h1{{font-size:27px;line-height:1.3}}
.hero p{{color:var(--ink2);margin-top:9px;max-width:40ch}}
.steps{{display:flex;gap:8px;margin:18px 0 20px;font-size:13px;color:var(--ink2);padding:0}}
.steps li{{list-style:none;flex:1;border-top:3px solid var(--line);padding-top:7px}}
.steps li:first-child{{border-top-color:var(--accent);color:var(--ink);font-weight:700}}
h2{{font-size:13.5px;letter-spacing:.04em;color:var(--ink2);margin:28px 0 12px}}
.grid{{display:grid;gap:14px;grid-template-columns:1fr}}
@media(min-width:560px){{.grid{{grid-template-columns:1fr 1fr}}.hero h1{{font-size:33px}}}}
.card{{background:var(--card);border:1px solid var(--line);border-radius:var(--r);overflow:hidden;display:flex;flex-direction:column}}
.art{{aspect-ratio:4/3;background:#f2ece4}}
.body{{padding:14px;display:flex;flex-direction:column;gap:8px;flex:1}}
.card h3{{font-size:18px;line-height:1.35}}
.card h3 .lat{{font-size:12px;color:var(--ink2);font-weight:400}}
.why{{font-size:14.5px;color:var(--ink2)}}
.meta{{display:flex;flex-wrap:wrap;gap:5px;padding:0;font-size:12px}}
.meta li{{list-style:none;background:#f2ece4;border-radius:5px;padding:3px 7px;color:var(--ink2)}}
.price{{font-size:19px;font-weight:700;margin-top:auto;padding-top:4px}}
.price small{{font-size:12.5px;font-weight:400;color:var(--ink2)}}
.prov{{font-size:11.5px;font-weight:400;font-style:normal;color:#9a5b00;display:block}}
.btn{{display:block;text-align:center;background:var(--wa);color:#fff;text-decoration:none;
font-weight:700;font-size:15.5px;padding:13px;border-radius:10px;min-height:48px}}
.btn.big{{font-size:17px;padding:16px}}
.btn.off{{background:#e6e0d8;color:#6b625b;font-weight:400;font-size:14px}}
.trust{{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:16px;margin:26px 0;font-size:14.5px}}
.trust li{{list-style:none;padding:7px 0;border-bottom:1px solid var(--line)}}
.trust li:last-child{{border-bottom:0;padding-bottom:0}}
.trust b{{display:block}}
.trust span{{color:var(--ink2);font-size:13.5px}}
footer{{border-top:1px solid var(--line);background:var(--card);margin-top:30px}}
.foot{{max-width:720px;margin:0 auto;padding:20px var(--pad) 34px;font-size:13px;color:var(--ink2);display:flex;flex-direction:column;gap:9px}}
</style>
</head>
<body>
{banner}
<header><div class="bar">
  <span class="logo">{CFG["brand_ar"]}</span><span class="lt">{CFG["brand_latin"]}</span>
</div></header>

<main class="wrap">
  <section class="hero">
    <h1>ما نبيع كارتون.<br>نبيع سهرة.</h1>
    <p>كل لعبة هنا عبرت اختبار واحد: منو يكعد، شكد عددهم، شكد وكت، وشكد تصير ضحكة.</p>
    <ol class="steps">
      <li>١. اختر اللعبة</li>
      <li>٢. ارسل واتساب</li>
      <li>٣. توصلك للباب</li>
    </ol>
    {hero_cta}
  </section>

  <h2>حلوة لهاي الليلة</h2>
  <div class="grid">
{chr(10).join(cards)}
  </div>

  <ul class="trust">
{person_line}    <li><b>يرد عليك إنسان، مو روبوت.</b><span>تكتب لنا على الواتساب ويجيك جواب من واحد منا، مو رسالة جاهزة.</span></li>
{trust_items}
  </ul>
</main>

<footer><div class="foot">
  <p>{CFG["brand_ar"]} · {CFG["brand_latin"]} — ألعاب لوحية، بغداد.</p>
  <p>{ADDRESS}</p>
</div></footer>
</body>
</html>
"""

out = HERE / "index.html"
out.write_text(html, encoding="utf-8")

state = "LIVE" if LIVE else "PRE-LAUNCH"
print(f"wrote {out.name}  {len(html.encode()):,} bytes  mode={state}")
print(f"  cash on delivery: {'OPEN, cap ' + str(COD_CAP) if COD_OPEN else 'absent from the page (cap 0, default closed)'}")
if not LIVE:
    missing = []
    if not WA:
        missing.append("whatsapp number (Founder)")
    if not PRICES_OK:
        missing.append("prices_approved (Founder, on Supply cost)")
    if not PUBLIC:
        missing.append("public=true (Founder)")
    print("  blocking publish: " + "; ".join(missing))
