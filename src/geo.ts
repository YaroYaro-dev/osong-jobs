// 기관 좌표 찾기 (카카오 로컬 API) + 저장
// - 공고마다 '찾을 이름'을 정하고(geoKey), 한 번 찾은 결과는 geo 표에 저장해 다시 찾지 않는다.
// - 내 위치와의 거리는 브라우저에서 계산한다 (내 위치는 서버로 보내지 않음).
import type { Env } from './collect';
import { OSONG_ORGS, CHILD_ADDR } from './places.ts';

export type GeoRow = { key: string; lat: number | null; lng: number | null; label: string | null; status: string };

const ORG_WORDS = /(초등학교병설유치원|초병설유치원|병설유치원|유치원|어린이집|초등학교|학교)/;

/** 제목에서 기관명 뽑기: '2026학년도 오송솔미유치원 겨울방학 …' → '오송솔미유치원' */
function orgFromTitle(title: string): string | null {
  const m = title.match(/([가-힣A-Za-z0-9]{2,20}?(초등학교병설유치원|초병설유치원|병설유치원|유치원|어린이집|초등학교))/);
  return m ? m[1].replace(/^(\d{4}학년도|\d{4}\.?)/, '') : null;
}

/**
 * 공고 → 좌표를 찾을 검색어. 같은 기관이면 같은 값이 나와야 저장분을 다시 쓴다.
 * 형식: 'addr:<주소>' 또는 'name:<지역> <기관명>'. 찾을 수 없으면 null (통합 모집 등)
 */
export function geoKey(j: { source: string; region: string; title: string; organization: string; place: string | null }): string | null {
  if (j.source === 'sssc') return null;                         // 여러 유치원 통합 모집
  const known = [...OSONG_ORGS].sort((a, b) => b.match.length - a.match.length)
    .find(o => `${j.organization} ${j.title}`.includes(o.match));
  if (known) return `addr:${known.address.replace(/\s*\(.*\)$/, '')}`;
  const place = (j.place || '').replace(/\s*(담당자명?|전화번호?|연락처|시설장|팩스|이메일|홈페이지)[\s\S]*$/, '').trim();
  // 도로명·지번까지 있는 상세 주소면 주소로 찾는다
  if (/(로|길)\s?\d|\d+-\d+|(읍|면|동)\s\d/.test(place)) return `addr:${place}`;
  let org = j.organization.split(' · ')[0].trim();
  if (j.source === 'mpool') org = j.organization.split(' · ')[1]?.trim() || '';
  if (!ORG_WORDS.test(org)) org = orgFromTitle(j.title) || '';   // 작성자가 사람 이름인 경우
  if (!org) return null;
  // '병설유치원'은 지도에 학교 이름으로 올라가 있는 경우가 많다
  org = org.replace(/(초등학교병설유치원|초병설유치원)$/, '초등학교').replace(/병설유치원$/, '');
  // 공고에 동네(읍·면·동)가 적혀 있으면 같이 넣어, 같은 이름의 다른 지역 기관과 헷갈리지 않게 한다
  const area = (place.match(/[가-힣][가-힣0-9]*(읍|면|동)(?=\s|$)/g) || []).pop();
  if (area && CHILD_ADDR[`${org}@${area}`]) return `addr:${CHILD_ADDR[`${org}@${area}`]}`;
  return `name:${j.region === '세종' ? '세종' : '충북'} ${org}${area ? '@' + area : ''}`;
}

async function kakao(env: Env, path: string, query: string) {
  const r = await fetch(`https://dapi.kakao.com/v2/local/search/${path}.json?query=${encodeURIComponent(query)}&size=5`, {
    headers: { Authorization: `KakaoAK ${env.KAKAO_REST_KEY}` }, signal: AbortSignal.timeout(10000),
  });
  if (r.status === 401 || r.status === 403) throw new Error(`카카오 키 오류 ${r.status} (키 또는 카카오맵 사용 설정 확인)`);
  if (!r.ok) throw new Error(`카카오 응답 ${r.status}`);
  return (await r.json() as { documents: any[] }).documents || [];
}

/** 검색어 하나를 좌표로. 지역(충북/세종)이 맞는 결과만 쓴다 */
export async function lookup(env: Env, key: string): Promise<{ lat: number; lng: number; label: string; approx?: boolean } | null> {
  if (key.startsWith('addr:')) {
    const q = key.slice(5);
    const docs = await kakao(env, 'address', q);
    const d = docs[0] || (await kakao(env, 'keyword', q))[0];
    return d ? { lat: +d.y, lng: +d.x, label: d.road_address?.address_name || d.address_name || d.place_name || q } : null;
  }
  const [q, area] = key.slice(5).split('@');     // '충북 꿈채움어린이집', '오송읍'
  const region = q.split(' ')[0];
  const name = q.slice(region.length + 1);
  const docs = [...(area ? await kakao(env, 'keyword', `${area} ${name}`) : []), ...await kakao(env, 'keyword', q)];
  const inRegion = (d: any) => region === '세종' ? /세종/.test(d.address_name) : /(충북|충청북도)/.test(d.address_name);
  const sameName = (d: any) => d.place_name.replace(/\s/g, '').includes(name.replace(/\s/g, ''));
  const areaWord = area?.replace(/\d+(동)$/, '');   // '복대1동'(행정동) → '복대' 로 '복대동'과도 맞게
  const inArea = (d: any) => !areaWord || `${d.address_name} ${d.road_address_name || ''}`.includes(areaWord);
  const pick = docs.find(d => inRegion(d) && inArea(d) && sameName(d))
    || (area ? null : docs.find(d => inRegion(d) && sameName(d)))      // 동네가 적혀 있는데 거기 없으면 다른 동네 것은 쓰지 않음
    || (area ? null : docs.find(d => inRegion(d) && /(유치원|어린이집|초등학교)/.test(d.category_name || '')));
  if (!pick && area) {                           // 지도에 없는 기관(아파트 안 가정어린이집 등) → 동네 중심으로 대략
    const a = (await kakao(env, 'address', `${region} ${area}`)).find(inRegion);
    if (a) return { lat: +a.y, lng: +a.x, label: a.address_name, approx: true };
  }
  return pick ? { lat: +pick.y, lng: +pick.x, label: pick.road_address_name || pick.address_name } : null;
}

export async function ensureGeoTable(env: Env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS geo (key TEXT PRIMARY KEY, lat REAL, lng REAL, label TEXT, status TEXT NOT NULL, checked TEXT NOT NULL)`).run();
  // 동네 기준 대략 위치가 생기기 전에 '못 찾음'으로 남은 것은 한 번 더 찾아 본다
  await env.DB.prepare(`DELETE FROM geo WHERE status='notfound' AND checked < '2026-11-14T04:30:00Z'`).run();
}

/** 아직 좌표가 없는 기관을 budget개까지 찾아서 저장 */
export async function geocodePending(env: Env, budget = 15) {
  if (!env.KAKAO_REST_KEY) return;
  await ensureGeoTable(env);
  const jobs = await env.DB.prepare(`SELECT source, region, title, organization, place FROM jobs
      WHERE posted >= date('now','-180 days') ORDER BY osong DESC, jochiwon DESC, posted DESC LIMIT 1500`).all<any>();
  const known = new Set((await env.DB.prepare(`SELECT key FROM geo`).all<{ key: string }>()).results.map(r => r.key));
  const todo: string[] = [];
  for (const j of jobs.results) {
    const k = geoKey(j);
    if (k && !known.has(k) && !todo.includes(k)) todo.push(k);
    if (todo.length >= budget) break;
  }
  const now = new Date().toISOString();
  const rows: D1PreparedStatement[] = [];
  for (const k of todo) {
    try {
      const g = await lookup(env, k);
      rows.push(env.DB.prepare(`INSERT OR REPLACE INTO geo (key,lat,lng,label,status,checked) VALUES (?,?,?,?,?,?)`)
        .bind(k, g?.lat ?? null, g?.lng ?? null, g?.label ?? null, g ? (g.approx ? 'area' : 'ok') : 'notfound', now));
    } catch (e) {
      if (e instanceof Error && /키 오류/.test(e.message)) {           // 키 문제면 수집 현황에 남기고 멈춤
        await env.DB.prepare(`INSERT INTO source_states (id,name,attempted,succeeded,error,count) VALUES ('geo','기관 위치 찾기 (카카오)',?,NULL,?,0)
          ON CONFLICT(id) DO UPDATE SET attempted=excluded.attempted, error=excluded.error`).bind(now, e.message).run();
        break;
      }
    }
  }
  if (rows.length) await env.DB.batch(rows);
  const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM geo WHERE status IN ('ok','area')`).first<{ n: number }>();
  const miss = await env.DB.prepare(`SELECT COUNT(*) AS n FROM geo WHERE status='notfound'`).first<{ n: number }>();
  
  if (rows.length) {
    await env.DB.prepare(`INSERT INTO source_states (id,name,attempted,succeeded,error,count) VALUES ('geo','기관 위치 찾기 (카카오)',?,?,NULL,?)
      ON CONFLICT(id) DO UPDATE SET attempted=excluded.attempted, succeeded=excluded.succeeded, error=NULL, count=excluded.count`)
      .bind(now, now, total?.n ?? 0).run();
    await env.DB.prepare(`UPDATE source_states SET name=? WHERE id='geo'`).bind(`기관 위치 찾기 (카카오) · 찾음 ${total?.n ?? 0} / 못 찾음 ${miss?.n ?? 0}`).run();
  }
}
