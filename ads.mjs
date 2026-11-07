import { createGoogleConsentManager } from './google-cmp.mjs';

// The native Google CMP adapter is implemented. Site approval, enabled and
// consentReady remain separate deployment gates in ads-config.json.
const IMPLEMENTATION_REVIEWED = true;
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

export function createAdController({
  implementationReviewed = false,
  document: doc = globalThis.document,
  fetchConfig = async () => {
    const response = await fetch(new URL('./ads-config.json', import.meta.url), { credentials:'same-origin' });
    if (!response.ok) throw new Error('Ad configuration unavailable');
    return response.json();
  },
  readinessTimeoutMs = 15000,
  scheduleTimeout = globalThis.setTimeout,
  cancelTimeout = globalThis.clearTimeout
} = {}) {
  const view = doc?.defaultView;
  const consentListeners = new Set();
  let configPromise, scriptPromise, loadedPublisher, consentManager;
  let activeRun, target, renderedSlot, renderedRevision;
  let scriptReady = false, runtimeStarted = false, requestAttempted = false;
  let consentState = { status:'disabled', reason:'disabled', canRequestAds:false, canRevoke:false, revision:0 };

  const current = candidate => candidate && candidate.run === activeRun &&
    candidate.root.isConnected && candidate.slot.isConnected &&
    candidate.root.contains(candidate.slot) &&
    candidate.slot.getAttribute('data-ad-placement') === 'guide';

  function pauseRequests() {
    if (runtimeStarted) (view.adsbygoogle ||= []).pauseAdRequests = 1;
  }
  function removeRenderedAd() {
    if (renderedSlot) hideSlot(renderedSlot);
    renderedSlot = undefined;
  }
  function notifyConsent(state) {
    consentState = state;
    applyConsent();
    for (const listener of consentListeners) listener(state);
  }
  function applyConsent() {
    pauseRequests();
    if (!consentState.canRequestAds || !current(target)) {
      removeRenderedAd();
      return 0;
    }
    if (!scriptReady) return 0;
    if (requestAttempted) {
      // Consent changes never refresh or replace an already requested unit.
      if (renderedRevision !== consentState.revision) removeRenderedAd();
      if (renderedSlot) view.adsbygoogle.pauseAdRequests = 0;
      return 0;
    }
    const slot = target.slot;
    try {
      const label = doc.createElement('small');
      label.className = 'ad-label';
      label.textContent = '광고';
      const unit = doc.createElement('ins');
      unit.className = 'adsbygoogle';
      unit.style.display = 'block';
      unit.setAttribute('data-ad-client', target.publisherId);
      unit.setAttribute('data-ad-slot', target.slotId);
      unit.setAttribute('data-ad-format', 'auto');
      unit.setAttribute('data-full-width-responsive', 'true');
      slot.replaceChildren(label, unit);
      slot.hidden = false;
      slot.style.display = 'block';
      renderedSlot = slot;
      renderedRevision = consentState.revision;
      // One attempt per page, including after a push error, DOM replacement or
      // revocation. This latch is set before calling the external library.
      requestAttempted = true;
      view.adsbygoogle.push({});
      // A synchronous CMP update during push must not be overwritten.
      if (consentState.canRequestAds && current(target) &&
          renderedSlot === slot && renderedRevision === consentState.revision) {
        view.adsbygoogle.pauseAdRequests = 0;
      } else {
        pauseRequests();
        removeRenderedAd();
      }
      return 1;
    } catch {
      pauseRequests();
      hideSlot(slot);
      renderedSlot = undefined;
      return 0;
    }
  }

  function loadScript(publisherId) {
    if (scriptPromise) return loadedPublisher === publisherId ? scriptPromise : Promise.resolve(false);
    loadedPublisher = publisherId;
    scriptPromise = new Promise(resolve => {
      if (!doc?.head || doc.querySelector('script[data-deokryeok-adsense]')) { resolve(false); return; }
      let finished = false;
      const script = doc.createElement('script');
      const timer = scheduleTimeout(() => finish(false), readinessTimeoutMs);
      function finish(ok) {
        if (finished) return;
        finished = true;
        cancelTimeout(timer);
        script.onload = script.onerror = null;
        scriptReady = ok;
        if (!ok) script.remove?.();
        resolve(ok);
      }
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.setAttribute('data-deokryeok-adsense', 'manual');
      script.src = GOOGLE_SCRIPT + '?client=' + publisherId;
      script.onload = () => finish(true);
      script.onerror = () => finish(false);
      doc.head.appendChild(script);
    });
    return scriptPromise;
  }

  async function mount(root, placement) {
    if (!root?.querySelectorAll) return { status:'invalid_root', mounted:0 };
    const allSlots = Array.from(root.querySelectorAll('[data-ad-placement]'));
    const slots = allSlots.filter(slot => slot.getAttribute('data-ad-placement') === placement);
    for (const slot of allSlots) {
      if (slot !== renderedSlot || !PLACEMENTS.has(placement) || slot !== slots[0]) hideSlot(slot);
    }
    if (!PLACEMENTS.has(placement)) {
      activeRun = undefined; target = undefined; pauseRequests(); removeRenderedAd();
      return { status:'unsupported_screen', mounted:0 };
    }
    if (implementationReviewed !== true) return { status:'implementation_not_reviewed', mounted:0 };
    if (requestAttempted) {
      if (renderedSlot !== slots[0] || !current(target)) { pauseRequests(); removeRenderedAd(); }
      return { status:'no_new_slots', mounted:0 };
    }
    if (!slots.length) return { status:'no_new_slots', mounted:0 };
    const candidate = { root, slot:slots[0], run:{} };
    activeRun = candidate.run;
    target = undefined;
    if (!current(candidate)) return { status:'stale_screen', mounted:0 };
    try {
      configPromise ||= Promise.resolve().then(fetchConfig);
      const config = await configPromise;
      if (!current(candidate)) return { status:'stale_screen', mounted:0 };
      const evaluated = evaluateAdConfig(config, placement, doc?.location?.origin);
      if (!evaluated.ready) return { status:evaluated.reason, mounted:0 };
      target = { ...candidate, publisherId:evaluated.publisherId, slotId:evaluated.slotId };
      if (!runtimeStarted) {
        if (!view) return { status:'unavailable', mounted:0 };
        runtimeStarted = true;
        // Pausing requests still loads Google scripts to bootstrap its CMP.
        // https://support.google.com/adsense/answer/7670312
        pauseRequests();
        consentManager = createGoogleConsentManager({
          window:view, onChange:notifyConsent, readinessTimeoutMs, scheduleTimeout, cancelTimeout
        });
        notifyConsent(consentManager.getState());
        consentManager.start();
      }
      if (!await loadScript(evaluated.publisherId)) {
        consentManager.stop('ad_script_unavailable');
        return { status:'script_unavailable', mounted:0 };
      }
      if (!current(candidate)) { applyConsent(); return { status:'stale_screen', mounted:0 }; }
      const mounted = applyConsent();
      return { status:requestAttempted ? 'requested' : consentState.status, mounted };
    } catch {
      if (current(candidate)) {
        pauseRequests(); removeRenderedAd(); hideSlot(candidate.slot);
        consentManager?.stop('ad_runtime_error');
      }
      return { status:'unavailable', mounted:0 };
    }
  }
  function subscribeConsent(listener) {
    consentListeners.add(listener);
    listener(consentState);
    return () => consentListeners.delete(listener);
  }
  return {
    mountAdSlots:mount,
    subscribeConsent,
    openPrivacySettings:() => consentManager?.openSettings() === true
  };
}

const controller = createAdController({ implementationReviewed:IMPLEMENTATION_REVIEWED });
export const mountAdSlots = (root, placement) => controller.mountAdSlots(root, placement);
export const subscribeAdConsent = listener => controller.subscribeConsent(listener);
export const openAdPrivacySettings = () => controller.openPrivacySettings();
