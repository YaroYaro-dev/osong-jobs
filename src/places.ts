// 지역 분류: '오송', '조치원' 태그
// 원칙: 확인된 주소로만 분류한다.
//  - 어린이집: 상세 페이지 소재지에 '오송읍' / '조치원읍'이 있을 때
//  - 교육청 게시판 공고(주소 칸 없음): 아래 '주소를 확인한 기관' 목록에 있을 때
// 기관을 추가할 때는 실제 주소를 확인하고 주석으로 남긴다.

export const OSONG_ORGS: { match: string; address: string }[] = [
  { match: '오송유치원', address: '청주시 흥덕구 오송읍 오송생명3로 101' },
  { match: '오송솔미유치원', address: '청주시 흥덕구 오송읍 봉산3길 7' },
  { match: '오송솔미초', address: '청주시 흥덕구 오송읍 오송생명12로 83' },
  { match: '솔강초', address: '청주시 흥덕구 오송읍 오송생명8로 95' },
  { match: '오송초', address: '청주시 흥덕구 오송읍 (오송초등학교병설유치원)' },
  { match: '만수초', address: '청주시 흥덕구 오송읍 (만수초등학교병설유치원)' },
];

export const JOCHIWON_ORGS: { match: string; address: string }[] = [
  { match: '조치원', address: '세종시 조치원읍 (기관명에 조치원이 들어간 학교·병설유치원)' },
  { match: '조치원교동초', address: '세종시 조치원읍 (조치원교동초등학교병설유치원)' },
];

export function tags(j: { title: string; organization: string; place: string | null; source: string }) {
  const place = j.place || '';
  const text = `${j.organization} ${j.title}`;
  // 통합 모집(학교지원본부)은 특정 기관 지역으로 분류하지 않는다. 어린이집은 상세 주소로만 판단한다.
  const byOrg = j.source !== 'sssc' && !j.source.endsWith('-child');
  // 긴 이름부터 맞춰 본다 (예: '오송솔미유치원'이 '오송유치원'보다 먼저)
  const osongOrg = byOrg ? [...OSONG_ORGS].sort((a, b) => b.match.length - a.match.length).find(o => text.includes(o.match)) : undefined;
  const jochiwonOrg = byOrg ? JOCHIWON_ORGS.find(o => j.organization.includes(o.match)) : undefined;
  return {
    osong: place.includes('오송읍') || osongOrg ? 1 : 0,
    jochiwon: place.includes('조치원읍') || jochiwonOrg ? 1 : 0,
    address: osongOrg?.address ?? null,     // 화면 표시용 기관 주소
  };
}
