"""
UI tests for the two registration pages. Serves the real site and
drives it in headless Chromium. Only the Firebase *CDN modules* are
stubbed (no network in the build sandbox) — the site's own HTML/CSS/JS
is what runs. The stubs record which Firebase PROJECT each read/call
targets, and can simulate backend answers.
Run:  python3 tests/ui_test.py   (from the repo root; needs playwright)
"""
import http.server, socketserver, threading, json, os, sys, functools
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8791
class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a, **k): pass
Handler = functools.partial(QuietHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.TCPServer(("127.0.0.1", PORT), Handler)
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
  const docs=Object.entries(all).filter(([k])=>k.startsWith(pid+'/')).map(([k,v])=>({id:k.split('/')[1],data:()=>v}));
  setTimeout(()=>ok({forEach:(f)=>docs.forEach(f)}),20); return ()=>{};
}
export async function getDoc(ref){
  if(window.__MOCK.getDocThrows) throw Object.assign(new Error('offline'),{code:'unavailable'});
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
    await new Promise(r=>setTimeout(r,250));
    const b = window.__MOCK.submit || {ok:true};
    if(b.ok) return {data:{success:true,registrationId:'reg_x',status:'pending'}};
    const e = new Error(b.message||'x'); e.code=b.code; if(b.reason) e.details={reason:b.reason}; throw e;
  };
}
"""
def setup_routes(page):
    def gs(route):
        u = route.request.url
        body = APP_JS if "firebase-app" in u else FS_JS if "firebase-firestore" in u else FN_JS if "firebase-functions" in u else ""
        route.fulfill(status=200, content_type="text/javascript", body=body)
    page.route("https://www.gstatic.com/firebasejs/**", gs)
    page.route("https://fonts.googleapis.com/**", lambda r: r.fulfill(status=200, content_type="text/css", body=""))
    page.route("https://fonts.gstatic.com/**", lambda r: r.abort())

results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(("PASS " if cond else "FAIL ") + name + (f"  [{detail}]" if detail and not cond else ""))

TOURN = {"bgmi-firebase/bgmi-test-001": {"title":"BGMI Test 001","status":"registration_open","match":"Squad TPP","entryFee":"₹200 / team","prizePool":"₹2,000","maxTeams":25,"registeredTeams":3,"date":"2026-10-10"},
         "ff-max-firebase/ffmax-test-001": {"title":"FF MAX Test 001","status":"registration_open","match":"Squad CS","entryFee":"₹200 / team","prizePool":"₹1,000","maxTeams":12,"registeredTeams":1,"date":"2026-10-11"},
         "bgmi-firebase/no-fee": {"title":"No Fee","status":"registration_open","maxTeams":25,"registeredTeams":0}}

def new_page(ctx, url, mock=None, width=1440, height=900, logs=None):
    page = ctx.new_page(); page.set_viewport_size({"width":width,"height":height}); setup_routes(page)
    m = {"tournaments": TOURN}; m.update(mock or {})
    page.add_init_script(f"window.__MOCK = {json.dumps(m)};")
    if logs is not None:
        page.on("console", lambda msg: logs.append((msg.type, msg.text)))
        page.on("pageerror", lambda e: logs.append(("pageerror", str(e))))
    page.goto(BASE + url); page.wait_for_function("document.querySelector('[data-field=title]').textContent !== 'Loading tournament…'", timeout=8000)
    return page

def fill_valid(page, team="Team Alpha", terms=True):
    vals = {"teamName":team,"p1Name":"Asha One","p1Ign":"AshaX","p1Uid":"1001","p1Email":"asha@example.com","p1Phone":"9876543210",
            "p2Name":"Player Two","p2Ign":"TwoX","p2Uid":"1002","p3Name":"Player Three","p3Ign":"ThreeX","p3Uid":"1003","p4Name":"Player Four","p4Ign":"FourX","p4Uid":"1004"}
    for k,v in vals.items(): page.fill("#"+k, v)
    if terms: page.check("#termsAccepted")

def visible_summaries(page):
    return page.evaluate("""[...document.querySelectorAll('.reg-summary-card')].filter(e=>{const r=e.getBoundingClientRect();return getComputedStyle(e).visibility!=='hidden' && e.offsetParent!==null && r.width>0 && r.height>0 && !e.closest('[hidden]') && getComputedStyle(e.parentElement).display!=='none'}).length""")

with sync_playwright() as pw:
    b = pw.chromium.launch(); ctx = b.new_context()
    PAGES = {"bgmi":"/bgmi/register.html?id=bgmi-test-001", "ffmax":"/ff-max/register.html?id=ffmax-test-001"}

    # ---- T16/T17 responsive: exactly one summary, no h-scroll, no overlap ----
    for game, url in PAGES.items():
        for w in (320,375,390,430,768,1024,1366,1440):
            p = new_page(ctx, url, width=w)
            n = visible_summaries(p)
            sw = p.evaluate("document.documentElement.scrollWidth"); iw = p.evaluate("window.innerWidth")
            desk = w >= 1024
            which = p.evaluate("(()=>{const d=document.querySelector('[data-desktop-summary]'),m=document.querySelector('[data-mobile-summary]');return [getComputedStyle(d).display!=='none',getComputedStyle(m).display!=='none']})()")
            ok_which = (which == [True, False]) if desk else (which == [False, True])
            overlap = False
            if desk:
                overlap = p.evaluate("(()=>{const a=document.querySelector('[data-desktop-summary]').getBoundingClientRect(),f=document.querySelector('.reg-form').getBoundingClientRect();return !(a.left>=f.right-1||a.right<=f.left+1)})()")
            check(f"T16/17 {game} {w}px: exactly 1 summary ({'desktop' if desk else 'mobile'} copy), no h-scroll, no overlap", n==1 and ok_which and sw<=iw and not overlap, f"visible={n} which={which} scrollW={sw} innerW={iw} overlap={overlap}")
            if game=="bgmi" and w in (390,1440): p.screenshot(path=f"/tmp/shot_{game}_{w}.png", full_page=True)
            p.close()

    # ---- T18 terms checkbox behaviour ----
    p = new_page(ctx, PAGES["bgmi"])
    vis = lambda: p.evaluate("getComputedStyle(document.getElementById('terms-error')).display!=='none'")
    check("T18 terms error hidden on initial load", not vis())
    p.locator(".reg-cta:visible").click()
    check("T18 terms error appears after Continue with box unchecked", vis())
    p.check("#termsAccepted")
    check("T18 terms error disappears immediately when checked", not vis())
    p.uncheck("#termsAccepted")
    check("T18 unticking alone does not re-show the error", not vis())
    p.locator(".reg-cta:visible").click()
    check("T18 error reappears when validation is triggered again", vis())
    p.check("#termsAccepted")
    check("T18 checked + error gone stays consistent (aria-invalid=false)", not vis() and p.get_attribute("#termsAccepted","aria-invalid")=="false")
    inline = p.evaluate("document.getElementById('terms-error').hasAttribute('style') || document.getElementById('terms-error').hasAttribute('hidden')")
    check("T18 terms error uses class state only (no inline style / hidden attr)", not inline)
    p.close()

    # ---- T19 fee ----
    for game, url in PAGES.items():
        p = new_page(ctx, url)
        fees = p.eval_on_selector_all("[data-fee-echo]", "els=>els.map(e=>e.textContent)")
        check(f"T19 {game}: Registration Fee shows tournament entryFee in every summary", fees and all(f=="₹200 / team" for f in fees), str(fees))
        p.close()
    def blocked(p):
        return p.evaluate("[...document.querySelectorAll('.reg-cta')].every(b=>b.disabled)"), p.evaluate("!document.querySelector('[data-load-error]').hidden"), p.inner_text("[data-load-error-title]")
    logs=[]; p = new_page(ctx, "/bgmi/register.html?id=no-fee", logs=logs)
    dis, banner, title = blocked(p)
    check("T19 missing entryFee: explicit error banner, Continue disabled, problem logged, no fake fee", dis and banner and not any("₹200" in f for f in p.eval_on_selector_all("[data-fee-echo]","e=>e.map(x=>x.textContent)")) and any("no usable entryFee" in t for k,t in logs if k=="error"), title)
    p.close()
    logs=[]; p = new_page(ctx, "/bgmi/register.html?id=nope", logs=logs)
    dis, banner, title = blocked(p)
    check("T31 unknown tournament id: 'could not be found', Continue disabled, logged", dis and banner and "could not be found" in title and any("No bgmi tournament" in t for k,t in logs if k=="error"), title)
    p.close()
    logs=[]; p = new_page(ctx, "/bgmi/register.html", logs=logs)
    dis, banner, title = blocked(p)
    back = p.get_attribute("[data-load-back]","href")
    check("T4/T31 missing ?id: 'Tournament information is missing.', Continue disabled, safe Back link", dis and banner and title=="Tournament information is missing." and back=="/#tournaments", f"{title} {back}")
    p.close()
    p = new_page(ctx, "/bgmi/register.html?id=bgmi-test-001", mock={"getDocThrows":True})
    dis, banner, title = blocked(p)
    check("T26 fetch failure: 'Unable to load tournament information.', Retry visible, Continue disabled", dis and banner and title=="Unable to load tournament information." and p.evaluate("!document.querySelector('[data-load-retry]').hidden"), title)
    p.evaluate("window.__MOCK.getDocThrows=false"); p.click("[data-load-retry]")
    p.wait_for_function("[...document.querySelectorAll('.reg-cta')].every(b=>!b.disabled)")
    check("T26 Retry recovers: banner gone, fee loaded, Continue enabled", p.evaluate("document.querySelector('[data-load-error]').hidden") and p.eval_on_selector_all("[data-fee-echo]","e=>e.map(x=>x.textContent)")==["₹200 / team"]*2)
    p.close()
    p = new_page(ctx, "/bgmi/register.html?id=closed-one", mock={"tournaments":{"bgmi-firebase/closed-one":{"title":"Closed","status":"upcoming","entryFee":"₹200 / team","maxTeams":5}}})
    dis, banner, title = blocked(p)
    check("T31 non-open status: 'currently closed', Continue disabled", dis and banner and "closed" in title.lower(), title)
    p.close()
    p = new_page(ctx, "/bgmi/register.html?id=bgmi-test-001")
    dis = p.evaluate("[...document.querySelectorAll('.reg-cta')].every(b=>b.disabled)")
    check("T30.4/5 valid tournament: Continue enabled, fee from Firebase in BOTH summaries", not dis and p.eval_on_selector_all("[data-fee-echo]","e=>e.map(x=>x.textContent)")==["₹200 / team"]*2)
    p.fill("#teamName","  Team   Alpha ")
    team = p.eval_on_selector_all("[data-team-echo]","e=>e.map(x=>x.textContent)")
    check("T2/T30.7-8 typing team name updates BOTH summaries immediately (whitespace collapsed)", team==["Team Alpha","Team Alpha"], str(team))
    p.evaluate("(()=>{const c=document.getElementById('p5Enabled');c.checked=true;c.dispatchEvent(new Event('change',{bubbles:true}))})()"); pl = p.eval_on_selector_all("[data-players-echo]","e=>e.map(x=>x.textContent)")
    check("T30.10 emergency player toggle updates BOTH Players summaries", pl==["4 + 1 Emergency"]*2, str(pl))
    p.evaluate("(()=>{const c=document.getElementById('p5Enabled');c.checked=false;c.dispatchEvent(new Event('change',{bubbles:true}))})()"); pl = p.eval_on_selector_all("[data-players-echo]","e=>e.map(x=>x.textContent)")
    check("Players summary returns to 4 in BOTH", pl==["4","4"], str(pl))
    p.fill("#teamName",""); team = p.eval_on_selector_all("[data-team-echo]","e=>e.map(x=>x.textContent)")
    check("empty team name shows em dash in BOTH", team==["—","—"], str(team))
    p.close()
    p = new_page(ctx, "/bgmi/register.html?id=bgmi-test-001", mock={"tournaments":{"bgmi-firebase/bgmi-test-001":{"title":"Num","status":"registration_open","entryFee":200}}})
    check("T19 numeric entryFee renders with rupee sign", p.eval_on_selector_all("[data-fee-echo]","els=>els.map(e=>e.textContent)")==["₹200","₹200"])
    p.close()

    # ---- T5 homepage register links carry the real Firebase document ID ----
    hp = ctx.new_page(); setup_routes(hp)
    hp.add_init_script("window.__MOCK = "+json.dumps({"tournaments":{**TOURN,"bgmi-firebase/upc-1":{"title":"Soon","status":"upcoming","date":"2026-11-01"}}})+";")
    hp.goto(BASE+"/"); hp.wait_for_selector(".tcard", timeout=8000)
    cards = hp.eval_on_selector_all(".tcard","els=>els.map(c=>({t:c.querySelector('[data-field=title]').textContent,h:c.querySelector('[data-field=cta]').getAttribute('href'),hid:c.querySelector('[data-field=cta]').hidden}))")
    byt = {c["t"]:c for c in cards}
    check("T5 homepage BGMI card -> /bgmi/register.html?id=<doc id from Firebase>", byt.get("BGMI Test 001",{}).get("h")=="/bgmi/register.html?id=bgmi-test-001" and not byt["BGMI Test 001"]["hid"], str(cards))
    check("T5 homepage FF MAX card -> /ff-max/register.html?id=<doc id from Firebase>", byt.get("FF MAX Test 001",{}).get("h")=="/ff-max/register.html?id=ffmax-test-001", str(cards))
    check("T5 non-open (upcoming) card has NO register link", byt.get("Soon",{}).get("hid") is True, str(cards))
    all_h = hp.eval_on_selector_all("a[href]","e=>e.map(x=>x.getAttribute('href'))")
    stale = [h for h in all_h if h.startswith("/assets/") and "register" in h or h in ("/about/","/contact/","/bgmi/history/","/ff-max/history/") or h=="/bgmi/register.html" or h=="/ff-max/register.html"]
    check("T5/T25 homepage has no stale/404 routes and no id-less register links", not stale, str(stale))
    hp.close()
    check("T24 /rules.html exists", os.path.exists(f"{ROOT}/rules.html"))
    for f in ("bgmi/register.html","ff-max/register.html"):
        check(f"T24 {f} rules link targets an existing file", 'href="/rules.html"' in open(f"{ROOT}/{f}").read())

    # ---- T20/T21 routing ----
    for game, url in PAGES.items():
        p = new_page(ctx, url)
        hrefs = p.eval_on_selector_all("a[href]", "els=>els.map(e=>e.getAttribute('href'))")
        bad = [h for h in hrefs if h and (h.startswith("/assets/") or h.endswith("/register.html") and "id=" not in h and h.startswith("/assets"))]
        nav = p.eval_on_selector_all("header .nav__links a, .reg-crumb a", "els=>els.map(e=>[e.textContent.trim(),e.getAttribute('href')])")
        check(f"T{20 if game=='bgmi' else 21} {game}: no link points into /assets/... register routes", not bad, str(bad))
        check(f"T{20 if game=='bgmi' else 21} {game}: nav BGMI/FF MAX go to the homepage tournaments section, Home to /", ("BGMI","/#tournaments") in [tuple(x) for x in nav] and ("Home","/") in [tuple(x) for x in nav], str(nav))
        p.close()
    import subprocess
    check("routes: register pages exist at the public paths", os.path.exists(f"{ROOT}/bgmi/register.html") and os.path.exists(f"{ROOT}/ff-max/register.html") and not os.path.exists(f"{ROOT}/assets/bgmi/register.html"))

    # ---- T1/T2 project separation from the browser side + success modal ----
    for game, url, proj in (("bgmi",PAGES["bgmi"],"bgmi-firebase"),("ffmax",PAGES["ffmax"],"ff-max-firebase")):
        p = new_page(ctx, url); fill_valid(p)
        p.locator(".reg-cta:visible").click()
        p.wait_for_selector("#reg-modal-overlay.is-open")
        sub = p.evaluate("window.__SUBMITS"); reads = p.evaluate("window.__READS")
        check(f"{game}: tournament READ goes only to {proj}", reads and all(r["project"]==proj for r in reads), str(reads))
        check(f"{game}: callable SUBMIT goes only to {proj}, region us-central1, name submitRegistration, game={game}", len(sub)==1 and sub[0]["project"]==proj and sub[0]["region"]=="us-central1" and sub[0]["name"]=="submitRegistration" and sub[0]["data"]["game"]==game, str(sub and {k:v for k,v in sub[0].items() if k!='data'}))
        d = sub[0]["data"]
        check(f"{game}: payload carries requestId + tournamentId from URL and NO fee/status/limits", d["requestId"] and d["tournamentId"]==url.split("id=")[1] and not any(k in d for k in ("entryFee","maxTeams","registeredTeams","status","prizePool")), str(list(d)))
        title = p.inner_text("#reg-modal-title"); msg = p.inner_text("#reg-modal-message")
        check(f"{game}: success modal is truthful (saved/pending payment; no 'confirmed'/'successful'/team number)", title=="Registration Details Saved" and "pending payment" in msg and not any(w in (title+msg).lower() for w in ("confirmed","successful","team number","paid")), f"{title} | {msg}")
        p.close()

    # ---- T15 double submission in the browser ----
    p = new_page(ctx, PAGES["bgmi"]); fill_valid(p)
    btn = p.locator(".reg-cta:visible"); btn.click(); 
    label = btn.inner_text(); btn.click(force=True) if False else None
    p.evaluate("document.getElementById('registration-form').requestSubmit()")   # a 2nd submit while in flight (Enter key / 2nd click)
    p.wait_for_selector("#reg-modal-overlay.is-open")
    check("T15 UI: button shows 'Submitting…' while in flight", label.startswith("Submitting"), label)
    check("T15 UI: second submit while in flight is ignored (exactly 1 backend call)", len(p.evaluate("window.__SUBMITS"))==1)
    p.close()

    # ---- error mapping (real reasons, not one generic message) ----
    cases = [("DUPLICATE_TEAM_NAME","already-exists","field","That team name is already registered for this tournament."),
             ("INVALID_TEAM_NAME","invalid-argument","field","Team name must be 3"),
             ("TOURNAMENT_CLOSED","failed-precondition","modal","Registration for this tournament is currently closed."),
             ("TOURNAMENT_FULL","resource-exhausted","modal","This tournament has reached its registration limit."),
             ("TOURNAMENT_NOT_FOUND","not-found","modal","This tournament could not be found."),
             ("INVALID_GAME","invalid-argument","modal","does not match this game"),
             ("DUPLICATE_PLAYER_UID","invalid-argument","modal","unique UID"),
             ("TERMS_NOT_ACCEPTED","failed-precondition","modal","Please accept the tournament rules to continue."),
             ("INTERNAL_ERROR","internal","modal","Something went wrong on our side"),
             (None,"functions/internal","modal","couldn't reach the registration service"),
             (None,"functions/not-found","modal","couldn't reach the registration service")]
    for reason, code, where, expect in cases:
        p = new_page(ctx, PAGES["bgmi"], mock={"submit":{"ok":False,"code":code,"reason":reason,"message":"m"}}); fill_valid(p)
        p.locator(".reg-cta:visible").click()
        if where=="field":
            p.wait_for_function("document.querySelector('#teamName').closest('.reg-field').classList.contains('reg-field--invalid')")
            txt = p.inner_text("#teamName >> xpath=../p[contains(@class,'reg-field__error')]"); open_modal = p.evaluate("document.getElementById('reg-modal-overlay').classList.contains('is-open')")
            check(f"error {reason}: inline under Team Name, no modal", expect in txt and not open_modal, txt)
        else:
            p.wait_for_selector("#reg-modal-overlay.is-open"); txt = p.inner_text("#reg-modal-message")
            check(f"error {reason or code}: mapped message", expect in txt, txt)
        if reason and reason not in ("DUPLICATE_TEAM_NAME","INVALID_TEAM_NAME"):
            check(f"error {reason}: NOT reported as a network failure", "couldn't reach" not in txt)
        label = p.locator(".reg-cta:visible").inner_text()
        check(f"error {reason or code}: button returns to 'Continue to Payment' so the user can retry", label=="Continue to Payment", label)
        p.close()

    # ---- unchanged-areas guard ----
    import hashlib
    b.close()

srv.shutdown()
bad = [r for r in results if not r[1]]
print(f"\n{len(results)-len(bad)}/{len(results)} UI checks passed")
sys.exit(1 if bad else 0)
