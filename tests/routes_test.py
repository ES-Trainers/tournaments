"""
Routing + registration-flow tests (Phase 2.2 routing fix).
Run from repo root:  python3 tests/routes_test.py      (needs playwright)

PART 1  static link audit of every HTML file (no browser).
PART 2  real click-through in headless Chromium: homepage card ->
        register page (with the real Firestore document id) -> form ->
        submit. Only the Firebase *CDN modules* are stubbed (no network
        in the build sandbox); the site's own HTML/CSS/JS is what runs.
        The stubs record which Firebase PROJECT each read/call targets.
        Document IDs are deliberately NOT "-test-001" style and contain
        a space and '&' so any hardcoding or missing encodeURIComponent fails.
"""
import http.server, socketserver, threading, json, os, re, subprocess, functools, sys
from html.parser import HTMLParser
from urllib.parse import urlsplit, parse_qs
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
results = []
def check(name, cond, detail=""):
    results.append(bool(cond)); print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"   <<< {detail}"))

# ------------------------------------------------------------------ PART 1
cfg = json.loads(subprocess.check_output(["node", "-e",
    "const vm=require('vm');const w={};vm.runInNewContext(require('fs').readFileSync('js/config.js','utf8'),{window:w});console.log(JSON.stringify(w.ES_CONFIG))"], cwd=ROOT))
routes = cfg["routes"]
print("routes in config:", routes)

class Links(HTMLParser):
    def __init__(s): super().__init__(); s.links=[]; s.ids=set()
    def handle_starttag(s, tag, attrs):
        a = dict(attrs)
        if a.get("id"): s.ids.add(a["id"])
        for k in ("href", "src"):
            if a.get(k) is not None and tag != "use": s.links.append((tag, k, a[k], a.get("data-route"), "data-whatsapp-cta" in a))

HTML = ["index.html", "rules.html", "bgmi/register.html", "ff-max/register.html"]
parsed = {}
for f in HTML:
    p = Links(); p.feed(open(f"{ROOT}/{f}", encoding="utf-8").read()); parsed[f] = p

def target_file(path):
    if path.endswith("/"): path += "index.html"
    return os.path.join(ROOT, path.lstrip("/"))

for f, p in parsed.items():
    for tag, k, v, route, wa in p.links:
        if re.match(r"^(https?:|mailto:|tel:|data:)", v) or v.startswith("#") and len(v) > 1 and v[1:] in p.ids: continue
        if v in ("#", ""):
            # '#' is legal ONLY for a WhatsApp CTA, whose href js/ui.js sets from config.
            check(f"{f}: '#' placeholder is a [data-whatsapp-cta] (filled from config), not a dead link", wa); continue
        u = urlsplit(v)
        path = u.path if u.path.startswith("/") else "/" + os.path.normpath(os.path.join(os.path.dirname(f), u.path))
        check(f"{f}: {k}={v} -> target exists", os.path.exists(target_file(path)), path)
        check(f"{f}: {v} is not an /assets/ PAGE route", not (path.startswith("/assets/") and path.endswith((".html", "/"))), path)
        if path.endswith("register.html"):
            check(f"{f}: register link {v} carries ?id=", bool(parse_qs(u.query).get("id")), "static register link without id")
        if u.fragment and path in ("/", "/index.html"):
            check(f"{f}: anchor #{u.fragment} exists on homepage", u.fragment in parsed["index.html"].ids)
        if route:
            check(f"{f}: data-route={route} static fallback == config route", route in routes and routes[route] == v, f"{v} vs {routes.get(route)}")

for r, v in routes.items():
    u = urlsplit(v)
    check(f"config route {r}={v} points at an existing page/section", os.path.exists(target_file(u.path)) and (not u.fragment or u.fragment in parsed["index.html"].ids))
check("config has no routes to pages that don't exist (no history/admin/bgmi/ffmax landing keys)", set(routes) == {"home","tournaments","about","rules","bgmiRegister","ffmaxRegister"}, str(set(routes)))
check("no public page lives under assets/", not [x for r,_,fs in os.walk(f"{ROOT}/assets") for x in fs if x.endswith(".html")])

# no route strings hardcoded in JS outside config.js
bad = []
for fn in os.listdir(f"{ROOT}/js"):
    if fn == "config.js": continue
    src = open(f"{ROOT}/js/{fn}", encoding="utf-8").read()
    for pat in ("register.html", "/#tournaments", "/#games", "/rules.html", "/ff-max/register", "/bgmi/register"):
        if re.search(r"[\"'`][^\"'`\n]*" + re.escape(pat), src): bad.append((fn, pat))
check("no page routes hardcoded in JS outside js/config.js", not bad, str(bad))
check("no 'id || \"...test\"' style ID fabrication in JS", not re.search(r"(id|Id)\s*(\|\||\?\?)\s*[\"']", "".join(open(f"{ROOT}/js/{f}").read() for f in ("registration.js","tournaments.js"))))
check("every non-config-open status compare uses canonical registration_open", "registration_open" in open(f"{ROOT}/functions/lib/submit.js").read() and not re.search(r"[\"']open[\"']", open(f"{ROOT}/functions/lib/submit.js").read()))

# ------------------------------------------------------------------ PART 2
PORT = 8792
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a,**k): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.TCPServer(("127.0.0.1", PORT), functools.partial(Q, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{PORT}"

APP_JS = "export function initializeApp(c,n){return {options:c,name:n};}"
FS_JS = """
export function getFirestore(app){return {app};}
export function doc(db,col,id){return {db,col,id};}
export function collection(db,name){return {db,name};}
export function query(c){return c;}
export function where(){return {};}
export function orderBy(){return {};}
export function limit(){return {};}
export function onSnapshot(q,ok){
  const pid=q.db.app.options.projectId, all=window.__MOCK.tournaments||{};
  const docs=Object.entries(all).filter(([k])=>k.startsWith(pid+'/')).map(([k,v])=>({id:k.slice(pid.length+1),data:()=>v}));
  setTimeout(()=>ok({forEach:(f)=>docs.forEach(f)}),20); return ()=>{};
}
export async function getDoc(ref){
  const pid = ref.db.app.options.projectId;
  (window.__READS = window.__READS||[]).push({project:pid,col:ref.col,id:ref.id});
  const t = (window.__MOCK.tournaments||{})[pid+'/'+ref.id];
  return {exists:()=>!!t, id:ref.id, data:()=>t};
}
"""
FN_JS = """
export function getFunctions(app,region){return {app,region};}
export function httpsCallable(fns,name){
  return async (data)=>{
    (window.__SUBMITS = window.__SUBMITS||[]).push({project:fns.app.options.projectId,region:fns.region,name,data});
    await new Promise(r=>setTimeout(r,150));
    return {data:{success:true,registrationId:'reg_x',status:'pending'}};
  };
}
"""
BG_ID, FF_ID = "bgmiDoc_7fQ2xA", "ffDoc 9&Z"
TOURN = {
 f"bgmi-firebase/{BG_ID}": {"title":"BGMI Open Cup","status":"registration_open","match":"Squad TPP","entryFee":"₹250 / team","prizePool":"₹2,000","maxTeams":25,"registeredTeams":3,"date":"2026-10-10"},
 f"ff-max-firebase/{FF_ID}": {"title":"FF MAX Clash","status":"registration_open","match":"Squad CS","entryFee":"₹150 / team","prizePool":"₹1,000","maxTeams":12,"registeredTeams":1,"date":"2026-10-11"},
 "bgmi-firebase/soon": {"title":"BGMI Soon","status":"upcoming","date":"2026-11-01"},
 "ff-max-firebase/live1": {"title":"FF Live","status":"live","date":"2026-10-01"},
}
def stub(page):
    def gs(route):
        u = route.request.url
        body = APP_JS if "firebase-app" in u else FS_JS if "firebase-firestore" in u else FN_JS if "firebase-functions" in u else ""
        route.fulfill(status=200, content_type="text/javascript", body=body)
    page.route("https://www.gstatic.com/firebasejs/**", gs)
    page.route("https://fonts.googleapis.com/**", lambda r: r.fulfill(status=200, content_type="text/css", body=""))
    page.route("https://fonts.gstatic.com/**", lambda r: r.abort())
    page.add_init_script(f"window.__MOCK = {json.dumps({'tournaments': TOURN})};")

def lum(rgb):
    c = [x/255 for x in rgb]; c = [x/12.92 if x <= .03928 else ((x+.055)/1.055)**2.4 for x in c]
    return .2126*c[0]+.7152*c[1]+.0722*c[2]
def contrast(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True); return (la+.05)/(lb+.05)
def rgb(s): return [int(float(x)) for x in re.findall(r"[\d.]+", s)[:3]]

def visible(page, sel):
    return page.eval_on_selector(sel, "e=>{const r=e.getBoundingClientRect();const s=getComputedStyle(e);return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0}")

def summaries(page, field):
    return page.eval_on_selector_all(f"[{field}]", "els=>els.filter(e=>e.offsetParent!==null).map(e=>e.textContent.trim())")

FILL = {"p1Name":"Asha One","p1Ign":"AshaX","p1Uid":"1001","p1Email":"asha@example.com","p1Phone":"9876543210","p2Name":"Player Two","p2Ign":"TwoX","p2Uid":"1002","p3Name":"Player Three","p3Ign":"ThreeX","p3Uid":"1003","p4Name":"Player Four","p4Ign":"FourX","p4Uid":"1004"}

with sync_playwright() as pw:
    b = pw.chromium.launch(); ctx = b.new_context()

    def home(width=1440):
        pg = ctx.new_page(); pg.set_viewport_size({"width": width, "height": 900}); stub(pg)
        logs = []; pg.on("console", lambda m: logs.append((m.type, m.text)))
        pg.goto(BASE + "/"); pg.wait_for_selector(".tcard"); return pg, logs

    # ---- homepage cards: only open tournaments show a (visible) Register Now
    pg, logs = home()
    check("homepage: no console errors (incl. unknown data-route)", not [l for l in logs if l[0] == "error"], str(logs))
    for cls, title in (("bgmi","BGMI Soon"),("ffmax","FF Live")):
        ok = pg.evaluate("t=>{const c=[...document.querySelectorAll('.tcard')].find(c=>c.querySelector('[data-field=title]').textContent===t);const e=c.querySelector('[data-field=cta]');const r=e.getBoundingClientRect();return getComputedStyle(e).display==='none'||r.width===0}", title)
        check(f"homepage: non-open card '{title}' shows NO Register Now button (computed style, not just [hidden])", ok)
    pg.close()

    # ---- full flow per game
    for game, path, gid, title, fee, proj in (
        ("bgmi", "/bgmi/register.html", BG_ID, "BGMI Open Cup", "₹250 / team", "bgmi-firebase"),
        ("ffmax", "/ff-max/register.html", FF_ID, "FF MAX Clash", "₹150 / team", "ff-max-firebase")):
        T = game.upper()
        pg, _ = home()
        card = pg.locator(f".tcard--{game}", has_text=title)
        btn = card.locator("[data-field=cta]")
        check(f"{T} flow: Register Now visible on the open card", btn.is_visible())
        href = btn.get_attribute("href")
        from urllib.parse import quote
        check(f"{T} flow: href == {path}?id=<encoded real Firestore doc id>", href == f"{path}?id={quote(gid, safe='')}", href)
        check(f"{T} flow: no /assets/ and not id-less", "/assets/" not in href and "id=" in href, href)
        logs = []; pg.on("console", lambda m: logs.append((m.type, m.text)))
        btn.click(); pg.wait_for_url(f"**{path}?id=*")
        u = urlsplit(pg.url)
        check(f"{T} flow: landed on {path} with the exact document id", u.path == path and parse_qs(u.query)["id"] == [gid], pg.url)
        pg.wait_for_function("document.querySelector('[data-field=title]').textContent!=='Loading tournament…'")
        check(f"{T} flow: NO 'Tournament information is missing'", not visible(pg, "[data-load-error]"))
        check(f"{T} flow: title from Firebase", title in summaries(pg, 'data-field="title"') or pg.locator("h1.reg-summary__title").inner_text() == title)
        check(f"{T} flow: fee from Firebase ({fee})", set(summaries(pg, "data-fee-echo")) == {fee}, str(summaries(pg, "data-fee-echo")))
        reads = pg.evaluate("window.__READS")
        check(f"{T} flow: tournament read targets ONLY {proj}, doc id preserved", reads and all(r["project"] == proj and r["id"] == gid and r["col"] == "tournaments" for r in reads), str(reads))
        pg.wait_for_function("!document.querySelector('.reg-cta').disabled") if False else None
        pg.fill("#teamName", "Team Alpha")
        te = summaries(pg, "data-team-echo")
        check(f"{T} flow: team summary updates immediately in EVERY visible summary", te and all(x == "Team Alpha" for x in te), str(te))
        for k, v in FILL.items(): pg.fill("#" + k, v)
        pg.click("label[for=p5Enabled]")
        pe = summaries(pg, "data-players-echo")
        check(f"{T} flow: players summary updates (4 + 1 Emergency)", pe and all(x == "4 + 1 Emergency" for x in pe), str(pe))
        pg.click("label[for=p5Enabled]")
        check(f"{T} flow: players summary back to 4", all(x == "4" for x in summaries(pg, "data-players-echo")))
        pg.check("#termsAccepted")
        cta = pg.locator(".reg-cta:visible").first
        check(f"{T} flow: Continue button usable after terms", cta.is_enabled())
        cta.click(); pg.wait_for_selector("#reg-modal-overlay.is-open")
        sub = pg.evaluate("window.__SUBMITS")
        check(f"{T} flow: backend call goes to {proj} with the SAME tournamentId + game", len(sub) == 1 and sub[0]["project"] == proj and sub[0]["data"]["tournamentId"] == gid and sub[0]["data"]["game"] == game, str(sub))
        check(f"{T} flow: submit payload has no fee/status (server-authoritative)", not {"entryFee","fee","status","registeredTeams"} & set(sub[0]["data"]))
        check(f"{T} flow: no console errors along the way", not [l for l in logs if l[0] == "error"], str(logs))

        # rules link from this registration page (close the success modal first, as a user would)
        pg.click("#reg-modal-close"); pg.wait_for_selector("#reg-modal-overlay.is-open", state="detached") if False else pg.wait_for_function("!document.getElementById('reg-modal-overlay').classList.contains('is-open')")
        with ctx.expect_page() as npg:
            pg.click('a[data-route="rules"]')
        rp = npg.value; rp.wait_for_load_state()
        check(f"{T}: View Tournament Rules opens /rules.html (real page, not 404)", urlsplit(rp.url).path == "/rules.html" and "Tournament Rules" in rp.inner_text("h1"), rp.url)
        rp.close(); pg.close()

    # ---- direct URL WITHOUT id (expected error) + Back button + mobile
    for game, path in (("bgmi","/bgmi/register.html"),("ffmax","/ff-max/register.html")):
        for w in (1440, 768, 390):
            pg = ctx.new_page(); pg.set_viewport_size({"width": w, "height": 900}); stub(pg)
            pg.goto(BASE + path); pg.wait_for_selector("[data-load-error]:not([hidden])")
            T = f"{game}@{w}"
            check(f"{T}: no-id URL shows 'Tournament information is missing.'", "Tournament information is missing." in pg.inner_text("[data-load-error-title]"))
            check(f"{T}: no fabricated id — no tournament read at all", not pg.evaluate("window.__READS"))
            check(f"{T}: submit stays disabled", pg.locator(".reg-cta").first.is_disabled())
            check(f"{T}: Retry button is NOT shown when retrying is pointless (missing id)", not visible(pg, "[data-load-retry]"))
            check(f"{T}: Back to Tournament visible", visible(pg, "[data-load-back]"))
            col = pg.eval_on_selector("[data-load-back]", "e=>{const s=getComputedStyle(e);return [s.color,s.backgroundColor,s.borderTopColor]}")
            cr = contrast(rgb(col[0]), rgb(col[1]) if not col[1].startswith("rgba(0, 0, 0, 0") else rgb("rgb(255,244,242)"))
            check(f"{T}: Back to Tournament text contrast >= 4.5 (got {cr:.1f})", cr >= 4.5, str(col))
            check(f"{T}: Back button is NOT white-on-light", rgb(col[0]) != [255,255,255])
            if w == 390:
                box = pg.eval_on_selector("[data-load-back]", "e=>{const r=e.getBoundingClientRect();return [r.left,r.right,innerWidth]}")
                check(f"{T}: Back button fully inside mobile viewport", box[0] >= 0 and box[1] <= box[2], str(box))
                check(f"{T}: no horizontal scroll", pg.evaluate("document.documentElement.scrollWidth<=innerWidth"))
            pg.click("[data-load-back]"); pg.wait_for_url(BASE + "/#tournaments")
            check(f"{T}: Back lands on the homepage tournaments section", urlsplit(pg.url).path == "/" and urlsplit(pg.url).fragment == "tournaments", pg.url)
            pg.close()

    # ---- nav / breadcrumb / footer / mobile menu hrefs resolve via config on every page
    for url in ("/", "/bgmi/register.html?id=x", "/ff-max/register.html?id=x"):
        for w in (1440, 390):
            pg = ctx.new_page(); pg.set_viewport_size({"width": w, "height": 900}); stub(pg); pg.goto(BASE + url)
            bad = pg.evaluate("""r=>[...document.querySelectorAll('[data-route]')].filter(a=>a.getAttribute('href')!==r[a.dataset.route]).map(a=>a.textContent.trim())""", routes)
            check(f"{url}@{w}: every data-route link href == config route", not bad, str(bad))
            hrefs = pg.eval_on_selector_all("header a[href], footer a[href], .reg-crumb a", "e=>e.map(a=>[a.textContent.trim(),a.getAttribute('href')])")
            for label in ("BGMI", "FF MAX"):
                got = {h for t, h in hrefs if t == label}
                check(f"{url}@{w}: '{label}' nav/footer/breadcrumb links -> {routes['tournaments']} only", got <= {routes["tournaments"]} and got, str(got))
            if w == 390 and url == "/":
                pg.click(".nav__toggle"); 
                check(f"{url}@{w}: mobile menu opens and its BGMI link works", visible(pg, "#mobile-menu a[data-route=tournaments]"))
                pg.click("#mobile-menu a[data-route=tournaments]"); 
                check(f"{url}@{w}: mobile BGMI link lands on #tournaments", urlsplit(pg.url).fragment == "tournaments", pg.url)
            pg.close()
    b.close()

print(f"\n{sum(results)}/{len(results)} routing checks passed"); sys.exit(0 if all(results) else 1)
