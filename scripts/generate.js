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
      max_tokens: maxTokens,
      system,
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

// ── 뉴스 카드 HTML 빌더 (기존 디자인 유지) ──────────────────────
function buildCard(item, index, extraClass = '') {
  const num    = String(index + 1).padStart(2, '0');
  const hasUrl = item.url && item.url.startsWith('http');
  const tag0   = hasUrl ? `<a class="news-card${extraClass}" href="${encodeURI(item.url)}" target="_blank" rel="noopener">` : `<div class="news-card${extraClass}">`;
  const tag1   = hasUrl ? '</a>' : '</div>';
  const link   = hasUrl ? '<span class="nc-link">원문 보기 →</span>' : '';

  const badgeMap = { official: 'badge-official', press: 'badge-press', research: 'badge-research' };
  const labelMap = { official: '공식발표', press: '언론보도', research: '리서치' };
  const badge    = item.sourceType
    ? `<span class="nc-src-badge ${badgeMap[item.sourceType] || 'badge-press'}">${labelMap[item.sourceType] || ''}</span>`
    : '';
  const tip = item.marketingTip
    ? `<div class="nc-mkt-tip">${item.marketingTip}</div>`
    : '';

  return `${tag0}
    <div class="nc-num">${num}</div>
    <div>
      <div class="nc-tags"><span class="nc-tag ${item.tagClass || 'tag-mkt'}">${item.tag || ''}</span></div>
      <div class="nc-title">${item.title || ''}</div>
      <div class="nc-desc">${item.desc || ''}</div>
      ${tip}
      <div class="nc-footer"><span class="nc-src">${item.source || ''}${badge}</span>${link}</div>
    </div>
  ${tag1}`;
}

// ── 시장 데이터 (서버사이드) ─────────────────────────────────────
async function fetchMarketData() {
  const result = { usd: null, kospi: null };
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/USD');
    const d = await r.json();
    if (d.rates?.KRW) result.usd = Math.round(d.rates.KRW);
    console.log(`  USD/KRW: ${result.usd}`);
  } catch (e) { console.warn('  USD fetch 실패:', e.message); }

  try {
    const r = await fetch('https://stooq.com/q/d/l/?s=%5Eks11&i=d&l=5');
    const txt = await r.text();
    const rows = txt.trim().split('\n').slice(1).map(l => l.split(','));
    if (rows.length >= 2) {
      result.kospi = { last: parseFloat(rows[rows.length-1][4]), prev: parseFloat(rows[rows.length-2][4]) };
      console.log(`  KOSPI: ${result.kospi.last}`);
    }
  } catch (e) { console.warn('  KOSPI fetch 실패:', e.message); }
  return result;
}

function buildMarketVars(m) {
  const usdVal = m.usd ? `${m.usd.toLocaleString('ko')}원` : '1,471원';
  const usdSub = m.usd ? '실시간' : '조회불가';
  let kospiVal = '—', kospiChg = '—', kospiCls = 'nt';
  if (m.kospi) {
    const { last, prev } = m.kospi;
    const chg = last - prev, pct = (chg / prev * 100).toFixed(2);
    kospiVal = last.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const ar = chg >= 0 ? '▲' : '▼';
    kospiChg = `${chg >= 0 ? '+' : ''}${chg.toFixed(2)} (${ar}${Math.abs(pct)}%)`;
    kospiCls = chg >= 0 ? 'up' : 'dn';
  }
  return { usdVal, usdSub, kospiVal, kospiChg, kospiCls };
}

// ── 섹션별 뉴스 생성 (검색 결과를 클로드에게 전달) ─────────────────

async function genInsuranceNews(dateKo) {
  const newsContext = await getRealtimeNews('보험 신상품 상속세 달러보험 시니어케어');
  const sys = `당신은 AIA생명 뉴스 에디터입니다. 제공된 뉴스 목록을 바탕으로 마케팅 관점의 JSON 배열(5건)을 만드세요.`;
  const usr = `뉴스목록:\n${newsContext}\n\nJSON 형식: [{"tag":"신상품|세제|시장","tagClass":"tag-new|tag-tax|tag-mkt","title":"기사제목","desc":"2문장 요약","marketingTip":"AIA 시사점","source":"언론사","sourceType":"press","url":"원본링크"}]`;
  const raw = await callClaude(sys, usr);
  try {
    const arr = parseJSON(raw);
    return { html: arr.map((item, i) => buildCard(item, i)).join(''), count: arr.length };
  } catch (e) { return { html: '', count: 0 }; }
}

async function genHNW(dateKo) {
  const newsContext = await getRealtimeNews('고액자산가 PB WM 투자 트렌드 상속');
  const sys = `Global Wealth 리서처입니다. 제공된 뉴스를 바탕으로 고액자산가 트렌드 JSON(4건)을 만드세요.`;
  const usr = `뉴스목록:\n${newsContext}\n\nJSON 형식: [{"tag":"자산가트렌드","tagClass":"tag-hnw","title":"제목","desc":"요약","marketingTip":"AIA 연결포인트","source":"출처","sourceType":"press","url":"링크"}]`;
  const raw = await callClaude(sys, usr);
  try { return parseJSON(raw).map((item, i) => buildCard(item, i, ' hnw-card')).join(''); }
  catch (e) { return ''; }
}

async function genTax(dateKo) {
  const newsContext = await getRealtimeNews('상속세 증여세 금융소득세 보험 절세');
  const sys = `세금 전문 리서처입니다. 제공된 뉴스를 바탕으로 절세 뉴스 JSON(4건)을 만드세요.`;
  const usr = `뉴스목록:\n${newsContext}\n\nJSON 형식: [{"tag":"상속·증여세","tagClass":"tag-tax","title":"제목","desc":"요약","marketingTip":"절세 포인트","source":"출처","sourceType":"official","url":"링크"}]`;
  const raw = await callClaude(sys, usr);
  try { return parseJSON(raw).map((item, i) => buildCard(item, i)).join(''); }
  catch (e) { return ''; }
}

async function genProducts() {
  const newsContext = await getRealtimeNews('보험 신상품 출시 2026');
  const sys = `보험 신상품 리서처입니다. 뉴스 목록에서 신상품 정보를 추출해 HTML <tr>형식으로 만드세요.`;
  const usr = `뉴스목록:\n${newsContext}\n\n결과 형식: <tr><td>회사</td><td>상품명</td><td>날짜</td><td><span class="tbdg">유형</span></td><td>특징</td></tr>`;
  return await callClaude(sys, usr);
}

async function genCategories(dateKo) {
  const newsContext = await getRealtimeNews('헬스케어 금융 인구고령화 AI 해외보험');
  const sys = `뉴스 큐레이터입니다. 뉴스 목록을 5개 카테고리별로 분류해 HTML을 만드세요.`;
  const usr = `뉴스목록:\n${newsContext}\n\n결과 형식: <div class="cat"><div class="cat-h">이모지 카테고리명</div><ul class="cat-ul"><li class="cat-li">헤드라인</li></ul></div>`;
  return await callClaude(sys, usr);
}

async function genCalendar(dateKo) {
  const sys = `보험금융 일정 관리자입니다. 이번 주 주요 금융 일정을 JSON(4건)으로 만드세요.`;
  const usr = `오늘(${dateKo}) 기준 이번 주 금융 및 경제 지표 발표 일정을 알려주세요. JSON 형식: [{"date":"MM/DD","title":"일정명","sub":"설명"}]`;
  const raw = await callClaude(sys, usr);
  try {
    return parseJSON(raw).map(item => `<div class="cal-row"><div class="cal-dt">${item.date}</div><div><div class="cal-t">${item.title}</div><div class="cal-s">${item.sub}</div></div></div>`).join('');
  } catch (e) { return ''; }
}

async function genSummary(dateKo) {
  const sys = `AIA생명 에디터입니다. 오늘의 핵심 동향을 2문장으로 요약하세요.`;
  const usr = `오늘(${dateKo})의 보험/금융 시장 핵심 요약을 텍스트만 반환하세요.`;
  return await callClaude(sys, usr);
}

// ── 메인 ─────────────────────────────────────────────────────────
async function main() {
  const date  = todayStr();
  const ko    = todayKo();
  const day   = dayKoStr();

  console.log(`\n🚀 AIA 뉴스클리핑 생성 시작: ${ko} (${day})\n`);

  const tplPath = path.join(__dirname, '..', 'template.html');
  if (!fs.existsSync(tplPath)) throw new Error('template.html 을 찾을 수 없습니다');
  let html = fs.readFileSync(tplPath, 'utf-8');

  console.log('📈 시장 데이터 수집...');
  const market = await fetchMarketData();
  const { usdVal, usdSub, kospiVal, kospiChg, kospiCls } = buildMarketVars(market);

  console.log('📡 실시간 뉴스 수집 및 요약 중...');
  const [
    { html: newsHtml, count: newsCount },
    hnwHtml, taxHtml, productHtml, catHtml, calHtml, summary,
  ] = await Promise.all([
    genInsuranceNews(ko), genHNW(ko), genTax(ko), genProducts(),
    genCategories(ko), genCalendar(ko), genSummary(ko),
  ]);

  html = html
    .replace(/\{\{DATE_KO\}\}/g,    ko)
    .replace(/\{\{DATE_ISO\}\}/g,   date)
    .replace(/\{\{DAY_KO\}\}/g,     day)
    .replace(/\{\{DAY_SHORT\}\}/g,  dayShort())
    .replace(/\{\{DAY_NUM\}\}/g,    dayNum())
    .replace(/\{\{MONTH_KO\}\}/g,   monthKo())
    .replace(/\{\{MONTH_EN\}\}/g,   monthEn())
    .replace(/\{\{YEAR\}\}/g,       yearStr())
    .replace(/\{\{USD_VAL\}\}/g,    usdVal)
    .replace(/\{\{USD_SUB\}\}/g,    usdSub)
    .replace(/\{\{KOSPI_VAL\}\}/g,  kospiVal)
    .replace(/\{\{KOSPI_CHG\}\}/g,  kospiChg)
    .replace(/\{\{KOSPI_CLS\}\}/g,  kospiCls)
    .replace(/\{\{SUMMARY\}\}/g,    summary)
    .replace(/\{\{NEWS_COUNT\}\}/g, String(newsCount))
    .replace(/\{\{NEWS_ITEMS\}\}/g, newsHtml)
    .replace(/\{\{HNW_ITEMS\}\}/g,  hnwHtml)
    .replace(/\{\{TAX_ITEMS\}\}/g,  taxHtml)
    .replace(/\{\{PRODUCT_ROWS\}\}/g, productHtml)
    .replace(/\{\{CAT_BLOCKS\}\}/g, catHtml)
    .replace(/\{\{CAL_ITEMS\}\}/g,  calHtml);

  const outDir = path.join(__dirname, '..', 'newsletters');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${date}.html`), html, 'utf-8');
  fs.writeFileSync(path.join(outDir, 'latest.html'), html, 'utf-8');

  console.log(`\n🎉 완료! newsletters/${date}.html\n`);
}

main().catch(err => {
  console.error('❌ 오류:', err);
  process.exit(1);
});
