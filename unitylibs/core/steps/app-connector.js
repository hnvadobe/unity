import { createActionBtn, createIntersectionObserver, getHeaders, getLocale } from '../../scripts/utils.js';

function getPreludeData(cfg) {
  const dataObj = {
    targetProduct: 'Photoshop',
    payload: {
      locale: getLocale(),
      operations: [...cfg.preludeState.operations],
    },
  };
  if(cfg.presentState.cache) {
    dataObj.href = cfg.preludeState.href
    dataObj.payload.finalAssetUrl = cfg.preludeState.finalAssetUrl;
  } else {
    dataObj.assetId = cfg.preludeState.assetId
    dataObj.payload.finalAssetId = cfg.preludeState.finalAssetId;
  }
  if (cfg.presentState?.adjustments && cfg.presentState?.adjustments.modified) {
    const imageAdjustment = {
      name: 'imageAdjustment',
      target: '',
      hue: parseInt(cfg.presentState?.adjustments.hue.value, 10),
      sat: parseInt(cfg.presentState?.adjustments.saturation.value, 10),
    };
    dataObj.payload.operations.push(imageAdjustment);
  }
  return dataObj;
}

async function continueInApp(cfg, appName, btnConfig) {
  const {
    apiKey,
    connectorApiEndPoint,
    refreshWidgetEvent,
    targetEl,
    unityEl,
    unityWidget,
  } = cfg;
  const continuebtn = unityWidget.querySelector(`continue-in-${appName}`);
  if (continuebtn) return continuebtn;
  const btn = await createActionBtn(btnConfig, `continue-in-app continue-in-${appName}`, true, true);
  btn.addEventListener('click', async (evt) => {
    evt.preventDefault();
    const { showErrorToast } = await import('../../scripts/utils.js');
    cfg.continueRetrying = false;
    if (cfg.scanResponseAfterRetries && cfg.scanResponseAfterRetries.status === 403) {
      unityEl.dispatchEvent(new CustomEvent(refreshWidgetEvent));
      await showErrorToast(targetEl, unityEl, '.icon-error-acmp');
      return false;
    }
    const data = getPreludeData(cfg);
    const connectorOptions = {
      method: 'POST',
      headers: getHeaders(apiKey),
      body: JSON.stringify(data),
    };
    const response = await fetch(connectorApiEndPoint, connectorOptions);
    if (response.status !== 200) {
      await showErrorToast(targetEl, unityEl, '.icon-error-request');
      return '';
    }
    const { url } = await response.json();
    window.location.href = url;
    return true;
  });
  return btn;
}

function resetAppConnector(cfg) {
  const connectBtn = cfg.unityWidget.querySelector('.continue-in-app');
  connectBtn?.classList.remove('show');
}

export default async function initAppConnector(cfg, appName) {
  const { unityEl, unityWidget, refreshWidgetEvent, interactiveSwitchEvent, targetEl } = cfg;
  const isContinueEnabled = unityEl.querySelector('.icon-app-connector');
  if (!isContinueEnabled) return;
  const btnConfig = isContinueEnabled.closest('li');
  const connectBtn = await continueInApp(cfg, appName, btnConfig);
  unityWidget.querySelector('.unity-action-area').append(connectBtn);
  unityEl.addEventListener(refreshWidgetEvent, () => {
    connectBtn?.classList.remove('show');
  });
  unityEl.addEventListener(interactiveSwitchEvent, () => {
    connectBtn?.classList.add('show');
  });
  createIntersectionObserver({ el: targetEl, callback: resetAppConnector, cfg });
}
