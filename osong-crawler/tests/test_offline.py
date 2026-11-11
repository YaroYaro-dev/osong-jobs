"""실제 사이트 없이 파서를 확인하는 테스트. 표 구조는 각 게시판 목록 형태를 흉내 낸 것.
실행: python -m pytest -q tests   (또는 python tests/test_offline.py)"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import crawler as C  # noqa: E402

C.DELAY = 0

MPOOL_LIST = """<table><thead><tr><th>번호</th><th>지역</th><th>구분</th><th>제목</th><th>작성자</th><th>등록일</th><th>조회수</th></tr></thead>
<tbody>
<tr><td>16130</td><td>청주</td><td>유치원</td><td><a href="./selectNttInfo.do?nttSn=1578587&amp;mi=12127">새글 N 오송유치원 기간제교사 채용 공고</a></td><td>전은정</td><td>2026.09.03.</td><td>10</td></tr>
<tr><td>16129</td><td>청주</td><td>유치원</td><td><a href="#" onclick="fn_view('1579999'); return false;">2026. 개신초병설유치원 방과후 강사 채용</a></td><td>개신초등학교</td><td>2026.11.06.</td><td>5</td></tr>
<tr><td>16128</td><td>충주</td><td>유치원</td><td><a href="./selectNttInfo.do?nttSn=1570001">충주 공고</a></td><td>충주</td><td>2026.11.06.</td><td>1</td></tr>
<tr><td>16127</td><td>청주</td><td>중등</td><td><a href="./selectNttInfo.do?nttSn=1570002">오송중학교 기간제</a></td><td>오송중학교</td><td>2026.11.06.</td><td>1</td></tr>
</tbody></table>"""

MPOOL_VIEW_OSONG = """<div class="view">기간제교사 채용 공고 1. 채용분야 및 기간 - 채용분야: 기간제교사 1명 - 채용기간: 2026. 10. 1. ~ 12. 29. (3개월)
접수기간: 2026. 9. 4.(금) ~ 9. 8.(화), 16:30 도착분까지 문의: 오송유치원 연구실 043-235-8508</div>"""
MPOOL_VIEW_OTHER = """<div>공고 및 접수기간: 2026. 11. 6.(금) ~ 11. 12.(목) 접수처: 개신초 교무실</div>"""

SCHOOL_LIST = """<table><tr><th>번호</th><th>분류</th><th>제목</th><th>작성자</th><th>등록일</th><th>마감일</th><th>조회수</th></tr>
<tr><td>14848</td><td>유치원</td><td><a href="selectNttInfo.do?nttSn=1600001&amp;mi=11716">2026학년도 오송솔미유치원 겨울방학 중 방과후과정 강사 채용 공고(2차)</a></td><td>오송솔미유치원</td><td>2026.11.06.</td><td>2026/11/27</td><td>209</td></tr>
<tr><td>14820</td><td>중등학교</td><td><a href="selectNttInfo.do?nttSn=1600002">청주대성고 대체인력</a></td><td>청주대성고등학교</td><td>2026.10.29.</td><td>2026/11/09</td><td>225</td></tr>
</table>"""

CHILD_LIST = """<table><caption>어린이집 구인 목록</caption><thead><tr><th>번호</th><th>유형</th><th>제목</th><th>어린이집명</th><th>직종</th><th>소재지</th><th>마감일</th><th>작성일</th><th>조회</th></tr></thead><tbody>
<tr><td>148</td><td>가정</td><td><a href="JobOfferSl.jsp?flag=Sl&amp;JOSEQ=1259144">0세반 교사 모십니다 (반증원)</a></td><td>코코어린이집</td><td>보육교사</td><td>충청북도 청주시 흥덕구</td><td>2026-11-30</td><td>2026-11-08</td><td>13</td></tr>
<tr><td>149</td><td>직장</td><td><a href="JobOfferSl.jsp?flag=Sl&amp;JOSEQ=1259200">간호사(간호조무사 가능) 모집</a></td><td>LG청주어린이집</td><td>간호사</td><td>충청북도 청주시 상당구</td><td>2026-11-30</td><td>2026-11-08</td><td>3</td></tr>
<tr><td>147</td><td>민간</td><td><a href="JobOfferSl.jsp?flag=Sl&amp;JOSEQ=1259145">0세반 담임교사</a></td><td>칸타빌키즈어린이집</td><td>보육교사</td><td>충청북도 청주시 청원구</td><td>2026-11-30</td><td>2026-11-08</td><td>13</td></tr>
</tbody></table>"""
CHILD_VIEW = "<div>소재지: 충청북도 청주시 흥덕구 오송읍 오송생명14로 217</div>"

WORK24_XML = """<?xml version="1.0" encoding="UTF-8"?><wantedRoot><total>1</total>
<wanted><wantedAuthNo>K2</wantedAuthNo><company>청주내과의원</company><title>간호조무사 모집</title><region>충북 청주시</region></wanted>
<wanted><wantedAuthNo>K3</wantedAuthNo><company>국공립 햇살어린이집</company><title>어린이집 간호조무사 채용</title><region>충북 청주시 흥덕구 오송읍</region><closeDt>26-12-05</closeDt></wanted>
<wanted><wantedAuthNo>K1</wantedAuthNo><company>동아어린이집</company><title>만1세반 담임교사 모집</title><sal>월급 231만원</sal>
<region>충북 청주시 흥덕구 오송읍</region><regDt>26-11-05</regDt><closeDt>26-11-30</closeDt><wantedInfoUrl>https://www.work24.go.kr/x</wantedInfoUrl></wanted></wantedRoot>"""


class FakeFetcher:
    def get(self, url, params=None):
        p = params or {}
        if "mpool" in url and "List" in url:
            return MPOOL_LIST if p.get("pageIndex") == 1 else MPOOL_LIST
        if "mpool" in url and "Info" in url:
            return MPOOL_VIEW_OSONG if p.get("nttSn") == "1578587" else MPOOL_VIEW_OTHER
        if "/cbe/na/ntt/selectNttList" in url:
            return SCHOOL_LIST
        if "/cbe/na/ntt/selectNttInfo" in url:
            return "<div>접수기간: 2026. 11. 6. ~ 11. 27.</div>"
        if "JobOfferSlPL" in url:
            return CHILD_LIST
        if "JobOfferSl.jsp" in url:
            return CHILD_VIEW if p.get("JOSEQ") == "1259144" else "<div>청원구</div>"
        if "work24" in url:
            return WORK24_XML
        raise AssertionError(url)


def test_dates():
    assert C.norm_date("2026.11.06.") == "2026-11-06"
    assert C.norm_date("2026/11/27") == "2026-11-27"
    assert C.norm_date("9. 8.(화)", base_year=2026) == "2026-09-08"
    assert C.extract_period("접수기간: 2026. 9. 4.(금) ~ 9. 8.(화), 16:30") == "2026-09-08"
    assert C.extract_period("공고 및 접수기간: 2025. 12. 29. ~ 2026. 1. 2.") == "2026-01-02"


def test_mpool():
    jobs = C.crawl_cbe(FakeFetcher(), 2, "mpool")
    by = {j.org: j for j in jobs}
    assert set(by) == {"전은정", "개신초등학교"}          # 충주·중등 제외
    osong = by["전은정"]
    assert osong.area == "오송" and osong.deadline == "2026-09-08" and "nttSn=1578587" in osong.url
    assert by["개신초등학교"].area == "인근 청주" and "nttSn=1579999" in by["개신초등학교"].url
    assert "새글" not in osong.title


def test_school_board():
    jobs = C.crawl_cbe(FakeFetcher(), 1, "school")
    assert len(jobs) == 1 and jobs[0].area == "오송" and jobs[0].deadline == "2026-11-27"


def test_childcare():
    jobs = C.crawl_childcare(FakeFetcher(), 1)
    assert len(jobs) == 2                                   # 청원구 보육교사 제외, 상당구 간호 포함
    nurse = [j for j in jobs if j.type == "어린이집 간호"]
    assert len(nurse) == 1 and nurse[0].org == "LG청주어린이집" and nurse[0].area == "인근 청주"
    j = [j for j in jobs if j.type == "어린이집"][0]
    assert j.org == "코코어린이집" and j.area == "오송" and "JOSEQ=1259144" in j.url


def test_work24(monkeypatch=None):
    import os
    os.environ["WORK24_KEY"] = "dummy"
    C.WORK24_KEYWORDS = ["보육교사"]
    jobs = C.crawl_work24(FakeFetcher())
    by = {j.org: j for j in jobs}
    assert "청주내과의원" not in by                          # 병원 간호조무사 제외
    assert by["국공립 햇살어린이집"].type == "어린이집 간호" and by["국공립 햇살어린이집"].area == "오송"
    assert by["동아어린이집"].deadline == "2026-11-30"


def test_output(tmp_path=None):
    import tempfile
    d = Path(tmp_path or tempfile.mkdtemp())
    C.OUT = d
    jobs = C.merge_history(C.crawl_childcare(FakeFetcher(), 1))
    C.write_outputs(jobs)
    page = (d / "index.html").read_text(encoding="utf-8")
    assert "코코어린이집" in page and "/*__DATA__*/null" not in page


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
