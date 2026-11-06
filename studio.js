import { evaluateReward, validateCampaign } from './rewards.mjs';

const PLAN_KEY = 'iyiy-coupon-plan-v1';
const PLAN_VERSION = '1.0';
const DELIVERY_METHODS = new Set(['verified_manual', 'public_store_coupon']);
const FIELD_RULES = Object.freeze({
  minimumOrderAmount: { id: 'minimum-order', label: '최소 주문금액', min: 1, max: 10000000, unit: '원' },
  maximumDiscountAmount: { id: 'maximum-discount', label: '최대 할인금액', min: 1, max: 999990, unit: '원' },
  couponValidityDays: { id: 'validity-days', label: '발급 후 사용기간', min: 1, max: 365, unit: '일' },
  issuanceLimit: { id: 'issuance-limit', label: '전체 발급 예정 수량', min: 1, max: 10000, unit: '매' }
});
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const formatNumber = number => number.toLocaleString('ko-KR');

/** A local planning form only. Null means undecided; it never means unlimited. */
export function validatePlanProposal(raw) {
  const errors = {};
  const values = { deliveryApproach: 'verified_manual' };
  if (!isRecord(raw)) return { valid: false, values: null, errors: { form: '운영안 형식을 확인해 주세요.' } };
  if (!DELIVERY_METHODS.has(raw.deliveryApproach)) errors.deliveryApproach = '준비된 혜택 전달 방식 중 하나를 골라 주세요.';
  else values.deliveryApproach = raw.deliveryApproach;

  for (const [name, rule] of Object.entries(FIELD_RULES)) {
    const value = raw[name];
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
      values[name] = null;
      continue;
    }
    let parsed = null;
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) parsed = Number(value.trim());
    else if (typeof value === 'number') parsed = value;
    if (!Number.isSafeInteger(parsed) || parsed < rule.min || parsed > rule.max) {
      errors[name] = `${rule.label}은 ${formatNumber(rule.min)}~${formatNumber(rule.max)}${rule.unit}의 정수로 입력하거나 비워 주세요.`;
    } else values[name] = parsed;
  }

  if (!errors.minimumOrderAmount && !errors.maximumDiscountAmount && values.minimumOrderAmount !== null && values.maximumDiscountAmount !== null && values.minimumOrderAmount * 5 > values.maximumDiscountAmount * 100) {
    const needed = Math.ceil(values.minimumOrderAmount * 5 / 100);
    errors.maximumDiscountAmount = `최소 주문금액의 5%를 담으려면 최대 할인금액을 ${formatNumber(needed)}원 이상으로 정해 주세요.`;
  }
  return { valid: Object.keys(errors).length === 0, values, errors };
}

/** Build a reviewable draft; nothing in the result is an issuance instruction. */
export function buildPlanDocument(raw, campaign) {
  const config = validateCampaign(campaign);
  const checked = validatePlanProposal(raw);
  if (!checked.valid) throw new TypeError('Invalid plan proposal.');
  return {
    schemaVersion: PLAN_VERSION,
    status: 'draft',
    previewOnly: true,
    couponIssued: false,
    campaignId: config.id,
    store: { ...config.store },
    threshold: { ...config.threshold },
    requiredQuestionCount: config.requiredQuestionCount,
    requiredCorrect: 19,
    discountPercent: config.discountPercent,
    proposal: {
      ...checked.values,
      couponType: null,
      applicableProducts: null,
      startsAt: null,
      endsAt: null,
      perCustomerLimit: null
    },
    note: '검토용 운영 초안. 판매자센터에 반영되지 않으며 실제 쿠폰을 생성하거나 발급하지 않습니다.'
  };
}

/** Load only this draft format and this verified campaign; ignore unknown properties. */
export function restorePlanDocument(raw, campaign) {
  const config = validateCampaign(campaign);
  if (!isRecord(raw) || raw.schemaVersion !== PLAN_VERSION || raw.status !== 'draft' || raw.previewOnly !== true || raw.couponIssued !== false || raw.campaignId !== config.id ||
      !isRecord(raw.store) || raw.store.url !== config.store.url || raw.discountPercent !== config.discountPercent ||
      !isRecord(raw.threshold) || raw.threshold.operator !== 'gt' || raw.threshold.score !== 90 || raw.requiredQuestionCount !== 20 || raw.requiredCorrect !== 19 || !isRecord(raw.proposal)) {
    throw new TypeError('Invalid saved plan.');
  }
  const checked = validatePlanProposal(raw.proposal);
  if (!checked.valid) throw new TypeError('Invalid saved proposal.');
  return checked.values;
}

async function initializeStudio() {
  const form = document.getElementById('studio-plan-form');
  if (!form) return;
  const feedback = document.getElementById('plan-feedback');
  const loadStatus = document.getElementById('studio-load-status');
  let campaign;
  let dirty = false;
  const announce = (text, kind = 'neutral') => {
    feedback.textContent = text;
    feedback.dataset.kind = kind;
  };
  const markDirty = () => {
    if (dirty) return;
    dirty = true;
    announce('변경한 내용은 아직 저장하지 않았어요.');
  };
  const readForm = () => ({
    deliveryApproach: form.elements.namedItem('deliveryApproach').value,
    ...Object.fromEntries(Object.keys(FIELD_RULES).map(name => [name, form.elements.namedItem(name).value]))
  });
  const clearErrors = () => {
    for (const name of ['deliveryApproach', ...Object.keys(FIELD_RULES)]) {
      const control = form.elements.namedItem(name);
      control.removeAttribute('aria-invalid');
      document.getElementById(name === 'deliveryApproach' ? 'delivery-error' : `${FIELD_RULES[name].id}-error`).textContent = '';
    }
  };
  const showErrors = errors => {
    clearErrors();
    let firstInvalid;
    for (const [name, message] of Object.entries(errors)) {
      const control = form.elements.namedItem(name);
      if (!control) continue;
      control.setAttribute('aria-invalid', 'true');
      const errorId = name === 'deliveryApproach' ? 'delivery-error' : `${FIELD_RULES[name].id}-error`;
      document.getElementById(errorId).textContent = message;
      firstInvalid ??= control;
    }
    announce('입력한 조건을 한 번 더 확인해 주세요. 표시한 항목을 고치면 저장할 수 있어요.', 'error');
    firstInvalid?.focus();
  };
  const updateDeliveryHelp = () => {
    const publicCoupon = form.elements.namedItem('deliveryApproach').value === 'public_store_coupon';
    document.getElementById('delivery-help').textContent = publicCoupon
      ? '스토어에 공개된 쿠폰을 안내하는 방식이에요. 링크가 공유될 수 있어 95점 이상 응시자에게만 지급되는 혜택을 보장하지 않아요.'
      : '점수와 대상자를 확인한 뒤 판매자가 지정 발급하는 방식이에요. 실제 운영에는 별도 검증과 판매자센터 설정이 필요해요.';
  };
  const updatePreview = score => {
    const reward = evaluateReward({ score, correct: score / 5, total: 20 }, campaign);
    const ticket = document.getElementById('studio-preview');
    ticket.dataset.eligible = String(reward.eligible);
    document.getElementById('preview-title').textContent = reward.title;
    document.getElementById('preview-message').textContent = reward.message;
    document.getElementById('preview-outcome').textContent = `예시 ${score}점 · ${reward.eligible ? '혜택 조건 달성' : '혜택 대상 아님'} · 실제 쿠폰 발급 아님`;
    document.getElementById('preview-store-name').textContent = reward.storeName || '혜택 미리보기';
    document.getElementById('preview-percent').textContent = reward.discountPercent === null ? '—' : String(reward.discountPercent);
  };
  const validatedDocument = () => {
    const raw = readForm();
    const checked = validatePlanProposal(raw);
    if (!checked.valid) { showErrors(checked.errors); return null; }
    clearErrors();
    return buildPlanDocument(raw, campaign);
  };

  try {
    const response = await fetch('./campaign.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Campaign unavailable.');
    campaign = validateCampaign(await response.json());
    document.getElementById('preview-scores').disabled = false;
    document.getElementById('studio-plan-fields').disabled = false;
    document.getElementById('save-plan').disabled = false;
    document.getElementById('download-plan').disabled = false;
    document.getElementById('studio-store-link').href = campaign.store.url;
    loadStatus.hidden = true;
    updatePreview(95);
  } catch {
    loadStatus.textContent = '혜택 설정을 불러오지 못했어요. 페이지를 새로 열어 주세요. 운영안 저장과 쿠폰 발급은 진행되지 않았어요.';
    loadStatus.dataset.kind = 'error';
    document.getElementById('preview-title').textContent = '혜택 정보를 확인해 주세요';
    document.getElementById('preview-message').textContent = '지금은 점수별 미리보기를 표시할 수 없어요.';
    announce('혜택 설정이 확인되면 운영안을 작성할 수 있어요.', 'error');
    return;
  }

  try {
    const saved = localStorage.getItem(PLAN_KEY);
    if (saved !== null) {
      const proposal = restorePlanDocument(JSON.parse(saved), campaign);
      form.elements.namedItem('deliveryApproach').value = proposal.deliveryApproach;
      for (const name of Object.keys(FIELD_RULES)) form.elements.namedItem(name).value = proposal[name] === null ? '' : String(proposal[name]);
      updateDeliveryHelp();
      announce('이 브라우저에 저장한 운영안을 불러왔어요. 판매자센터에는 반영되지 않았어요.', 'success');
    }
  } catch {
    announce('저장된 운영안을 불러오지 못했어요. 빈 초안에서 다시 작성하거나 JSON으로 내려받아 주세요.', 'error');
  }

  document.getElementById('preview-scores').addEventListener('change', event => {
    const score = Number(event.target.value);
    if ([90, 95, 100].includes(score)) updatePreview(score);
  });
  form.addEventListener('input', event => {
    markDirty();
    if (event.target.matches('input, select')) {
      event.target.removeAttribute('aria-invalid');
      const name = event.target.name;
      const error = document.getElementById(name === 'deliveryApproach' ? 'delivery-error' : `${FIELD_RULES[name]?.id}-error`);
      if (error) error.textContent = '';
    }
  });
  form.elements.namedItem('deliveryApproach').addEventListener('change', () => { updateDeliveryHelp(); markDirty(); });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const plan = validatedDocument();
    if (!plan) return;
    try {
      localStorage.setItem(PLAN_KEY, JSON.stringify(plan));
      dirty = false;
      announce('운영안을 이 브라우저에 저장했어요. 실제 쿠폰 설정과 발급에는 반영되지 않았어요.', 'success');
    } catch {
      announce('이 브라우저에 저장하지 못했어요. JSON으로 내려받아 보관해 주세요.', 'error');
    }
  });
  document.getElementById('download-plan').addEventListener('click', () => {
    const plan = validatedDocument();
    if (!plan) return;
    let url;
    try {
      const blob = new Blob([JSON.stringify(plan, null, 2) + '\n'], { type: 'application/json;charset=utf-8' });
      url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'iyiy-coupon-plan-draft.json';
      document.body.append(link);
      link.click();
      link.remove();
      announce('운영안 JSON 다운로드를 시작했어요. 파일은 검토용 초안이며 실제 쿠폰을 발급하지 않아요.', 'success');
    } catch {
      announce('파일을 내려받지 못했어요. 잠시 후 다시 시도해 주세요.', 'error');
    } finally {
      if (url) setTimeout(() => URL.revokeObjectURL(url), 1500);
    }
  });
}

if (typeof document !== 'undefined') initializeStudio();
