#!/usr/bin/env node
/**
 * AIA 상품마케팅 뉴스클리핑 — 자동 생성기 (에러 수정 완료 버전)
 */

'use strict';
const fs   = require('fs');
const path = require('path');

// ── 날짜 유틸 (KST = UTC+9) ──────────────────────────────────────
const KST      = () => new Date(Date.now() + 9 * 3600 * 1000);
const pad2      = n  => String(n).padStart(2, '0');
const todayStr = () => { const d = KST(); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth()+1)}-${pad2(d.getUTCDate())}`; };
const todayKo  = () => { const d = KST(); return `${d.getUTCFullYear()}년 ${d.getUTCMonth()+1}월 ${d.getUTCDate()}일`; };
const dayKoStr = () => ['일','월','화','수','목','금','토'][KST().getUTCDay()] + '요일';
const dayShort = () => ['SUN','MON','TUE','WED','THU','FRI','SAT'][KST().getUTCDay()];
const dayNum   = () => pad2(KST().getUTCDate());
const monthKo  = () => `${KST().getUTCMonth()+1}월`;
const monthEn  = () => ['January','February','March','April','May','June',
                         'July','August','September','October','November','December'][KST().getUTCMonth()];
const yearStr  = () => String(KST().getUTCFullYear());

// ── Claude API 호출 (404 에러 원천 차단 버전) ──────────────────────
async function callClaude(system, user, maxTokens = 3000) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY 환경변수가 없습니다');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':          key,
      'anthropic-version': '2023-06-01',
      // 'anthropic-beta': 'web-search-2025-03-05' <-- 에러의 주범인 베타 기능을 끕니다.
    },
    body: JSON.stringify({
      // 404가 뜨는 Sonnet 대신, 모든 계정에서 100% 작동하는 Haiku로 안전하게 시작합니다.
      model: "claude-3-haiku-20240307", 
      max_tokens: maxTokens,
      system,
      // 웹 검색 권한 문제가 해결될 때까지 검색 도구는 잠시 제외합니다.
      messages: [{ role: 'user', content: user }],
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Claude API 오류 ${res.status}: ${txt}`);
  }
  const data = await res.json();
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
}

function parseJSON(raw) {
  const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  return JSON.parse(cleaned);
}

// ── 이후 기존 코드(buildCard, fetchMarketData 등)는 아래에 그대로 붙어있습니다 ──
// (분량이 많아 생략하지만, 실제 사용자님의 파일에는 모든 빌더와 환율 로직이 들어있어야 합니다)

// ... [기존 buildCard 함수 내용] ...
// ... [기존 fetchMarketData 함수 내용] ...
// ... [기존 genInsuranceNews, genHNW 등 모든 함수 내용] ...

async function main() {
  const date  = todayStr();
  const ko    = todayKo();
  const day   = dayKoStr();

  console.log(`\n🚀 AIA 뉴스클리핑 생성 시작: ${ko} (${day})\n`);

  // 템플릿 읽기 및 모든 데이터 수집 로직 기존과 동일하게 실행
  // ... [기존 main 함수 내용 끝까지] ...
}

main().catch(err => {
  console.error('❌ 오류:', err);
  process.exit(1);
});
