import { mountAdSlots, subscribeAdConsent, openAdPrivacySettings } from './ads.mjs';

const controls = Array.from(document.querySelectorAll('[data-consent-settings]'));
const feedback = document.querySelector('[data-consent-feedback]');
let settingsRequested = false;
function showFeedback(message = '') {
  if (!feedback) return;
  feedback.textContent = message;
  feedback.hidden = !message;
}
subscribeAdConsent(state => {
  for (const button of controls) {
    button.hidden = !state.canRevoke;
    button.disabled = state.status === 'pending';
  }
  if (settingsRequested && state.status === 'error') {
    showFeedback('개인정보 설정을 불러오지 못했어요. 새로고침 후 다시 시도해 주세요.');
  }
});
for (const button of controls) {
  button.addEventListener('click', () => {
    settingsRequested = true;
    showFeedback();
    if (!openAdPrivacySettings()) {
      showFeedback('개인정보 설정을 불러오지 못했어요. 새로고침 후 다시 시도해 주세요.');
    }
  });
}
// Account approval and deployment configuration gate all external script loads.
void mountAdSlots(document.querySelector('main'), 'guide');
