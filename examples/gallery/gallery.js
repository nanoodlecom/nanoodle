// A shared link can target a sample, a collapsed alternate run, or the index.
function revealFragment() {
  let id;
  try {
    id = decodeURIComponent(location.hash.slice(1));
  } catch {
    return;
  }
  const target = document.getElementById(id);
  if (!target) return;
  for (let element = target; element; element = element.parentElement) {
    if (element instanceof HTMLDetailsElement) element.open = true;
  }
  if (target.matches('.sample')) target.focus({ preventScroll: true });
  target.scrollIntoView();
}

addEventListener('hashchange', revealFragment);
revealFragment();

const directory = document.querySelector('.directory');
const search = directory.querySelector('input');
const type = directory.querySelector('select');
const status = directory.querySelector('.directory-status');
const entries = [...directory.querySelectorAll('.directory-list li')];

function filterDirectory() {
  const words = search.value.trim().toLowerCase().split(/\s+/);
  let count = 0;
  for (const entry of entries) {
    const matchesType = !type.value || type.value === entry.dataset.type;
    const keywords = entry.dataset.search.toLowerCase();
    entry.hidden = !matchesType || !words.every(word => keywords.includes(word));
    if (!entry.hidden) count += 1;
  }
  status.textContent = count ? `${count} ${count === 1 ? 'workflow' : 'workflows'}` : 'No workflows found. Try a different search or output type.';
  status.hidden = false;
}

directory.querySelector('.directory-tools').hidden = false;
document.addEventListener('click', event => {
  if (event.target.closest('a[href="#workflow-index"]')) directory.open = true;
});
search.addEventListener('input', filterDirectory);
type.addEventListener('change', filterDirectory);

// Downloads and raw asset links stay usable without JavaScript. Stop animated
// GIF previews for people who have asked for reduced motion in their OS.
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
for (const preview of document.querySelectorAll('img[data-animated-src]')) {
  function updatePreview() {
    preview.src = reduceMotion.matches ? preview.dataset.stillSrc : preview.dataset.animatedSrc;
  }
  updatePreview();
  reduceMotion.addEventListener('change', updatePreview);
}
