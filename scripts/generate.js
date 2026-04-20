#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

/**
 * 1. 날짜 및 시간 유틸리티 (KST 기준)
 */
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

/**
 * 2. 구글 실시간 뉴스 수집 (RSS 방식 - 키 필요 없음)
 */
async function getRealtimeNews(query) {
    try {
        const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`;
        const res = await fetch(url);
        if (!res.ok) return '뉴스 데이터를 가져올 수 없습니다.';
        const xml = await res.text();
        return xml.split('<item>').slice(1, 11).map(it => {
            const title = it.split('<title>')[1]?.split('</title>')[0] || '';
            const link = it.split('<link>')[1]?.split('</link>')[0] || '';
            const source = it.split('<source')[1]?.split('>')[1]?.split('</source>')[0] || '뉴스';
            return `제목: ${title} / 출처: ${source} / 링크: ${link}`;
        }).join('\n');
    } catch (e) {
        return '뉴스 수집 중 오류 발생';
    }
}

/**
 * 3. AI 엔진 (Gemini 1.5 Flash 적용 - 404/400 에러 방어 로직)
 */
async function callAI(system, user) {
    const key = (process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY || '').trim();
    if (!key) throw new Error('API 키가 설정되지 않았습니다. GitHub Secrets를 확인해주세요.');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`;

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ 
                role: 'user', 
                parts: [{ text: `지침: ${system}\n\n입력데이터:\n${user}` }] 
            }]
        })
    });

    const data = await res.json();
    if (!res.ok) {
        throw new Error(`AI 호출 실패(${res.status}): ${JSON.stringify(data.error)}`);
    }
    
    // AI 응답에서 텍스트만 추출
    const responseText = data.candidates[0].content.parts[0].text;
    // JSON 응답일 경우 마크다운 코드 블록 제거
    return responseText.replace(/```json/g, '').replace(/```/g, '').trim();
}

/**
 * 4. 카드 디자인 빌더 (기존 디자인 100% 유지)
 */
function buildCard(item, index, extraClass = '') {
    const num = String(index + 1).padStart(2, '0');
    const badgeMap = { official: 'badge-official', press: 'badge-press', research: 'badge-research' };
    const labelMap = { official: '공식발표', press: '언론보도', research: '리서치' };
    const safeUrl = item.url ? encodeURI(item.url) : '#';

    return `
    <a class="news-card${extraClass}" href="${safeUrl}" target="_blank" rel="noopener">
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

/**
 * 5. 섹션별 데이터 생성 로직
 */
async function genInsuranceNews() {
    const ctx = await getRealtimeNews('보험 신상품 상속세 시니어 달러보험');
    const res = await callAI("보험 에디터입니다.", `다음 뉴스를 JSON 배열(5건)로 요약하세요: [{"tag":"신상품","tagClass":"tag-new","title":"제목","desc":"요약","marketingTip":"팁","source":"출처","sourceType":"press","url":"링크"}]`);
    try {
        const arr = JSON.parse(res);
        return { html: arr.map((item, i) => buildCard(item, i)).join(''), count: arr.length };
    } catch (e) { return { html: '', count: 0 }; }
}

async function genHNW() {
    const ctx = await getRealtimeNews('고액자산가 투자 PB 트렌드');
    const res = await callAI("HNW 전문가입니다.", `다음 뉴스를 JSON 배열(4건)로 요약하세요: [{"tag":"자산트렌드","tagClass":"tag-hnw","title":"제목","desc":"요약","marketingTip":"팁","source":"출처","sourceType":"press","url":"링크"}]`);
    try {
        const arr = JSON.parse(res);
        return arr.map((item, i) => buildCard(item, i, ' hnw-card')).join('');
    } catch (e) { return ''; }
}

async function genTax() {
    const ctx = await getRealtimeNews('상속세 증여세 절세 보험');
    const res = await callAI("세무 전문가입니다.", `다음 뉴스를 JSON 배열(4건)로 요약하세요: [{"tag":"세무","tagClass":"tag-tax","title":"제목","desc":"요약","marketingTip":"팁","source":"출처","sourceType":"official","url":"링크"}]`);
    try {
        const arr = JSON.parse(res);
        return arr.map((item, i) => buildCard(item, i)).join('');
    } catch (e) { return ''; }
}

async function genProducts() {
    const ctx = await getRealtimeNews('보험 신상품 출시');
    return await callAI("리서처입니다.", `다음 뉴스 정보를 토대로 5줄의 <tr><td>회사</td><td>상품명</td><td>날짜</td><td><span class="tbdg">유형</span></td><td>특징</td></tr> HTML 행만 생성하세요.\n\n뉴스:\n${ctx}`);
}

async function genCategories() {
    return await callAI("큐레이터입니다.", "🧬헬스, 💰금융, 📊인구, 🤖AI, 🌐해외 5개 카테고리를 <div class=\"cat\">내용</div> HTML 구조로 작성하세요.");
}

async function genCalendar() {
    const res = await callAI("매니저입니다.", '이번 주 주요 경제 일정을 JSON 배열(4건)로 작성하세요: [{"date":"MM/DD","title":"일정"}]');
    try {
        const arr = JSON.parse(res);
        return arr.map(it => `<div class="cal-row"><div class="cal-dt">${it.date}</div><div class="cal-t">${it.title}</div></div>`).join('');
    } catch (e) { return ''; }
}

/**
 * 6. 메인 실행 및 파일 저장
 */
async function main() {
    const date = todayStr();
    const ko = todayKo();
    console.log(`🚀 AIA 뉴스레터 생성 시작: ${ko}`);

    const tplPath = path.join(__dirname, '..', 'template.html');
    if (!fs.existsSync(tplPath)) throw new Error('template.html 파일이 없습니다.');
    let html = fs.readFileSync(tplPath, 'utf-8');

    console.log('📡 AI 데이터 수집 및 변환 중...');
    const [news, hnw, tax, products, cats, cal] = await Promise.all([
        genInsuranceNews(), genHNW(), genTax(), genProducts(), genCategories(), genCalendar()
    ]);

    // 템플릿 치환
    html = html
        .replace(/\{\{DATE_KO\}\}/g, ko)
        .replace(/\{\{DATE_ISO\}\}/g, date)
        .replace(/\{\{DAY_KO\}\}/g, dayKoStr())
        .replace(/\{\{DAY_SHORT\}\}/g, dayShort())
        .replace(/\{\{DAY_NUM\}\}/g, dayNum())
        .replace(/\{\{MONTH_KO\}\}/g, monthKo())
        .replace(/\{\{MONTH_EN\}\}/g, monthEn())
        .replace(/\{\{YEAR\}\}/g, yearStr())
        .replace(/\{\{USD_VAL\}\}/g, "1,471원")
        .replace(/\{\{SUMMARY\}\}/g, "AIA 상품마케팅팀을 위한 오늘의 금융 핵심 요약입니다.")
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

    console.log(`\n🎉 생성 완료: newsletters/${date}.html`);
}

// 최종 실행부 (오류 방지 봉합)
main().catch(err => {
    console.error('❌ 최종 오류 발생:', err);
    process.exit(1);
});
