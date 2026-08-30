require('dotenv').config();
const path = require('path');
const express = require('express');
const { createLinkedInClient, extractVanityName } = require('./client');
const { parseProfileView, mergeProfileSections } = require('./parser');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

let linkedInClient;
let linkedInSession = {
  liAt: process.env.LINKEDIN_LI_AT,
  jsessionId: process.env.LINKEDIN_JSESSIONID
};

function getLinkedInClient() {
  if (!linkedInClient) {
    linkedInClient = createLinkedInClient(
      linkedInSession.liAt,
      linkedInSession.jsessionId
    );
  }

  return linkedInClient;
}

function setLinkedInSession(liAt, jsessionId) {
  linkedInSession = { liAt, jsessionId };
  linkedInClient = createLinkedInClient(liAt, jsessionId);
}

function requireAdmin(req, res, next) {
  const adminApiKey = process.env.ADMIN_API_KEY;
  if (!adminApiKey) {
    return res.status(503).json({
      status: 'error',
      message: 'Admin session refresh is not configured.'
    });
  }

  const authHeader = req.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (token !== adminApiKey) {
    return res.status(401).json({
      status: 'error',
      message: 'Invalid admin token.'
    });
  }

  next();
}

app.get('/api/v1/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/v1/admin/session', requireAdmin, (req, res) => {
  const { liAt, jsessionId } = req.body || {};

  if (!liAt || !jsessionId) {
    return res.status(400).json({
      status: 'error',
      message: 'Both "liAt" and "jsessionId" are required.'
    });
  }

  try {
    setLinkedInSession(liAt, jsessionId);

    return res.json({
      status: 'success',
      message: 'LinkedIn session updated for this running server process.'
    });
  } catch (error) {
    return res.status(400).json({
      status: 'error',
      message: error.message
    });
  }
});

async function profileHandler(req, res) {
  const url = req.method === 'GET' ? req.query.url : req.body?.url;

  if (!url) {
    return res.status(400).json({ status: 'error', message: 'Parameter "url" is required.' });
  }

  const vanityName = extractVanityName(url);
  if (!vanityName) {
    return res.status(400).json({ status: 'error', message: 'Invalid LinkedIn profile URL format.' });
  }

  try {
    const client = getLinkedInClient();

    // 1. Fetch main top-card profile entity
    const profileRes = await client.get(
      `/identity/dash/profiles?q=memberIdentity&memberIdentity=${vanityName}&decorationId=com.linkedin.voyager.dash.deco.identity.profile.FullProfileWithEntities-101`
    );

    const baseData = parseProfileView(profileRes.data);
    const profileUrn = baseData._profileUrn;
    baseData.profileUrl = baseData.profileUrl || `https://www.linkedin.com/in/${vanityName}/`;

    mergeProfileSections(baseData, {
      experience: profileRes.data,
      education: profileRes.data,
      skills: profileRes.data,
      certifications: profileRes.data,
      languages: profileRes.data
    });

    // 2. Fetch profile section entities concurrently if profile URN was found
    if (profileUrn) {
      const [expRes, eduRes, skillRes, certRes, langRes] = await Promise.allSettled([
        client.get(`/identity/dash/profilePositionGroups?q=profile&profileUrn=${encodeURIComponent(profileUrn)}`),
        client.get(`/identity/dash/profileEducations?q=profile&profileUrn=${encodeURIComponent(profileUrn)}`),
        client.get(`/identity/dash/profileSkills?q=profile&profileUrn=${encodeURIComponent(profileUrn)}`),
        client.get(`/identity/dash/profileCertifications?q=profile&profileUrn=${encodeURIComponent(profileUrn)}`),
        client.get(`/identity/dash/profileLanguages?q=profile&profileUrn=${encodeURIComponent(profileUrn)}`)
      ]);

      const sectionResponses = {
        experience: expRes.status === 'fulfilled' ? expRes.value.data : null,
        education: eduRes.status === 'fulfilled' ? eduRes.value.data : null,
        skills: skillRes.status === 'fulfilled' ? skillRes.value.data : null,
        certifications: certRes.status === 'fulfilled' ? certRes.value.data : null,
        languages: langRes.status === 'fulfilled' ? langRes.value.data : null
      };

      mergeProfileSections(baseData, sectionResponses);
    }

    // Clean internal helper properties before returning
    delete baseData._profileUrn;

    return res.status(200).json({
      status: 'success',
      data: baseData
    });

  } catch (error) {
    if (error.response && [301, 302, 303, 307, 308].includes(error.response.status)) {
      return res.status(401).json({
        status: 'error',
        message: 'LinkedIn session expired or invalid. Please update li_at cookie in .env.'
      });
    }

    if (error.response) {
      return res.status(error.response.status).json({
        status: 'error',
        message: `LinkedIn returned status code ${error.response.status}`
      });
    }

    return res.status(500).json({ status: 'error', message: error.message });
  }
}

app.post('/api/v1/profile', profileHandler);
app.get('/api/v1/profile', profileHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`LinkedIn Profile API running on port ${PORT}`);
});
