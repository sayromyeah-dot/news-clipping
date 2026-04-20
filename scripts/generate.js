#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

// ── 1. 날짜 및 시간 유틸리티 (KST) ─────────────────────────────
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

// ── 2. 구글 뉴스 수집 (RSS) ─────────────────────────────────
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

// ── 3. AI 엔진 (Gemini 1.5 Flash 전용) ───────────────────────
async function callAI(system, user) {
    const key = (process.env.GEMINI_API_KEY || '').trim();
    if (!key) {
        throw new Error('GEMINI_API_KEY가 설정되지 않았습니다. GitHub Secrets와 Workflow 설정을 확인해주세요.');
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`;

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ 
                role: 'user', 
                parts: [{ text: `지침: ${system}\n\n데이터:\n${user}` }] 
            }]
        })
    });

    const data = await res.json();
    if (!res.ok) {
        throw new Error(`Gemini API 에러(${res.status}): ${JSON.stringify(data.error)}`);
    }
    
    const responseText = data.candidates[0].content.parts[0].text;
    // JSON 응답 시 발생하는 마크다운 기호 제거
    return responseText.replace(/```json/g, '').replace(/```/g, '').trim();
}

// ── 4. 카드 디자인 빌더 (기존 디자인 100% 보존) ─────────────────
function buildCard(item, index, extraClass = '') {
    const num = String(index + 1).padStart(2, '0');
    const bMap = { official: 'badge-official', press: 'badge-press', research: 'badge-research' };
    const lMap = { official: '공식발표', press: '언론보도', research: '리서치' };
    const safeUrl = item.url ? encodeURI(item.url) : '#';

    return `
    <a class="news-card${extraClass}" href="${safeUrl}" target="_blank">
        <div class="nc-num">${num}</div>
        <div>
            <div class="nc-tags"><span class="nc-tag ${item.tagClass || 'tag-mkt'}">${item.tag || '뉴스'}</span></div>
            <div class="nc-title">${item.title || ''}</div>
            <div class="nc-desc">${item.desc || ''}</div>
            ${item.marketingTip ? `<div class="nc-mkt-tip">${item.marketingTip}</div>` : ''}
            <div class="nc-footer">
                <span class="nc-src">${item.source || ''}<span class="nc-src-badge ${bMap[item.sourceType] || 'badge-press'}">${lMap[item.sourceType] || '언론보도'}</span></span>
                <span class="nc-link">원문 보기 →</span>
            </div>
        </div>
    </a>`;
}

// ── 5. 섹션별 데이터 생성 로직 ───────────────────────────────
async function genInsuranceNews() {
    const ctx = await getRealtimeNews('보험 신상품 상속세 시니어 달러보험');
    const res = await callAI("보험 에디터", `JSON 배열(5건)로 출력: [{"tag":"신상품","tagClass":"tag-new","title":"제목","desc":"요약","marketingTip":"팁","source":"출처","sourceType":"press","url":"링크"}]`);
    try {
        const arr = JSON.parse(res);
        return { html: arr.map((item, i) => buildCard(item, i)).join(''), count: arr.length };
    } catch (e) { return { html: '', count: 0 }; }
}

async function genHNW() {
    const ctx = await getRealtimeNews('고액자산가 투자 트렌드');
    const res = await callAI("HNW 리서처", `JSON 배열(4건) 출력: [{"tag":"자산트렌드","tagClass":"tag-hnw","title":"제목","desc":"요약","marketingTip":"팁","source":"출처","sourceType":"press","url":"링크"}]`);
    try {
        return JSON.parse(res).map((item, i) => buildCard(item, i, ' hnw-card')).join('');
    } catch (e) { return ''; }
}

async function genTax() {
    const ctx = await getRealtimeNews('상속세 증여세 절세 보험');
    const res = await callAI("세무사", `JSON 배열(4건) 출력: [{"tag":"세무","tagClass":"tag-tax","title":"제목","desc":"요약","marketingTip":"팁","source":"출처","sourceType":"official","url":"링크"}]`);
    try {
        return JSON.parse(res).map((item, i) => buildCard(item, i)).join('');
    } catch (e) { return ''; }
}

async function genProducts() {
    const ctx = await getRealtimeNews('보험 신상품 출시');
    return await callAI("에디터", `5줄의 <tr><td>회사</td><td>상품명</td><td>날짜</td><td>유형</td><td>특징</td></tr> HTML만 생성.\n뉴스:\n${ctx}`);
}

async function genCategories() {
    return await callAI("에디터", "5개 카테고리를 <div class=\"cat\">내용</div> HTML로 작성 (🧬헬스, 💰금융, 📊인구, 🤖AI, 🌐해외)");
}

async function gen
