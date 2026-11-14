import feeds from './sejong-feeds.json';
import {
  Job, parseCbeBoard, parseCbeMpool, parseChildcare, childcareAddress,
  parseSchoolFeed, parseSssc, deadlineFromText, pageIds, fullAddress, childcareCode,
} from './parse';
import { tags } from './places';
import { geocodePending } from './geo';

export interface Env {
  DB: D1Database;
  ADMIN_TOKEN?: string;      // 수동 갱신(/api/update) 보호용
  RESEND_API_KEY?: string;   // 선택: 새 오송 공고 이메일 알림
  NOTIFY_TO?: string;        // 선택: 알림 받을 이메일
  NOTIFY_FROM?: string;      // 선택: 보내는 주소 (Resend에서 인증한 주소)
  KAKAO_REST_KEY?: string;   // 선택: 기관 위치(거리 표시)용 카카오 REST API 키
}

const UA = 'OsongJobsCollector/1.0 (personal job alert; low frequency)';
const SSSC_URL = 'https://sssc.sje.go.kr/sssc/pt/pst/selectPstList.do?mi=1230&bbsId=1061';
// 무료 요금제는 한 번 실행에 외부 요청 50개까지라, 상세 페이지는 실행당 이 개수까지만 읽는다
const DETAIL_BUDGET = 25;

async function get(url: string): Promise<string> {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`원본 서버 응답 ${r.status}`);
  return await r.text();
}
const errMsg = (e: unknown) => e instanceof Error ? (/abort|timeout/i.test(e.message) ? '원본 서버 연결 시간 초과' : e.message) : '수집 실패';

/** 실패 시 1번만 다시 시도 */
async function getRetry(url: string) {
  try { return await get(url); } catch { await new Promise(r => setTimeout(r, 1500)); return await get(url); }
}

async function isFirstRun(env: Env, source: string) {
  const r = await env.DB.prepare('SELECT 1 FROM source_states WHERE id=?').bind(source).first();
  return !r;
}

/** 공고 저장 (있으면 갱신). 새로 들어온 공고 id 목록을 돌려준다 */
async function save(env: Env, rows: Job[], now: string, firstRun: boolean): Promise<string[]> {
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const known = new Set<string>();
  for (let i = 0; i < ids.length; i += 90) {   // D1 바인딩 개수 제한(100) 때문에 90개씩
    const part = ids.slice(i, i + 90);
    const res = await env.DB.prepare(`SELECT id FROM jobs WHERE id IN (${part.map(() => '?').join(',')})`).bind(...part).all<{ id: string }>();
    res.results.forEach(x => known.add(x.id));
  }
  const stmts = rows.map(j => {
    const t = tags(j);
    return env.DB.prepare(`INSERT INTO jobs (id,source,region,type,title,organization,place,osong,jochiwon,posted,deadline,url,first_seen,last_seen,detail_checked,notified)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title, organization=excluded.organization,
        place=COALESCE(jobs.place, excluded.place), deadline=COALESCE(excluded.deadline, jobs.deadline),
        osong=MAX(jobs.osong, excluded.osong), jochiwon=MAX(jobs.jochiwon, excluded.jochiwon), last_seen=excluded.last_seen`)
      .bind(j.id, j.source, j.region, j.type, j.title, j.organization, j.place ?? t.address, t.osong, t.jochiwon, j.posted, j.deadline, j.url, now, now, firstRun ? 1 : 0);
  });
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
  return ids.filter(id => !known.has(id));
}

async function setState(env: Env, id: string, name: string, now: string, count: number, error: string | null) {
  await env.DB.prepare(`INSERT INTO source_states (id,name,attempted,succeeded,error,count) VALUES (?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, attempted=excluded.attempted,
      succeeded=CASE WHEN excluded.error IS NULL THEN excluded.attempted ELSE source_states.succeeded END,
      error=excluded.error, count=excluded.count`)
    .bind(id, name, now, error ? null : now, error, count).run();
}

/** 한 출처 실행 틀: 실패해도 기존 데이터는 그대로 */
async function run(env: Env, id: string, name: string, fn: (first: boolean, now: string) => Promise<{ count: number; warn?: string | null }>) {
  const now = new Date().toISOString();
  const first = await isFirstRun(env, id);
  try {
    const r = await fn(first, now);
    await setState(env, id, name, now, r.count, r.warn ?? null);
  } catch (e) {
    await setState(env, id, name, now, 0, errMsg(e));
  }
}

// ───── 출처별 수집 ─────

/**
 * 게시판 여러 페이지 읽기. 페이지 번호 파라미터 이름이 사이트마다 달라서
 * 2페이지에서 currPage / pageIndex 를 차례로 시도하고, 1페이지와 다른 목록이 나오는 쪽을 쓴다.
 * stopWhenKnown: 평소 실행에선 이미 저장된 공고만 나오는 페이지에서 멈춘다.
 */
async function readPages(env: Env, base: string, parse: (html: string) => Job[], maxPages: number, stopWhenKnown: boolean) {
  const html1 = await getRetry(base);
  const all = parse(html1); const keep = new Set(all.map(j => j.id));
  const seenPost = new Set(pageIds(html1));          // 분류와 상관없는 전체 글 번호
  if (!seenPost.size) throw new Error('공고 목록을 읽지 못함 · 게시판 구조 확인 필요');
  let param: string | null = null; let warn: string | null = null; let pages = 1;
  for (let page = 2; page <= maxPages; page++) {
    let html = '';
    if (!param) {
      for (const cand of ['currPage', 'pageIndex']) {
        const h = await getRetry(`${base}&${cand}=${page}`);
        if (pageIds(h).some(id => !seenPost.has(id))) { param = cand; html = h; break; }
      }
      if (!param) { warn = '2페이지를 열 수 없음 · 최신 1페이지만 수집'; break; }
    } else {
      html = await getRetry(`${base}&${param}=${page}`);
    }
    const ids = pageIds(html).filter(id => !seenPost.has(id));
    if (!ids.length) break;                           // 더 이상 새 글 없음 (마지막 페이지)
    ids.forEach(id => seenPost.add(id)); pages = page;
    const fresh = parse(html).filter(j => !keep.has(j.id));
    fresh.forEach(j => { keep.add(j.id); all.push(j); });
    if (stopWhenKnown && fresh.length) {
      const ids = fresh.map(j => j.id);
      const known = await env.DB.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).first<{ n: number }>();
      if ((known?.n ?? 0) === ids.length) break;   // 이 페이지는 전부 이미 있음 → 그 뒤도 이미 있음
    }
  }
  return { rows: all, warn: warn ?? (pages > 1 ? null : null) };
}

// 학교구인정보는 유치원 외 글도 섞여 있어, 한 페이지에 유치원 글이 0건일 수 있다 → 페이지 판단은 전체 글 기준
const CBE_BASE = 'https://www.cbe.go.kr/cbe/na/ntt/selectNttList.do?bbsId=1798&mi=11716';
async function cbeBoard(env: Env, maxPages = 3, backfill = false) {
  await run(env, 'cbe', '충북교육청 학교구인정보', async (first, now) => {
    const { rows, warn } = await readPages(env, CBE_BASE, parseCbeBoard, maxPages, !backfill);
    await save(env, rows, now, first || backfill);   // 지난 공고 채우기는 알림 보내지 않음
    return { count: rows.length, warn };
  });
}

const MPOOL_BASE = 'https://www.cbe.go.kr/mpool/na/ntt/selectNttList.do?mi=12127&bbsId=1091';
async function cbeMpool(env: Env, maxPages = 3, backfill = false) {
  await run(env, 'mpool', '충북교육청 기간제교사 인력풀', async (first, now) => {
    const { rows, warn } = await readPages(env, MPOOL_BASE, parseCbeMpool, maxPages, !backfill);
    await save(env, rows, now, first || backfill);   // 지난 공고 채우기는 알림 보내지 않음
    return { count: rows.length, warn };
  });
}

async function childcare(env: Env, center: 'chungbuk' | 'sejong') {
  const id = `${center}-child`;
  await run(env, id, center === 'sejong' ? '세종육아종합지원센터 어린이집 구인' : '충북육아종합지원센터 어린이집 구인', async (first, now) => {
    const base = `https://${center}.childcare.go.kr/ccef/job/JobOfferSlPL.jsp?flag=SlPL`;
    let all: Job[] = []; const seen = new Set<string>(); let warn: string | null = null;
    for (let page = 1; page <= 3; page++) {
      const rows = parseChildcare(await getRetry(page === 1 ? base : `${base}&offset=${(page - 1) * 10}&pageIndex=${page}`), center);
      if (!rows.length) { if (page === 1) throw new Error('공고 목록을 읽지 못함 · 게시판 구조 확인 필요'); break; }
      const fresh = rows.filter(r => !seen.has(r.id)); if (!fresh.length) { if (page === 2) warn = '2페이지가 1페이지와 같음 · 최신 목록만 수집'; break; }
      fresh.forEach(r => seen.add(r.id)); all = all.concat(fresh);
    }
    // 충북은 오송이 속한 흥덕구만 보관, 세종은 전부
    if (center === 'chungbuk') all = all.filter(j => (j.place || '').includes('흥덕구'));
    all.forEach(j => { j.place = null; });   // 목록의 '구' 단위 주소는 쓰지 않고 상세 주소로 채운다
    await save(env, all, now, first);
    return { count: all.length, warn };
  });
}

async function sejongSchools(env: Env, part: 1 | 2) {
  const list = feeds as { name: string; url: string }[];
  const half = Math.ceil(list.length / 2);
  const mine = part === 1 ? list.slice(0, half) : list.slice(half);
  await run(env, `sejong-school-${part}`, `세종 유치원·학교 홈페이지 (${part}/2)`, async (first, now) => {
    let ok = 0; const fails: string[] = []; let rows: Job[] = [];
    for (const f of mine) {
      try { rows = rows.concat(parseSchoolFeed(await get(f.url), f)); ok++; }
      catch (e) { fails.push(`${f.name}: ${errMsg(e)}`); }
    }
    await save(env, rows, now, first);
    if (!ok) throw new Error(`게시판 ${mine.length}곳 모두 실패`);
    return { count: rows.length, warn: fails.length ? `${ok}/${mine.length}곳 확인 · 실패: ${fails.slice(0, 5).join(', ')}${fails.length > 5 ? ' 외' : ''}` : null };
  });
}

async function sssc(env: Env) {
  await run(env, 'sssc', '세종교육청 학교지원본부 (통합 모집)', async (first, now) => {
    const rows = parseSssc(await getRetry(SSSC_URL), SSSC_URL);
    await save(env, rows, now, first);
    return { count: rows.length };
  });
}

/** 상세 페이지 보충: 어린이집 소재지(오송읍·조치원읍 확인), 기간제·학교 공고 접수 마감일 */
async function fillDetails(env: Env, budget = DETAIL_BUDGET) {
  const res = await env.DB.prepare(`SELECT id, source, url, organization, title FROM jobs
      WHERE detail_checked=0 AND (source LIKE '%-child' OR source IN ('mpool','sejong-school','sssc'))
      ORDER BY posted DESC LIMIT ?`).bind(budget).all<{ id: string; source: string; url: string; organization: string; title: string }>();
  const updates: D1PreparedStatement[] = [];   // D1도 실행당 쿼리 수 제한이 있어 한 번에 모아서 보낸다
  for (const j of res.results) {
    let place: string | null = null, deadline: string | null = null;
    try {
      const html = await get(j.url);
      if (j.source.endsWith('-child')) place = childcareAddress(html);
      else deadline = deadlineFromText(html);
    } catch { continue; }   // 다음 실행에서 다시 시도
    const t = tags({ title: j.title, organization: j.organization, place, source: j.source });
    updates.push(env.DB.prepare(`UPDATE jobs SET detail_checked=1, place=COALESCE(?, place), deadline=COALESCE(deadline, ?),
        osong=MAX(osong, ?), jochiwon=MAX(jochiwon, ?) WHERE id=?`)
      .bind(place, deadline, t.osong, t.jochiwon, j.id));
  }
  if (updates.length) await env.DB.batch(updates);
}

/**
 * 어린이집 상세 주소 채우기: 공고에 '오송읍'처럼 동네까지만 있으면
 * 공고 본문 → 없으면 어린이집 정보공개포털 요약 페이지에서 도로명 주소를 가져온다. (거리 계산용)
 */
export async function fillChildcareAddress(env: Env, budget = 5) {
  try { await env.DB.prepare(`ALTER TABLE jobs ADD COLUMN addr_checked INTEGER NOT NULL DEFAULT 0`).run(); } catch { /* 이미 있음 */ }
  const res = await env.DB.prepare(`SELECT id, url, place FROM jobs
      WHERE source LIKE '%-child' AND addr_checked=0 AND posted >= date('now','-120 days')
      ORDER BY osong DESC, jochiwon DESC, posted DESC LIMIT 300`).all<{ id: string; url: string; place: string | null }>();
  const STREET = /(로|길)\s?\d/;
  const todo = res.results.filter(j => !STREET.test(j.place || '')).slice(0, budget);
  const done = res.results.filter(j => STREET.test(j.place || ''));
  const updates: D1PreparedStatement[] = done.slice(0, 50).map(j => env.DB.prepare(`UPDATE jobs SET addr_checked=1 WHERE id=?`).bind(j.id));
  for (const j of todo) {
    let addr: string | null = null;
    try {
      const html = await get(j.url);
      addr = fullAddress(html);
      const code = addr ? null : childcareCode(html);
      if (code) addr = fullAddress(await get(`https://info.childcare.go.kr/info_html5/pnis/search/preview/SummaryInfoSlPu.jsp?flag=YJ&STCODE_POP=${code}`));
    } catch { continue; }   // 다음에 다시
    updates.push(env.DB.prepare(`UPDATE jobs SET addr_checked=1, place=COALESCE(?, place) WHERE id=?`).bind(addr, j.id));
  }
  if (updates.length) await env.DB.batch(updates);
}

/** 새 오송 공고 이메일 알림 (설정했을 때만) */
async function notify(env: Env) {
  if (!env.RESEND_API_KEY || !env.NOTIFY_TO) return;
  const res = await env.DB.prepare(`SELECT id,title,organization,deadline,url FROM jobs WHERE osong=1 AND notified=0 ORDER BY posted DESC LIMIT 20`)
    .all<{ id: string; title: string; organization: string; deadline: string | null; url: string }>();
  if (!res.results.length) return;
  const lines = res.results.map(j => `• ${j.organization} — ${j.title}\n  마감: ${j.deadline ?? '미확인'}\n  ${j.url}`).join('\n\n');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.NOTIFY_FROM || 'onboarding@resend.dev', to: env.NOTIFY_TO,
      subject: `[오송 채용] 새 공고 ${res.results.length}건`, text: lines,
    }),
  });
  if (r.ok) await env.DB.batch(res.results.map(j => env.DB.prepare('UPDATE jobs SET notified=1 WHERE id=?').bind(j.id)));
}

// ───── 실행 묶음 (무료 요금제: 크론 5개, 실행당 외부 요청 50개) ─────
export const GROUPS: Record<string, (env: Env) => Promise<void>> = {
  // 하루 3번: 교육청 게시판은 한 번에 최신 10건만 보여서 자주 본다
  edu: async env => { await cbeBoard(env); await cbeMpool(env); await fillDetails(env, 15); await notify(env); await geocodePending(env, 8); },
  childcare_cb: async env => { await childcare(env, 'chungbuk'); await fillDetails(env, 15); await notify(env); await fillChildcareAddress(env, 6); await geocodePending(env, 6); },
  childcare_sj: async env => { await childcare(env, 'sejong'); await fillDetails(env, 15); await fillChildcareAddress(env, 6); await geocodePending(env, 6); },
  schools_1: async env => { await sejongSchools(env, 1); },
  schools_2: async env => { await sejongSchools(env, 2); await sssc(env); await fillDetails(env, 15); },
  // 한 번만 수동 실행: 이미 뒤로 밀려난 공고 채우기 (무료 요금제 요청 한도 안에서 약 40페이지 = 400건)
  backfill_cbe: async env => { await cbeBoard(env, 40, true); },
  backfill_mpool: async env => { await cbeMpool(env, 40, true); },
  // 기관 위치를 한꺼번에 채우기 (수동, 실행당 20곳 · 무료 요금제 요청 한도)
  geo: async env => { await fillChildcareAddress(env, 8); await geocodePending(env, 15); },
};

// wrangler.toml의 crons 순서와 맞춘다 (UTC 기준)
export const CRON_TO_GROUP: Record<string, string> = {
  '7 1,5,9 * * *': 'edu',           // 한국 10:07, 14:07, 18:07
  '27 1 * * *': 'childcare_cb',     // 10:27
  '37 1 * * *': 'childcare_sj',     // 10:37
  '47 1 * * *': 'schools_1',        // 10:47
  '57 1 * * *': 'schools_2',        // 10:57
};
