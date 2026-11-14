// 게시판 HTML을 공고 목록으로 바꾸는 순수 함수들 (네트워크 없음 → 테스트 가능)

export type Job = {
  id: string;            // 출처:게시물번호
  source: string;        // 출처 id
  region: '충북' | '세종';
  type: '유치원' | '어린이집' | '어린이집 간호';
  title: string;
  organization: string;
  place: string | null;  // 확인된 소재지 (상세 페이지·공식 주소)
  posted: string;        // YYYY-MM-DD
  deadline: string | null;
  url: string;
  detailId?: string;     // 상세 페이지를 더 읽어야 하는 경우 (어린이집 소재지, 기간제 접수기간)
};

export function clean(s: string): string {
  return (s || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim()
    .replace(/^(새글\s*)?N\s+/, '');
}

export function toDate(s: string, baseYear?: number): string | null {
  const t = clean(s);
  let m = t.match(/(20\d{2})\s*[.\/\-년]\s*(\d{1,2})\s*[.\/\-월]\s*(\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = t.match(/(?<!\d)(\d{2})-(\d{2})-(\d{2})(?!\d)/);
  if (m) return iso(2000 + +m[1], +m[2], +m[3]);
  if (baseYear) {
    m = t.match(/(?<!\d)(\d{1,2})\s*[.\/월]\s*(\d{1,2})(?!\d)/);
    if (m) return iso(baseYear, +m[1], +m[2]);
  }
  return null;
}
function iso(y: number, mo: number, d: number) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 헤더(th) 이름으로 열을 찾는 표 읽기 */
export function readTable(html: string, mustHave: string[]) {
  for (const table of html.match(/<table\b[\s\S]*?<\/table>/gi) || []) {
    const heads = [...table.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(x => clean(x[1]));
    if (!mustHave.every(w => heads.some(h => h.includes(w)))) continue;
    const rows: { cells: string[]; raw: string }[] = [];
    for (const tr of table.match(/<tr\b[\s\S]*?<\/tr>/gi) || []) {
      const cells = [...tr.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(x => x[1]);
      if (cells.length >= 3) rows.push({ cells, raw: tr });
    }
    const col = (...names: string[]) => {
      for (const n of names) { const i = heads.findIndex(h => h.includes(n)); if (i >= 0) return i; }
      return -1;
    };
    return { heads, rows, col };
  }
  return null;
}

/** 행 안에서 게시물 번호 찾기: nttSn=, data-id=, JOSEQ=, pstSn=, onclick('1234567') */
export function postId(raw: string, keys = ['nttSn', 'JOSEQ', 'pstSn']): string | null {
  for (const k of keys) { const m = raw.match(new RegExp(`${k}=(\\d+)`)); if (m) return m[1]; }
  const d = raw.match(/data-(?:id|ntt-sn|sn)=["'](\d+)/i); if (d) return d[1];
  const o = raw.match(/\(\s*['"]?(\d{5,})['"]?/); return o ? o[1] : null;
}

/** 목록 표에 있는 모든 게시물 번호 (분류와 상관없이) — 페이지가 넘어갔는지 판단용 */
export function pageIds(html: string): string[] {
  const out: string[] = [];
  for (const tr of html.match(/<tr\b[\s\S]*?<\/tr>/gi) || []) {
    if (!/<td\b/i.test(tr)) continue;
    const id = postId(tr); if (id) out.push(id);
  }
  return out;
}

/** 제목 셀: a[title] 우선, 없으면 셀 텍스트 */
function titleOf(cell: string) {
  const t = cell.match(/<a\b[^>]*title=["']([^"']+)["']/i)?.[1];
  return clean(t || cell).replace(/\s*(새글|NEW)$/i, '');
}

// ───────── 충북교육청 학교구인정보 (bbsId=1798) ─────────
// 열: 번호 | 분류 | 제목 | 작성자 | 등록일 | 마감일 | 조회
export function parseCbeBoard(html: string): Job[] {
  const t = readTable(html, ['제목', '등록일']); if (!t) return [];
  const iKind = t.col('분류', '구분'), iTitle = t.col('제목'), iWriter = t.col('작성자', '기관'),
    iPosted = t.col('등록일'), iDead = t.col('마감');
  const out: Job[] = [];
  for (const r of t.rows) {
    const id = postId(r.raw); const kind = clean(r.cells[iKind] || '');
    const title = titleOf(r.cells[iTitle] || ''); const posted = toDate(r.cells[iPosted] || '');
    if (!id || !title || !posted) continue;
    if (!kind.includes('유치원')) continue;               // 병설유치원 포함, 초·중·고 제외
    out.push({
      id: `cbe:${id}`, source: 'cbe', region: '충북', type: '유치원', title,
      organization: clean(r.cells[iWriter] || ''), place: null, posted,
      deadline: iDead >= 0 ? toDate(r.cells[iDead] || '') : null,
      url: `https://www.cbe.go.kr/cbe/na/ntt/selectNttInfo.do?bbsId=1798&nttSn=${id}&mi=11716`,
    });
  }
  return out;
}

// ───────── 충북교육청 기간제교사 인력풀 (bbsId=1091) ─────────
// 열: 번호 | 지역 | 구분 | 제목 | 작성자 | 등록일 | 조회
export function parseCbeMpool(html: string): Job[] {
  const t = readTable(html, ['제목', '등록일']); if (!t) return [];
  const iRegion = t.col('지역'), iKind = t.col('구분'), iTitle = t.col('제목'),
    iWriter = t.col('작성자'), iPosted = t.col('등록일');
  const out: Job[] = [];
  for (const r of t.rows) {
    const id = postId(r.raw); const title = titleOf(r.cells[iTitle] || '');
    const posted = toDate(r.cells[iPosted] || ''); const kind = clean(r.cells[iKind] || '');
    if (!id || !title || !posted) continue;
    if (!(kind + title).includes('유치원')) continue;
    out.push({
      id: `mpool:${id}`, source: 'mpool', region: '충북', type: '유치원', title,
      organization: [clean(r.cells[iRegion] || ''), clean(r.cells[iWriter] || '')].filter(Boolean).join(' · '),
      place: null, posted, deadline: null, detailId: id,
      url: `https://www.cbe.go.kr/mpool/na/ntt/selectNttInfo.do?nttSn=${id}&mi=12127`,
    });
  }
  return out;
}

// ───────── 육아종합지원센터 인력뱅크 (충북·세종 공통) ─────────
// 열: 번호 | 유형 | 제목 | 어린이집명 | 직종 | 소재지 | 마감일 | 작성일 | 조회
export function parseChildcare(html: string, center: 'chungbuk' | 'sejong'): Job[] {
  const t = readTable(html, ['제목', '소재지']); if (!t) return [];
  const iType = t.col('유형'), iTitle = t.col('제목'), iOrg = t.col('어린이집'), iJob = t.col('직종'),
    iPlace = t.col('소재지'), iDead = t.col('마감'), iPosted = t.col('작성일', '등록일');
  const out: Job[] = [];
  for (const r of t.rows) {
    const id = postId(r.raw); const title = titleOf(r.cells[iTitle] || '');
    const posted = toDate(r.cells[iPosted] || ''); if (!id || !title || !posted) continue;
    const job = clean(r.cells[iJob] || ''); const nurse = /간호/.test(job + title);
    const area = clean(r.cells[iPlace] || '');
    out.push({
      id: `${center}-child:${id}`, source: `${center}-child`, region: center === 'sejong' ? '세종' : '충북',
      type: nurse ? '어린이집 간호' : '어린이집', title,
      organization: [clean(r.cells[iOrg] || ''), clean(r.cells[iType] || ''), job].filter(Boolean).join(' · '),
      place: area || null, posted, deadline: toDate(r.cells[iDead] || ''), detailId: id,
      url: `https://${center}.childcare.go.kr/ccef/job/JobOfferSl.jsp?flag=Sl&JOSEQ=${id}`,
    });
  }
  return out;
}

/** 어린이집 상세 페이지에서 소재지(주소) 한 줄 뽑기 */
export function childcareAddress(html: string): string | null {
  const text = clean(html);
  const m = text.match(/(충청북도|충북|세종특별자치시|세종)\s[^|]{2,60}?(읍|면|동|로|길)\s?[^\s|]{0,20}/);
  if (!m) return null;
  // 주소 뒤에 붙는 다음 칸 이름(담당자명, 전화번호 등)은 잘라낸다
  return m[0].replace(/\s*(담당자명?|전화번호?|연락처|시설장|팩스|이메일|홈페이지)[\s\S]*$/, '').trim() || null;
}

// ───────── 세종 유치원·학교 홈페이지 게시판 ─────────
const JOB_WORDS = /(채용|위촉|구인|강사.{0,15}모집|교사.{0,15}모집|기간제|대체인력)/;
const NOT_JOB = /(합격|결과|면접\s*대상|모집요강|유아\s*모집|원아\s*모집|입학|신입생)/;
export function parseSchoolFeed(html: string, feed: { name: string; url: string }): Job[] {
  const t = readTable(html, ['제목']); if (!t) return [];
  const iTitle = t.col('제목'), iPosted = t.col('등록일', '작성일', '날짜');
  const kinder = /유치원/.test(feed.name);
  const base = new URL(feed.url);
  const out: Job[] = [];
  for (const r of t.rows) {
    const id = postId(r.raw); const title = titleOf(r.cells[iTitle] || '');
    if (!id || !title || !JOB_WORDS.test(title) || NOT_JOB.test(title)) continue;
    if (!kinder && !/유치원/.test(title)) continue;     // 초등학교 게시판은 병설유치원 공고만
    const posted = toDate(r.cells[iPosted >= 0 ? iPosted : r.cells.length - 2] || '') ||
      r.cells.map(c => toDate(c)).filter(Boolean).at(-1) || null;
    if (!posted) continue;
    const u = new URL(base.href); u.pathname = u.pathname.replace('selectNttList.do', 'selectNttInfo.do');
    u.searchParams.set('nttSn', id);
    out.push({
      id: `sjschool:${base.pathname.split('/')[1]}:${id}`, source: 'sejong-school', region: '세종', type: '유치원',
      title, organization: feed.name, place: null, posted, deadline: null, url: u.href,
    });
  }
  return out;
}

// ───────── 세종교육청 학교지원본부 공지 (통합 모집) ─────────
export function parseSssc(html: string, listUrl: string): Job[] {
  const t = readTable(html, ['제목']); if (!t) return [];
  const iTitle = t.col('제목'), iPosted = t.col('등록일', '작성일');
  const out: Job[] = [];
  for (const r of t.rows) {
    const id = postId(r.raw, ['pstSn', 'nttSn']); const title = titleOf(r.cells[iTitle] || '');
    if (!id || !title || !/유치원/.test(title) || !/(모집|채용)/.test(title) || NOT_JOB.test(title)) continue;
    if (/비공개/.test(r.raw)) continue;
    const posted = toDate(r.cells[iPosted] || '') || r.cells.map(c => toDate(c)).filter(Boolean).at(-1) || null;
    if (!posted) continue;
    const u = new URL(listUrl); u.pathname = u.pathname.replace(/select\w+List\.do/, m => m.replace('List', ''));
    u.searchParams.set('pstSn', id);
    out.push({
      id: `sssc:${id}`, source: 'sssc', region: '세종', type: '유치원', title,
      organization: '세종교육청 학교지원본부 (여러 유치원 통합 모집)', place: null, posted, deadline: null, url: u.href,
    });
  }
  return out;
}

/** 공고 본문에서 접수 마감일 찾기: '접수기간: 2026. 9. 4.(금) ~ 9. 8.(화)' → 2026-09-08 */
export function deadlineFromText(html: string): string | null {
  const text = clean(html);
  for (const w of ['접수기간', '접수 기간', '서류접수', '서류 접수', '공고 및 접수', '모집기간', '모집 기간', '접수일시']) {
    const i = text.indexOf(w); if (i < 0) continue;
    const seg = text.slice(i, i + 140);
    const parts = seg.split(/[~∼]|부터/);
    if (parts.length >= 2) {
      const start = toDate(parts[0]); const year = start ? +start.slice(0, 4) : undefined;
      const end = toDate(parts[1].slice(0, 40), year);
      if (end) return end;
    }
  }
  return null;
}
