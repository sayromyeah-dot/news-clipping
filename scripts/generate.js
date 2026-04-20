#!/usr/bin/env node
'use strict';
const fs   = require('fs');
const path = require('path');

// ── 날짜 유틸 ──────────────────────────────────────
const KST      = () => new Date(Date.now() + 9 * 3600 * 1000);
const pad2      = n  => String(n).padStart(2, '0');
const todayStr = () => { const d = KST(); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth()+1)}-${pad2(d.getUTCDate())}`; };
const todayKo  = () => { const d = KST(); return `${d.getUTCFullYear()}년 ${d.getUTCMonth()+1}월 ${d.getUTCDate()}일`; };
const dayKoStr = () => ['일','월','화','수','목','금','토'][KST().getUTCDay()] + '요일';
const dayShort = () => ['SUN','MON','TUE','WED','THU','FRI','SAT'][KST().getUTCDay()];
const dayNum   = () => pad2(KST().getUTCDate());
const monthKo  = () => `${KST().getUTCMonth()+1}월`;
const monthEn  = () => ['January','February','March','April','May','June','July','August','September','October','November','December'][KST().getUTCMonth()];
const yearStr  = () => String(KST().getUTCFullYear());

// ── 구글 실시간 뉴스 검색 (RSS) ──────────────────────────────────
async function getRealtimeNews(query) {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`;
    const res = await fetch(url);
    const xml = await res.text();
    return xml.split('<item>').slice(1, 12).map(it => {
      const title = it.split('<title>')[1]?.split('</title>')[0] || '';
      const link = it.split('<link>')[1]?.split('</link>')[0] || '';
      const source = it.split('<source')[1]?.split('>')[1]?.split('</source>')[0] || '뉴스';
      return `제목: ${title} / 출처: ${source} / 링크: ${link}`;
    }).join('\n');
  } catch (e) { return '최신 뉴스 수집 불가'; }
}

// ── Claude API 호출 (404 에러 및 문법 에러 해결) ──────────────────────
async function callClaude(system, user, maxTokens = 3500) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY 환경변수가 없습니다');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: "claude-3-haiku-20240307", 
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Claude API 오류: ${res.status} - ${txt}`);
  }
  const data = await res.json();
  return data.content[0].text;
}

function parseJSON(raw) {
  const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  return JSON.parse(cleaned);
}

// ── 뉴스 카드 HTML 빌더 (기존 디자인 유지) ──────────────────────
function buildCard(item, index, extraClass = '') {
  const num    = String(index + 1).padStart(2, '0');
  const hasUrl = item.url && item.url.startsWith('http');
  const tag0   = hasUrl ? `<a class="news-card${extraClass}" href="${encodeURI(item.url)}" target="_blank">` : `<div class="news-card${extraClass}">`;
  const tag1   = hasUrl ? '</a>' : '</div>';
  const badgeMap = { official: 'badge-official', press: 'badge-press', research: 'badge-research' };
  const labelMap = { official: '공식발표', press: '언론보도', research: '리서치' };
  const badge    = item.sourceType ? `<span class="nc-src-badge ${badgeMap[item.sourceType] || 'badge-press'}">${labelMap[item.sourceType] || ''}</span>` : '';

  return `${tag0}
    <div class="nc-num">${num}</div>
    <div>
      <div class="nc-tags"><span class="nc-tag ${item.tagClass || 'tag-mkt'}">${item.tag || '뉴스'}</span></div>
      <div class="nc-title">${item.title || ''}</div>
      <div class="nc-desc">${item.desc || ''}</div>
      ${item.marketingTip ? `<div class="nc-mkt-tip">${item.marketingTip}</div>` : ''}
      <div class="nc-footer"><span class="nc-src">${item.source || ''}${badge}</span><span class="nc-link">원문 보기 →</span></div>
    </div>
  ${tag1}`;
}

// ── 시장 데이터 수집 (USD) ──────────────────────────────────
async function fetchMarketData() {
  const result = { usd: null };
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/USD');
    const d = await r.json();
    if (d.rates?.KRW) result.usd = Math.round(d.rates.KRW);
  } catch (e) { console.error('USD 실패'); }
  return result;
}

// ── 섹션 생성 함수들 (기존 디자인 복구) ──────────────────

async function genInsuranceNews() {
  const ctx = await getRealtimeNews('보험 신상품 달러보험 시니어 상속세');
  const raw = await callClaude("AIA 에디터입니다.", `뉴스:\n${ctx}\n\nJSON 배열(5건)로 요약: [{"tag":"카테고리","tagClass":"tag-new","title":"제목","desc":"요약","marketingTip":"팁","source":"출처","sourceType":"press","url":"링크"}]`);
  try { const arr = parseJSON(raw); return { html: arr.map((item, i)
