// 실제 사이트 없이 파서·지역 분류를 확인. 실행: npm test
import { parseCbeBoard, parseCbeMpool, parseChildcare, childcareAddress, parseSchoolFeed, parseSssc, deadlineFromText, toDate } from '../src/parse.ts';
import { tags } from '../src/places.ts';
import { fullAddress, childcareCode } from '../src/parse.ts';
import { geoKey } from '../src/geo.ts';

let n = 0;
function eq(a: unknown, b: unknown, msg: string) {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A !== B) throw new Error(`✗ ${msg}\n  got ${A}\n  want ${B}`);
  n++;
}

// 날짜
eq(toDate('2026.11.13.'), '2026-11-13', 'dot date');
eq(toDate('2026/11/20'), '2026-11-20', 'slash date');
eq(toDate('26-11-30'), '2026-11-30', 'work24 date');
eq(deadlineFromText('<p>접수기간: 2026. 9. 4.(금) ~ 9. 8.(화), 16:30 도착분</p>'), '2026-09-08', 'deadline no year');
eq(deadlineFromText('공고 및 접수기간: 2025. 12. 29. ~ 2026. 1. 2.'), '2026-01-02', 'deadline cross year');
eq(deadlineFromText('채용기간 2026.12.30~2027.2.27'), null, 'work period is not deadline');

// 충북교육청 학교구인정보
const cbe = `<table><thead><tr><th>번호</th><th>분류</th><th>제목</th><th>작성자</th><th>등록일</th><th>마감일</th><th>조회수</th></tr></thead><tbody>
<tr><td>14880</td><td>유치원</td><td class="ta_l"><a href="#" data-id="1583001" class="nttInfoBtn" title="오송솔미초등학교병설유치원 겨울방학 방과후과정 강사 채용공고(1차)">새글 N 오송솔미초등학교병설유치원 겨울방학…</a></td><td>오송솔미초등학교</td><td>2026.11.13.</td><td>2026/11/20</td><td>12</td></tr>
<tr><td>14879</td><td>초등학교</td><td><a href="#" data-id="1583000">겨울방학 방과후 돌봄 자원봉사자 모집</a></td><td>주중초등학교</td><td>2026.11.13.</td><td>2026/11/20</td><td>3</td></tr>
<tr><td>14881</td><td>유치원</td><td><a href="./selectNttInfo.do?nttSn=1583002">2026학년도 비봉유치원 학년말 방학 중 방과후 과정 강사 채용 공고(1차)</a></td><td>비봉유치원</td><td>2026.11.13.</td><td>2026/11/17</td><td>5</td></tr>
</tbody></table>`;
const c = parseCbeBoard(cbe);
eq(c.length, 2, 'cbe keeps only 유치원');
eq(c[0].title, '오송솔미초등학교병설유치원 겨울방학 방과후과정 강사 채용공고(1차)', 'cbe full title from title attr');
eq([c[0].id, c[0].deadline], ['cbe:1583001', '2026-11-20'], 'cbe id/deadline');
eq(tags(c[0]).osong, 1, 'cbe 오송솔미초 → osong');
eq(tags(c[1]).osong, 0, 'cbe 비봉 → not osong');
eq(tags({ title: '2026학년도 학년말 방학 중 방과후과정 강사 채용 공고(솔강초병설유)', organization: '솔강초등학교', place: null, source: 'cbe' }).address, '청주시 흥덕구 오송읍 오송생명8로 95', '솔강초 → osong with address');
eq(tags({ title: '2026. 오송유치원 겨울방학 중 방과후과정 강사 채용 공고', organization: '김선희', place: null, source: 'cbe' }).osong, 1, '작성자가 사람 이름이어도 제목으로 오송유치원 인식');
eq(tags({ title: '2026학년도 오송솔미유치원 겨울방학 강사(2차)', organization: '오송솔미유치원', place: null, source: 'cbe' }).address, '청주시 흥덕구 오송읍 봉산3길 7', '오송솔미유치원 matched before 오송유치원');

// 기간제 인력풀
const mp = `<table><tr><th>번호</th><th>지역</th><th>구분</th><th>제목</th><th>작성자</th><th>등록일</th><th>조회</th></tr>
<tr><td>16130</td><td>청주</td><td>유치원</td><td><a href="./selectNttInfo.do?nttSn=1578587&amp;mi=12127">오송유치원 기간제교사 채용 공고</a></td><td>전은정</td><td>2026.09.03.</td><td>10</td></tr>
<tr><td>16129</td><td>청주</td><td>중등</td><td><a href="./selectNttInfo.do?nttSn=1578500">오송중학교 기간제</a></td><td>오송중</td><td>2026.09.03.</td><td>1</td></tr></table>`;
const m = parseCbeMpool(mp);
eq(m.length, 1, 'mpool only 유치원');
eq(tags(m[0]).osong, 1, 'mpool 오송유치원 by title');

// 어린이집 (목록 + 상세 주소)
const cc = `<table><thead><tr><th>번호</th><th>유형</th><th>제목</th><th>어린이집명</th><th>직종</th><th>소재지</th><th>마감일</th><th>작성일</th><th>조회</th></tr></thead><tbody>
<tr><td>148</td><td>가정</td><td><a href="JobOfferSl.jsp?flag=Sl&amp;JOSEQ=1259144">0세반 교사 모십니다</a></td><td>코코어린이집</td><td>보육교사</td><td>충청북도 청주시 흥덕구</td><td>2026-11-30</td><td>2026-11-08</td><td>13</td></tr>
<tr><td>147</td><td>직장</td><td><a href="#" onclick="fnView('1259150')">간호사 모집</a></td><td>LG청주어린이집</td><td>간호사</td><td>충청북도 청주시 상당구</td><td>2026-11-30</td><td>2026-11-08</td><td>3</td></tr>
</tbody></table>`;
const k = parseChildcare(cc, 'chungbuk');
eq(k.map(x => [x.id, x.type]), [['chungbuk-child:1259144', '어린이집'], ['chungbuk-child:1259150', '어린이집']], 'childcare rows');
eq(tags({ ...k[0], place: null }).osong, 0, 'childcare not osong without detail address (name-only never counts)');
const addr = childcareAddress('<table><tr><th>소재지</th><td>충청북도 청주시 흥덕구 오송읍 오송생명14로 217</td></tr></table>');
eq(addr?.includes('오송읍'), true, 'detail address parsed');
eq(childcareAddress('<dl><dt>소재지</dt><dd>충청북도 청주시 흥덕구 복대1동 담당자명 홍길동</dd></dl>'), '충청북도 청주시 흥덕구 복대1동', 'address trims following label');
eq(tags({ ...k[0], place: addr }).osong, 1, 'childcare osong by verified address');
eq(tags({ title: '연장반', organization: '햇살어린이집', place: '세종특별자치시 조치원읍 신흥리 1', source: 'sejong-child' }).jochiwon, 1, 'jochiwon by address');

// 세종 학교 홈페이지
const sf = `<table><tr><th>번호</th><th>제목</th><th>작성자</th><th>등록일</th><th>조회</th></tr>
<tr><td>5</td><td><a href="#" data-id="4001" class="nttInfoBtn" title="2026학년도 겨울방학 중 방과후과정 강사 채용 공고">2026학년도 겨울방학 …</a></td><td>행정실</td><td>2026.11.10</td><td>3</td></tr>
<tr><td>4</td><td><a href="#" data-id="4000">방과후과정 강사 최종 합격자 발표</a></td><td>행정실</td><td>2026.11.09</td><td>3</td></tr>
<tr><td>3</td><td><a href="#" data-id="3999">2학기 기간제교원 채용</a></td><td>교무실</td><td>2026.11.08</td><td>3</td></tr></table>`;
const s1 = parseSchoolFeed(sf, { name: '조치원교동초등학교병설유치원', url: 'https://schoolhp.sje.go.kr/jk-e/na/ntt/selectNttList.do?bbsId=2145&mi=3494' });
eq(s1.length, 2, 'school feed: 합격자 발표 excluded');
eq(s1[0].url.includes('selectNttInfo.do') && s1[0].url.includes('nttSn=4001'), true, 'school detail url');
eq(tags(s1[0]).jochiwon, 1, '조치원 school → jochiwon');
const s2 = parseSchoolFeed(sf, { name: '수왕초등학교', url: 'https://schoolhp.sje.go.kr/suwang-e/na/ntt/selectNttList.do?bbsId=2245&mi=11551' });
eq(s2.length, 0, 'elementary board: non-kindergarten jobs excluded');

// 학교지원본부
const ss = `<table><tr><th>번호</th><th>제목</th><th>작성자</th><th>등록일</th></tr>
<tr><td>30</td><td><a href="./selectPst.do?pstSn=9001&amp;bbsId=1061">2026학년도 유치원 겨울방학 중 방과후과정 시간강사 2차 모집 공고</a></td><td>학교행정지원팀</td><td>2026.11.24</td></tr>
<tr><td>29</td><td><a href="./selectPst.do?pstSn=9000">유치원 방과후과정 시간강사 면접대상자 공고</a></td><td>학교행정지원팀</td><td>2026.11.11</td></tr></table>`;
const sp = parseSssc(ss, 'https://sssc.sje.go.kr/sssc/pt/pst/selectPstList.do?mi=1230&bbsId=1061');
eq(sp.length, 1, 'sssc: only open recruitment');
eq([tags(sp[0]).osong, tags(sp[0]).jochiwon], [0, 0], 'sssc merged recruitment not assigned to a region');

// 좌표 검색어
eq(geoKey({ source: 'cbe', region: '충북', title: '오송솔미초등학교병설유치원 겨울방학 강사(1차)', organization: '오송솔미초등학교', place: null }), 'addr:청주시 흥덕구 오송읍 오송생명12로 83', 'geo: known osong org → address');
eq(geoKey({ source: 'cbe', region: '충북', title: '2026학년도 비봉유치원 학년말 방학 중 강사 채용', organization: '비봉유치원', place: null }), 'name:충북 비봉유치원', 'geo: org name');
eq(geoKey({ source: 'mpool', region: '충북', title: '2026. 가경초등학교병설유치원 기간제교사 채용', organization: '청주 · 김선희', place: null }), 'name:충북 가경초등학교', 'geo: mpool person writer → title, 병설 → 초등학교');
eq(geoKey({ source: 'chungbuk-child', region: '충북', title: '담임', organization: '하트리움어린이집 · 민간 · 보조교사', place: '충청북도 청주시 흥덕구 복대1동 담당자명' }), 'name:충북 하트리움어린이집@복대1동', 'geo: childcare without street address → name');
eq(geoKey({ source: 'sejong-child', region: '세종', title: '담임', organization: '별나무어린이집 · 가정', place: '세종특별자치시 해밀동 해밀7로 25' }), 'addr:세종특별자치시 해밀동 해밀7로 25', 'geo: street address');
eq(geoKey({ source: 'sssc', region: '세종', title: '유치원 강사 2차', organization: '학교지원본부', place: null }), null, 'geo: merged recruitment skipped');

eq(geoKey({ source: 'chungbuk-child', region: '충북', title: '담임', organization: '꿈채움어린이집 · 가정', place: '충청북도 청주시 흥덕구 오송읍' }), 'addr:청주시 흥덕구 오송읍 오송생명14로 215', 'geo: 직접 확인한 어린이집 주소');
eq(geoKey({ source: 'chungbuk-child', region: '충북', title: '담임', organization: '오송별어린이집 · 가정', place: '충청북도 청주시 흥덕구 오송읍' }), 'name:충북 오송별어린이집@오송읍', 'geo: 오송읍 area kept');
eq(fullAddress('<th>주소</th><td>(30091) 세종특별자치시 산울7로 11 707동108호</td>'), '세종특별자치시 산울7로 11', 'full address from portal');
eq(fullAddress('<td>(28221) 충청북도 청주시 흥덕구 오송읍 오송생명14로 215 103동 103호 동아라이크텐아파트</td>'), '충청북도 청주시 흥덕구 오송읍 오송생명14로 215', 'full address 오송');
eq(fullAddress('<td>충청북도 청주시 흥덕구 오송읍</td>'), null, 'no street → null');
eq(childcareCode('<a href="javascript:fnPopup(\'36110000441\')">'), '36110000441', 'portal code in onclick');
eq(childcareCode('SummaryInfoSlPu.jsp?flag=YJ&STCODE_POP=43113000123'), '43113000123', 'portal code in url');
console.log(`✔ ${n}개 확인 통과`);
