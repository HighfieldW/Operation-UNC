"""Reddit lead finder for Video Production Plus.

Searches chosen subreddits for people asking for a video editor, skips
editors advertising themselves, and saves everything to leads.json,
which the dashboard page (index.html) reads.

Reddit throttles automated visitors, so this works gently: it does a
small batch of searches per run, pauses between them, waits and retries
when Reddit says "slow down", and remembers where it stopped so the next
run carries on from there. Each run also has a time budget, so it always
finishes and saves its progress.
"""
import html
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

# ---- Edit these to tune what gets found ------------------------------------
# Each group has its own communities and its own, more specific phrases.
GROUPS = {
    "Business": {
        "communities": [
            "Entrepreneur", "smallbusiness", "startups", "ecommerce",
            "shopify", "marketing", "DigitalMarketing", "agency",
        ],
        "queries": [
            "looking for a video editor",
            "need a video editor for my business",
            "hire a video editor retainer",
            "how do you find reliable video editors",
            "video editor for my agency",
        ],
    },
    "Creators": {
        "communities": [
            "VideoEditing", "NewTubers", "SmallYoutubers", "youtubers",
            "content_creators", "PartneredYoutube", "podcasting",
        ],
        "queries": [
            "looking for a video editor youtube",
            "need an editor for my channel",
            "hire a video editor for my podcast",
            "where do you find video editors",
            "paying video editor",
        ],
    },
    "Hiring boards": {
        "communities": ["forhire", "hiring"],
        "queries": [
            "[hiring] video editor",
            "hiring a video editor",
            "looking for a video editor",
            "video editor needed paid",
            "long term video editor",
        ],
    },
}
BATCH_SIZE = 30          # most searches per run (the workflow runs every hour)
PAUSE_SECONDS = 20       # wait between searches
MAX_RETRIES = 2          # tries per search when Reddit says "slow down"
MAX_WAIT = 120           # longest single wait, in seconds
MAX_SLOWDOWNS = 4        # after this many "slow down" replies, rest until the next run
TIME_BUDGET = 20 * 60    # stop starting new searches after this many seconds
MAX_LEADS_KEPT = 500
# ----------------------------------------------------------------------------

UA = "Mozilla/5.0 (compatible; VPPLeadFinder/1.0; personal lead monitoring)"
ATOM = "{http://www.w3.org/2005/Atom}"
DATA_FILE = Path("leads.json")
STATE = {"slowdowns": 0}

# The TITLE must show someone wanting to hire or find an editor
WANT = re.compile(
    r"(looking for|looking to hire|need|needs|needed|hiring|hire|seeking|wanted|"
    r"where (can|do|to|should)|how (do|can|to|should)[^?.]{0,40}(find|hire)|recommend\w*)"
    r"[^.\n?]{0,60}\b(editors?|video editing|editing services)\b",
    re.I,
)
# Titles that are about something else: other roles, software, tutorials, feedback...
OTHER_ROLE = re.compile(
    r"\b(sales|closer|setter|lead gen|appointment|sdr|developer|programmer|partner|acquisition|"
    r"software|apps?|plugins?|premiere|davinci|capcut|final cut|after effects|tutorial|course|"
    r"learn|laptop|pc|computer|gpu|monitor|cpm|rpm|feedback|critique|review my|rate my|"
    r"help me edit|how to edit|tips)\b",
    re.I,
)
# Someone offering their own editing services or seeking work (not a lead)
OFFER = re.compile(
    r"\[\s*for ?hire\s*\]|\bfor hire\b|\bi('m| am) a (freelance |professional )?video editor|"
    r"looking for (work|clients|projects|gigs|opportunities)|seeking (work|clients)|"
    r"available for (hire|work|projects)|\bportfolio\b|\bdm (me )?for rates\b",
    re.I,
)


class RateLimited(Exception):
    """Reddit kept saying 'slow down' even after waiting."""


def fetch(url):
    for attempt in range(1, MAX_RETRIES + 1):
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                return resp.read()
        except urllib.error.HTTPError as exc:
            if exc.code != 429:
                raise
            STATE["slowdowns"] += 1
            if attempt == MAX_RETRIES:
                break
            header = exc.headers.get("Retry-After") if exc.headers else None
            wait = int(header) if header and header.isdigit() else 60 * attempt
            wait = min(wait, MAX_WAIT)
            print(f"Reddit said slow down (429). Waiting {wait}s (try {attempt}/{MAX_RETRIES})...")
            time.sleep(wait)
    raise RateLimited()


def clean(text):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html.unescape(text or ""))).strip()


def parse_feed(raw):
    root = ET.fromstring(raw)
    for entry in root.findall(ATOM + "entry"):
        link = entry.find(ATOM + "link")
        yield {
            "title": clean(entry.findtext(ATOM + "title")),
            "link": link.get("href") if link is not None else "",
            "posted": entry.findtext(ATOM + "updated") or "",
            "body": clean(entry.findtext(ATOM + "content")),
        }


def is_lead(post):
    title = post["title"]
    if OFFER.search(title) or OTHER_ROLE.search(title):
        return False
    return bool(WANT.search(title))


def build_queue():
    """Every (group, subreddit, phrase) to search, mixed so each batch spreads across communities."""
    queue = []
    rounds = max(len(g["queries"]) for g in GROUPS.values())
    for i in range(rounds):
        for name, g in GROUPS.items():
            if i < len(g["queries"]):
                for sub in g["communities"]:
                    queue.append((name, sub, g["queries"][i]))
    return queue


def load_data():
    if DATA_FILE.exists():
        try:
            return json.loads(DATA_FILE.read_text())
        except Exception:
            pass
    return {}


def main():
    started = time.monotonic()
    STATE["slowdowns"] = 0
    data = load_data()
    existing = {l["link"]: l for l in data.get("leads", [])}
    # Drop earlier matches that the stricter filter would now reject
    existing = {k: v for k, v in existing.items() if is_lead({"title": v["title"]})}
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")

    queue = build_queue()
    total = len(queue)
    cursor = data.get("cursor", 0) % total
    stuck = data.get("stuck", 0)

    found = {}
    ok = failed = steps = 0
    refused = cooldown = out_of_time = False
    errors = {}

    while steps < BATCH_SIZE:
        if time.monotonic() - started > TIME_BUDGET:
            out_of_time = True
            break
        group, sub, q = queue[(cursor + steps) % total]
        url = (
            f"https://www.reddit.com/r/{sub}/search.rss?"
            f"q={urllib.parse.quote(q)}&restrict_sr=on&sort=new&t=week"
        )
        try:
            for post in parse_feed(fetch(url)):
                if post["link"] and is_lead(post):
                    post.update(sub=sub, group=group)
                    found[post["link"]] = post
            ok += 1
        except RateLimited:
            refused = True
            break  # stop here; the next run resumes from this search
        except Exception as exc:  # any other problem: note it and move on
            failed += 1
            key = str(exc)[:80]
            errors[key] = errors.get(key, 0) + 1
            print(f"Skipped r/{sub} '{q}': {exc}")
        steps += 1
        if STATE["slowdowns"] >= MAX_SLOWDOWNS:
            cooldown = True  # Reddit keeps pushing back; rest until the next run
            break
        if steps < BATCH_SIZE:
            time.sleep(PAUSE_SECONDS)

    if refused:
        stuck += 1
        if stuck >= 3:  # a search refused three runs in a row gets skipped
            steps += 1
            stuck = 0
    else:
        stuck = 0
    cursor = (cursor + steps) % total

    added = 0
    for link, p in found.items():
        if link not in existing:
            existing[link] = {
                "link": link,
                "platform": "Reddit",
                "title": p["title"],
                "community": f"r/{p['sub']}",
                "group": p["group"],
                "posted": p["posted"],
                "snippet": p["body"][:300] + ("..." if len(p["body"]) > 300 else ""),
                "found": now,
            }
            added += 1

    leads = sorted(existing.values(), key=lambda l: l["posted"], reverse=True)[:MAX_LEADS_KEPT]
    stats = {
        "searches_ok": ok,
        "searches_failed": failed,
        "rate_limited": refused or cooldown,
        "out_of_time": out_of_time,
        "queue_size": total,
        "errors": errors,
    }
    DATA_FILE.write_text(
        json.dumps(
            {"updated": now, "stats": stats, "cursor": cursor, "stuck": stuck, "leads": leads},
            indent=1,
        ),
        encoding="utf-8",
    )
    print(
        f"{ok} searches worked, {failed} failed, rate limited: {refused or cooldown}, "
        f"out of time: {out_of_time}, {len(found)} matching posts, {added} new, "
        f"{len(leads)} saved. Next start: {cursor}/{total}."
    )


if __name__ == "__main__":
    main()
