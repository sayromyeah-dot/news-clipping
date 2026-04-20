#!/usr/bin/env node
/**
 * AIA 상품마케팅 뉴스클리핑 — 자동 생성기
 * 환경변수: ANTHROPIC_API_KEY (필수), PAGES_URL (선택)
 */

'use strict';
const fs   = require('fs');
const path = require('path');

// ── 날짜 유틸 (KST = UTC+9) ──────────────────────────────────────
const KST      = () => new Date(Date.now() + 9 * 3600 * 1000);
const pad2     = n  => String(n).padStart(2, '0');
const todayStr = () => { const d = KST(); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth()+1)}-${pad2(d.getUTCDate())}`; };
const todayKo  = () => { const d = KST(); return `${d.getUTCFullYear()}년 ${d.getUTCMonth()+1}월 ${d.getUTCDate()}일`; };
const dayKoStr = () => ['일','월','화','수','목','금','토'][KST().getUTCDay()] + '요일';
const dayShort = () => ['SUN','MON','TUE','WED','THU','FRI','SAT'][KST().getUTCDay()];
const dayNum   = () => pad2(KST().getUTCDate());
const monthKo  = () => `${KST().getUTCMonth()+1}월`;
const monthEn  = () => ['January','February','March','April','May','June',
                         'July','August','September','October','November','December'][KST().getUTCMonth()];
const yearStr  = () => String(KST().getUTCFullYear());

// ── Claude API 호출 ───────────────────────────────────────────────
async function callClaude(system, user, maxTokens = 3000) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY 환경변수가 없습니다');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         key,
      'anthropic-version': '2023-06-01',
      'anthropic-beta':    'web-search-2025-03-05',
    },
    body: JSON.stringify({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: maxTokens,
      system,
      tools:    [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }],
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
  // 마크다운 코드블록 제거 후 파싱
  const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  return JSON.parse(cleaned);
}

// ── 뉴스 카드 HTML 빌더 ──────────────────────────────────────────
// 클래스: .news-card, .nc-num, .nc-tags, .nc-tag, .nc-title, .nc-desc,
//         .nc-mkt-tip, .nc-footer, .nc-src, .nc-src-badge, .nc-link
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

  // USD/KRW
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(6000) });
    const d = await r.json();
    if (d.result === 'success' && d.rates?.KRW) result.usd = Math.round(d.rates.KRW);
    else if (d.rates?.KRW) result.usd = Math.round(d.rates.KRW);
    console.log(`  USD/KRW: ${result.usd || '실패'}`);
  } catch (e) { console.warn('  USD fetch 실패:', e.message); }

  // 폴백: jsdelivr currency mirror
  if (!result.usd) {
    try {
      const r = await fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json', { signal: AbortSignal.timeout(6000) });
      const d = await r.json();
      if (d.usd?.krw) { result.usd = Math.round(d.usd.krw); console.log(`  USD/KRW(폴백): ${result.usd}`); }
    } catch (e) { console.warn('  USD 폴백 실패:', e.message); }
  }

  // KOSPI — stooq CSV
  try {
    const r = await fetch('https://stooq.com/q/d/l/?s=%5Eks11&i=d&l=5', { signal: AbortSignal.timeout(8000) });
    const txt = await r.text();
    const rows = txt.trim().split('\n').slice(1)
      .map(l => l.split(','))
      .filter(r => r.length >= 5 && !isNaN(parseFloat(r[4])));
    if (rows.length >= 2) {
      result.kospi = { last: parseFloat(rows[rows.length-1][4]), prev: parseFloat(rows[rows.length-2][4]) };
      console.log(`  KOSPI: ${result.kospi.last}`);
    }
  } catch (e) { console.warn('  KOSPI fetch 실패:', e.message); }

  return result;
}

function buildMarketVars(m) {
  const usdVal = m.usd ? `${m.usd.toLocaleString('ko')}원` : '—';
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

// ── 섹션 생성 함수들 ─────────────────────────────────────────────

async function genInsuranceNews(dateKo) {
  const d    = KST();
  const prev = new Date(d.getTime() - 86400000);
  const fmt  = dt => `${dt.getUTCFullYear()}.${pad2(dt.getUTCMonth()+1)}.${pad2(dt.getUTCDate())}`;
  const today = fmt(d), yest = fmt(prev);

  const sys = `당신은 AIA생명 상품마케팅팀을 위한 뉴스 에디터입니다.
어제(${yest}) 또는 오늘(${today}) 발행된 기사만 선별합니다.
보험 전문지뿐 아니라 조선일보, 중앙일보, 한국경제, 매일경제, 연합뉴스 등 일반 언론도 포함합니다.
기사 개별 URL을 반드시 제공하세요. 홈페이지 메인 URL 금지.
JSON 배열만 반환하세요.`;

  const usr = `어제(${yest})~오늘(${today}) 발행된 보험·금융·경제 뉴스 5건을 웹 검색으로 찾아주세요.
AIA 마케팅 관점에서 중요한 주제: 달러·환율, 고령화·시니어, 보험 신상품, 상속세·자산이전, 금융시장, AI보험사기.
JSON 배열 반환 (최대 5건):
[{"tag":"달러보험|시니어|신상품|상속세|금융시장|AI보험 중 하나","tagClass":"tag-dollar|tag-senior|tag-new|tag-tax|tag-mkt|tag-reg 중 하나","title":"기사 제목","desc":"2~3문장 요약. 발행일 포함.","marketingTip":"AIA 시사점 1문장","source":"언론사명","sourceType":"press","url":"기사 개별 URL"}]`;

  const raw = await callClaude(sys, usr);
  try {
    const arr = parseJSON(raw);
    const html = arr.map((item, i) => buildCard(item, i)).join('');
    return { html, count: arr.length };
  } catch (e) {
    console.error('보험뉴스 파싱 실패:', e.message);
    return { html: '<div class="news-card"><div class="nc-num">—</div><div><div class="nc-desc">뉴스 로드 오류</div></div></div>', count: 0 };
  }
}

async function genHNW(dateKo) {
  const sys = `당신은 Global Wealth(고액자산가) 마켓 리서처입니다. JSON 배열만 반환하세요.`;
  const usr = `오늘(${dateKo}) 기준 고액자산가 관련 최신 뉴스/트렌드 4건을 웹 검색으로 찾아주세요.
주제: 자산가 투자트렌드, 럭셔리·라이프스타일, PB·WM 동향, 자산이전.
JSON 배열(4건): [{"tag":"투자트렌드|럭셔리|PB·WM|자산이전 중 하나","tagClass":"tag-hnw","title":"제목","desc":"2문장","marketingTip":"AIA 달러보험·자산승계 연결 포인트","source":"출처","sourceType":"press","url":"기사URL"}]`;
  const raw = await callClaude(sys, usr);
  try { return parseJSON(raw).map((item, i) => buildCard(item, i, ' hnw-card')).join(''); }
  catch (e) { console.error('HNW 파싱 실패:', e.message); return '<div class="news-card"><div class="nc-num">—</div><div><div class="nc-desc">오류</div></div></div>'; }
}

async function genTax(dateKo) {
  const sys = `당신은 세금·상속·증여 전문 리서처입니다. JSON 배열만 반환하세요.`;
  const usr = `오늘(${dateKo}) 기준 상속세·증여세·금융소득세·보험세제 관련 최신 뉴스 4건을 웹 검색으로 찾아주세요.
JSON 배열(4건): [{"tag":"상속세|증여세|금융소득세|보험세제 중 하나","tagClass":"tag-tax","title":"제목","desc":"2문장. 수치 포함.","marketingTip":"보험 절세 연결 포인트","source":"출처","sourceType":"official|press|research","url":"URL"}]`;
  const raw = await callClaude(sys, usr);
  try { return parseJSON(raw).map((item, i) => buildCard(item, i)).join(''); }
  catch (e) { console.error('세금 파싱 실패:', e.message); return '<div class="news-card"><div class="nc-num">—</div><div><div class="nc-desc">오류</div></div></div>'; }
}

async function genProducts() {
  const d    = KST();
  const from = new Date(d.getTime() - 30 * 86400000);
  const fmt  = dt => `${dt.getUTCFullYear()}.${pad2(dt.getUTCMonth()+1)}.${pad2(dt.getUTCDate())}`;
  const period = `${fmt(from)} ~ ${fmt(d)}`;

  const sys = `당신은 보험 신상품 리서처입니다. JSON 배열만 반환하세요.`;
  const usr = `아래 기간(최근 30일) 내 출시된 국내 보험 신상품을 웹 검색으로 찾아주세요.
기간: ${period}
규칙: 출시일 확인 불가 시 제외. launchDate 필드 필수(YYYY.MM.DD).
JSON 배열(최대 8건): [{"company":"보험사명","product":"상품명","launchDate":"YYYY.MM.DD","type":"달러보험|시니어|생보|손보|간편 중 하나","typeClass":"dl|sr| 중 하나","feature":"핵심 특징 1문장"}]`;

  const raw = await callClaude(sys, usr);
  try {
    const arr = parseJSON(raw);
    return arr
      .sort((a, b) => (b.launchDate || '').localeCompare(a.launchDate || ''))
      .map(item => `<tr>
        <td>${item.company}</td>
        <td>${item.product}</td>
        <td>${item.launchDate || '—'}</td>
        <td><span class="tbdg ${item.typeClass || ''}">${item.type}</span></td>
        <td>${item.feature}</td>
      </tr>`).join('');
  } catch (e) {
    console.error('신상품 파싱 실패:', e.message);
    return '<tr><td colspan="5" style="padding:16px;text-align:center;color:#9C9A93">신상품 정보 로드 오류</td></tr>';
  }
}

async function genCategories(dateKo) {
  const sys = `당신은 보험·금융 뉴스 큐레이터입니다. JSON 배열만 반환하세요.`;
  const usr = `오늘(${dateKo}) 기준 아래 5개 카테고리별 최신 헤드라인 3건씩을 웹 검색으로 찾아주세요.
최근 1~2일 이내 뉴스 우선.
JSON: [{"icon":"이모지","title":"카테고리명","items":["헤드라인1","헤드라인2","헤드라인3"]}]
카테고리: 🧬 헬스·의료, 💰 금융·환율, 📊 인구·고령화, 🤖 AI·디지털, 🌐 해외보험`;
  const raw = await callClaude(sys, usr);
  try {
    return parseJSON(raw).map(cat => `
    <div class="cat">
      <div class="cat-h"><span class="cat-ico">${cat.icon}</span><span class="cat-name">${cat.title}</span></div>
      <ul class="cat-ul">${(cat.items || []).map(it => `<li class="cat-li">${it}</li>`).join('')}</ul>
    </div>`).join('');
  } catch (e) { console.error('카테고리 파싱 실패:', e.message); return ''; }
}

async function genCalendar(dateKo) {
  const sys = `당신은 보험·금융 업계 일정 관리자입니다. JSON 배열만 반환하세요.`;
  const usr = `${dateKo} 기준 이번 주 보험/금융/세금 관련 주요 일정 4~5건을 웹 검색으로 찾아주세요.
JSON: [{"date":"MM/DD (요일)","title":"일정명","sub":"장소 또는 주최"}]`;
  const raw = await callClaude(sys, usr);
  try {
    return parseJSON(raw).map(item => `
    <div class="cal-row">
      <div class="cal-dt">${item.date}</div>
      <div><div class="cal-t">${item.title}</div><div class="cal-s">${item.sub}</div></div>
    </div>`).join('');
  } catch (e) { console.error('일정 파싱 실패:', e.message); return '<div class="cal-row"><div class="cal-dt">—</div><div><div class="cal-t">일정 로드 오류</div></div></div>'; }
}

async function genSummary(dateKo) {
  const sys = `당신은 AIA생명 상품마케팅 에디터입니다. 오늘의 핵심 동향을 2~3문장으로 요약합니다.`;
  const usr = `오늘(${dateKo}) 기준 달러·환율 동향, Global Wealth 자산가 이슈, 보험 업계 핵심 뉴스를 웹 검색 후 2~3문장으로 요약하세요. 텍스트만 반환하세요.`;
  try { return (await callClaude(sys, usr)).trim().replace(/^"|"$/g, ''); }
  catch (e) { return '오늘의 보험 업계 및 금융 시장 주요 동향을 확인하세요.'; }
}

// ── 메인 ─────────────────────────────────────────────────────────
async function main() {
  const date  = todayStr();
  const ko    = todayKo();
  const day   = dayKoStr();

  console.log(`\n🚀 AIA 뉴스클리핑 생성 시작: ${ko} (${day})\n`);

  // 1. 템플릿 읽기
  const tplPath = path.join(__dirname, '..', 'template.html');
  if (!fs.existsSync(tplPath)) throw new Error('template.html 을 찾을 수 없습니다');
  let html = fs.readFileSync(tplPath, 'utf-8');

  // 2. 시장 데이터 (서버사이드)
  console.log('📈 시장 데이터 수집...');
  const market = await fetchMarketData();
  const { usdVal, usdSub, kospiVal, kospiChg, kospiCls } = buildMarketVars(market);

  // 3. 뉴스 콘텐츠 병렬 수집
  console.log('📡 뉴스 콘텐츠 수집 (병렬)...');
  const [
    { html: newsHtml, count: newsCount },
    hnwHtml, taxHtml, productHtml, catHtml, calHtml, summary,
  ] = await Promise.all([
    genInsuranceNews(ko),
    genHNW(ko), genTax(ko), genProducts(),
    genCategories(ko), genCalendar(ko), genSummary(ko),
  ]);

  // 4. 템플릿 변수 치환
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

  // 5. 파일 저장
  const outDir = path.join(__dirname, '..', 'newsletters');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const outPath = path.join(outDir, `${date}.html`);
  fs.writeFileSync(outPath, html, 'utf-8');
  console.log(`✅ 저장: newsletters/${date}.html`);

  // latest.html (index.html 폴백용)
  fs.writeFileSync(path.join(outDir, 'latest.html'), html, 'utf-8');
  console.log('✅ newsletters/latest.html 갱신');

  // index.html은 PWA 스마트 리다이렉트 버전 유지 (덮어쓰지 않음)
  console.log('ℹ️  index.html 유지 (PWA 버전)');

  console.log(`\n🎉 완료! newsletters/${date}.html\n`);
}

main().catch(err => {
  console.error('❌ 오류:', err);
  process.exit(1);
});
