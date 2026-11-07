// Google Privacy & messaging is bootstrapped by the AdSense tag.
// This module reads actual TCF callbacks; it never creates a consent record.
// https://developers.google.com/funding-choices/fc-api-docs
// https://support.google.com/adsense/answer/9804260
const GOOGLE_VENDOR_ID = 755;
const SETTLED_EVENTS = new Set(['tcloaded', 'useractioncomplete']);

export function createGoogleConsentManager({
  window: view = globalThis.window,
  onChange = () => {},
  readinessTimeoutMs = 15000,
  scheduleTimeout = globalThis.setTimeout,
  cancelTimeout = globalThis.clearTimeout
} = {}) {
  let state = { status:'pending', reason:'awaiting_cmp', canRequestAds:false, canRevoke:false, revision:0 };
  let started = false, closed = false, registered = false, revocationPending = false;
  let timer, listenerId, lastChoice, revision = 0;

  function clearWatchdog() {
    if (timer !== undefined) cancelTimeout(timer);
    timer = undefined;
  }
  function publish(status, reason, canRequestAds = false, canRevoke = false) {
    if (state.status === status && state.reason === reason && state.canRequestAds === canRequestAds &&
        state.canRevoke === canRevoke && state.revision === revision) return;
    state = { status, reason, canRequestAds, canRevoke, revision };
    onChange(state);
  }
  function removeListener() {
    if (listenerId !== undefined && typeof view?.__tcfapi === 'function') {
      try { view.__tcfapi('removeEventListener', 2, () => {}, listenerId); } catch {}
    }
  }
  function stop(reason = 'cmp_stopped') {
    if (closed) return;
    closed = true;
    clearWatchdog();
    removeListener();
    publish('error', reason);
  }
  function watchReadiness() {
    clearWatchdog();
    timer = scheduleTimeout(() => stop('cmp_timeout'), readinessTimeoutMs);
  }
  function recordChoice(value) {
    if (lastChoice !== value) { lastChoice = value; revision++; }
  }
  function receive(data, success) {
    if (closed) return;
    if (data && Number.isInteger(data.listenerId)) listenerId = data.listenerId;
    if (success !== true || !data || typeof data !== 'object' || Array.isArray(data)) {
      stop('invalid_cmp_response'); return;
    }
    if (data.cmpStatus === 'error') { stop('cmp_error'); return; }
    // Outside the applicable region the TCF response can omit all consent fields.
    // A false applicability signal is not described as consent.
    if (data.gdprApplies === false && !revocationPending) {
      clearWatchdog();
      recordChoice('not_applicable');
      publish('not_applicable', 'cmp_not_applicable', true);
      return;
    }
    const canRevoke = data.gdprApplies === true &&
      typeof view?.googlefc?.showRevocationMessage === 'function';
    if (data.gdprApplies !== true || data.cmpStatus !== 'loaded') {
      publish('pending', 'awaiting_cmp_data', false, canRevoke); return;
    }
    if (data.eventStatus === 'cmpuishown') {
      // The CMP is responding. Let the visitor take as long as needed to choose.
      clearWatchdog();
      publish('pending', 'awaiting_user_choice', false, canRevoke);
      return;
    }
    // Opening settings invalidates the earlier decision immediately. A replayed
    // tcloaded event must not undo that pause before a new user action.
    if (revocationPending && data.eventStatus !== 'useractioncomplete') {
      publish('pending', 'awaiting_user_choice', false, canRevoke); return;
    }
    if (!SETTLED_EVENTS.has(data.eventStatus)) {
      publish('pending', 'awaiting_cmp_data', false, canRevoke); return;
    }
    if (typeof data.tcString !== 'string' || !data.tcString.trim() || data.isServiceSpecific === false) {
      stop('invalid_tcf_data'); return;
    }
    clearWatchdog();
    revocationPending = false;
    recordChoice(data.tcString);
    // This is a conservative minimum request gate, not a replacement for
    // Google's own processing of the complete TC string and vendor restrictions.
    const permitted = data.purpose?.consents?.[1] === true &&
      data.vendor?.consents?.[GOOGLE_VENDOR_ID] === true;
    publish(permitted ? 'allowed' : 'denied', permitted ? 'tcf_permission' : 'tcf_denied', permitted, canRevoke);
  }
  function start() {
    if (started || closed) return;
    started = true;
    watchReadiness();
    try {
      view.googlefc ||= {};
      view.googlefc.callbackQueue ||= [];
      view.googlefc.callbackQueue.push({
        CONSENT_API_READY: () => {
          if (closed || registered) return;
          if (typeof view.__tcfapi !== 'function') { stop('tcf_api_unavailable'); return; }
          registered = true;
          try { view.__tcfapi('addEventListener', 2, receive); }
          catch { stop('tcf_api_error'); }
        }
      });
    } catch { stop('cmp_api_unavailable'); }
  }
  function openSettings() {
    if (closed || !state.canRevoke || state.status === 'pending') return false;
    revocationPending = true;
    publish('pending', 'awaiting_user_choice', false, true);
    watchReadiness();
    try {
      view.googlefc.callbackQueue.push({
        CONSENT_API_READY: () => {
          if (closed) return;
          try {
            if (typeof view.googlefc.showRevocationMessage !== 'function') {
              stop('revocation_unavailable'); return;
            }
            view.googlefc.showRevocationMessage();
          } catch { stop('revocation_error'); }
        }
      });
      return true;
    } catch { stop('revocation_error'); return false; }
  }
  return { start, stop, openSettings, getState:() => state };
}
