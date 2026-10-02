"""Reddit lead finder for Video Production Plus.

Searches chosen subreddits for people asking for a video editor, skips
editors advertising themselves, and saves everything to leads.json,
which the dashboard page (index.html) reads.
"""
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

# ---- Edit these to tune what gets found ------------------------------------
COMMUNITIES = {
    "Business": [
        "Entrepreneur", "smallbusiness", "startups", "ecommerce",
        "shopify", "marketing", "DigitalMarketing", "agency",
    ],
    "Creators": [
        "VideoEditing", "NewTubers", "SmallYoutubers", "youtubers",
        "content_creators", "PartneredYoutube", "podcasting",
    ],
    "Hiring boards": ["forhire", "hiring"],
}
QUERIES = [
    "looking for video editor",
    "need a video editor",
    "hiring video editor",
    "where to find video editor",
    "recommend video editor",
    "hire editor",
]
MAX_LEADS_KEPT = 500
# ----------------------------------------------------------------------------

UA = "Mozilla/5.0 (compatible; VPPLeadFinder/1.0; personal lead monitoring)"
ATOM = "{http://www.w3.org/2005/Atom}"
DATA_FILE = Path("leads.json")

# Someone asking for an editor
WANT = re.compile(
    r"(looking for|need|needs|hiring|hire|want|seeking|where (can|do|to)|recommend|find)"
    r"[^.\n]{0,60}(editors?\b|video editing)",
    re.I,
)
# Hiring for other roles (sales, developers...) is not a lead
OTHER_ROLE = re.compile(
    r"\b(sales|closer|setter|lead gen|appointment|sdr|developer|programmer|partner|acquisition)\b",
    re.I,
)
# Someone offering their own editing services (not a lead)
OFFER = re.compile(
    r"\[\s*for ?hire\s*\]|\bfor hire\b|\bi('m| am) a (freelance |professional )?video editor",
    re.I,
)


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read()


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
    if OFFER.search(post["title"]) or OTHER_ROLE.search(post["title"]):
        return False
    return bool(WANT.search(post["title"] + " " + post["body"][:500]))


def load_existing():
    if DATA_FILE.exists():
        try:
            return {l["link"]: l for l in json.loads(DATA_FILE.read_text()).get("leads", [])}
        except Exception:
            pass
    return {}


def main():
    existing = load_existing()
    # Drop earlier matches that the stricter filter would now reject
    existing = {k: v for k, v in existing.items() if not OTHER_ROLE.search(v["title"])}
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    found = {}
    ok = 0
    failed = 0
    errors = {}

    for group, subs in COMMUNITIES.items():
        for sub in subs:
            for q in QUERIES:
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
                except Exception as exc:  # keep going if one feed fails
                    failed += 1
                    errors[str(exc)[:80]] = errors.get(str(exc)[:80], 0) + 1
                    print(f"Skipped r/{sub} '{q}': {exc}")
                time.sleep(2)  # be polite to Reddit

    if ok == 0:
        print("Every request failed. Reddit may be blocking this server.")
        sys.exit(1)

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
    stats = {"searches_ok": ok, "searches_failed": failed, "errors": errors}
    DATA_FILE.write_text(
        json.dumps({"updated": now, "stats": stats, "leads": leads}, indent=1), encoding="utf-8"
    )
    print(f"{ok} searches worked, {failed} failed, {len(found)} matching posts, {added} new, {len(leads)} saved.")


if __name__ == "__main__":
    main()
