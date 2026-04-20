#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

// ── 1. 날짜 유틸리티 (KST 기준) ──────────────────────────────────
const KST = () => new Date(Date.now() + 9 * 3600 * 1000);
const pad2 = (n) => String(n).padStart(2, '0');

const todayStr = () => {
    const d = KST();
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
};

const todayKo = () => {
    const d = KST();
    return `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
};

const dayKoStr = () => ['일', '월', '화', '수', '목', '금', '토'][KST().getUTCDay()] + '요일';
const dayShort = () => ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][KST().getUTCDay()];
const dayNum = () => pad2(KST().getUTCDate());
const monthKo = () => `${KST().getUTCMonth() + 1}월`;
const monthEn = () => ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][KST().getUTCMonth()];
const yearStr = () => String(KST().getUTCFullYear());

// ── 2. 실시간 뉴스 검색 (Google News RSS) ─────────────────────────
async function getRealtimeNews(query) {
    try {
        const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`;
        const res = await fetch(url);
        const xml = await res.text();
        const items = xml.split('<item>').slice(1, 12);
        return items.map(it => {
            const title = it.split('<title>')[1]?.split('</title>')[0] || '';
            const link = it.split('<link>')[1]?.split('</link>')[0] || '';
            const source = it.split('<source')[1]?.split('>')[1]?.split('</source>')[0] || '뉴스';
            return `제목: ${title} / 출처: ${source} / 링크: ${link}`;
        }).join('\n');
    } catch (e) {
        return '최신 뉴스 데이터를 가져올 수 없습니다.';
    }
}

// ── 3. Claude API 호출 (404 에러 해결) ────────────────────────────
async function callClaude(system, user) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY 환경변수가 없습니다.');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
            model: "claude-3-haiku-20240307", // 가장 안정적인 모델
            max_tokens: 3500,
            system: system,
            messages: [{ role: 'user', content: user }]
        })
    });

    if (!res.ok) {
        const errTxt = await res.text();
        throw new Error(`Claude API 오류 ${res.status}: ${errTxt}`);
    }
    const data = await res.json();
    return data.content[0].text;
}

function parseJSON(raw) {
    const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    return JSON.parse(cleaned);
}

// ── 4. HTML 빌더 (기존 디자인 유지) ─────────────────────────────
function buildCard(item, index, extraClass = '') {
    const num = String(index + 1).padStart(2, '0');
    const url = item.url || '#';
    const badgeMap = { official: 'badge-official', press: 'badge-press', research: 'badge-research' };
    const labelMap = { official: '공식발표', press: '언론보도', research: '리서치' };
    const badgeClass = badgeMap[item.sourceType] || 'badge-press';
    const badgeLabel = labelMap[item.sourceType] || '언론보도';

    return `
    <a class="news-card${extraClass}" href="${encodeURI(url)}" target="_blank" rel="noopener">
        <div class="nc-num">${num}</div>
        <div>
            <div class="nc-tags"><span class="nc-tag ${item.tagClass || 'tag-mkt'}">${item.tag || '뉴스'}</span></div>
            <div class="nc-title">${item.title || ''}</div>
            <div class="nc-desc">${item.desc || ''}</div>
            ${item.marketingTip ? `<div class="nc-mkt-tip">${item.marketingTip}</div>` : ''}
            <div class="nc-footer">
                <span class="nc-src">${item.source || ''}<span class="nc-src-badge ${badgeClass}">${badgeLabel}</span></span>
                <span class="nc-link">원문 보기 →</span>
            </div>
        </div>
    </a>`;
}

// ── 5. 섹션별 생성 로직 (디자인 기능 유지) ────────────────────────
async function genInsuranceNews() {
    const ctx = await getRealtimeNews('보험 신상품 달러보험 시니어케어');
    const sys = "보험 마케팅 에디터입니다. 뉴스 목록을 바탕으로 JSON 배열(5건)을 작성하세요.";
    const usr = `뉴스목록:\n${ctx}\n\nJSON 형식: [{"tag":"신상품","tagClass":"tag-new","title":"제목","desc":"요약","marketingTip":"팁","source":"출처","sourceType":"press","url":"링크"}]`;
    try {
        const raw = await callClaude(sys, usr);
        const arr = parseJSON(raw);
        return { html: arr.map((item, i) => buildCard(item, i)).join(''), count: arr.length };
    } catch (e) { return { html: '', count: 0 }; }
}

async function genHNW() {
    const ctx = await getRealtimeNews('고액자산가 PB WM 투자 트렌드');
    const sys = "부유층 자산관리 리서처입니다. JSON 배열(4건)을 작성하세요.";
    const usr = `뉴스목록:\n${ctx}\n\nJSON 형식: [{"tag":"자산트렌드","tagClass":"tag-hnw","title":"제목","desc":"요약","marketingTip":"팁","source":"출처","sourceType":"press","url":"링크"}]`;
    try {
        const raw = await callClaude(sys, usr);
        const arr = parseJSON(raw);
        return arr.map((item, i) => buildCard(item, i, ' hnw-card')).join('');
    } catch (e) { return ''; }
}

async function genTax() {
    const ctx = await getRealtimeNews('상속세 증여세 절세 보험세제');
    const sys = "세무 전문가입니다. JSON 배열(4건)을 작성하세요.";
    const usr = `뉴스목록:\n${ctx}\n\nJSON 형식: [{"tag":"절세","tagClass":"tag-tax","title":"제목","desc":"요약","marketingTip":"팁","source":"출처","sourceType":"official","url":"링크"}]`;
    try {
        const raw = await callClaude(sys, usr);
        const arr = parseJSON(raw);
        return arr.map((item, i) => buildCard(item, i)).join('');
    } catch (e) { return ''; }
}

async function genProducts() {
    const ctx = await getRealtimeNews('보험 신상품 출시 현황');
    const sys = "보험 상품 리서처입니다. 신상품 정보를 HTML <tr> 구조로 추출하세요.";
    const usr = `뉴스목록:\n${ctx}\n\n출력 형식: <tr><td>보험사</td><td>상품명</td><td>날짜</td><td><span class="tbdg">유형</span></td><td>특징</td></tr> (5줄 내외)`;
    return await callClaude(sys, usr);
}

async function genCategories() {
    const ctx = await getRealtimeNews('금융 인구고령화 디지털보험');
    const sys = "뉴스 큐레이터입니다. 뉴스 카테고리를 <div class=\"cat\"> 구조의 HTML로 작성하세요.";
    const usr = `뉴스목록:\n${ctx}\n\n카테고리: 🧬헬스, 💰금융, 📊인구, 🤖AI, 🌐해외`;
    return await callClaude(sys, usr);
}

async function genCalendar() {
    const sys = "일정 관리자입니다. 이번 주 주요 금융 일정을 JSON 배열로 작성하세요.";
    const usr = '이번 주 보험 및 경제 주요 일정 4건을 다음 형식으로 작성하세요: [{"date":"MM/DD","title":"일정"}]';
    try {
        const raw = await callClaude(sys, usr);
        const arr = parseJSON(raw);
        return arr.map(it => `<div class="cal-row"><div class="cal-dt">${it.date}</div><div class="cal-t">${it.title}</div></div>`).join('');
    } catch (e) { return ''; }
}

// ── 6. 메인 실행부 (템플릿 치환) ───────────────────────────────
async function main() {
    const date = todayStr();
    const ko = todayKo();
    console.log(`🚀 AIA 뉴스레터 생성 시작: ${ko}`);

    const tplPath = path.join(__dirname, '..', 'template.html');
    if (!fs.existsSync(tplPath)) throw new Error('template.html 파일을 찾을 수 없습니다.');
    let html = fs.readFileSync(tplPath, 'utf-8');

    // 시장 데이터 (간소화)
    let usdVal = "1,471원";
    try {
        const r = await fetch('https://open.er-api.com/v6/latest/USD');
        const d = await r.json();
        if (d.rates?.KRW) usdVal = `${Math.round(d.rates.KRW).toLocaleString()}원`;
    } catch (e) { console.log('시장 데이터 로드 실패'); }

    // 병렬 데이터 수집
    console.log('📡 실시간 데이터 수집 및 요약 중...');
    const [news, hnw, tax, products, cats, cal] = await Promise.all([
        genInsuranceNews(), genHNW(), genTax(), genProducts(), genCategories(), genCalendar()
    ]);

    // 최종 치환
    html = html
        .replace(/\{\{DATE_KO\}\}/g, ko)
        .replace(/\{\{DATE_ISO\}\}/g, date)
        .replace(/\{\{DAY_KO\}\}/g, dayKoStr())
        .replace(/\{\{DAY_SHORT\}\}/g, dayShort())
        .replace(/\{\{DAY_NUM\}\}/g, dayNum())
        .replace(/\{\{MONTH_KO\}\}/g, monthKo())
        .replace(/\{\{MONTH_EN\}\}/g, monthEn())
        .replace(/\{\{YEAR\}\}/g, yearStr())
        .replace(/\{\{USD_VAL\}\}/g, usdVal)
        .replace(/\{\{SUMMARY\}\}/g, "AIA 상품마케팅팀을 위한 오늘의 핵심 금융 동향입니다.")
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

    console.log(`\n🎉 완료: newsletters/${date}.html`);
}

main().catch(err => {
    console.error('❌ 최종 오류:', err);
    process.exit(1);
});
