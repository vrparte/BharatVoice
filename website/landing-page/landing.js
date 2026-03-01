const tabButtons = Array.from(document.querySelectorAll('.tab-btn'));
const tabPanels = Array.from(document.querySelectorAll('.tab-panel'));
const callbackForm = document.getElementById('callbackForm');
const phoneInput = document.getElementById('phoneInput');
const callbackMsg = document.getElementById('callbackMsg');

const setActiveTab = (tab) => {
  tabButtons.forEach((button) => {
    const active = button.dataset.tab === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });

  tabPanels.forEach((panel) => {
    const active = panel.id === `tab-${tab}`;
    panel.classList.toggle('active', active);
  });
};

tabButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const tab = button.dataset.tab || 'dental';
    setActiveTab(tab);
  });
});

callbackForm?.addEventListener('submit', (event) => {
  event.preventDefault();

  const digits = (phoneInput?.value || '').replace(/\D/g, '');
  if (!/^\d{10}$/.test(digits)) {
    callbackMsg.textContent = 'Please enter a valid 10-digit Indian mobile number.';
    return;
  }

  callbackMsg.textContent = `Thanks! We will call +91-${digits} shortly.`;
  callbackForm.reset();
});
