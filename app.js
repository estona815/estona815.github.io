import { validateBank, generateExam, gradeExam, EXAM_SIZE } from './core.mjs';
import { validateCampaign, evaluateReward } from './rewards.mjs';

const app = document.querySelector('#app');
const dialog = document.querySelector('#modal');
const modalBody = document.querySelector('#modal-body');
const toastBox = document.querySelector('#toast');
const KEY = 'chiikawa-exam-v1';
const LAST_KEY = 'chiikawa-result-v1';
const PUBLIC_SITE_URL = 'https://estona815.github.io';
const h = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const icon = (name, size = 22) => {
  const paths = {
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    back: '<path d="m14 6-6 6 6 6"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    share: '<path d="M12 16V3m-5 5 5-5 5 5M5 13v7h14v-7"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
    book: '<path d="M12 5v16M3 3c4 0 6 1 9 2 3-1 5-2 9-2v16c-4 0-6 0-9 2-3-2-5-2-9-2Z"/>',
    retry: '<path d="M3 10a9 9 0 1 1 1 8M3 3v7h7"/>',
    star: '<path d="m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z" fill="#f8d98c"/>',
    clock: '<circle cx="12" cy="12" r="9" fill="#b6d3e3"/><path d="M12 6v6l4 2"/>',
    paper: '<path d="M6 2h8l4 5v15H6Z" fill="#ffe5eb"/><path d="M14 2v6h4M9 12h6m-6 4h6"/>',
    external: '<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>',
    gift: '<path d="M3 8h18v4H3zM5 12v9h14v-9M12 8v13M12 8H8a3 3 0 1 1 3-3Zm0 0h4a3 3 0 1 0-3-3Z"/>',
    shop: '<path d="m4 3-2 6h20l-2-6ZM4 12v9h16v-9M9 21v-7h6v7M2 9a3 3 0 0 0 5 2 3 3 0 0 0 5 0 3 3 0 0 0 5 0 3 3 0 0 0 5-2"/>',
    ticket: '<path d="M3 5h18v5a2 2 0 0 0 0 4v5H3v-5a2 2 0 0 0 0-4Zm13 0v2m0 3v4m0 3v2"/>'
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.star}</svg>`;
};

let bank, exam = [], answers = [], index = 0, screen = 'home', result = null, reviewFilter = 'wrong';
let toastTimer, cardPromise = null, savedResult = null;
let storageAvailable = true;
let campaign = null, benefitsReturn = 'home';
const hero = new Image();
let heroLoaded;
function loadCardArt() {
  if (!heroLoaded) heroLoaded = new Promise(resolve => {
    hero.onload = () => resolve(true);
    hero.onerror = () => resolve(false);
    hero.src = './assets/picnic-celebration.svg';
    if (hero.complete && hero.naturalWidth) resolve(true);
  });
  return heroLoaded;
}
const STORY_CHAPTERS = [
  {title:'첫 장은 살금살금', message:'아는 이야기가 하나쯤 숨어 있을 거야.', image:'picnic-invitation.svg', alt:'꽃 인장을 붙인 소풍 초대장'},
  {title:'기억을 모아모아', message:'좋아했던 장면을 천천히 떠올려 봐.', image:'picnic-study.svg', alt:'기억을 적어 두는 펼친 노트'},
  {title:'기지개 한 번, 다시 폴짝', message:'조금 낯설어도 괜찮아. 함께 알아가면 돼.', image:'picnic-adventure.svg', alt:'꽃길을 따라가는 작은 소풍 지도'},
  {title:'이제 마지막 페이지', message:'조금만 더 가면, 너만의 성적표가 기다려.', image:'picnic-celebration.svg', alt:'꽃과 리본으로 꾸민 완주 성적표'}
];
function setScreen(next) { screen = next; document.body.dataset.screen = next; }

function toast(message) {
  clearTimeout(toastTimer);
  toastBox.textContent = message;
  toastBox.classList.add('visible');
  toastTimer = setTimeout(() => toastBox.classList.remove('visible'), 3600);
}
function writeStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { storageAvailable = false; }
}
function removeStorage(key) {
  try { localStorage.removeItem(key); return localStorage.getItem(key) === null; }
  catch { storageAvailable = false; return false; }
}
function readStorage(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); }
  catch { return null; }
}
function serialize() {
  return { version: bank.version, exam: exam.map(q => ({ id:q.id, order:q.options.map(o => bank.questions.find(x => x.id === q.id).options.indexOf(o)) })), answers:[...answers], index, savedAt:Date.now() };
}
function deserialize(raw, requireComplete = false) {
  if (!raw || raw.version !== bank.version || !Array.isArray(raw.exam) || raw.exam.length !== EXAM_SIZE || !Array.isArray(raw.answers) || raw.answers.length !== EXAM_SIZE || !Number.isInteger(raw.index) || raw.index < 0 || raw.index >= EXAM_SIZE) return null;
  const ids = new Set();
  const questions = [];
  for (const entry of raw.exam) {
    if (!entry || typeof entry !== 'object') return null;
    const original = bank.questions.find(q => q.id === entry.id);
    if (!original || ids.has(entry.id) || !Array.isArray(entry.order) || entry.order.length !== 4 || new Set(entry.order).size !== 4 || entry.order.some(n => !Number.isInteger(n) || n < 0 || n > 3)) return null;
    ids.add(entry.id);
    questions.push({ ...original, options:entry.order.map(n => original.options[n]), answerIndex:entry.order.indexOf(original.answerIndex) });
  }
  if (raw.answers.some(a => a !== null && (!Number.isInteger(a) || a < 0 || a > 3))) return null;
  if (requireComplete && raw.answers.some(a => a === null)) return null;
  return { exam:questions, answers:[...raw.answers], index:raw.index, savedAt:raw.savedAt };
}
function persist() { if (screen === 'quiz') writeStorage(KEY, serialize()); }
function focusScreen(selector = 'h1') {
  window.scrollTo({top:0, behavior:'instant'});
  requestAnimationFrame(() => {
    const target = app.querySelector(selector) || app;
    target.setAttribute('tabindex', '-1');
    target.focus({preventScroll:true});
  });
}
function openModal(title, content) {
  if (dialog.open) dialog.close();
  modalBody.innerHTML = `<div class="modal-heading"><h2 id="modal-title">${h(title)}</h2><button type="button" class="close-button" data-action="close" aria-label="닫기">${icon('close',18)}</button></div>${content}`;
  dialog.showModal();
}
function closeModal() { if (dialog.open) dialog.close(); }

function renderHome() {
  setScreen('home');
  const saved = deserialize(readStorage(KEY));
  app.innerHTML = `<section class="home story-home">
    <div class="invitation-hero">
      <div class="invitation-heading">
        <h1 class="hero-title"><span>치이카와</span><span>덕력고사</span></h1>
        <p class="hero-subtitle">작은 초대장 한 장,<br>우리의 덕력 소풍이 시작돼요.</p>
        <p class="invitation-story">어느 날, 귀여운 초대장이 도착했어요.<br>친구들과 20개의 이야기를 만나러 가볼까요?</p>
      </div>
      <figure class="hero-visual"><img class="invitation-art" src="./assets/picnic-invitation.svg" width="900" height="900" fetchpriority="high" alt="꽃 인장과 작은 연필이 놓인 분홍 소풍 초대장"></figure>
      <div class="invitation-actions"><button type="button" class="primary start-button" data-action="start">덕력고사 시작하기 ${icon('arrow',25)}</button>
        <p class="invitation-facts">랜덤 20문제 <span aria-hidden="true">·</span> 100점 만점 <span aria-hidden="true">·</span> 시간 제한 없음</p>
        <button class="invite-link" type="button" data-action="copy-link">${icon('share',16)} 도전 링크 복사</button>
        ${saved ? `<button class="continue-link" type="button" data-action="resume">풀던 시험 이어하기 · ${saved.answers.filter(a => a !== null).length}/20문제</button>` : ''}
      </div>
    </div>
    <section class="story-journey" aria-labelledby="journey-title"><img class="journey-flower" src="./assets/flower.svg" width="26" height="26" alt=""><h2 id="journey-title">오늘의 작은 여정</h2><ol class="journey-stops">
      <li class="journey-stop"><img src="./assets/picnic-study.svg" width="900" height="600" loading="lazy" decoding="async" alt="꽃갈피를 끼운 소풍 노트"><div><h3>작은 초대장</h3><p>두근두근, 함께 갈래?</p></div></li>
      <li class="journey-stop"><img src="./assets/picnic-adventure.svg" width="900" height="600" loading="lazy" decoding="async" alt="점선으로 이어진 소풍 지도"><div><h3>이야기 산책</h3><p>좋아했던 장면을 하나씩</p></div></li>
      <li class="journey-stop"><img src="./assets/picnic-celebration.svg" width="900" height="600" loading="lazy" decoding="async" alt="리본과 꽃이 달린 완주 성적표"><div><h3>우리들의 성적표</h3><p>끝까지 함께한 오늘의 기념</p></div></li>
    </ol></section>
    <p class="fan-note">공식 자료를 읽고 만든 비공식 팬 퀴즈예요.<br>원작·애니메이션의 스포일러가 포함돼요.</p>
  </section>`;
}
function startExam() {
  closeModal();
  exam = generateExam(bank.questions);
  answers = new Array(EXAM_SIZE).fill(null);
  index = 0; result = null; cardPromise = null;
  renderQuestion(); persist(); focusScreen('.question-title');
  if (!storageAvailable) toast('이 브라우저에서는 진행 상황을 저장할 수 없어요. 창을 닫지 않고 풀어 주세요.');
}
function resumeExam() {
  const saved = deserialize(readStorage(KEY));
  if (!saved) { toast('이어 풀 수 있는 시험이 없어요.'); renderHome(); return; }
  exam = saved.exam; answers = saved.answers; index = saved.index; result = null; cardPromise = null;
  closeModal(); renderQuestion(); focusScreen('.question-title');
}
function renderQuestion() {
  setScreen('quiz');
  const q = exam[index];
  const completed = answers.filter(a => a !== null).length;
  const level = ['','쉬움','보통','어려움'][q.difficulty];
  const chapterNumber = Math.floor(index / 5);
  const chapter = STORY_CHAPTERS[chapterNumber];
  app.innerHTML = `<section class="question-page story-question">
    <div class="chapter-intro"><img class="chapter-art" src="./assets/${chapter.image}" width="1536" height="1024" alt="${chapter.alt}"><div class="chapter-copy"><p class="chapter-title">${chapter.title}</p><p class="chapter-message">${chapter.message}</p></div><div class="question-counter" aria-label="20문제 중 ${index+1}번째">${String(index+1).padStart(2,'0')} <small>/ 20</small></div></div>
    <ol class="chapter-stops" aria-label="이야기 진행"><li ${chapterNumber===0?'aria-current="step"':''}>초대장</li><li ${chapterNumber===1?'aria-current="step"':''}>기억 조각</li><li ${chapterNumber===2?'aria-current="step"':''}>이야기 산책</li><li ${chapterNumber===3?'aria-current="step"':''}>마지막 장</li></ol>
    <div class="progress-track" role="progressbar" aria-label="답한 문제 수" aria-valuemin="0" aria-valuemax="20" aria-valuenow="${completed}"><div class="progress-fill" style="width:${completed/EXAM_SIZE*100}%"></div></div>
    <div class="question-meta"><span class="category">${h(q.category)}</span><span>${level} · 5점</span></div>
    <fieldset class="question-field"><legend class="question-title">${h(q.question)}</legend>
      <div class="choices">${q.options.map((option, i) => `<label class="choice"><input type="radio" name="choice" value="${i}" ${answers[index] === i ? 'checked' : ''}><span class="choice-number" aria-hidden="true">${i+1}</span><span class="choice-text">${h(option)}</span><span class="choice-check">${icon('check',20)}</span></label>`).join('')}</div>
    </fieldset>
    <div class="question-nav"><button type="button" class="back-button" data-action="previous" ${index===0?'disabled':''}>${icon('back',18)} 이전 문제</button><button type="button" class="primary" data-action="next" ${answers[index]===null?'disabled':''}>${index===EXAM_SIZE-1?'성적표 받기':'다음 문제'} ${icon('arrow',21)}</button></div>
    <p class="question-hint">정답은 마지막에 함께 확인해요.</p>
  </section>`;
}
function completeExam() {
  const missing = answers.findIndex(a => a === null);
  if (missing !== -1) { index=missing; renderQuestion(); focusScreen('.question-title'); toast('아직 답하지 않은 문제가 있어요.'); return; }
  result = gradeExam(exam, answers);
  const snapshot = serialize();
  savedResult = snapshot; writeStorage(LAST_KEY, snapshot); removeStorage(KEY);
  renderResult(); focusScreen();
}
function renderResult() {
  setScreen('result');
  if (!result) result = gradeExam(exam, answers);
  const r = result;
  app.innerHTML = `<section class="result">
    <h1 class="result-heading">오늘의 덕력 소풍, 완주!</h1><p class="result-caption">친구들과 함께 만든 나의 덕력 성적표</p><div class="result-rule" aria-hidden="true"></div>
    <div class="result-score" aria-label="100점 만점에 ${r.score}점">${r.score}<small>점</small></div>
    <p class="result-count">20문제 중 ${r.correct}문제 정답</p>
    <h2 class="grade-title">${h(r.grade.title)}</h2>
    <p class="grade-message">${h(r.grade.message)}</p>
    <img class="result-art celebration-art" src="./assets/picnic-celebration.svg" width="900" height="600" alt="리본과 꽃으로 꾸민 완주 성적표">
    <p class="story-completion">${r.score>=90?'작은 이야기까지 기억한 너, 멋져!':r.score>=50?'좋아했던 장면들이 차곡차곡 모였네.':'처음 만난 이야기도, 이제는 네 덕력이야.'}</p>
    <div class="category-scores" aria-label="영역별 정답 수">${r.categories.map(c => `<div class="category-row"><span>${h(c.name)}</span><div class="category-track" aria-hidden="true"><span style="width:${c.total ? c.correct/c.total*100 : 0}%"></span></div><span>${c.correct} / ${c.total}</span></div>`).join('')}</div>
    <div class="result-actions"><button type="button" class="primary" data-action="share">${icon('share',23)} 친구에게 자랑하기</button><div class="actions-two"><button type="button" class="secondary" data-action="download">${icon('download',19)} 성적표 저장</button><button type="button" class="secondary" data-action="review">${icon('book',19)} 해설 노트</button></div></div>
    <button type="button" class="retry" data-action="retry">${icon('retry',17)} 한 번 더 도전하기</button>
    <a class="reading-link" href="./guides/">좋아하는 세계를 더 알아보기 ${icon('book',18)}</a>
  </section>`;
  if (!cardPromise) cardPromise = makeResultCard(r).catch(() => null);
}
function storePromotion() {
  if (!campaign) return '';
  return `<aside class="store-promo" aria-label="IYIY 스토어 홍보"><img src="./assets/picnic-gift.svg" width="480" height="480" loading="lazy" decoding="async" alt=""><div><p class="promo-label">스토어 홍보 · IYIY</p><h2>소풍 뒤엔, 취향 구경</h2><p>좋아하는 귀여움을 천천히 만나봐요.</p><a href="${h(campaign.store.url)}" target="_blank" rel="noopener noreferrer">IYIY 스토어 구경하기 ${icon('external',15)}<span class="sr-only"> (새 탭)</span></a></div></aside>`;
}
function rewardCard(scoreResult = null, compact = false) {
  if (!campaign) return '';
  const reward = scoreResult ? evaluateReward(scoreResult, campaign) : null;
  const eligible = reward?.eligible === true;
  const validResult = reward && reward.status !== 'invalid_result' && reward.status !== 'invalid_campaign';
  const headline = eligible ? '와아! 혜택 점수를 달성했어요' : validResult ? '조금 더 알아가면, 선물에 한 걸음!' : '덕력에 도전하고, 작은 선물도';
  const note = eligible ? `${scoreResult.score}점 · 20문제 중 ${scoreResult.correct}문제 정답!` : validResult ? scoreResult.score === 90 ? '아깝다! 한 문제만 더 맞히면 95점이에요.' : `이번에는 ${scoreResult.score}점. 95점에 다시 도전해 봐요.` : '20문제 중 19문제 이상, 95점 또는 100점';
  return `<section class="reward-card ${eligible ? 'reward-earned' : ''} ${compact ? 'reward-compact' : ''}" aria-label="IYIY 할인 혜택 미리보기">
    <div class="reward-heading"><span>${icon(eligible ? 'star' : 'gift',18)} ${eligible ? '점수 조건 달성' : 'IYIY의 작은 선물'}</span><span class="preview-pill">미리보기</span></div>
    <div class="reward-ticket"><div class="reward-value"><strong>${campaign.discountPercent}<small>%</small></strong><span>할인 쿠폰</span></div><div class="reward-copy"><p class="reward-store">${h(campaign.store.name)}</p><h2>${headline}</h2><p>${note}</p></div></div>
    <div class="reward-bottom"><p>${icon('clock',15)} 쿠폰 발급은 준비 중이에요.</p>${compact ? '<button type="button" class="reward-more" data-action="benefits">혜택 자세히 보기 <span aria-hidden="true">→</span></button>' : '<span class="reward-preparing">오픈 준비 중</span>'}</div>
  </section>`;
}
function latestBenefitResult() {
  const saved = deserialize(readStorage(LAST_KEY), true);
  if (saved) return gradeExam(saved.exam, saved.answers);
  return result;
}
function showBenefits() {
  if (screen !== 'benefits') benefitsReturn = screen;
  persist();
  closeModal();
  renderBenefits();
  focusScreen();
}
function returnFromBenefits() {
  if (benefitsReturn === 'quiz' && exam.length === EXAM_SIZE && answers.length === EXAM_SIZE) { renderQuestion(); focusScreen('.question-title'); }
  else if (benefitsReturn === 'result' && result) { renderResult(); focusScreen(); }
  else if (benefitsReturn === 'review' && result) { renderReview(); focusScreen(); }
  else { renderHome(); focusScreen(); }
}
function renderBenefits() {
  setScreen('benefits');
  const returnLabel = benefitsReturn === 'quiz' ? '풀던 시험으로 돌아가기' : benefitsReturn === 'result' ? '성적표로 돌아가기' : benefitsReturn === 'review' ? '해설 노트로 돌아가기' : '첫 화면으로';
  if (!campaign) {
    app.innerHTML = `<section class="benefits-page"><button type="button" class="back-button" data-action="benefits-back">${icon('back',17)} ${returnLabel}</button><div class="loading"><h1>혜택 안내를 준비하고 있어요</h1><p>잠시 후 다시 확인해 주세요.<br>덕력고사는 계속 풀 수 있어요.</p></div></section>`;
    return;
  }
  const last = latestBenefitResult();
  app.innerHTML = `<section class="benefits-page">
    <button type="button" class="back-button" data-action="benefits-back">${icon('back',17)} ${returnLabel}</button>
    <div class="benefits-intro"><p class="eyebrow">IYIY × 덕력고사</p><h1>소풍의 마지막,<br><span>작은 선물 예고.</span></h1><p>좋아하는 마음을 모아, 작은 선물을 준비하고 있어요.</p><img class="benefits-art gift-art" src="./assets/picnic-gift.svg" width="480" height="480" alt="분홍 리본과 꽃 장식으로 포장한 작은 선물"></div>
    ${last ? `<p class="benefit-recent">이 브라우저의 최근 성적 · <strong>${last.score}점</strong></p>` : ''}
    ${rewardCard(last)}
    <div class="benefit-steps" aria-label="혜택 이용 순서"><div><span>01</span><h2>20문제 풀기</h2><p>나의 덕력을 확인해요</p></div><div><span>02</span><h2>95점에 도전</h2><p>19문제 이상 정답!</p></div><div><span>03</span><h2>혜택 만나기</h2><p>쿠폰 오픈 준비 중</p></div></div>
    <aside class="benefit-notice"><span aria-hidden="true">${icon('ticket',23)}</span><div><h2>아직은 혜택 미리보기예요</h2><p>지금은 쿠폰이 발급되지 않아요. 이벤트 일정과 사용 조건은 오픈할 때 알려드릴게요.</p><p class="benefit-rule">혜택 기준은 <strong>90점 초과</strong>예요. 현재 배점에서는 95점·100점이 해당돼요.</p></div></aside>
    <section class="store-card"><div class="store-badge" aria-hidden="true">${icon('shop',32)}</div><div class="store-copy"><p class="eyebrow">취향을 찾아가는 시간</p><h2>IYIY 스마트스토어</h2><p>어떤 귀여움을 만나게 될까?<br>좋아하는 것들을 천천히 구경해 봐요.</p></div><a class="secondary store-link" href="${h(campaign.store.url)}" target="_blank" rel="noopener noreferrer">IYIY 구경하기 ${icon('external',17)}<span class="sr-only"> (새 탭)</span></a><p class="store-footnote">상품과 구매 조건은 스토어에서 확인해 주세요.</p></section>
    <button class="primary benefit-cta" type="button" data-action="${benefitsReturn === 'quiz' ? 'benefits-back' : 'start'}">${benefitsReturn === 'quiz' ? '풀던 시험 이어하기' : last ? '95점에 다시 도전하기' : '나의 덕력 확인하기'} ${icon('arrow',21)}</button>
    <p class="benefits-kindness">혜택 점수와 상관없이, 좋아하는 마음은 늘 만점.</p>
  </section>`;
}
function renderReview() {
  setScreen('review');
  const wrong = result.review.filter(q => !q.correct);
  const items = result.review.map((entry, i) => ({...entry, number:i+1})).filter(entry => reviewFilter === 'all' || !entry.correct);
  app.innerHTML = `<section class="review"><div class="section-head"><h1>해설 노트</h1><button type="button" class="back-button" data-action="result">${icon('back',17)} 성적표</button></div><p class="review-intro">한 문제씩 알아가면, 덕력도 쑥쑥 자라요.</p><div class="filter-tabs" aria-label="해설 보기"><button type="button" data-action="filter-wrong" aria-pressed="${reviewFilter==='wrong'}">틀린 문제 ${wrong.length}</button><button type="button" data-action="filter-all" aria-pressed="${reviewFilter==='all'}">전체 20문제</button></div><div class="review-items">
  ${items.length ? items.map(entry => {
    const q=entry.question, source=bank.sources.find(s => s.id===q.sourceId);
    return `<article class="review-item"><div class="review-label"><span>${String(entry.number).padStart(2,'0')} · ${h(q.category)}</span><strong class="${entry.correct?'correct':''}">${entry.correct?'정답':'다음엔 맞힐 거야'}</strong></div><h2>${h(q.question)}</h2><div class="answer-lines">${!entry.correct ? `<div class="wrong-answer">내 답 · ${h(q.options[entry.selectedIndex] ?? '미응답')}</div>` : ''}<div class="right-answer">정답 · ${h(q.options[q.answerIndex])}</div></div><p class="explanation">${h(q.explanation)}</p><a class="source-link" href="${h(source.url)}" target="_blank" rel="noopener noreferrer">${h(source.title)} ${icon('external',12)}</a></article>`;
  }).join('') : `<div class="empty-note">${icon('star',44)}<h2>빈틈없는 덕력이야!</h2><p>틀린 문제가 없어요.<br>전체 문제에서 해설을 다시 볼 수 있어요.</p></div>`}</div><button type="button" class="secondary review-bottom" data-action="result">${icon('back',17)} 성적표로 돌아가기</button></section>`;
}
function showGuide() {
  openModal('시험 보기 전에', `<p>작고 귀여운 세계를 얼마나 알고 있는지, 가볍게 확인해 봐요.</p><ul><li>현재 <strong>${bank.questions.length}문제</strong> 중 매번 20문제를 뽑아요.</li><li>쉬움 8개 · 보통 8개 · 어려움 4개예요.</li><li>한 문제에 5점, 총 100점이에요.</li><li>시간 제한은 없고, 답을 바꿀 수 있어요.</li><li>마지막에 점수와 해설을 함께 확인해요.</li></ul><p class="muted">원작·애니메이션 내용이 포함돼요. 공식 자료를 참고해 만든 비공식 팬 퀴즈이며, 장식은 꽃·초대장·지도 등 자체 디자인이에요. 난이도는 편집 기준이에요.</p><p class="muted">이 앱의 풀이 기록은 이 브라우저에만 저장돼요. 브라우저 기록을 지우면 사라질 수 있어요. 현재 성적표 이미지와 문구를 공유할 수 있어요.</p><button class="primary" type="button" data-action="close">알겠어!</button>`);
}
function showSources() {
  openModal('문제 출처', `<p>공식 공개 자료를 참고한 ${bank.questions.length}문제예요. 각 문제의 해설에서 해당 출처를 확인할 수 있어요.</p><ul class="source-list">${bank.sources.map(s => `<li><a href="${h(s.url)}" target="_blank" rel="noopener noreferrer">${h(s.title)} ${icon('external',12)}</a></li>`).join('')}</ul><p class="muted">확인일 · ${h(bank.reviewedAt)}<br>캐릭터·작품 권리는 원권리자에게 있어요. 이 퀴즈는 공식 서비스가 아니에요.</p>`);
}
function showHistory() {
  const saved = deserialize(readStorage(LAST_KEY), true);
  if (!saved) {
    const pending = deserialize(readStorage(KEY));
    openModal('내 기록', `<p>${pending ? `진행 중인 시험이 있어요. ${pending.answers.filter(a => a !== null).length}/20문제에 답했어요.` : '아직 완성한 성적표가 없어요. 20문제를 풀면 마지막 성적표가 여기에 남아요.'}</p><p class="muted">이 브라우저에 저장한 최근 기록만 보여요.</p>${pending ? '<button class="primary" type="button" data-action="resume">풀던 시험 이어하기</button>' : '<button class="primary" type="button" data-action="close">확인</button>'}<button class="danger-link" type="button" data-action="clear-history">이 브라우저의 풀이 기록 지우기</button>`);
    return;
  }
  const r=gradeExam(saved.exam,saved.answers);
  openModal('지난 덕력 성적표', `<div class="history-score">${r.score}점</div><div class="history-grade">${h(r.grade.title)}</div><p class="muted" style="text-align:center">20문제 중 ${r.correct}문제 정답 · 이 브라우저의 최근 기록</p><button class="primary" type="button" data-action="load-result">성적표 다시 보기</button><button class="danger-link" type="button" data-action="clear-history">이 브라우저의 풀이 기록 지우기</button>`);
}
function loadLastResult() {
  const saved = deserialize(readStorage(LAST_KEY), true);
  if (!saved) { toast('저장된 성적표를 찾지 못했어요.'); return; }
  exam=saved.exam; answers=saved.answers; index=saved.index;
  result=gradeExam(exam,answers); cardPromise=null;
  closeModal(); renderResult(); focusScreen();
}
function resultText() {
  return `치이카와 덕력고사\n오늘의 덕력 소풍, 완주!\n${result.score}점 · ${result.grade.title}\n20문제 중 ${result.correct}문제 정답!\n좋아하는 마음은 언제나 만점.\n\n나도 도전하기\n${PUBLIC_SITE_URL}\n#치이카와덕력고사 #비공식팬퀴즈`;
}
async function copyChallengeLink() {
  try {
    await navigator.clipboard.writeText(PUBLIC_SITE_URL);
    toast('도전 링크를 복사했어요. 친구에게 초대장을 보내 봐요!');
  } catch {
    openModal('친구에게 초대장 보내기', `<p>아래 링크를 복사해서 보내면 누구나 덕력고사에 도전할 수 있어요.</p><textarea class="share-text" readonly aria-label="공개 도전 링크">${PUBLIC_SITE_URL}</textarea><button type="button" class="primary" data-action="close">확인</button>`);
  }
}
async function shareResult() {
  const score = result.score;
  const text = resultText();
  const blob = await cardPromise;
  if (navigator.share) {
    const data={title:'치이카와 덕력고사',text};
    if (blob) {
      const file=new File([blob],`chiikawa-score-${score}.png`,{type:'image/png'});
      if (navigator.canShare?.({files:[file]})) data.files=[file];
    }
    try { await navigator.share(data); toast('성적표를 공유했어요.'); return; }
    catch (error) { if (error.name==='AbortError') { toast('공유를 취소했어요.'); return; } }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('결과 문구를 복사했어요. 친구에게 붙여넣어 주세요!');
  } catch {
    openModal('결과 문구 공유', `<p>아래 문구를 길게 눌러 복사해 주세요. 성적표 이미지도 저장할 수 있어요.</p><textarea class="share-text" readonly aria-label="공유할 결과 문구">${h(text)}</textarea><button class="primary" type="button" data-action="download">${icon('download',20)} 성적표 이미지 저장</button>`);
  }
}
async function downloadResult() {
  const score=result.score;
  const blob=await cardPromise;
  if (!blob) { toast('이미지를 만들지 못했어요. 결과 문구로 공유해 주세요.'); return; }
  const url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url; a.download=`chiikawa-score-${score}.png`; a.rel='noopener';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url),60000);
  toast('성적표 이미지 저장을 시작했어요.');
}
async function makeResultCard(r) {
  await document.fonts.ready;
  const hasHero=await loadCardArt();
  const canvas=document.createElement('canvas'); canvas.width=1080; canvas.height=1350;
  const ctx=canvas.getContext('2d'); if (!ctx) throw new Error('Canvas unavailable');
  ctx.fillStyle='#fff0f2'; ctx.fillRect(0,0,1080,1350);
  ctx.fillStyle='#f5b2c040';
  for(let i=0;i<1350;i+=80) ctx.fillRect(0,i,1080,40);
  for(let i=0;i<1080;i+=80) ctx.fillRect(i,0,40,1350);
  ctx.fillStyle='#fffbf2';ctx.strokeStyle='#806254';ctx.lineWidth=3;
  ctx.beginPath();ctx.roundRect(60,50,960,1250,20);ctx.fill();ctx.stroke();
  ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#513b31';
  ctx.font='56px Jua';ctx.fillText('치이카와 덕력고사',540,135);
  ctx.strokeStyle='#cbb09f';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(125,200);ctx.lineTo(955,200);ctx.stroke();
  ctx.font='32px Gowun';ctx.fillStyle='#81695f';ctx.fillText('오늘의 덕력 소풍, 완주!',540,259);
  ctx.fillStyle='#513b31';ctx.font='174px Jua';ctx.fillText(`${r.score}점`,540,390);
  ctx.font='32px Gowun';ctx.fillStyle='#81695f';ctx.fillText(`20문제 중 ${r.correct}문제 정답`,540,496);
  ctx.fillStyle='#b35d78';ctx.font='62px Jua';ctx.fillText(r.grade.title,540,589,840);
  if(hasHero) ctx.drawImage(hero,200,635,680,453.3333);
  ctx.strokeStyle='#cbb09f';ctx.setLineDash([9,9]);ctx.beginPath();ctx.moveTo(125,1090);ctx.lineTo(955,1090);ctx.stroke();ctx.setLineDash([]);
  ctx.fillStyle='#513b31';ctx.font='29px Gowun';ctx.fillText(r.categories.map(c=>`${c.name} ${c.correct}/${c.total}`).join('     '),540,1136);
  ctx.font='33px Jua';ctx.fillText('좋아하는 마음은 언제나 만점.',540,1200);
  ctx.fillStyle='#8c7267';ctx.font='23px Gowun';ctx.fillText('팬이 만든 비공식 퀴즈 · 덕력 소풍',540,1260);
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Image generation failed')),'image/png'));
}

document.addEventListener('change', event => {
  if (event.target.matches('input[name="choice"]') && screen==='quiz') {
    answers[index]=Number(event.target.value); persist();
    app.querySelector('[data-action="next"]').disabled=false;
    const completed=answers.filter(a=>a!==null).length;
    app.querySelector('[role="progressbar"]').setAttribute('aria-valuenow',String(completed));
    app.querySelector('.progress-fill').style.width=`${completed/EXAM_SIZE*100}%`;
  }
});
document.addEventListener('click', async event => {
  const button=event.target.closest('[data-action]');
  if(!button || button.disabled) return;
  const action=button.dataset.action;
  if(!bank && action!=='reload' && action!=='close') return;
  switch(action) {
    case 'start': case 'retry':
      if(deserialize(readStorage(KEY))) openModal('새 시험을 시작할까?', '<p>풀던 시험이 있어요. 새로 시작하면 진행 중인 답안은 바뀌어요.</p><button class="primary" type="button" data-action="resume">풀던 시험 이어하기</button><button class="secondary" type="button" data-action="new">새 문제로 시작하기</button>');
      else startExam(); break;
    case 'new': startExam(); break;
    case 'resume': resumeExam(); break;
    case 'home':
      if(screen==='quiz') { persist(); openModal('잠깐 쉬어 갈까?', `<p>${storageAvailable?'지금까지 고른 답은 이 브라우저에 저장돼요. 첫 화면에서 이어 풀 수 있어요.':'이 브라우저에서는 기록이 저장되지 않아요. 첫 화면으로 가면 진행 중인 시험을 잃을 수 있어요.'}</p><button class="primary" type="button" data-action="confirm-home">첫 화면으로</button><button class="secondary" type="button" data-action="close">계속 풀기</button>`); }
      else {renderHome();focusScreen();} break;
    case 'confirm-home': closeModal();renderHome();focusScreen();break;
    case 'previous': if(index>0) {index--;renderQuestion();persist();focusScreen('.question-title');} break;
    case 'next':
      if(answers[index]===null) return;
      if(index===EXAM_SIZE-1) completeExam(); else {index++;renderQuestion();persist();focusScreen('.question-title');} break;
    case 'result': renderResult();focusScreen();break;
    case 'review': reviewFilter='wrong';renderReview();focusScreen();break;
    case 'filter-wrong': reviewFilter='wrong';renderReview();app.querySelector('[data-action="filter-wrong"]').focus();break;
    case 'filter-all': reviewFilter='all';renderReview();app.querySelector('[data-action="filter-all"]').focus();break;
    case 'guide': showGuide();break;
    case 'benefits': showBenefits();break;
    case 'benefits-back': returnFromBenefits();break;
    case 'sources': showSources();break;
    case 'history': showHistory();break;
    case 'load-result': loadLastResult();break;
    case 'clear-history': openModal('풀이 기록 지우기', '<p>이 브라우저의 진행 중인 시험과 최근 성적표를 지워요.</p><button type="button" class="primary" data-action="confirm-clear">기록 지우기</button><button type="button" class="secondary" data-action="close">취소</button>');break;
    case 'confirm-clear': {
      const progressRemoved=removeStorage(KEY), resultRemoved=removeStorage(LAST_KEY);
      savedResult=null;exam=[];answers=[];index=0;result=null;cardPromise=null;closeModal();renderHome();focusScreen();
      toast(progressRemoved && resultRemoved ? '이 브라우저의 기록을 지웠어요.' : '저장소에 접근할 수 없어요. 브라우저 설정에서 이 사이트의 데이터를 지워 주세요.');
      break;
    }
    case 'close': closeModal();break;
    case 'share': button.disabled=true;try {await shareResult();} finally {button.disabled=false;} break;
    case 'copy-link': button.disabled=true;try {await copyChallengeLink();} finally {button.disabled=false;} break;
    case 'download': button.disabled=true;try {await downloadResult();} finally {button.disabled=false;} break;
    case 'reload': window.location.reload();break;
  }
});
dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeModal();}});
window.addEventListener('pagehide',persist);

try {
  const [response, campaignResponse] = await Promise.all([
    fetch('./questions.json',{cache:'no-cache'}),
    fetch('./campaign.json',{cache:'no-cache'}).catch(() => null)
  ]);
  if(!response.ok) throw new Error('Unable to load question bank');
  bank=validateBank(await response.json());
  if (campaignResponse?.ok) {
    try { campaign=validateCampaign(await campaignResponse.json()); }
    catch { campaign=null; }
  }
  renderHome();
} catch {
  app.innerHTML=`<div class="loading"><img src="./assets/flower.svg" width="40" height="40" alt=""><h1>시험지를 가져오지 못했어요</h1><p>연결을 확인하고 한 번 더 눌러 주세요.</p><button type="button" class="primary" data-action="reload" style="margin:24px auto 0;max-width:280px">다시 불러오기</button></div>`;
}
