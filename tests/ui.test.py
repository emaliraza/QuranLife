"""UI test for Sukoon. Runs the whole app in headless Chromium many times, in both themes and two
phone widths, exercises every screen, sheet and the Recite flow, and fails on any page error,
console error (font CDN failures excluded) or horizontal overflow.
Run: python3 tests/ui.test.py [passes]
"""
import sys, os, json, random
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "file://" + os.path.join(ROOT, "www", "index.html")
PASSES = int(sys.argv[1]) if len(sys.argv) > 1 else 6
IGNORE = ("ERR_TUNNEL_CONNECTION_FAILED", "fonts.googleapis", "fonts.gstatic", "net::ERR_")

VERSE_INPUTS = {
    "14-7": ["لئن شكرتم لأزيدنكم", "لئن لأزيدنكم", "لئن شكرتم لازيدكم", "لئن شكرتم كثيرا لأزيدنكم", "hello", ""],
    "13-28": ["ألا بذكر الله تطمئن القلوب", "الا بذكر الله تطمئن", "ألا بذكر الله تطمئن الكلوب"],
    "94-5": ["فإن مع العسر يسرا إن مع العسر يسرا", "فإن مع العسر يسرا"],
}
MEANING_INPUTS = ["if you are thankful he will give you more", "the weather is nice", ""]

def run_pass(pw, n, width, scheme, seed):
    random.seed(seed)
    errors = []
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={"width": width, "height": 800}, device_scale_factor=1, color_scheme=scheme, locale="en-US")
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    pg.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" and not any(x in m.text for x in IGNORE) else None)

    def no_overflow(where):
        sw, iw = pg.evaluate("[document.scrollingElement.scrollWidth, window.innerWidth]")
        if sw > iw + 1: errors.append(f"horizontal overflow at {where}: {sw} > {iw}")

    def click(sel, where=""):
        pg.click(sel, timeout=5000); pg.wait_for_timeout(60)

    pg.goto(URL); pg.wait_for_timeout(500)
    assert pg.is_visible("#onb"), "onboarding not shown"
    pg.fill("#onbName", "Ali"); click('[data-need]'); click("#onbFinish")
    assert pg.is_hidden("#onb"), "onboarding did not close"
    no_overflow("today")

    # journal: empty save -> toast, then real save, then edit
    click("#saveEntry"); pg.wait_for_timeout(100)
    assert "Write even one word" in pg.inner_text("#toast")
    click('[data-fill="0"]'); pg.fill("#g1", "a mistake"); click("#saveEntry"); pg.wait_for_timeout(200)
    assert "done for today" in pg.inner_text("#journal")
    assert pg.inner_text("#streakNum").strip() == "1"
    click("#editEntry"); assert pg.input_value("#g1") == "a mistake"; click("#saveEntry"); pg.wait_for_timeout(150)

    # settings sheet + reminders + supporter + reset flow (cancel)
    click("#openSettings"); pg.wait_for_timeout(150)
    click("#remToggle"); pg.wait_for_timeout(100); assert pg.is_visible("#remTimes")
    pg.fill("#tMorning", "07:30"); pg.dispatch_event("#tMorning", "change")
    click("#remToggle"); assert pg.is_hidden("#remTimes")
    click("#resetAsk"); assert pg.is_visible("#resetBox"); click("#resetNo"); assert pg.is_hidden("#resetBox")
    click("#exportJ"); pg.wait_for_timeout(150)
    if pg.is_visible("textarea"):
        click("[data-close]"); pg.wait_for_timeout(80); click("#openSettings"); pg.wait_for_timeout(150)
    click("#setSupporter"); pg.wait_for_timeout(150); click("#supToggle"); pg.wait_for_timeout(150)
    assert "Supporter" in pg.inner_text("#toast")

    # Quran tab and Recite flow (typed fallback)
    click('[data-tab="quran"]'); pg.wait_for_timeout(150); no_overflow("quran")
    for f in ["hope", "gratitude", "purpose", "peace", "bm", "all"]:
        click(f'[data-qf="{f}"]')
    assert pg.locator("#qList .card").count() >= 20, "supporter preview should show all verses"
    click('[data-bm="14-7"]'); click('[data-qf="bm"]'); assert pg.locator("#qList .card").count() == 1; click('[data-qf="all"]')
    click('[data-slow="14-7"]'); pg.wait_for_timeout(200)
    for vid, inputs in VERSE_INPUTS.items():
        click(f'[data-recite="{vid}"]'); pg.wait_for_timeout(250)
        assert pg.is_visible("#rcTarget")
        # try the mic first: in headless it must fail gracefully into typing mode
        if pg.is_visible("#rcMic"):
            click("#rcMic"); pg.wait_for_timeout(700)
            if pg.is_visible("#rcMic") and "on" in (pg.get_attribute("#rcMic", "class") or ""):
                click("#rcMic"); pg.wait_for_timeout(700)
        if pg.is_hidden("#rcTyped"): click("#rcSwitch")
        assert pg.is_visible("#rcInput")
        for txt in inputs:
            pg.fill("#rcInput", txt); click("#rcCheck"); pg.wait_for_timeout(150)
            if not txt.strip():
                assert "Type the words" in pg.inner_text("#toast"); continue
            res = pg.inner_text("#rcResult"); assert "%" in res, "no score for " + txt
            html = pg.inner_html("#rcLive")
            if txt not in ("hello",) and txt != inputs[0]: assert "red-highlight" in html, "expected red words for " + txt
            if txt == inputs[0]: assert "red-highlight" not in html or vid == "94-5", "perfect input should not be red: " + html
            click("#rcAgain"); assert pg.is_hidden("#rcResult")
        # meaning mode
        click('[data-rmode="en"]'); pg.wait_for_timeout(80)
        if pg.is_hidden("#rcTyped"): click("#rcSwitch")
        for txt in MEANING_INPUTS:
            pg.fill("#rcInput", txt); click("#rcCheck"); pg.wait_for_timeout(120)
            if txt: assert "%" in pg.inner_text("#rcResult"); click("#rcAgain")
        no_overflow("recite " + vid)
        click("[data-close]"); pg.wait_for_timeout(80)
    # daily verse card recite button exists on days with a verse
    click('[data-tab="today"]'); pg.wait_for_timeout(100)
    if pg.locator("#dailyCard [data-recite]").count():
        click("#dailyCard [data-recite]"); pg.wait_for_timeout(200); assert pg.is_visible("#rcTarget"); click("[data-close]")

    # Journey
    click('[data-tab="journey"]'); pg.wait_for_timeout(150); no_overflow("journey")
    for i in range(7):
        if pg.is_visible("#jDone"):
            opts = pg.locator("[data-jopt]");
            if opts.count(): opts.nth(random.randrange(opts.count())).click()
            click("#jDone"); pg.wait_for_timeout(100)
        elif pg.is_visible("#jUnlock"):
            break
    click("#allSteps"); pg.wait_for_timeout(120); assert pg.locator("#sheetHost .step").count() == 7; click("[data-close]")
    click("#showStories"); pg.wait_for_timeout(120); click('[data-story="1"]'); pg.wait_for_timeout(120); assert "Sara" in pg.inner_text("#sheetHost"); click("[data-close]")
    picks = pg.locator("[data-pp]")
    if picks.count():
        assert pg.is_disabled("#savePlan")
        for i in range(3): picks.nth(i).click()
        picks.nth(3).click(); assert "Three is enough" in pg.inner_text("#toast")
        click("#savePlan"); pg.wait_for_timeout(100)
        assert pg.locator("[data-pd]").count() == 3
        for i in range(3): pg.locator("[data-pd]").nth(0).click(); pg.wait_for_timeout(60)
        click("#editPlan"); pg.wait_for_timeout(80); assert pg.locator("[data-pp].on").count() == 3; click("#savePlan")

    # Connect
    click('[data-tab="connect"]'); pg.wait_for_timeout(150); no_overflow("connect")
    for i in range(34): click("#tap")
    assert pg.inner_text("#tap .count").strip() == "34"
    click('[data-ph="3"]'); assert pg.inner_text("#tap .count").strip() == "0"
    click("#dhReset")
    for i in range(5): click(f'[data-pr="{i}"]')
    assert "All five" in pg.inner_text("#toast")
    click("#hardToday"); pg.wait_for_timeout(100); click("[data-close]")
    click("#howToPray"); pg.wait_for_timeout(100); assert pg.locator("#sheetHost .step").count() == 7; click("[data-close]")
    click("#farBtn"); pg.wait_for_timeout(100); assert pg.locator("#sheetHost .step").count() == 4; click("[data-close]")

    # Progress
    click('[data-tab="progress"]'); pg.wait_for_timeout(150); no_overflow("progress")
    txt = pg.inner_text("#progTop")
    assert "recitations checked" in txt and "5" in txt
    assert pg.locator("#progGrid .dot.on").count() == 1
    assert pg.locator("#milestones .mile").count() == 5

    # persistence: reload keeps everything
    pg.reload(); pg.wait_for_timeout(500)
    assert pg.is_hidden("#onb"); assert pg.inner_text("#streakNum").strip() == "1"
    click('[data-tab="connect"]'); assert "Today" in pg.inner_text("#dhTotal")

    # reset to onboarding
    click('[data-tab="today"]'); click("#openSettings"); pg.wait_for_timeout(100); click("#resetAsk"); click("#resetYes"); pg.wait_for_timeout(150)
    assert pg.is_visible("#onb")
    b.close()
    return errors

with sync_playwright() as pw:
    total = 0
    for n in range(PASSES):
        width = 320 if n % 2 else 390
        scheme = "dark" if n % 3 == 2 else "light"
        try:
            errs = run_pass(pw, n, width, scheme, n * 17 + 3)
        except Exception as e:
            errs = ["EXCEPTION: " + repr(e)]
        status = "ok" if not errs else "FAILED"
        print(f"pass {n+1}/{PASSES} width={width} {scheme}: {status}")
        for e in errs: print("   ", e)
        total += len(errs)
    print("TOTAL ERRORS:", total)
    sys.exit(1 if total else 0)
