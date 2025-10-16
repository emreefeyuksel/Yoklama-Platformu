// Small UX helpers
document.addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (!a) return;
  if (a.matches('[data-copy]')) {
    e.preventDefault();
    const text = a.getAttribute('href') || a.dataset.copy || '';
    navigator.clipboard.writeText(text).then(() => {
      a.textContent = 'Kopyalandı';
      setTimeout(() => (a.textContent = 'Linki kopyala'), 1200);
    }).catch(()=>{});
  }
});

