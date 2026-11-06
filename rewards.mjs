/**
 * Preview-only shopping reward policy.
 * A browser score can illustrate eligibility; it never authorizes real issuance.
 * This module deliberately has no coupon provider call, claim URL or live mode.
 */
const REQUIRED_TOTAL = 20;
const THRESHOLD_SCORE = 90;
const DISCOUNT_PERCENT = 5;
const CORRECT_NEEDED = 19;
const SCORE_NEEDED = 95;
const STORE_ORIGIN = 'https://smartstore.naver.com';
const STORE_PATH = '/iyiy';
const UNAVAILABLE_FIELDS = ['couponUrl', 'claimEndpoint', 'couponCode', 'provider'];

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function nullableInteger(value, name, minimum = 1) {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${name} must be null or a safe integer >= ${minimum}.`);
  }
  return value;
}

function nullableDate(value, name) {
  if (value == null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${name} must be null or an ISO timestamp with a timezone.`);
  }
  return value;
}

/** Only this verified store landing page is permitted as a navigation target. */
function verifiedStoreUrl(value) {
  if (typeof value !== 'string' || value.trim() !== value) throw new TypeError('A verified HTTPS store URL is required.');
  let url;
  try { url = new URL(value); } catch { throw new TypeError('Invalid store URL.'); }
  if (url.origin !== STORE_ORIGIN || url.protocol !== 'https:' || url.username || url.password || url.port ||
      ![STORE_PATH, `${STORE_PATH}/`].includes(url.pathname) || url.search || url.hash) {
    throw new TypeError('The store URL must be the allowlisted IYIY SmartStore landing page.');
  }
  return `${STORE_ORIGIN}${STORE_PATH}`;
}

/**
 * Validate and copy the current, explicitly preview-only campaign.
 * Optional unset terms normalize to null. Unsupported issuance settings fail closed.
 * Throws on invalid configuration; evaluateReward catches this for customer UI.
 */
export function validateCampaign(campaign) {
  if (!record(campaign)) throw new TypeError('Campaign must be an object.');
  if (campaign.version !== '0.2') throw new TypeError('Unsupported campaign version.');
  if (typeof campaign.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(campaign.id)) throw new TypeError('A stable campaign id is required.');
  if (campaign.mode !== 'preview') throw new TypeError('Only preview campaigns are supported; real issuance is unavailable.');
  if (campaign.discountPercent !== DISCOUNT_PERCENT) throw new TypeError('This preview campaign is for a 5% benefit.');
  if (campaign.requiredQuestionCount !== REQUIRED_TOTAL) throw new TypeError('This campaign requires exactly 20 questions.');
  if (!record(campaign.threshold) || campaign.threshold.operator !== 'gt' || campaign.threshold.score !== THRESHOLD_SCORE) {
    throw new TypeError('This campaign requires a score strictly greater than 90.');
  }
  if (!record(campaign.store) || typeof campaign.store.name !== 'string' || !campaign.store.name.trim()) throw new TypeError('A named verified store is required.');
  for (const key of UNAVAILABLE_FIELDS) {
    if (campaign[key] != null) throw new TypeError(`${key} cannot be enabled in the preview campaign.`);
  }
  const startsAt = nullableDate(campaign.startsAt, 'startsAt');
  const endsAt = nullableDate(campaign.endsAt, 'endsAt');
  if (startsAt !== null && endsAt !== null && Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new TypeError('endsAt must be later than startsAt.');
  }
  return {
    version: '0.2', id: campaign.id, mode: 'preview',
    store: { name: campaign.store.name.trim(), url: verifiedStoreUrl(campaign.store.url) },
    discountPercent: DISCOUNT_PERCENT,
    threshold: { operator: 'gt', score: THRESHOLD_SCORE },
    requiredQuestionCount: REQUIRED_TOTAL,
    startsAt, endsAt,
    couponValidityDays: nullableInteger(campaign.couponValidityDays, 'couponValidityDays'),
    minimumOrderAmount: nullableInteger(campaign.minimumOrderAmount, 'minimumOrderAmount', 0),
    maximumDiscountAmount: nullableInteger(campaign.maximumDiscountAmount, 'maximumDiscountAmount'),
    issuanceLimit: nullableInteger(campaign.issuanceLimit, 'issuanceLimit'),
    perCustomerLimit: nullableInteger(campaign.perCustomerLimit, 'perCustomerLimit'),
    couponUrl: null, claimEndpoint: null, couponCode: null, provider: null
  };
}

const unavailable = (status, reason, values = {}) => ({
  status, reason, eligible: false,
  canClaim: false, canIssue: false, issued: false,
  mode: 'preview', isPreview: true,
  correctNeeded: null, correctGap: null, scoreNeeded: null, scoreGap: null,
  discountPercent: null, storeName: null, storeUrl: null,
  thresholdLabel: null,
  title: '혜택 정보를 확인하고 있어요',
  message: '지금은 쿠폰을 발급하지 않아요.',
  ...values
});

/**
 * Pure, fail-closed preview evaluation.
 * `eligible` means the canonical score meets the preview rule, never that a coupon
 * exists or may be issued. Every result has canClaim/canIssue/issued === false.
 */
export function evaluateReward(result, campaign) {
  let config;
  try { config = validateCampaign(campaign); }
  catch { return unavailable('invalid_campaign', 'invalid_campaign'); }
  const common = {
    correctNeeded: CORRECT_NEEDED, scoreNeeded: SCORE_NEEDED,
    discountPercent: config.discountPercent,
    storeName: config.store.name, storeUrl: config.store.url,
    thresholdLabel: '90점 초과 · 19문제 이상 정답'
  };
  if (!record(result) || !Number.isSafeInteger(result.total) || !Number.isSafeInteger(result.correct) || !Number.isSafeInteger(result.score)) {
    return unavailable('invalid_result', 'malformed_result', { ...common, title: '성적표를 먼저 확인해 주세요', message: '20문제를 끝까지 풀면 혜택 기준을 확인할 수 있어요.' });
  }
  if (result.total !== REQUIRED_TOTAL) {
    return unavailable('invalid_result', 'wrong_question_count', { ...common, title: '20문제 성적표가 필요해요', message: '이번 혜택은 20문제를 모두 푼 성적표를 기준으로 해요.' });
  }
  if (result.correct < 0 || result.correct > REQUIRED_TOTAL || result.score < 0 || result.score > 100 || result.score !== result.correct * 5) {
    return unavailable('invalid_result', 'inconsistent_result', { ...common, title: '성적표를 다시 확인해 주세요', message: '정답 수와 점수가 일치하는 성적표가 필요해요.' });
  }
  const eligible = result.score > config.threshold.score;
  return {
    ...unavailable(eligible ? 'eligible_preview' : 'ineligible', eligible ? 'preview_threshold_met' : 'score_below_threshold'),
    ...common,
    eligible,
    correctGap: Math.max(0, CORRECT_NEEDED - result.correct),
    scoreGap: Math.max(0, SCORE_NEEDED - result.score),
    title: eligible ? '5% 혜택 기준 달성!' : '5% 혜택까지 한 걸음!',
    message: eligible
      ? '95점 이상을 달성했어요. 쿠폰 이벤트는 오픈 준비 중이에요.'
      : `${Math.max(0, CORRECT_NEEDED - result.correct)}문제를 더 맞히면 95점 이상! 다시 도전해 볼까요?`
  };
}
