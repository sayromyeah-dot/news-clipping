#!/usr/bin/env node
/**
 * AIA 상품마케팅 뉴스클리핑 — 자동 생성기 (최종 통합 버전)
 * 기능: 기존 디자인 유지 + 구글 실시간 뉴스 검색 + 클로드 요약
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

// ── 구글 실시간 뉴스 검색 (RSS) ──────────────────────────────────
async function getRealtimeNews(query) {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`;
    const res = await fetch(url);
    const xml = await res.text();
    const items = xml.split('<item>').slice(1, 15); // 상위 15개 뉴스 추출
    return items.map(it => {
      const title = it.split('<title>')[1]?.split('</title>')[0] || '';
      const link = it.split('<link>')[1]?.split('</link>')[0] || '';
      const source = it.split('<source')[1]?.split('>')[1]?.split('</source>')[0] || '뉴스';
      return `제목: ${title} / 출처: ${source} / 링크: ${link}`;
    }).join('\n');
  } catch (e) {
    console.error('검색 실패:', e.message);
    return '최신 뉴스를 가져오는 데 실패했습니다.';
  }
}

// ── Claude API 호출 (가장 안정적인 모델 사용) ──────────────────────
async function callClaude(system, user, maxTokens = 3500) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY 환경변수가 없습니다');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':          key,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: "claude-3-haiku-20240307", // 에러 없는 가장 안정적인 모델
      max
