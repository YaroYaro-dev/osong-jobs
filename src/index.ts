import { Env, GROUPS, CRON_TO_GROUP } from './collect';
import PAGE from './page.html';

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
      return Response.json({ jobs: jobs.results, states: states.results }, { headers: { 'cache-control': 'no-store' } });
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
