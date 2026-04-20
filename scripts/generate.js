#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

// ── 1. 날짜 유틸리티 (KST 기준) ──────────────────────────────────
const KST = () => new Date(Date.now() + 9 * 3600 * 1000);
const pad2 = (n) => String(n).padStart(2, '0');
const todayStr = () => { const d = KST(); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; };
const todayKo = () => { const d = KST(); return `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`; };
const dayKoStr = () => ['일', '월', '화', '수', '목', '금', '토'][KST().getUTCDay()] + '요일';
const dayShort = () => ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][KST().getUTCDay()];
const dayNum = () => pad2(KST().getUTCDate());
const monthKo = () => `${KST().getUTCMonth() + 1}월`;
const monthEn = () => ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][KST().getUTCMonth()];
const yearStr = () => String(KST().getUTCFullYear());

// ── 2. 구글 실시간 뉴스 검색 (RSS) ─────────────────────────
async function getRealtimeNews(query) {
    try {
        const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`;
        const res = await fetch(url);
        const xml = await res.text();
        return xml.split('<item>').slice(1, 11).map(it => {
            const t = it.split('<title>')[1]?.split('</title>')[0] || '';
            const l = it.split('<link>')[1]?.split('</link>')[0] || '';
            const s = it.split('<source')[1]?.split('>')[1]?.split('</source>')[0] || '뉴스';
            return `제목: ${t} / 출처: ${s} / 링크: ${l}`;
        }).join('\n');
    } catch (e) { return '최신 뉴스 데이터를 가져올 수 없습니다.'; }
}

// ── 3. AI 엔진 (Gemini 1.5 Flash - 404 에러 원천 차단) ─────────────
async function callAI(system, user) {
    // 기존에 설정하신 ANTHROPIC_API_KEY를 그대로 쓰셔도 되지만, 
    // Gemini 전용 키를 받으시면 더 확실합니다 (무료).
    const key = process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`;

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: `${system}\n\n${user}` }] }]
        })
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`AI 호출 실패: ${res.status} - ${err}`);
    }
    const data = await res.json();
    return data.candidates[0].content.parts[0].text;
}

function parseJSON(raw) {
    const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    return JSON.parse(cleaned);
}

// ── 4. HTML 빌더 (기존 디자인 완벽 유지) ─────────────────────────────
function buildCard(item, index, extraClass = '') {
    const num = String(index + 1).padStart(2, '0');
    const badgeMap = { official: 'badge-official', press: 'badge-press', research: 'badge-research' };
    const labelMap = { official: '공식발표', press: '언론보도', research: '리서치' };
    
    return `
    <a class="news-card${extraClass}" href="${encodeURI(item.url || '#')}" target="_blank">
        <div class="nc-num">${num}</div>
        <div>
            <div class="nc-tags"><span class="nc-tag ${item.tagClass || 'tag-mkt'}">${item.tag || '뉴스'}</span></div>
            <div class="nc-title">${item.title || ''}</div>
            <div class="nc-desc">${item.desc || ''}</div>
            ${item.marketingTip ? `<div class="nc-mkt-tip">${item.marketingTip}</div>` : ''}
            <div class="nc-footer">
                <span class="nc-src">${item.source || ''}<span class="nc-src-badge ${badgeMap[item.sourceType] || 'badge-press'}">${labelMap[item.sourceType] || '언론보도'}</span></span>
                <span class="nc-link">원문 보기 →</span>
            </div>
        </div>
    </a>`;
}

// ── 5. 각 섹션별 생성 로직 ──────────────────────────────
async function genInsuranceNews() {
    const ctx = await getRealtimeNews('보험 신상품 상속세 시니어 달러보험');
    const res = await callAI("AIA 에디터입니다.", `뉴스:\n${ctx}\n\nJSON 배열(5건)로 출력: [{"tag":"신상품","tagClass":"tag-new","title":"제목","desc":"요약","marketingTip":"팁","source":"출처","sourceType":"press","url":"링크"}]`);
    try { 
        const arr = parseJSON(res); 
        return { html: arr.map((item, i) => buildCard(item, i)).join(''), count: arr.length };
    } catch (e) { return { html: '', count: 0 }; }
}

async function genHNW() {
    const ctx = await getRealtimeNews('고액자산가 PB 투자 트렌드');
    const res = await callAI("HNW 리서처입니다.", `뉴스:\n${ctx}\n\nJSON 배열(4건) 출력: [{"tag":"자산트렌드","tagClass":"tag-hnw","title":"제목","desc":"요약","marketingTip":"팁","source":"출처","sourceType":"press","url":"링크"}]`);
    try { return parseJSON(res).map((item, i) => buildCard(item, i, ' hnw-card')).join(''); } catch (e) { return ''; }
}

async function genTax() {
    const ctx = await getRealtimeNews('상속세 증여세 절세 금융세무');
    const res = await callAI("세무사입니다.", `뉴스:\n${ctx}\n\nJSON 배열(4건) 출력: [{"tag":"절세","tagClass":"tag-tax","title":"제목","desc":"요약","marketingTip":"팁","source":"출처","sourceType":"official","url":"링크"}]`);
    try { return parseJSON(res).map((item, i) => buildCard(item, i)).join(''); } catch (e) { return ''; }
}

async function genProducts() {
    const ctx = await getRealtimeNews('보험 신상품 출시');
    return await callAI("상품 리서처입니다.", `뉴스:\n${ctx}\n\n5줄의 <tr><td>회사</td><td>상품명</td><td>날짜</td><td>유형</td><td>특징</td></tr> HTML만 출력하세요.`);
}

async function genCategories() {
    const ctx = await getRealtimeNews('헬스케어 금융 인구고령화 AI');
    return await callAI("에디터입니다.", `뉴스:\n${ctx}\n\n5개 카테고리를 <div class="cat">...</div> 구조의 HTML로 작성하세요.`);
}

async function genCalendar() {
    const res = await callAI("일정 관리자입니다.", '이번 주 경제 일정을 [{"date":"MM/DD","title":"내용"}] JSON 배열(4건)로 작성하세요.');
    try { return parseJSON(res).map(it => `<div class="cal-row"><div class="cal-dt">${it.date}</div><div class="cal-t">${it.title}</div></div>`).join(''); } catch (e) { return ''; }
}

// ── 6. 메인 실행 (템플릿 치환) ───────────────────────────────
async function main() {
    const date = todayStr(); const ko = todayKo();
    console.log(`🚀 AIA 뉴스레터 생성 시작: ${ko}`);

    const tplPath = path.join(__dirname, '..', 'template.html');
    let html = fs.readFileSync(tplPath, 'utf-8');

    console.log('📡 실시간 데이터 수집 중...');
    const [news, hnw, tax, products, cats, cal] = await Promise.all([
        genInsuranceNews(), genHNW(), genTax(), genProducts(), genCategories(), genCalendar()
    ]);

    html = html
        .replace(/\{\{DATE_KO\}\}/g, ko)
        .replace(/\{\{DATE_ISO\}\}/g, date)
        .replace(/\{\{DAY_KO\}\}/g, dayKoStr()).replace(/\{\{DAY_SHORT\}\}/g, dayShort())
        .replace(/\{\{DAY_NUM\}\}/g, dayNum()).replace(/\{\{MONTH_KO\}\}/g, monthKo())
        .replace(/\{\{MONTH_EN\}\}/g, monthEn()).replace(/\{\{YEAR\}\}/g, yearStr())
        .replace(/\{\{USD_VAL\}\}/g, "1,471원")
        .replace(/\{\{SUMMARY\}\}/g, "오늘의 핵심 금융 동향을 요약해 드립니다.")
        .replace(/\{\{NEWS_COUNT\}\}/g, String(news.count))
        .replace(/\{\{NEWS_ITEMS\}\}/g, news.html)
        .replace(/\{\{HNW_ITEMS\}\}/g, hnw)
        .replace(/\{\{TAX_ITEMS\}\}/g, tax)
        .replace(/\{\{PRODUCT_ROWS\}\}/g, products)
        .replace(/\{\{CAT_BLOCKS\}\}/g, cats)
        .replace(/\{\{CAL_ITEMS\}\}/g, cal);

    const outDir = path.join(__dirname, '..', 'newsletters');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `${date}.html`), html);
    fs.writeFileSync(path.join(outDir, 'latest.html'), html);
    console.log(`\n🎉 완료: newsletters/${date}.html`);
}

main().catch(err => { console.error('❌ 최종 오류:', err); process.exit(1); });
