function extractText(value) {
  if (!value) return null;
  if (typeof value === 'string') return cleanText(value);
  if (typeof value.text === 'string') return cleanText(value.text);
  if (typeof value.name === 'string') return cleanText(value.name);
  if (typeof value.localizedName === 'string') return cleanText(value.localizedName);
  if (typeof value.defaultLocalizedName === 'string') return cleanText(value.defaultLocalizedName);
  if (typeof value.displayName === 'string') return cleanText(value.displayName);
  if (typeof value.city === 'string' || typeof value.country === 'string') {
    return cleanText([value.city, value.geographicArea, value.country].filter(Boolean).join(', '));
  }
  if (Array.isArray(value.textDirectionSegments)) {
    return cleanText(value.textDirectionSegments.map(segment => segment.text).filter(Boolean).join(' '));
  }
  if (Array.isArray(value.attributes)) {
    return cleanText(value.attributes.map(extractText).filter(Boolean).join(' '));
  }
  return null;
}

function cleanText(value) {
  if (!value || typeof value !== 'string') return null;
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim() || null;
}

function parseVectorImage(vectorImage) {
  if (!vectorImage?.rootUrl || !Array.isArray(vectorImage.artifacts) || vectorImage.artifacts.length === 0) {
    return null;
  }

  const sortedArtifacts = [...vectorImage.artifacts].sort((a, b) => {
    const aPixels = (a.width || 0) * (a.height || 0);
    const bPixels = (b.width || 0) * (b.height || 0);
    return bPixels - aPixels;
  });

  const imagePath = sortedArtifacts[0]?.fileIdentifyingUrlPathSegment ||
    sortedArtifacts[0]?.fileSelectingUrlPathSegment;

  return imagePath ? `${vectorImage.rootUrl}${imagePath}` : null;
}

function extractImage(value) {
  if (!value) return null;

  return parseVectorImage(value.displayImageReference?.vectorImage) ||
    parseVectorImage(value['com.linkedin.common.VectorImage']) ||
    parseVectorImage(value.vectorImage) ||
    parseVectorImage(value);
}

function parseDate(date) {
  if (!date?.year) return null;
  return {
    year: date.year,
    month: date.month || null,
    day: date.day || null,
    formatted: [date.year, date.month, date.day]
      .filter(Boolean)
      .map(part => String(part).padStart(2, '0'))
      .join('-')
  };
}

function parseDateRange(timePeriod) {
  const range = timePeriod?.dateRange || timePeriod;

  if (!range) {
    return { start: null, end: null, isCurrent: false };
  }

  return {
    start: parseDate(range.startDate || range.start),
    end: parseDate(range.endDate || range.end),
    isCurrent: Boolean((range.startDate || range.start) && !(range.endDate || range.end))
  };
}

function uniqueBy(items, getKey) {
  const seen = new Set();
  return items.filter(item => {
    const key = getKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getItems(section) {
  if (!section) return [];
  return [...(section.included || []), ...(section.elements || [])];
}

function getEntityMap(sections) {
  return getItems(sections.fullProfile)
    .concat(getItems(sections.experience))
    .concat(getItems(sections.education))
    .concat(getItems(sections.skills))
    .concat(getItems(sections.certifications))
    .concat(getItems(sections.languages))
    .reduce((map, item) => {
      if (item?.entityUrn) map.set(item.entityUrn, item);
      return map;
    }, new Map());
}

function getRef(item, fieldName, entityMap) {
  const ref = item?.[`*${fieldName}`] || item?.[fieldName];
  if (typeof ref === 'string') return entityMap.get(ref) || null;
  if (Array.isArray(ref)) return ref.map(urn => entityMap.get(urn)).filter(Boolean);
  return null;
}

function typeIncludes(item, value) {
  return item?.$type?.toLowerCase().includes(value.toLowerCase()) ||
    item?.entityUrn?.toLowerCase().includes(value.toLowerCase());
}

function hasNoType(item) {
  return !item?.$type && !item?.entityUrn;
}

function findIncludedByUrn(included, urn) {
  if (!urn || typeof urn !== 'string') return null;
  return included.find(item => item.entityUrn === urn || item.urn === urn) || null;
}

function extractLocation(profileObj, included) {
  const directLocation = extractText(profileObj.locationName) ||
    extractText(profileObj.geoLocationName) ||
    extractText(profileObj.geoRegionName) ||
    extractText(profileObj.location) ||
    extractText(profileObj.geoLocation) ||
    extractText(profileObj.locationBasicLocation);

  if (directLocation) return directLocation;

  const candidateUrns = [
    profileObj['*geoLocation'],
    profileObj['*geoLocationBackfilled'],
    profileObj['*location'],
    profileObj.geoLocation?.geoUrn,
    profileObj.geoLocation?.['*geo'],
    profileObj.geoLocation?.entityUrn,
    profileObj.location?.entityUrn
  ].filter(Boolean);

  for (const urn of candidateUrns) {
    const entity = findIncludedByUrn(included, urn);
    const location = extractText(entity) ||
      extractText(entity?.defaultLocalizedName) ||
      extractText(entity?.displayName) ||
      extractText(entity?.locationName) ||
      extractText(entity?.geoLocationName) ||
      extractText(entity?.location);

    if (location) return location;
  }

  const geoEntity = included.find(item =>
    typeIncludes(item, 'Geo') &&
    (
      item.defaultLocalizedName ||
      item.displayName ||
      item.locationName ||
      item.geoLocationName
    )
  );

  return extractText(geoEntity) ||
    extractText(geoEntity?.defaultLocalizedName) ||
    extractText(geoEntity?.displayName) ||
    extractText(geoEntity?.locationName) ||
    extractText(geoEntity?.geoLocationName);
}

function parseProfileView(rawResponse, expectedVanityName) {
  const included = rawResponse?.included || [];
  const normalizedExpectedVanityName = expectedVanityName?.toLowerCase();

  const profileObjects = included.filter(item =>
    item.$type?.includes('identity.dash.profile.Profile') ||
    item.$type?.includes('identity.profile.Profile') ||
    item.entityUrn?.includes('fsd_profile:')
  );

  const responseData = rawResponse?.data || {};
  const profileObj = profileObjects.find(item =>
    normalizedExpectedVanityName &&
    String(item.publicIdentifier || item.vanityName || '').toLowerCase() === normalizedExpectedVanityName
  ) || (
    normalizedExpectedVanityName &&
    String(responseData.publicIdentifier || responseData.vanityName || '').toLowerCase() === normalizedExpectedVanityName
      ? responseData
      : null
  ) || profileObjects[0] || responseData;

  const profileUrn = profileObj.entityUrn || profileObj.urn || null;
  const firstName = extractText(profileObj.firstName);
  const lastName = extractText(profileObj.lastName);

  return {
    _profileUrn: profileUrn,
    profileUrl: profileObj.publicIdentifier
      ? `https://www.linkedin.com/in/${profileObj.publicIdentifier}/`
      : null,
    vanityName: profileObj.publicIdentifier || profileObj.vanityName || null,
    name: cleanText([firstName, lastName].filter(Boolean).join(' ')),
    firstName,
    lastName,
    headline: extractText(profileObj.headline),
    location: extractLocation(profileObj, included),
    about: extractText(profileObj.summary),
    industry: extractText(profileObj.industryName) || profileObj.industryUrn || null,
    images: {
      profile: extractImage(profileObj.profilePicture) || extractImage(profileObj.picture),
      background: extractImage(profileObj.backgroundPicture)
    },
    experience: [],
    education: [],
    skills: [],
    certifications: [],
    languages: []
  };
}

function mergeProfileSections(profileData, sections) {
  const normalizedSections = { ...sections, fullProfile: sections.fullProfile || sections.experience };
  const entityMap = getEntityMap(normalizedSections);

  const expItems = getItems(normalizedSections.experience);
  const positionGroups = expItems.filter(item => typeIncludes(item, 'PositionGroup'));
  const groupByPositionUrn = new Map();
  positionGroups.forEach(group => {
    const positionRefs = getRef(group, 'profilePositionInPositionGroup', entityMap);
    const positions = Array.isArray(positionRefs) ? positionRefs : [positionRefs].filter(Boolean);
    positions.forEach(position => groupByPositionUrn.set(position.entityUrn, group));
  });

  profileData.experience = uniqueBy(profileData.experience.concat(expItems
    .filter(item =>
      !typeIncludes(item, 'PositionGroup') &&
      (typeIncludes(item, 'Position') || (hasNoType(item) && (item.title || item.companyName)))
    )
    .map(pos => ({
      title: extractText(pos.title) || extractText(pos.titleText),
      company: extractText(pos.companyName) ||
        extractText(pos.company?.name) ||
        extractText(getRef(pos, 'company', entityMap)?.name) ||
        extractText(groupByPositionUrn.get(pos.entityUrn)?.companyName),
      location: extractText(pos.locationName) || extractText(pos.location),
      description: extractText(pos.description),
      dateRange: parseDateRange(pos.timePeriod || pos.dateRange),
      companyLogo: extractImage(pos.companyLogo) ||
        extractImage(pos.logo) ||
        extractImage(getRef(pos, 'company', entityMap)?.logo) ||
        extractImage(groupByPositionUrn.get(pos.entityUrn)?.logo)
    }))
    .filter(item => item.title || item.company)), item =>
    [item.title, item.company, item.dateRange.start?.formatted, item.dateRange.end?.formatted].join('|')
  );

  const eduItems = getItems(normalizedSections.education);
  profileData.education = uniqueBy(profileData.education.concat(eduItems
    .filter(item =>
      typeIncludes(item, 'Education') ||
      (hasNoType(item) && (item.schoolName || item.degreeName || item.fieldOfStudy))
    )
    .map(edu => ({
      school: extractText(edu.schoolName) ||
        extractText(edu.school?.name) ||
        extractText(getRef(edu, 'school', entityMap)?.name),
      degree: extractText(edu.degreeName),
      fieldOfStudy: extractText(edu.fieldOfStudy),
      description: extractText(edu.description),
      dateRange: parseDateRange(edu.timePeriod || edu.dateRange),
      schoolLogo: extractImage(edu.schoolLogo) ||
        extractImage(edu.logo) ||
        extractImage(getRef(edu, 'school', entityMap)?.logo)
    }))
    .filter(item => item.school || item.degree)), item =>
    [item.school, item.degree, item.fieldOfStudy].join('|')
  );

  const skillItems = getItems(normalizedSections.skills);
  profileData.skills = uniqueBy(profileData.skills.concat(skillItems
    .filter(item =>
      typeIncludes(item, 'Skill') ||
      (hasNoType(item) && (item.name || item.nameText || item.skillName))
    )
    .map(skill => ({
      name: extractText(skill.name) || extractText(skill.nameText) || extractText(skill.skillName),
      endorsementCount: skill.endorsementCount || skill.endorsementsCount || null
    }))
    .filter(item => item.name)), item => item.name.toLowerCase()
  );

  const certItems = getItems(normalizedSections.certifications);
  profileData.certifications = uniqueBy(profileData.certifications.concat(certItems
    .filter(item =>
      typeIncludes(item, 'Certification') ||
      (hasNoType(item) && (item.authority || item.licenseNumber))
    )
    .map(cert => ({
      name: extractText(cert.name),
      authority: extractText(cert.authority) || extractText(cert.issuer?.name),
      licenseNumber: extractText(cert.licenseNumber),
      url: cert.url || null,
      dateRange: parseDateRange(cert.timePeriod || cert.dateRange)
    }))
    .filter(item => item.name)), item => [item.name, item.authority].join('|')
  );

  const languageItems = getItems(normalizedSections.languages);
  profileData.languages = uniqueBy(profileData.languages.concat(languageItems
    .filter(item =>
      typeIncludes(item, 'Language') ||
      (hasNoType(item) && (item.proficiency || item.proficiencyName))
    )
    .map(language => ({
      name: extractText(language.name),
      proficiency: extractText(language.proficiency) || extractText(language.proficiencyName)
    }))
    .filter(item => item.name)), item => item.name.toLowerCase()
  );
}

module.exports = { parseProfileView, mergeProfileSections };
