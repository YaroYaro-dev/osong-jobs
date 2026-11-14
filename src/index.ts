import { Env, GROUPS, CRON_TO_GROUP, fillChildcareAddress } from './collect';
import PAGE from './page.html';
import { geoKey, geocodePending, lookup, ensureGeoTable, GeoRow } from './geo';

export default {
  // 정해진 시간에 자동 수집
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    let group = CRON_TO_GROUP[event.cron];
    // 어린이집 크론은 하루 두 번: 한국 10:27 충북, 22:27 충남 (무료 요금제 크론 5개 제한)
    if (group === 'childcare_cb' && new Date(event.scheduledTime).getUTCHours() === 13) group = 'childcare_cn';
    if (group) ctx.waitUntil(GROUPS[group](env));
  },

  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
    }

    if (url.pathname === '/api/jobs') {
      const jobs = await env.DB.prepare(`SELECT *
        FROM jobs WHERE posted >= date('now','-180 days') ORDER BY posted DESC, first_seen DESC LIMIT 2000`).all();
      const states = await env.DB.prepare('SELECT * FROM source_states ORDER BY id').all();
      // 기관 좌표 붙이기
      await ensureGeoTable(env);
      const geo = new Map((await env.DB.prepare(`SELECT key,lat,lng,label,status FROM geo`).all<GeoRow>()).results.map(g => [g.key, g]));
      let missing = 0;
      const list = (jobs.results as any[]).map(j => {
        const k = geoKey(j);
        const g = k ? geo.get(k) : undefined;
        if (k && !g) missing++;
        return g && g.lat != null ? { ...j, lat: g.lat, lng: g.lng, approx: g.status === 'area' ? 1 : undefined, geo_label: g.label } : j;
      });
      // 아직 위치를 모르는 기관이 있으면, 페이지를 연 김에 뒤에서 조금씩 찾아 둔다 (다음 새로고침부터 거리 표시)
      const needAddr = (jobs.results as any[]).some(j => j.source.endsWith('-child') && !/(로|길)\s?\d/.test(j.place || '') && !j.addr_checked);
      if ((missing || needAddr) && env.KAKAO_REST_KEY) ctx.waitUntil((async () => {
        await fillChildcareAddress(env, 6).catch(() => {});
        await geocodePending(env, 12).catch(() => {});
      })());
      return Response.json({ jobs: list, states: states.results }, { headers: { 'cache-control': 'no-store' } });
    }

    // 내 위치를 주소로 찾기: GET /api/geocode?q=오송읍 오송생명1로 194  (내 위치는 저장하지 않고 좌표만 돌려줌)
    if (url.pathname === '/api/geocode') {
      const q = (url.searchParams.get('q') || '').trim().slice(0, 80);
      if (!q) return Response.json({ error: '주소를 입력하세요' }, { status: 400 });
      if (!env.KAKAO_REST_KEY) return Response.json({ error: '아직 주소 검색이 설정되지 않았어요 (카카오 키 필요)' }, { status: 503 });
      try {
        const g = await lookup(env, `addr:${q}`);
        return g ? Response.json(g) : Response.json({ error: '주소를 찾지 못했어요' }, { status: 404 });
      } catch (e) { return Response.json({ error: e instanceof Error ? e.message : '주소 검색 실패' }, { status: 502 }); }
    }

    // 수동 갱신: POST /api/update?group=edu  (Authorization: Bearer <ADMIN_TOKEN>)
    if (url.pathname === '/api/update' && req.method === 'POST') {
      if (!env.ADMIN_TOKEN || req.headers.get('authorization') !== `Bearer ${env.ADMIN_TOKEN}`) {
        return new Response('unauthorized', { status: 401 });
      }
      const group = url.searchParams.get('group') || 'edu';
      if (!GROUPS[group]) return new Response(`group: ${Object.keys(GROUPS).join(', ')}`, { status: 400 });
      await GROUPS[group](env);
      return Response.json({ ok: true, group });
    }

    return new Response('not found', { status: 404 });
  },
};
