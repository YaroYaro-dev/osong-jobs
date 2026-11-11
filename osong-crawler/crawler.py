#!/usr/bin/env python3
"""
오송 유치원·어린이집 교사 채용 공고 수집기

수집 대상
  1. 충북교육청 기간제교사 인력풀 · 기간제 채용공고   (www.cbe.go.kr/mpool)
  2. 충북교육청 학교구인정보                         (www.cbe.go.kr/cbe)
  3. 충북육아종합지원센터 인력뱅크 · 구인             (chungbuk.childcare.go.kr)
  4. 고용24 오픈API (환경변수 WORK24_KEY 가 있을 때만)

결과
  out/jobs.json   수집한 공고 목록
  out/index.html  공고 목록 페이지 (template.html 기반)

사용법
  pip install -r requirements.txt
  python crawler.py                 # 기본 설정으로 실행
  python crawler.py --pages 8       # 게시판마다 8페이지까지 읽기
  python crawler.py --debug         # 받은 HTML을 out/debug/ 에 저장 (구조가 바뀌었을 때 확인용)
"""
from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import os
import re
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from urllib.parse import urlencode, urljoin

import requests
from bs4 import BeautifulSoup

# ──────────────────────────── 설정 ────────────────────────────
# 오송 공고로 볼 단어. 제목·작성자·본문·주소 중 하나에 들어 있으면 '오송'으로 분류.
OSONG_KEYWORDS = ["오송", "만수초"]

# 게시판마다 읽을 페이지 수 (한 페이지 10건 안팎)
DEFAULT_PAGES = 5

# 요청 사이 쉬는 시간(초). 기관 서버에 부담을 주지 않도록 1초 이상 권장.
DELAY = 1.2

USER_AGENT = (
    "Mozilla/5.0 (compatible; osong-job-collector/1.0; personal use)"
)

CBE_MPOOL_LIST = "https://www.cbe.go.kr/mpool/na/ntt/selectNttList.do"
CBE_MPOOL_VIEW = "https://www.cbe.go.kr/mpool/na/ntt/selectNttInfo.do"
CBE_SCHOOL_LIST = "https://www.cbe.go.kr/cbe/na/ntt/selectNttList.do"
CBE_SCHOOL_VIEW = "https://www.cbe.go.kr/cbe/na/ntt/selectNttInfo.do"
CB_CHILD_LIST = "https://chungbuk.childcare.go.kr/ccef/job/JobOfferSlPL.jsp"
CB_CHILD_VIEW = "https://chungbuk.childcare.go.kr/ccef/job/JobOfferSl.jsp"

# 고용24 오픈API. 인증키를 받은 뒤 '서비스 명세'에 적힌 주소·파라미터 이름과
# 맞는지 꼭 확인하고, 다르면 아래 값을 고치세요.
WORK24_URL = os.environ.get(
    "WORK24_URL",
    "https://www.work24.go.kr/cm/openApi/call/wk/callOpenApiSvcInfo210L01.do",
)
WORK24_PARAMS = {
    "callTp": "L",
    "returnType": "XML",
    "startPage": "1",
    "display": "100",
    "region": "43113",          # 충북 청주시 흥덕구 (지역코드는 명세서의 코드표로 확인)
    "keyword": "보육교사",
}
WORK24_KEYWORDS = ["보육교사", "유치원교사", "어린이집", "어린이집 간호조무사", "어린이집 간호사"]

# 어린이집 간호사·간호조무사 공고는 드물어서 흥덕구가 아니라 청주시 전체에서 모은다.
NURSE_AREA = "청주"

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "out"
TODAY = dt.date.today()


# ──────────────────────────── 데이터 ────────────────────────────
@dataclass
class Job:
    title: str
    org: str
    type: str                  # 유치원 / 어린이집 / 어린이집 간호
    area: str                  # 오송 / 인근 청주
    src: str
    url: str
    posted: str = ""           # YYYY-MM-DD
    deadline: str = ""         # YYYY-MM-DD
    role: str = ""
    memo: str = ""
    key: str = field(default="", repr=False)

    def finish(self) -> "Job":
        self.key = self.key or f"{self.src}|{self.url}|{self.title}"
        return self


# ──────────────────────────── HTTP ────────────────────────────
class Fetcher:
    def __init__(self, debug: bool = False):
        self.s = requests.Session()
        self.s.headers.update({"User-Agent": USER_AGENT, "Accept-Language": "ko-KR,ko;q=0.9"})
        self.debug = debug
        self.n = 0

    def get(self, url: str, params: dict | None = None) -> str:
        time.sleep(DELAY)
        r = self.s.get(url, params=params, timeout=20)
        r.raise_for_status()
        if not r.encoding or r.encoding.lower() == "iso-8859-1":
            r.encoding = r.apparent_encoding
        text = r.text
        if self.debug:
            self.n += 1
            d = OUT / "debug"
            d.mkdir(parents=True, exist_ok=True)
            (d / f"{self.n:03d}.html").write_text(f"<!-- {r.url} -->\n{text}", encoding="utf-8")
        return text


# ──────────────────────────── 파싱 도우미 ────────────────────────────
def clean(s: str) -> str:
    s = html.unescape(s or "")
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"^(새글\s*)?N\s+", "", s)          # '새글 N' 표시 제거
    return s.replace("새글 ", "").strip()


def norm_date(s: str, base_year: int | None = None) -> str:
    """'2026.11.06.' '2026-11-06' '2026/11/06' '2026. 9. 4.' '9. 8.' → 'YYYY-MM-DD'"""
    s = s or ""
    m = re.search(r"(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})", s)
    m2 = re.search(r"(?<!\d)(\d{2})-(\d{2})-(\d{2})(?!\d)", s)   # 고용24 '26-11-30'
    if m:
        y, mo, d = map(int, m.groups())
    elif m2:
        y, mo, d = map(int, m2.groups())
        y += 2000
    else:
        m = re.search(r"(?<!\d)(\d{1,2})\s*[.\-/월]\s*(\d{1,2})(?!\d)", s)
        if not m or not base_year:
            return ""
        y, (mo, d) = base_year, map(int, m.groups())
    try:
        return dt.date(y, mo, d).isoformat()
    except ValueError:
        return ""


def find_table_rows(soup: BeautifulSoup, must_have: list[str]) -> list[dict]:
    """헤더에 must_have 단어가 모두 있는 표를 찾아, 행마다 {헤더: 셀} 사전을 돌려준다.
    각 행에는 '_links' (href·onclick 목록)도 붙인다."""
    for table in soup.find_all("table"):
        heads = [clean(th.get_text()) for th in table.find_all("th")]
        if not heads or not all(any(w in h for h in heads) for w in must_have):
            continue
        rows = []
        body = table.find("tbody") or table
        for tr in body.find_all("tr"):
            tds = tr.find_all("td")
            if len(tds) < len(must_have):
                continue
            row = {}
            for i, td in enumerate(tds):
                name = heads[i] if i < len(heads) else f"col{i}"
                row[name] = clean(td.get_text(" "))
            links = []
            for a in tr.find_all(["a", "button"]):
                links.append((a.get("href") or "") + " " + (a.get("onclick") or ""))
            row["_links"] = links
            row["_html"] = str(tr)
            rows.append(row)
        return rows
    return []


def col(row: dict, *names: str) -> str:
    for n in names:
        for k, v in row.items():
            if not k.startswith("_") and n in k:
                return v
    return ""


def link_id(row: dict, key: str) -> str:
    """행 안의 링크에서 게시물 번호(nttSn, JOSEQ 등)를 찾는다."""
    blob = " ".join(row.get("_links", [])) + " " + row.get("_html", "")
    m = re.search(rf"{key}=(\d+)", blob)
    if m:
        return m.group(1)
    # onclick="fn_view('1578587')" 같은 형태
    m = re.search(r"\(\s*['\"]?(\d{6,})['\"]?", blob)
    return m.group(1) if m else ""


def is_osong(*texts: str) -> bool:
    t = " ".join(texts)
    return any(k in t for k in OSONG_KEYWORDS)


def detail_text(page_html: str) -> str:
    soup = BeautifulSoup(page_html, "html.parser")
    for tag in soup(["script", "style", "nav", "header", "footer"]):
        tag.decompose()
    return clean(soup.get_text(" "))


def extract_period(text: str, label_words=("접수기간", "접수 기간", "서류접수", "서류 접수", "공고 및 접수", "모집기간", "모집 기간")) -> str:
    """본문에서 접수 마감일을 찾는다. '접수기간: 2026. 9. 4.(금) ~ 9. 8.(화)' → 2026-09-08"""
    for w in label_words:
        i = text.find(w)
        if i < 0:
            continue
        seg = text[i:i + 120]
        parts = re.split(r"[~∼]|부터", seg, maxsplit=1)
        if len(parts) == 2:
            left, right = parts
            start = norm_date(left)
            year = int(start[:4]) if start else TODAY.year
            end = norm_date(right[:40], base_year=year)
            if end:
                return end
        d = norm_date(seg)
        if d:
            return d
    return ""


def extract_work_period(text: str) -> str:
    for w in ("채용기간", "채용 기간", "계약기간", "계약 기간", "근무기간", "근무 기간"):
        i = text.find(w)
        if i >= 0:
            return clean(text[i:i + 60]).split("※")[0][:60]
    return ""


# ──────────────────────────── 1·2. 충북교육청 ────────────────────────────
def crawl_cbe(f: Fetcher, pages: int, board: str) -> list[Job]:
    if board == "mpool":
        list_url, view_url, params, src = CBE_MPOOL_LIST, CBE_MPOOL_VIEW, {"mi": "12127", "bbsId": "1091"}, "충북교육청 기간제교사 인력풀"
    else:
        list_url, view_url, params, src = CBE_SCHOOL_LIST, CBE_SCHOOL_VIEW, {"mi": "11716", "bbsId": "1798"}, "충북교육청 학교구인정보"

    jobs, seen = [], set()
    for p in range(1, pages + 1):
        try:
            page = f.get(list_url, {**params, "pageIndex": p})
        except Exception as e:
            print(f"  ! {src} {p}페이지 실패: {e}", file=sys.stderr)
            break
        rows = find_table_rows(BeautifulSoup(page, "html.parser"), ["제목", "등록일"])
        if not rows:
            print(f"  ! {src}: 목록 표를 찾지 못함 (--debug 로 HTML 확인)", file=sys.stderr)
            break
        new = 0
        for r in rows:
            title, writer = col(r, "제목"), col(r, "작성자")
            kind, region = col(r, "구분", "분류"), col(r, "지역")
            if "유치원" not in (kind + title + writer):
                continue
            if region and "청주" not in region:
                continue
            ntt = link_id(r, "nttSn")
            uid = ntt or title
            if uid in seen:
                continue
            seen.add(uid)
            new += 1
            url = f"{view_url}?{urlencode({'nttSn': ntt, 'mi': params['mi']})}" if ntt else f"{list_url}?{urlencode(params)}"
            posted = norm_date(col(r, "등록일"))
            deadline = norm_date(col(r, "마감일"))
            role, memo, body = "", "", ""
            # 오송 여부가 제목·작성자로 안 드러나면 본문까지 확인
            if ntt:
                try:
                    body = detail_text(f.get(view_url, {"nttSn": ntt, "mi": params["mi"]}))
                except Exception as e:
                    print(f"  ! 상세 실패 {ntt}: {e}", file=sys.stderr)
            if body:
                deadline = deadline or extract_period(body)
                memo = extract_work_period(body)
            osong = is_osong(title, writer, body)
            jobs.append(Job(
                title=title, org=writer or "", type="유치원",
                area="오송" if osong else "인근 청주", src=src, url=url,
                posted=posted, deadline=deadline, role=role, memo=memo,
            ).finish())
        if new == 0 and p > 1:
            break
    return jobs


# ──────────────────────────── 3. 충북육아종합지원센터 ────────────────────────────
def crawl_childcare(f: Fetcher, pages: int) -> list[Job]:
    src = "충북육아종합지원센터 인력뱅크"
    jobs, seen = [], set()
    for p in range(1, pages + 1):
        params = {"flag": "SlPL", "offset": (p - 1) * 10, "pageIndex": p}
        try:
            page = f.get(CB_CHILD_LIST, params)
        except Exception as e:
            print(f"  ! {src} {p}페이지 실패: {e}", file=sys.stderr)
            break
        rows = find_table_rows(BeautifulSoup(page, "html.parser"), ["제목", "소재지"])
        if not rows:
            print(f"  ! {src}: 목록 표를 찾지 못함 (--debug 로 HTML 확인)", file=sys.stderr)
            break
        new = 0
        for r in rows:
            loc = col(r, "소재지")
            nurse = "간호" in (col(r, "직종") + col(r, "제목"))
            if nurse:
                if NURSE_AREA not in loc and "오송" not in loc:
                    continue
            elif "흥덕구" not in loc and "오송" not in loc:
                continue
            seq = link_id(r, "JOSEQ")
            uid = seq or (col(r, "제목") + col(r, "어린이집"))
            if uid in seen:
                continue
            seen.add(uid)
            new += 1
            url = f"{CB_CHILD_VIEW}?{urlencode({'flag': 'Sl', 'JOSEQ': seq})}" if seq else f"{CB_CHILD_LIST}?flag=SlPL"
            body = ""
            if seq:
                try:
                    body = detail_text(f.get(CB_CHILD_VIEW, {"flag": "Sl", "JOSEQ": seq}))
                except Exception as e:
                    print(f"  ! 상세 실패 {seq}: {e}", file=sys.stderr)
            org = col(r, "어린이집")
            jobs.append(Job(
                title=col(r, "제목"), org=org, type="어린이집 간호" if nurse else "어린이집",
                area="오송" if is_osong(org, loc, body) else "인근 청주",
                src=src, url=url,
                posted=norm_date(col(r, "작성일", "등록일")),
                deadline=norm_date(col(r, "마감일")),
                role=" · ".join(x for x in [col(r, "직종"), col(r, "유형")] if x),
            ).finish())
        if new == 0 and p > 1:
            break
    return jobs


# ──────────────────────────── 4. 고용24 오픈API ────────────────────────────
def crawl_work24(f: Fetcher) -> list[Job]:
    key = os.environ.get("WORK24_KEY", "").strip()
    if not key:
        print("  - 고용24: WORK24_KEY 가 없어 건너뜀")
        return []
    jobs, seen = [], set()
    for kw in WORK24_KEYWORDS:
        try:
            xml = f.get(WORK24_URL, {**WORK24_PARAMS, "authKey": key, "keyword": kw})
        except Exception as e:
            print(f"  ! 고용24 실패: {e}", file=sys.stderr)
            continue
        soup = BeautifulSoup(xml, "xml")
        err = soup.find(["error", "errMsg", "message"])
        items = soup.find_all("wanted")
        if not items:
            print(f"  ! 고용24 '{kw}': 결과 없음 또는 형식이 다름 ({clean(err.get_text()) if err else '응답 확인 필요'})", file=sys.stderr)
            continue

        def g(it, *names):
            for n in names:
                t = it.find(n)
                if t and t.get_text(strip=True):
                    return clean(t.get_text())
            return ""

        for it in items:
            title = g(it, "title", "wantedTitle")
            org = g(it, "company", "busplaName", "corpNm")
            region = g(it, "region", "basicAddr", "workRegion")
            uid = g(it, "wantedAuthNo") or title + org
            if uid in seen:
                continue
            seen.add(uid)
            blob = title + org
            daycare = "어린이집" in blob
            if "간호" in title:
                if not daycare:
                    continue          # 병원 간호조무사 공고는 제외
                kind = "어린이집 간호"
            elif "유치원" in blob:
                kind = "유치원"
            else:
                kind = "어린이집"
            jobs.append(Job(
                title=title, org=org, type=kind,
                area="오송" if is_osong(region, title, org) else "인근 청주",
                src="고용24", url=g(it, "wantedInfoUrl", "wantedMobileInfoUrl") or "https://www.work24.go.kr",
                posted=norm_date(g(it, "regDt")),
                deadline=norm_date(g(it, "closeDt")),
                role=" · ".join(x for x in [g(it, "sal", "salTpNm"), g(it, "career")] if x),
                memo=region,
            ).finish())
    return jobs


# ──────────────────────────── 저장 ────────────────────────────
def merge_history(new: list[Job]) -> list[dict]:
    """지난번 jobs.json 과 합친다. 게시판에서 밀려난 공고도 기록으로 남긴다(60일)."""
    path = OUT / "jobs.json"
    old = []
    if path.exists():
        try:
            old = json.loads(path.read_text(encoding="utf-8")).get("jobs", [])
        except Exception:
            old = []
    by_key = {j["key"]: j for j in old if j.get("key")}
    for j in new:
        d = asdict(j)
        d["first_seen"] = by_key.get(j.key, {}).get("first_seen", TODAY.isoformat())
        d["last_seen"] = TODAY.isoformat()
        by_key[j.key] = d
    cutoff = (TODAY - dt.timedelta(days=60)).isoformat()
    return [j for j in by_key.values() if j.get("last_seen", "") >= cutoff]


def write_outputs(jobs: list[dict]) -> None:
    OUT.mkdir(exist_ok=True)
    payload = {"updated": dt.datetime.now().strftime("%Y-%m-%d %H:%M"), "jobs": jobs}
    (OUT / "jobs.json").write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    tpl = (ROOT / "template.html").read_text(encoding="utf-8")
    data = json.dumps(payload, ensure_ascii=False).replace("</", "<\\/")
    (OUT / "index.html").write_text(tpl.replace("/*__DATA__*/null", data), encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pages", type=int, default=DEFAULT_PAGES)
    ap.add_argument("--debug", action="store_true")
    ap.add_argument("--only", choices=["mpool", "school", "childcare", "work24"])
    a = ap.parse_args()

    f = Fetcher(debug=a.debug)
    steps = {
        "mpool": lambda: crawl_cbe(f, a.pages, "mpool"),
        "school": lambda: crawl_cbe(f, a.pages, "school"),
        "childcare": lambda: crawl_childcare(f, a.pages),
        "work24": lambda: crawl_work24(f),
    }
    found: list[Job] = []
    for name, fn in steps.items():
        if a.only and name != a.only:
            continue
        print(f"▶ {name}")
        try:
            got = fn()
        except Exception as e:
            print(f"  ! {name} 전체 실패: {e}", file=sys.stderr)
            got = []
        osong = sum(1 for j in got if j.area == "오송")
        print(f"  {len(got)}건 (오송 {osong}건)")
        found += got

    jobs = merge_history(found)
    write_outputs(jobs)
    print(f"✔ 저장: {OUT/'jobs.json'} · {OUT/'index.html'} (누적 {len(jobs)}건)")


if __name__ == "__main__":
    main()
