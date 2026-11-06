// The publisher ID is verified; site approval, a live ad unit and a reviewed
// consent adapter are still pending. JSON alone never activates advertising.
const IMPLEMENTATION_REVIEWED = false;
const GOOGLE_SCRIPT = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';
// Only substantive, standalone editorial guides may host a manual ad unit.
// Quiz, start, score, review and coupon screens must remain unsupported.
const PLACEMENTS = new Set(['guide']);
const PUBLISHER_ID = /^ca-pub-(?!0{16}$)\d{16}$/;
const SLOT_ID = /^(?!0{10}$)\d{10}$/;
const CONFIG_KEYS = new Set(['version','network','enabled','publisherId','siteApproved','approvedOrigin','privacyReady','consentReady','autoAdsDisabled','placements']);

export function evaluateAdConfig(raw, placement, origin) {
  const blocked = reason => ({ ready:false, reason });
  if (!PLACEMENTS.has(placement)) return blocked('unsupported_screen');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => !CONFIG_KEYS.has(key))) return blocked('invalid_config');
  if (raw.version !== '1' || raw.network !== 'adsense') return blocked('invalid_config');
  for (const key of ['enabled','siteApproved','privacyReady','consentReady','autoAdsDisabled']) if (typeof raw[key] !== 'boolean') return blocked('invalid_config');
  if (raw.enabled !== true) return blocked('disabled');
  if (raw.siteApproved !== true) return blocked('site_not_approved');
  if (!PUBLISHER_ID.test(raw.publisherId ?? '')) return blocked('invalid_publisher');
  if (!raw.placements || typeof raw.placements !== 'object' || Array.isArray(raw.placements) || Object.keys(raw.placements).some(key => !PLACEMENTS.has(key))) return blocked('invalid_slots');
  if (typeof raw.placements[placement] !== 'string' || !SLOT_ID.test(raw.placements[placement])) return blocked('invalid_slot');
  try {
    const approved = new URL(raw.approvedOrigin);
    if (approved.protocol !== 'https:' || approved.origin !== raw.approvedOrigin || approved.origin !== origin) return blocked('origin_not_approved');
  } catch { return blocked('origin_not_approved'); }
  if (!raw.privacyReady) return blocked('privacy_not_ready');
  if (!raw.consentReady) return blocked('consent_not_ready');
  if (!raw.autoAdsDisabled) return blocked('auto_ads_not_disabled');
  return { ready:true, reason:'configuration_ready', publisherId:raw.publisherId, slotId:raw.placements[placement] };
}

function hideSlot(slot) {
  slot.hidden = true;
  slot.style.display = 'none';
  slot.replaceChildren();
}

// The factory allows a future reviewed CMP integration and deterministic tests.
// The production instance below deliberately supplies neither activation gate.
export function createAdController({
  implementationReviewed = false,
  document: doc = globalThis.document,
  fetchConfig = async () => {
    const response = await fetch(new URL('./ads-config.json', import.meta.url), { credentials:'same-origin' });
    if (!response.ok) throw new Error('Ad configuration unavailable');
    return response.json();
  },
  checkConsent = async () => false
} = {}) {
  const runs = new WeakMap();
  const mounted = new WeakSet();
  let configPromise;
  let scriptPromise;
  let loadedPublisher;

  function loadScript(publisherId) {
    if (scriptPromise) return loadedPublisher === publisherId ? scriptPromise : Promise.resolve(false);
    loadedPublisher = publisherId;
    scriptPromise = new Promise(resolve => {
      if (!doc?.head || doc.querySelector('script[data-deokryeok-adsense]')) { resolve(false); return; }
      const script = doc.createElement('script');
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.setAttribute('data-deokryeok-adsense', 'manual');
      script.src = `${GOOGLE_SCRIPT}?client=${publisherId}`;
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      doc.head.appendChild(script);
    });
    return scriptPromise;
  }

  async function mount(root, placement) {
    if (!root?.querySelectorAll) return { status:'invalid_root', mounted:0 };
    const run = {};
    runs.set(root, run);
    const allSlots = Array.from(root.querySelectorAll('[data-ad-placement]'));
    const slots = allSlots.filter(slot => slot.getAttribute('data-ad-placement') === placement);
    for (const slot of allSlots) {
      if (!mounted.has(slot) || !PLACEMENTS.has(placement) || !slots.includes(slot)) hideSlot(slot);
    }
    if (!PLACEMENTS.has(placement)) return { status:'unsupported_screen', mounted:0 };
    if (implementationReviewed !== true) return { status:'implementation_not_reviewed', mounted:0 };
    const current = slot => runs.get(root) === run && root.isConnected && slot.isConnected && root.contains(slot) && slot.getAttribute('data-ad-placement') === placement;
    const pending = slots.filter(slot => !mounted.has(slot) && current(slot));
    if (!pending.length) return { status:'no_new_slots', mounted:0 };
    try {
      configPromise ||= Promise.resolve().then(fetchConfig);
      const config = await configPromise;
      if (!pending.some(current)) return { status:'stale_screen', mounted:0 };
      const evaluated = evaluateAdConfig(config, placement, doc?.location?.origin);
      if (!evaluated.ready) return { status:evaluated.reason, mounted:0 };
      // A real CMP must decide for this visitor before any Google request.
      if (await checkConsent({ placement, origin:doc.location.origin }) !== true) return { status:'consent_not_granted', mounted:0 };
      if (!pending.some(current)) return { status:'stale_screen', mounted:0 };
      if (!await loadScript(evaluated.publisherId)) return { status:'script_unavailable', mounted:0 };
      if (!pending.some(current)) return { status:'stale_screen', mounted:0 };
      let count = 0;
      for (const slot of pending.filter(current)) {
        const label = doc.createElement('small');
        label.className = 'ad-label';
        label.textContent = '광고';
        const unit = doc.createElement('ins');
        unit.className = 'adsbygoogle';
        unit.style.display = 'block';
        unit.setAttribute('data-ad-client', evaluated.publisherId);
        unit.setAttribute('data-ad-slot', evaluated.slotId);
        unit.setAttribute('data-ad-format', 'auto');
        unit.setAttribute('data-full-width-responsive', 'true');
        slot.replaceChildren(label, unit);
        slot.hidden = false;
        slot.style.display = 'block';
        try {
          const view = doc.defaultView;
          (view.adsbygoogle ||= []).push({});
          mounted.add(slot);
          count++;
        } catch { hideSlot(slot); }
      }
      return { status:count ? 'requested' : 'not_requested', mounted:count };
    } catch {
      for (const slot of pending.filter(current)) hideSlot(slot);
      return { status:'unavailable', mounted:0 };
    }
  }
  return { mountAdSlots:mount };
}

const controller = createAdController({ implementationReviewed:IMPLEMENTATION_REVIEWED });
export const mountAdSlots = (root, placement) => controller.mountAdSlots(root, placement);
