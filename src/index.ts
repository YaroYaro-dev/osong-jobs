import { Env, GROUPS, CRON_TO_GROUP } from './collect';
import PAGE from './page.html';
import { geoKey, lookup, ensureGeoTable, GeoRow } from './geo';

export default {
  // 정해진 시간에 자동 수집
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    const group = CRON_TO_GROUP[event.cron];
    if (group) ctx.waitUntil(GROUPS[group](env));
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
    }

    if (url.pathname === '/api/jobs') {
      const jobs = await env.DB.prepare(`SELECT id,source,region,type,title,organization,place,osong,jochiwon,posted,deadline,url,first_seen
        FROM jobs WHERE posted >= date('now','-180 days') ORDER BY posted DESC, first_seen DESC LIMIT 2000`).all();
      const states = await env.DB.prepare('SELECT * FROM source_states ORDER BY id').all();
      // 기관 좌표 붙이기
      await ensureGeoTable(env);
      const geo = new Map((await env.DB.prepare(`SELECT key,lat,lng,label,status FROM geo WHERE status='ok'`).all<GeoRow>()).results.map(g => [g.key, g]));
      const list = (jobs.results as any[]).map(j => {
        const g = geo.get(geoKey(j) || '');
        return g ? { ...j, lat: g.lat, lng: g.lng } : j;
      });
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
