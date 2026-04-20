#!/usr/bin/env node
/**
 * AIA 상품마케팅 뉴스클리핑 — 자동 생성기 (최종 통합본)
 * 기존 디자인 및 모든 섹션 유지 + 실시간 뉴스 + API 에러 수정
 */

'use strict';
const fs   = require('fs');
const path = require('path');

// ── 날짜 유틸 (기존 유지) ──────────────────────────────────────
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

// ── 실시간 뉴스 검색 (RSS) ──────────────────────────────────
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

// ── Claude API 호출 (404 에러 해결) ──────────────────────
async function callClaude(system, user, maxTokens = 3500) {
  const key = process.env.ANTHROPIC_API_KEY;
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
  if (!res.ok) throw new Error(`Claude API 오류: ${res.status}`);
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
      <div class="nc-tags"><span class="nc-tag ${item.tagClass || 'tag-mkt'}">${item.tag || ''}</span></div>
      <div class="nc-title">${item.title || ''}</div>
      <div class="nc-desc">${item.desc || ''}</div>
      ${item.marketingTip ? `<div class="nc-mkt-tip">${item.marketingTip}</div>` : ''}
      <div class="nc-footer"><span class="nc-src">${item.source || ''}${badge}</span><span class="nc-link">원문 보기 →</span></div>
    </div>
  ${tag1}`;
}

// ── 시장 데이터 수집 (기존 유지) ──────────────────────────────────
async function fetchMarketData() {
  const result = { usd: null, kospi: null };
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/USD');
    const d = await r.json();
    if (d.rates?.KRW) result.usd = Math.round(d.rates.KRW);
  } catch (e) { console.error('USD 실패'); }
  return result;
}

// ── 섹션 생성 함수들 (기존의 모든 섹션 디자인 복구) ──────────────────

async function genInsuranceNews() {
  const ctx = await getRealtimeNews('보험 신상품 달러보험 시니어 상속세');
  const raw = await callClaude("AIA 에디터입니다.", `뉴스:\n${ctx}\n\nJSON 배열(5건)로 요약: [{"tag":"카테고리","tagClass":"tag-new","title":"제목","desc":"요약","marketingTip":"팁","source":"출처","sourceType":"press","url":"링크"}]`);
  try { const arr = parseJSON(raw); return { html: arr.map((item, i) => buildCard(item, i)).join(''), count: arr.length }; }
  catch (e) { return { html: '', count: 0 }; }
}

async function genHNW() {
  const ctx = await getRealtimeNews('자산가 투자 PB WM 트렌드');
  const raw = await callClaude("HNW 리서처입니다.", `뉴스:\n${ctx}\n\nJSON(4건): [{"tag":"투자트렌드","tagClass":"tag-hnw","title":"제목","desc":"요약","marketingTip":"팁","source":"출처","sourceType":"press","url":"링크"}]`);
  try { return parseJSON(raw).map((item, i) => buildCard(item, i, ' hnw-card')).join(''); } catch (e) { return ''; }
}

async function genTax() {
  const ctx = await getRealtimeNews('상속세 증여세 절세 보험');
  const raw = await callClaude("세무 전문가입니다.", `뉴스:\n${ctx}\n\nJSON(4건): [{"tag":"세무","tagClass":"tag-tax","title":"제목","desc":"요약","marketingTip":"팁","source":"출처","sourceType":"official","url":"링크"}]`);
  try { return parseJSON(raw).map((item, i) => buildCard(item, i)).join(''); } catch (e) { return ''; }
}

async function genProducts() {
  const ctx = await getRealtimeNews('최신 보험 신상품 출시');
  return await callClaude("신상품 리서처입니다.", `뉴스:\n${ctx}\n\n결과를 <tr><td>보험사</td><td>상품명</td><td>날짜</td><td><span class="tbdg">유형</span></td><td>특징</td></tr> 형식으로 5줄 작성하세요.`);
}

async function genCategories() {
  const ctx = await getRealtimeNews('헬스케어 금융 고령화 AI 해외보험');
  return await callClaude("큐레이터입니다.", `뉴스:\n${ctx}\n\n5개 카테고리(🧬헬스, 💰금융, 📊인구, 🤖AI, 🌐해외)를 <div class="cat"> 구조의 HTML로 작성하세요.`);
}

async function genCalendar() {
  const raw = await callClaude("일정 관리자입니다.", "이번 주 주요 금융 지표 및 보험 관련 일정 4건을 JSON [{"date":"MM/DD","title":"일정"}] 형식으로 만드세요.");
  try { return parseJSON(raw).map(it => `<div class="cal-row"><div class="cal-dt">${it.date}</div><div class="cal-t">${it.title}</div></div>`).join(''); } catch (e) { return ''; }
}

// ── 메인 (기존 템플릿 치환 로직 100% 복구) ──────────────────────────
async function main() {
  const date = todayStr(); const ko = todayKo();
  console.log(`🚀 AIA 뉴스레터 생성 시작: ${ko}`);

  const tplPath = path.join(__dirname, '..', 'template.html');
  let html = fs.readFileSync(tplPath, 'utf-8');

  const market = await fetchMarketData();
  const [news, hnw, tax, products, cats, cal] = await Promise.all([
    genInsuranceNews(), genHNW(), genTax(), genProducts(), genCategories(), genCalendar()
  ]);

  html = html
    .replace(/\{\{DATE_KO\}\}/g, ko).replace(/\{\{DATE_ISO\}\}/g, date)
    .replace(/\{\{DAY_KO\}\}/g, dayKoStr()).replace(/\{\{DAY_SHORT\}\}/g, dayShort())
    .replace(/\{\{DAY_NUM\}\}/g, dayNum()).replace(/\{\{MONTH_KO\}\}/g, monthKo())
    .replace(/\{\{MONTH_EN\}\}/g, monthEn()).replace(/\{\{YEAR\}\}/g, yearStr())
    .replace(/\{\{USD_VAL\}\}/g, market.usd ? `${market.usd.toLocaleString()}원` : "1,471원")
    .replace(/\{\{SUMMARY\}\}/g, "AIA 상품마케팅팀을 위한 오늘의 실시간 뉴스클리핑입니다.")
    .replace(/\{\{NEWS_COUNT\}\}/g, String(news.count))
    .replace(/\{\{NEWS_ITEMS\}\}/g, news.html)
    .replace(/\{\{HNW_ITEMS\}\}/g, hnw)
    .replace(/\{\{TAX_ITEMS\}\}/g, tax)
    .replace(/\{\{PRODUCT_ROWS\}\}/g, products)
    .replace(/\{\{CAT_BLOCKS\}\}/g, cats)
    .replace(/\{\{CAL_ITEMS\}\}/g, cal);

  const outDir = path.join(__dirname, '..', 'newsletters');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${date}.html`), html, 'utf-8');
  fs.writeFileSync(path.join(outDir, 'latest.html'), html, 'utf-8');
  console.log(`✅ 생성 완료: newsletters/${date}.html`);
}

main().catch(err => { console.error('❌ 오류:', err); process.exit(1); });
