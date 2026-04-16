const leadForm = document.getElementById('leadForm');
const leadMsg = document.getElementById('leadMsg');
const leadName = document.getElementById('leadName');
const leadBusiness = document.getElementById('leadBusiness');
const leadPhone = document.getElementById('leadPhone');
const leadCity = document.getElementById('leadCity');
const scrollButtons = Array.from(document.querySelectorAll('[data-scroll-target]'));

const sanitize = (value) => value.trim();

const setLeadMessage = (message) => {
  if (!leadMsg) return;
  leadMsg.textContent = message;
};

leadForm?.addEventListener('submit', (event) => {
  event.preventDefault();

  const name = sanitize(leadName?.value || '');
  const business = sanitize(leadBusiness?.value || '');
  const phoneDigits = (leadPhone?.value || '').replace(/\D/g, '');
  const city = sanitize(leadCity?.value || '');

  if (!name || !business || !city) {
    setLeadMessage('Please complete all fields before submitting.');
    return;
  }

  if (!/^\d{10}$/.test(phoneDigits)) {
    setLeadMessage('Please enter a valid 10-digit Indian phone number.');
    return;
  }

  setLeadMessage(
    `Thanks ${name}. We will call +91-${phoneDigits} to set up Receptr for ${business} in ${city}.`
  );
  leadForm.reset();
});

scrollButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const targetSelector = button.getAttribute('data-scroll-target');
    if (!targetSelector) return;

    const target = document.querySelector(targetSelector);
    if (!(target instanceof HTMLElement)) return;

    if (
      (targetSelector === '#leadForm' || targetSelector === '#leadCapture') &&
      leadForm
    ) {
      leadForm.classList.remove('hidden');
      leadName?.focus();
    }

    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});
