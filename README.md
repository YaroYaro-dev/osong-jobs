# 오송 유치원·어린이집 채용 공고 (Cloudflare 버전)

Cloudflare Workers가 정해진 시간마다 게시판을 읽고, D1 데이터베이스에 쌓고, 웹페이지로 보여줍니다.

## 수집 출처와 시간 (한국시간)

| 시간 | 출처 |
|---|---|
| 10:07 · 14:07 · 18:07 | 충북교육청 학교구인정보(유치원), 충북교육청 기간제교사 인력풀(유치원) |
| 10:27 | 충북육아종합지원센터 어린이집 구인 (흥덕구 + 청주 간호 공고) |
| 10:37 | 세종육아종합지원센터 어린이집 구인 |
| 10:47 · 10:57 | 세종 유치원·학교 홈페이지 48곳, 세종교육청 학교지원본부 |

- 교육청 게시판은 한 번에 최신 10건만 보여서 하루 3번 확인합니다.
- 세종교육청 본청 게시판은 사이트가 자동 수집을 거부(robots.txt)해서 넣지 않았습니다.
- 수집에 실패해도 기존 데이터는 지워지지 않고, 실패 내용은 페이지 아래 '수집 현황'에 출처별로 표시됩니다.

## 지역 분류

- **오송**
  - 어린이집: 상세 페이지 소재지에 '오송읍'이 있을 때
  - 교육청 공고: 주소를 확인해 둔 오송 기관일 때 (`src/places.ts`)
- **조치원:** 소재지에 '조치원읍'이 있거나, 조치원 학교 게시판일 때
- 학교지원본부 통합 모집은 특정 지역으로 분류하지 않습니다.
- 마감일을 확인하지 못하면 '미확인'으로 두고, 추정해서 넣지 않습니다.

---

## 자동 배포 (GitHub 연결됨)

이 저장소의 `main` 브랜치에 커밋이 올라가면 Cloudflare Workers Builds가 자동으로 `npx wrangler deploy`를 실행합니다.
진행 상황은 Cloudflare 대시보드 → osong-jobs → Deployments에서 볼 수 있습니다.
비밀값(ADMIN_TOKEN, RESEND_API_KEY 등)과 D1 데이터는 Cloudflare에 있어서 배포해도 그대로 유지됩니다.

## 처음 올리기 (Windows, 한 번만)

1. **Node.js 설치:** https://nodejs.org 에서 LTS 버전을 받아 설치합니다.
2. **명령 창 열기:** 압축을 푼 `osong-jobs-worker` 폴더를 열고, 위쪽 주소창에 `cmd`를 입력한 뒤 Enter를 누릅니다.
3. **필요한 프로그램 설치:**
   ```
   npm install
   ```
4. **Cloudflare 로그인:** 브라우저가 열리면 **Allow**를 누릅니다.
   ```
   npx wrangler login
   ```
5. **데이터베이스 만들기:**
   ```
   npx wrangler d1 create osong-jobs
   ```
   결과에 나온 `database_id = "xxxxxxxx-...."`의 따옴표 안 값을 복사합니다.
   `wrangler.toml`을 메모장으로 열고 `여기에-d1-create-결과의-database_id-붙여넣기` 자리에 붙여넣은 뒤 저장합니다.
6. **표 만들기:**
   ```
   npm run db:init
   ```
   "Do you want to continue?"가 나오면 `y`를 누릅니다.
7. **올리기:**
   ```
   npm run deploy
   ```
   마지막에 나오는 `https://osong-jobs.○○○.workers.dev` 가 내 사이트 주소입니다.

이제 위 시간표대로 자동 수집됩니다. 첫 수집 전까지는 페이지가 비어 있습니다.

## 바로 한 번 수집하기 (선택)

다음 날 아침까지 기다리지 않고 바로 채우려면 이렇게 합니다.

1. 관리용 비밀번호를 정합니다. 입력창이 나오면 아무 긴 문자열이나 넣으세요.
   ```
   npx wrangler secret put ADMIN_TOKEN
   ```
2. 아래 다섯 줄을 하나씩 실행합니다. `비밀번호`와 사이트 주소는 내 것으로 바꿉니다.
   ```
   curl -X POST -H "Authorization: Bearer 비밀번호" "https://osong-jobs.○○○.workers.dev/api/update?group=edu"
   curl -X POST -H "Authorization: Bearer 비밀번호" "https://osong-jobs.○○○.workers.dev/api/update?group=childcare_cb"
   curl -X POST -H "Authorization: Bearer 비밀번호" "https://osong-jobs.○○○.workers.dev/api/update?group=childcare_sj"
   curl -X POST -H "Authorization: Bearer 비밀번호" "https://osong-jobs.○○○.workers.dev/api/update?group=schools_1"
   curl -X POST -H "Authorization: Bearer 비밀번호" "https://osong-jobs.○○○.workers.dev/api/update?group=schools_2"
   ```
3. 사이트를 새로고침하고, 맨 아래 **수집 현황**에서 출처마다 성공·실패를 확인합니다.

**처음 한 번은 지난 공고도 채워 넣으세요.** 교육청 게시판에서 이미 뒤로 밀려난 공고를 가져와요. 알림은 보내지 않아요.
```
curl -X POST -H "Authorization: Bearer 비밀번호" "https://osong-jobs.○○○.workers.dev/api/update?group=backfill_cbe"
curl -X POST -H "Authorization: Bearer 비밀번호" "https://osong-jobs.○○○.workers.dev/api/update?group=backfill_mpool"
```

어린이집 공고의 오송·조치원 표시는 상세 페이지를 읽은 뒤에 붙습니다. 한 번에 20~25건씩 읽어서, 처음 하루 이틀은 표시가 조금씩 늘어납니다.

## 새 오송 공고 이메일 알림 (선택)

1. https://resend.com 에 가입하고 API Key를 만듭니다.
2. 아래 명령으로 등록합니다.
   ```
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put NOTIFY_TO
   ```
   `NOTIFY_TO`에는 알림을 받을 내 이메일 주소를 넣습니다.

교육청 게시판과 충북 어린이집 수집 뒤에 새 오송 공고가 있으면 메일이 옵니다. 처음 수집한 공고는 알림을 보내지 않고, 그 뒤에 새로 나온 것만 보냅니다.

## 알아둘 것

- **사이트 주소:** 주소를 아는 사람은 누구나 볼 수 있습니다. 공개된 채용 공고만 담겨 있습니다. 관심 공고(★)는 각자 브라우저에만 저장됩니다. 나만 보게 하려면 Cloudflare 대시보드 → Zero Trust → Access로 잠글 수 있습니다.
- **무료 요금제:** 실행 한 번에 외부 요청 50개, 자동 실행 시간 5개까지라 그 안에 맞춰 나눠 두었습니다.
- **오송 기관 추가:** `src/places.ts`에 주소를 확인하고 넣은 뒤 `npm run deploy`를 다시 실행합니다.
- **문제 확인:** Cloudflare 대시보드 → Workers → osong-jobs → Logs에서 실행 기록을 볼 수 있습니다.

## 파일

| 파일 | 내용 |
|---|---|
| `src/parse.ts` | 게시판별 목록 읽기, 날짜·접수마감 추출 |
| `src/places.ts` | 오송·조치원 분류 기준 |
| `src/collect.ts` | 출처별 수집, 저장, 상세 보충, 알림, 실행 묶음 |
| `src/index.ts` | 자동 실행 진입점, `/api/jobs`, `/api/update` |
| `src/page.html` | 웹페이지 |
| `src/sejong-feeds.json` | 세종 유치원·학교 게시판 목록 |
| `schema.sql` | 데이터베이스 표 |
| `test/parse.test.ts` | 실제 사이트 없이 파서 확인 (`npm test`) |
