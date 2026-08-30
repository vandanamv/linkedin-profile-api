const axios = require('axios');

function createLinkedInClient(liAt, jsessionId) {
  if (!liAt || !jsessionId) {
    throw new Error('LINKEDIN_LI_AT and LINKEDIN_JSESSIONID are required.');
  }

  // Ensure JSESSIONID is clean for the csrf-token header
  const cleanCsrfToken = jsessionId.replace(/^"|"$/g, '');

  return axios.create({
    baseURL: 'https://www.linkedin.com/voyager/api',
    maxRedirects: 0, // Stop infinite authwall redirects
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/vnd.linkedin.normalized+json+2.1',
      'x-restli-protocol-version': '2.0.0',
      'x-li-lang': 'en_US',
      'csrf-token': cleanCsrfToken,
      'Cookie': `li_at=${liAt}; JSESSIONID=${jsessionId.startsWith('"') ? jsessionId : `"${jsessionId}"`};`
    },
    timeout: 15000
  });
}

function extractVanityName(profileUrl) {
  if (!profileUrl || typeof profileUrl !== 'string') return null;

  try {
    const parsedUrl = new URL(profileUrl.trim());
    const host = parsedUrl.hostname.replace(/^www\./, '').toLowerCase();
    if (host !== 'linkedin.com') return null;

    const [, section, vanityName] = parsedUrl.pathname.split('/');
    if (section !== 'in' || !vanityName) return null;

    return decodeURIComponent(vanityName).trim() || null;
  } catch (_error) {
    return null;
  }
}

module.exports = { createLinkedInClient, extractVanityName };
