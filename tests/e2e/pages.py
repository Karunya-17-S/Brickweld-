"""Visit every page/tab as each role; record JS errors, failed API calls, error boxes and screenshots.
Usage: python3 tests/e2e/pages.py  (shim must be running on :54321)"""
import json, os, re, sys
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:54321")
OUT = os.environ.get("OUT", "/tmp/e2e")
os.makedirs(OUT, exist_ok=True)
PW = "Test@12345"

FIN_ROUTES = (
    ["/dashboard", "/projects"]
    + ["/attendance?view=sheet", "/attendance?view=wages", "/attendance?view=month"]
    + [f"/accounts?tab={t}" for t in ["overview", "transactions", "payables", "bills", "receivables", "expenses", "capital", "cash"]]
    + [f"/materials?tab={t}" for t in ["indents", "po", "grn", "stock"]]
    + [f"/contractors?tab={t}" for t in ["wo", "bills", "payments", "balances"]]
    + [f"/masters?tab={t}" for t in ["workers", "teams", "clients", "suppliers", "contractors", "materials", "machines", "jobs", "categories"]]
    + [f"/reports?r={r}" for r in ["pnl", "receivables", "daybook", "account", "expenses", "payables", "party", "purchases", "contractor", "wages", "attendance", "materials"]]
    + [f"/audit?tab={t}" for t in ["log", "alerts", "deleted"]]
    + [f"/settings?tab={t}" for t in ["users", "company", "accounts", "me"]]
)
SUP_ROUTES = ["/attendance?view=sheet", "/attendance?view=month", "/projects", "/materials?tab=indents", "/materials?tab=grn", "/materials?tab=stock",
              "/reports?r=attendance", "/reports?r=materials"]
SUP_FORBIDDEN = ["/dashboard", "/accounts", "/contractors", "/masters", "/audit", "/settings", "/reports?r=pnl"]

results = {}

def login(page, email):
    page.goto(BASE + "/login")
    page.fill("input[type=email]", email)
    page.fill("input[type=password]", PW)
    page.get_by_role("button", name=re.compile("sign in", re.I)).click()
    page.wait_for_url(re.compile(r"/(dashboard|attendance)"), timeout=15000)
    page.wait_for_load_state("networkidle")

def run(role, email, routes, forbidden=()):
    issues = []
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        ctx = b.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        cur = {"r": "login"}
        page.on("console", lambda m: m.type == "error" and issues.append({"route": cur["r"], "kind": "console", "msg": m.text[:300]}))
        page.on("pageerror", lambda e: issues.append({"route": cur["r"], "kind": "pageerror", "msg": str(e)[:300]}))
        def on_resp(r):
            if ("/rest/v1/" in r.url or "/auth/v1/" in r.url) and r.status >= 400:
                try: body = r.text()[:300]
                except Exception: body = ""
                issues.append({"route": cur["r"], "kind": f"http {r.status}", "msg": r.url.split("/v1/")[1][:160] + " → " + body})
        page.on("response", on_resp)
        login(page, email)
        # first project detail page too
        page.goto(BASE + "/projects"); page.wait_for_load_state("networkidle")
        link = page.locator("tbody tr").first
        proj_routes = []
        if link.count():
            link.click(); page.wait_for_load_state("networkidle")
            pid = page.url.split("/projects/")[-1].split("?")[0]
            proj_routes = [f"/projects/{pid}?tab={t}" for t in ["overview", "quotations", "receipts", "labour", "materials", "contractors", "expenses", "transactions"]]
        for r in list(routes) + proj_routes:
            cur["r"] = r
            page.goto(BASE + r)
            page.wait_for_load_state("networkidle")
            page.wait_for_timeout(250)
            body = page.inner_text("body")
            if re.search(r"Something went wrong|Couldn't load|Could not load|permission", body, re.I):
                m = re.search(r".{0,80}(Something went wrong|Couldn't load|Could not load|permission).{0,120}", body, re.I | re.S)
                issues.append({"route": r, "kind": "errorbox", "msg": m.group(0).replace("\n", " ") if m else ""})
            name = re.sub(r"[^a-z0-9]+", "_", r.strip("/"))[:60] or "home"
            page.screenshot(path=f"{OUT}/{role}__{name}.png", full_page=True)
        for r in forbidden:
            cur["r"] = "forbidden " + r
            page.goto(BASE + r); page.wait_for_load_state("networkidle")
            path = page.url.replace(BASE, "")
            if path.split("?")[0] == r.split("?")[0] and "reports" not in r and "#acc" not in r:
                issues.append({"route": r, "kind": "access", "msg": f"{role} could open {r}"})
            if r == "/dashboard#acc" and re.search(r"Business dashboard|Projects at a glance|Profit on running", page.inner_text("body")):
                issues.append({"route": r, "kind": "access", "msg": f"{role} sees the MD dashboard"})
                continue
            if r == "/dashboard#acc": continue
            if "reports" in r and re.search(r"Profit & loss", page.inner_text("main") if page.locator("main").count() else page.inner_text("body")):
                issues.append({"route": r, "kind": "access", "msg": f"{role} sees P&L"})
        b.close()
    results[role] = issues

run("md", "md@bw.test", FIN_ROUTES)
run("accountant", "acc@bw.test", FIN_ROUTES, ["/dashboard#acc"])
run("supervisor", "sup@bw.test", SUP_ROUTES, SUP_FORBIDDEN)
json.dump(results, open(f"{OUT}/issues.json", "w"), indent=1)
for role, iss in results.items():
    print(f"\n== {role}: {len(iss)} issue(s)")
    seen = set()
    for i in iss:
        k = (i["kind"], i["msg"][:120])
        if k in seen: continue
        seen.add(k)
        print(f"  [{i['route']}] {i['kind']}: {i['msg']}")
