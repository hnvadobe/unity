import { getConfig } from './utils.js';

function createErrorMap(errorList) {
  const errorMap = {};
  if (Array.isArray(errorList)) {
    errorList.forEach((error) => {
      if (error['title.single.code']) {
        errorMap[error['title.single.code']] = error['title.single.message'];
      }
      if (error['title.multi.code']) {
        errorMap[error['title.multi.code']] = error['title.multi.message'];
      }
      if (error['body.single.code']) {
        errorMap[error['body.single.code']] = error['body.single.message'];
      }
      if (error['body.multi.code']) {
        errorMap[error['body.multi.code']] = error['body.multi.message'];
      }
    });
  }
  return errorMap;
}

async function loadErrorMessages(verb) {
  const { locale } = getConfig();
  const { origin } = window.location;
  const baseUrl = (origin.includes('hlx.page') || origin.includes('hlx.live')) 
    ? 'https://main--unity--adobecom.hlx.live'
    : origin;
  const errorFile = locale.prefix && locale.prefix !== '/'
    ? `${baseUrl}${locale.prefix}/unity/configs/errors/${verb}.json`
    : `${baseUrl}/unity/configs/errors/${verb}.json`;
  const errorRes = await fetch(errorFile);
  if (!errorRes.ok) {
    throw new Error('Failed to fetch error messages.');
  }
  const errorJson = await errorRes.json();
  window.uem = createErrorMap(errorJson?.content?.data);
}

export default async function getError(verb, code) {
  try {
    if (!window.uem || Object.keys(window.uem).length === 0) await loadErrorMessages(verb);
    return window.uem?.[code];
  } catch (e) {
    return '';
  }
}
