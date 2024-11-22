import {
  createTag,
  getUnityLibs,
  getHeaders,
  loadImg,
  createActionBtn,
  loadSvg,
  createIntersectionObserver,
  priorityLoad,
  getLibs,
} from '../../../scripts/utils.js';

const miloLibs = getLibs('/libs');
const { decorateDefaultLinkAnalytics } = await import(`${miloLibs}/martech/attributes.js`);

function resetSliders(unityWidget) {
  const adjustmentCircles = unityWidget.querySelectorAll('.adjustment-circle');
  adjustmentCircles.forEach((c) => { c.style = ''; });
}

function addOrUpdateOperation(array, keyToCheck, valueToCheck, keyToUpdate, newValue, newObject) {
  const existingObject = array.find((obj) => obj[keyToCheck] === valueToCheck);
  if (existingObject) {
    existingObject[keyToUpdate] = newValue;
  } else {
    array.push(newObject);
  }
}

function resetWorkflowState(cfg) {
  cfg.presentState = {
    activeIdx: cfg.isUpload ? 0 : -1,
    removeBgState: {
      assetId: null,
      assetUrl: null,
    },
    changeBgState: {},
    adjustments: {},
  };
  cfg.preludeState = { assetId: null, operations: [] };
  const img = cfg.targetEl.querySelector(':scope > picture img');
  img.style.filter = '';
  resetSliders(cfg.unityWidget);
}

function toggleDisplay(domEl) {
  if (domEl.classList.contains('show')) domEl.classList.remove('show');
  else domEl.classList.add('show');
}

async function addProductIcon(cfg) {
  const { unityEl, unityWidget, targetEl, refreshWidgetEvent } = cfg;
  cfg.refreshEnabled = false;
  const refreshCfg = unityEl.querySelector('.icon-product-icon');
  if (!refreshCfg) return;
  const [prodIcon, refreshIcon] = refreshCfg.closest('li').querySelectorAll('img[src*=".svg"]');
  const unityOrigin = getUnityLibs().split('/unitylibs')[0];
  prodIcon.src = `${unityOrigin}${new URL(prodIcon.src).pathname}`;
  const iconHolder = createTag('div', { class: 'widget-product-icon show' }, prodIcon);
  const refreshSvg = await loadSvg(`${unityOrigin}${new URL(refreshIcon.src).pathname}`);
  const refreshAnalyics = createTag('div', { class: 'widget-refresh-text' }, 'Restart');
  const refreshHolder = createTag('a', { href: '#', class: 'widget-refresh-button' }, refreshSvg);
  refreshHolder.append(refreshAnalyics);
  await loadImg(prodIcon);
  unityWidget.querySelector('.unity-action-area').append(iconHolder);
  if (!refreshIcon) return;
  cfg.refreshEnabled = true;
  const mobileRefreshHolder = refreshHolder.cloneNode(true);
  [refreshHolder, mobileRefreshHolder].forEach((el) => {
    el.addEventListener('click', (evt) => {
      evt.preventDefault();
      unityEl.dispatchEvent(new CustomEvent(refreshWidgetEvent));
    });
  });
  unityWidget.querySelector('.unity-action-area').append(refreshHolder);
  targetEl.append(mobileRefreshHolder);
}

async function handleEvent(cfg, eventHandler) {
  const { targetEl, unityEl } = cfg;
  const { default: showProgressCircle } = await import('../../features/progress-circle/progress-circle.js');
  const { showErrorToast } = await import('../../../scripts/utils.js');
  showProgressCircle(targetEl);
  try {
    await eventHandler();
  } catch (e) {
    await showErrorToast(targetEl, unityEl, '.icon-error-request');
  } finally {
    showProgressCircle(targetEl);
  }
}

async function updateImgClasses(cfg, img) {
  const { imgDisplay } = cfg;
  if (imgDisplay === 'landscape' || imgDisplay === 'portrait') {
    const {
      IMG_LANDSCAPE,
      IMG_PORTRAIT,
      IMG_REMOVE_BG,
    } = await import('../../steps/upload-btn.js');
    if (cfg.imgDisplay === 'landscape') {
      if (img.classList.contains(IMG_LANDSCAPE)) img.classList.remove(IMG_LANDSCAPE);
    } else if (cfg.imgDisplay === 'portrait') {
      if (img.classList.contains(IMG_PORTRAIT)) img.classList.remove(IMG_PORTRAIT);
    }
    if (!img.classList.contains(IMG_REMOVE_BG)) img.classList.add(IMG_REMOVE_BG);
  }
}

function checkImgModified(hostname) {
  let isModified = false;
  try {
    const pageUrlObject = new URL(window.location.href);
    isModified = hostname !== pageUrlObject.hostname;
  } catch (e) {
    return '';
  }
  return isModified;
}

async function removeBgHandler(cfg, changeDisplay = true) {
  const {
    apiEndPoint,
    apiKey,
    interactiveSwitchEvent,
    refreshWidgetEvent,
    targetEl,
    unityEl,
  } = cfg;
  const { showErrorToast } = await import('../../../scripts/utils.js');
  const { endpoint } = cfg.wfDetail.removebg;
  const img = targetEl.querySelector('picture img');
  const hasExec = cfg.presentState.removeBgState.srcUrl;
  if (changeDisplay
    && hasExec
    && !(img.src.startsWith(cfg.presentState.removeBgState.srcUrl))) {
    cfg.presentState.removeBgState.assetId = null;
    cfg.presentState.removeBgState.srcUrl = null;
    cfg.presentState.changeBgState = {};
    cfg.presentState.adjustments = {};
    cfg.presentState.assetId = null;
    cfg.preludeState.operations = [];
  }
  const { srcUrl, assetUrl } = cfg.presentState.removeBgState;
  const urlIsValid = assetUrl ? await fetch(assetUrl) : null;
  if (cfg.presentState.removeBgState.assetId && urlIsValid?.status === 200) {
    if (changeDisplay) {
      img.src = cfg.presentState.removeBgState.assetUrl;
      cfg.preludeState.operations.push({ name: 'removeBackground' });
      await loadImg(img);
      unityEl.dispatchEvent(new CustomEvent(interactiveSwitchEvent));
    }
    return false;
  }
  const { hostname, origin, pathname } = new URL(img.src);
  const imgUrl = srcUrl || (img.src.startsWith('blob:') ? img.src : `${origin}${pathname}`);
  const isImgModified = checkImgModified(hostname);
  cfg.presentState.removeBgState.srcUrl = imgUrl;
  const { uploadAsset } = await import('../../steps/upload-step.js');
  const id = await uploadAsset(cfg, imgUrl);
  if (!id) {
    await showErrorToast(targetEl, unityEl, '.icon-error-request');
    return false;
  }
  if (isImgModified) {
    const { scanImgForSafety } = await import('../../steps/upload-step.js');
    let scanResponse = await scanImgForSafety(cfg, id);
    if (scanResponse.status === 403) {
      unityEl.dispatchEvent(new CustomEvent(refreshWidgetEvent));
      await showErrorToast(targetEl, unityEl, '.icon-error-acmp');
      return false;
    }
    if (scanResponse.status === 429
      || (scanResponse.status >= 500 && scanResponse.status < 600)) {
      const { retryRequestUntilProductRedirect } = await import('../../../scripts/utils.js');
      scanResponse = await retryRequestUntilProductRedirect(cfg, () => scanImgForSafety(cfg, id));
    }
  }
  cfg.preludeState.assetId = id;
  const removeBgOptions = {
    method: 'POST',
    headers: getHeaders(apiKey),
    body: `{"surfaceId":"Unity","assets":[{"id": "${id}"}]}`,
  };
  const response = await fetch(`${apiEndPoint}/${endpoint}`, removeBgOptions);
  if (response.status !== 200) {
    await showErrorToast(targetEl, unityEl, '.icon-error-request');
    return false;
  }
  const { outputUrl } = await response.json();
  const opId = new URL(outputUrl).pathname.split('/').pop();
  cfg.preludeState.finalAssetId = opId;
  cfg.presentState.removeBgState.assetId = opId;
  cfg.presentState.removeBgState.assetUrl = outputUrl;
  cfg.preludeState.operations.push({ name: 'removeBackground' });
  if (!changeDisplay) return true;
  await updateImgClasses(cfg, img);
  img.src = outputUrl;
  await loadImg(img);
  unityEl.dispatchEvent(new CustomEvent(interactiveSwitchEvent));
  return true;
}

async function removebg(cfg, featureName) {
  const { wfDetail, unityWidget } = cfg;
  const removebgBtn = unityWidget.querySelector('.ps-action-btn.removebg-button');
  if (removebgBtn) return removebgBtn;
  const btn = await createActionBtn(wfDetail[featureName].authorCfg, 'ps-action-btn removebg-button show');
  btn.addEventListener('click', async (evt) => {
    evt.preventDefault();
    handleEvent(cfg, () => removeBgHandler(cfg));
  });
  return btn;
}

async function changeBgHandler(cfg, selectedUrl = null, refreshState = true) {
  if (refreshState) resetWorkflowState();
  const {
    apiEndPoint,
    apiKey,
    targetEl,
    unityWidget,
    unityEl,
    interactiveSwitchEvent,
  } = cfg;
  const { showErrorToast } = await import('../../../scripts/utils.js');
  const { endpoint } = cfg.wfDetail.changebg;
  const unityRetriggered = await removeBgHandler(cfg, false);
  const img = targetEl.querySelector('picture img');
  const fgId = cfg.presentState.removeBgState.assetId;
  const bgImg = selectedUrl || unityWidget.querySelector('.unity-option-area .changebg-options-tray img').dataset.backgroundImg;
  const { origin, pathname } = new URL(bgImg);
  const bgImgUrl = `${origin}${pathname}`;
  const { uploadAsset } = await import('../../steps/upload-step.js');
  const bgId = await uploadAsset(cfg, bgImgUrl);
  if (!unityRetriggered && cfg.presentState.changeBgState[bgImgUrl]?.assetId) {
    img.src = cfg.presentState.changeBgState[bgImgUrl].assetUrl;
    await loadImg(img);
    addOrUpdateOperation(cfg.preludeState.operations, 'name', 'changeBackground', 'assetIds', [bgId], { name: 'changeBackground', assetIds: [bgId] });
    unityEl.dispatchEvent(new CustomEvent(interactiveSwitchEvent));
    return;
  }
  const changeBgOptions = {
    method: 'POST',
    headers: getHeaders(apiKey),
    body: `{
            "assets": [{ "id": "${fgId}" },{ "id": "${bgId}" }],
            "metadata": {
              "foregroundImageId": "${fgId}",
              "backgroundImageId": "${bgId}"
            }
          }`,
  };
  const response = await fetch(`${apiEndPoint}/${endpoint}`, changeBgOptions);
  if (response.status !== 200) {
    await showErrorToast(targetEl, unityEl, '.icon-error-request');
    return;
  }
  const { outputUrl } = await response.json();
  const changeBgId = new URL(outputUrl).pathname.split('/').pop();
  cfg.presentState.changeBgState[bgImgUrl] = {};
  cfg.presentState.changeBgState[bgImgUrl].assetId = changeBgId;
  cfg.presentState.changeBgState[bgImgUrl].assetUrl = outputUrl;
  cfg.preludeState.finalAssetId = changeBgId;
  addOrUpdateOperation(cfg.preludeState.operations, 'name', 'changeBackground', 'assetIds', [bgId], { name: 'changeBackground', assetIds: [bgId] });
  img.src = outputUrl;
  await loadImg(img);
  if (!img.classList.contains('mobile-gray-bg')) img.classList.add('mobile-gray-bg');
  unityEl.dispatchEvent(new CustomEvent(interactiveSwitchEvent));
}

function updateQueryParam(url, params) {
  const parsedUrl = new URL(url);
  Object.entries(params).forEach(([key, value]) => {
    parsedUrl.searchParams.set(key, value);
  });
  return parsedUrl;
}

async function changebg(cfg, featureName) {
  const { unityWidget, wfDetail } = cfg;
  const { authorCfg } = wfDetail[featureName];
  const changebgBtn = unityWidget.querySelector('.ps-action-btn.changebg-button');
  if (changebgBtn) return changebgBtn;
  const btn = await createActionBtn(authorCfg, 'ps-action-btn changebg-button subnav-active show');
  btn.classList.add('focus');
  btn.dataset.optionsTray = 'changebg-options-tray';
  const bgSelectorTray = createTag('div', { class: 'changebg-options-tray show' });
  const bgOptions = authorCfg.querySelectorAll(':scope ul li');
  const thumbnailSrc = [];
  [...bgOptions].forEach((o) => {
    let thumbnail = null;
    let bgImg = null;
    bgImg = o.querySelector('img');
    thumbnail = bgImg;
    thumbnail.dataset.backgroundImg = bgImg.src;
    thumbnail.setAttribute('src', updateQueryParam(bgImg.src, { format: 'webply', width: '68', height: '68' }));
    thumbnailSrc.push(thumbnail.getAttribute('src'));
    const a = createTag('a', { href: '#', class: 'changebg-option' }, thumbnail);
    bgSelectorTray.append(a);
    a.addEventListener('click', async (evt) => {
      evt.preventDefault();
      handleEvent(cfg, () => changeBgHandler(cfg, bgImg.src, false));
    });
  });
  priorityLoad(thumbnailSrc);
  unityWidget.querySelector('.unity-option-area').append(bgSelectorTray);
  btn.addEventListener('click', (evt) => {
    evt.preventDefault();
    if (btn.classList.contains('subnav-active')) btn.classList.remove('subnav-active');
    else btn.classList.add('subnav-active');
    toggleDisplay(unityWidget.querySelector('.unity-option-area .changebg-options-tray'));
    if (btn.classList.contains('focus')) {
      btn.classList.remove('focus');
    } else {
      btn.classList.add('focus');
    }
  });
  return btn;
}

function updateAdjustment(cfg, cssFilter, propertyName, value) {
  const filterValue = cssFilter.replace('inputValue', value);
  cfg.presentState.adjustments[propertyName] = { value, filterValue };
}

function createSlider(cfg, tray, propertyName, label, cssFilter, valObj) {
  const { targetEl } = cfg;
  const { minVal, maxVal, zeroVal } = valObj;
  const actionDiv = createTag('div', { class: 'adjustment-option' });
  const actionLabel = createTag('label', { class: 'adjustment-label' }, label);
  const actionSliderDiv = createTag('div', { class: `adjustment-container ${propertyName}` });
  const actionSliderInput = createTag('input', {
    type: 'range',
    min: minVal,
    max: maxVal,
    value: zeroVal,
    class: `adjustment-slider ${propertyName}`,
  });
  updateAdjustment(cfg, cssFilter, propertyName, zeroVal);
  const actionAnalytics = createTag('div', { class: 'analytics-content' }, `Adjust ${label} slider`);
  const actionSliderCircle = createTag('a', { href: '#', class: `adjustment-circle ${propertyName}` }, actionAnalytics);
  actionSliderDiv.append(actionSliderInput, actionSliderCircle);
  actionDiv.append(actionLabel, actionSliderDiv);
  actionSliderInput.addEventListener('input', () => {
    const { value } = actionSliderInput;
    const centerOffset = (value - minVal) / (maxVal - minVal);
    const moveCircle = 3 + (centerOffset * 94);
    actionSliderCircle.style.left = `${moveCircle}%`;
    const img = targetEl.querySelector(':scope > picture img');
    updateAdjustment(cfg, cssFilter, propertyName, value);
    cfg.presentState.adjustments.modified = true;
    const imgFilters = Object.keys(cfg.presentState.adjustments);
    img.style.filter = '';
    imgFilters.forEach((f) => {
      img.style.filter += `${cfg.presentState.adjustments[f].filterValue} `;
    });
  });
  actionSliderInput.addEventListener('change', () => {
    actionSliderCircle.click();
  });
  actionSliderCircle.addEventListener('click', (evt) => {
    evt.preventDefault();
  });
  tray.append(actionDiv);
}

async function changeAdjustments(cfg, featureName) {
  const { unityWidget, wfDetail, targetEl } = cfg;
  const { authorCfg } = wfDetail[featureName];
  const adjustmentBtn = unityWidget.querySelector('.ps-action-btn.adjustment-button');
  const hueCssFilter = 'hue-rotate(inputValuedeg)';
  const saturationCssFilter = 'saturate(inputValue%)';
  const hueZeroVal = 0;
  const saturationZeroVal = 100;
  if (adjustmentBtn) {
    const img = targetEl.querySelector(':scope > picture img');
    img.style.filter = '';
    updateAdjustment(cfg, hueCssFilter, 'hue', hueZeroVal);
    updateAdjustment(cfg, saturationCssFilter, 'saturation', saturationZeroVal);
    return adjustmentBtn;
  }
  const btn = await createActionBtn(authorCfg, 'ps-action-btn adjustment-button subnav-active show');
  btn.classList.add('focus');
  btn.dataset.optionsTray = 'adjustment-options-tray';
  const sliderTray = createTag('div', { class: 'adjustment-options-tray show' });
  const sliderOptions = authorCfg.querySelectorAll(':scope > ul li');
  [...sliderOptions].forEach((o) => {
    let iconName = null;
    const psAction = o.querySelector(':scope > .icon');
    [...psAction.classList].forEach((cn) => { if (cn.match('icon-')) iconName = cn; });
    const [, actionName] = iconName.split('-');
    switch (actionName) {
      case 'hue':
        createSlider(cfg, sliderTray, 'hue', o.innerText, hueCssFilter, { minVal: -180, maxVal: 180, zeroVal: hueZeroVal });
        break;
      case 'saturation':
        createSlider(cfg, sliderTray, 'saturation', o.innerText, saturationCssFilter, { minVal: 0, maxVal: 300, zeroVal: saturationZeroVal });
        break;
      default:
        break;
    }
  });
  unityWidget.querySelector('.unity-option-area').append(sliderTray);
  btn.addEventListener('click', (evt) => {
    evt.preventDefault();
    if (btn.classList.contains('subnav-active')) btn.classList.remove('subnav-active');
    else btn.classList.add('subnav-active');
    toggleDisplay(unityWidget.querySelector('.unity-option-area .adjustment-options-tray'));
    if (btn.classList.contains('focus')) {
      btn.classList.remove('focus');
    } else {
      btn.classList.add('focus');
    }
  });
  return btn;
}

function showFeatureButton(unityWidget, prevBtn, currBtn) {
  if (!prevBtn) {
    unityWidget.querySelector('.unity-action-area').append(currBtn);
  } else {
    prevBtn.insertAdjacentElement('afterend', currBtn);
    const prevOptionTray = prevBtn?.dataset.optionsTray;
    unityWidget.querySelector(`.unity-option-area .${prevOptionTray}`)?.classList.remove('show');
    prevBtn.classList.remove('show');
  }
  const currOptionTray = currBtn.dataset.optionsTray;
  unityWidget.querySelector(`.unity-option-area .${currOptionTray}`)?.classList.add('show');
  currBtn.classList.add('show');
}

async function changeVisibleFeature(cfg) {
  const { unityWidget, enabledFeatures } = cfg;
  if (cfg.presentState.activeIdx + 1 === enabledFeatures.length) return;
  cfg.presentState.activeIdx += 1;
  const featureName = enabledFeatures[cfg.presentState.activeIdx];
  let actionBtn = null;
  switch (featureName) {
    case 'removebg':
      actionBtn = await removebg(cfg, featureName);
      break;
    case 'changebg':
      actionBtn = await changebg(cfg, featureName);
      break;
    case 'slider':
      actionBtn = await changeAdjustments(cfg, featureName);
      break;
    default:
      break;
  }
  const prevActionBtn = unityWidget.querySelector('.ps-action-btn.show');
  if (prevActionBtn === actionBtn) return;
  showFeatureButton(unityWidget, prevActionBtn, actionBtn);
}

async function resetWidgetState(cfg) {
  const { unityWidget, unityEl, targetEl } = cfg;
  cfg.presentState.activeIdx = -1;
  cfg.preludeState.operations = [];
  cfg.isUpload = false;
  cfg.imgDisplay = '';
  const initImg = unityEl.querySelector(':scope picture img');
  const img = targetEl.querySelector(':scope > picture img');
  img.src = initImg.src;
  img.style.filter = '';
  await changeVisibleFeature(cfg);
  unityWidget.querySelector('.widget-product-icon')?.classList.add('show');
  unityWidget.querySelector('.widget-refresh-button').classList.remove('show');
  targetEl.querySelector(':scope > .widget-refresh-button').classList.remove('show');
  const { resetClasses } = await import('../../steps/upload-btn.js');
  resetClasses(img, targetEl);
  resetSliders(unityWidget);
  await loadImg(img);
}

async function switchProdIcon(cfg, forceRefresh = true) {
  const { unityWidget, refreshEnabled, targetEl } = cfg;
  const iconHolder = unityWidget.querySelector('.widget-product-icon');
  if (!(refreshEnabled)) return;
  if (forceRefresh) {
    await resetWidgetState(cfg);
    return;
  }
  iconHolder?.classList.remove('show');
  unityWidget.querySelector('.widget-refresh-button').classList.add('show');
  targetEl.querySelector(':scope > .widget-refresh-button').classList.add('show');
}

async function uploadCallback(cfg) {
  const { enabledFeatures } = cfg;
  resetWorkflowState(cfg);
  if (enabledFeatures.length === 1) return;
  await removeBgHandler(cfg);
  cfg.isUpload = false;
}

export default async function init(cfg) {
  const { targetEl, unityEl, unityWidget, interactiveSwitchEvent, refreshWidgetEvent } = cfg;
  resetWorkflowState(cfg);
  await addProductIcon(cfg);
  await changeVisibleFeature(cfg);
  const img = cfg.targetEl.querySelector('picture img');
  const { default: createUpload } = await import('../../steps/upload-btn.js');
  const uploadBtn = await createUpload(cfg, img, uploadCallback);
  unityWidget.querySelector('.unity-action-area').append(uploadBtn);
  const { default: initAppConnector } = await import('../../steps/app-connector.js');
  await initAppConnector(cfg, 'photoshop');
  await decorateDefaultLinkAnalytics(unityWidget);
  unityEl.addEventListener(interactiveSwitchEvent, async () => {
    await changeVisibleFeature(cfg);
    await switchProdIcon(cfg, false);
    await decorateDefaultLinkAnalytics(unityWidget);
  });
  unityEl.addEventListener(refreshWidgetEvent, async () => {
    await switchProdIcon(cfg, true);
  });
  createIntersectionObserver({ el: targetEl, callback: switchProdIcon, cfg });
}
