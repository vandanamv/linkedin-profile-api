const form = document.getElementById('profile-form');
const input = document.getElementById('profile-url');
const output = document.getElementById('output');
const button = document.getElementById('submit-button');
const requestStatus = document.getElementById('request-status');
const responseMeta = document.getElementById('response-meta');

function renderJson(value, isError = false) {
  output.className = isError ? 'error' : '';
  output.textContent = JSON.stringify(value, null, 2);
}

form.addEventListener('submit', async event => {
  event.preventDefault();

  button.disabled = true;
  requestStatus.textContent = 'Fetching profile...';
  responseMeta.textContent = 'Loading';
  output.className = '';
  output.textContent = 'Loading...';

  const startedAt = performance.now();

  try {
    const response = await fetch('/api/v1/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: input.value.trim() })
    });
    const data = await response.json();
    const elapsedMs = Math.round(performance.now() - startedAt);

    requestStatus.textContent = response.ok ? 'Success' : 'Request failed';
    responseMeta.textContent = `${response.status} in ${elapsedMs}ms`;
    renderJson(data, !response.ok);
  } catch (error) {
    requestStatus.textContent = 'Network error';
    responseMeta.textContent = 'Failed';
    renderJson({ status: 'error', message: error.message }, true);
  } finally {
    button.disabled = false;
  }
});
