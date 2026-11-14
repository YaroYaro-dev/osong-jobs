-- 공고
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,           -- 출처:게시물번호
  source TEXT NOT NULL,
  region TEXT NOT NULL,          -- 충북 / 세종
  type TEXT NOT NULL,            -- 유치원 / 어린이집 / 어린이집 간호
  title TEXT NOT NULL,
  organization TEXT NOT NULL,
  place TEXT,                    -- 확인된 소재지
  osong INTEGER NOT NULL DEFAULT 0,
  jochiwon INTEGER NOT NULL DEFAULT 0,
  posted TEXT NOT NULL,
  deadline TEXT,                 -- 확인 못 하면 NULL ('미확인'), 추정해서 넣지 않음
  url TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  detail_checked INTEGER NOT NULL DEFAULT 0,
  notified INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS jobs_posted ON jobs(posted);
CREATE INDEX IF NOT EXISTS jobs_osong ON jobs(osong, notified);
CREATE INDEX IF NOT EXISTS jobs_detail ON jobs(detail_checked);

-- 출처별 수집 상태
CREATE TABLE IF NOT EXISTS source_states (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  attempted TEXT NOT NULL,
  succeeded TEXT,
  error TEXT,
  count INTEGER NOT NULL DEFAULT 0
);
