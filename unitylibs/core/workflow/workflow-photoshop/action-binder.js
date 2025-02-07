/* eslint-disable max-classes-per-file */
/* eslint-disable eqeqeq */
/* eslint-disable no-await-in-loop */
/* eslint-disable class-methods-use-this */
/* eslint-disable no-restricted-syntax */

import {
  getGuestAccessToken,
  unityConfig,
  loadImg,
  createTag,
  getLocale,
  delay,
  getLibs,
} from '../../../scripts/utils.js';

const CONTAIN_OBJECT = 'contain-object';
const MOBILE_GRAY_BG = 'mobile-gray-bg';
const GRAY_BG = 'gray-bg';
const FULL_HEIGHT = 'full-height';
const IMG_LANDSCAPE = 'img-landscape';
const IMG_PORTRAIT = 'img-portrait';
const IMG_REMOVE_BG = 'img-removebg';

class ServiceHandler {
  constructor(renderWidget = false, canvasArea = null, unityEl = null) {
    this.renderWidget = renderWidget;
    this.canvasArea = canvasArea;
    this.unityEl = unityEl;
  }

  getHeaders() {
    return {
      headers: {
        'Content-Type': 'application/json',
        Authorization: getGuestAccessToken(),
        'x-api-key': unityConfig.apiKey,
      },
    };
  }

  async postCallToService(api, options, errorCallbackOptions = {}, failOnError = true) {
    const postOpts = {
      method: 'POST',
      ...this.getHeaders(),
      ...options,
    };
    try {
      const response = await fetch(api, postOpts);
      if (failOnError && response.status != 200) throw Error('Operation failed');
      if (!failOnError) return response;
      const resJson = await response.json();
      return resJson;
    } catch (err) {
      if (!this.renderWidget) return {};
      this.showErrorToast(errorCallbackOptions);
      throw Error('Operation failed');
    }
  }

  showErrorToast(errorCallbackOptions) {
    this.canvasArea?.querySelector('.progress-circle')?.classList.remove('show');
    if (!errorCallbackOptions.errorToastEl) return;
    const msg = this.unityEl.querySelector(errorCallbackOptions.errorType)?.nextSibling.textContent;
    errorCallbackOptions.errorToastEl.querySelector('.alert-text p').innerText = msg;
    errorCallbackOptions.errorToastEl.classList.add('show');
  }
}

export default class ActionBinder {
  constructor(unityEl, workflowCfg, wfblock, canvasArea, actionMap = {}, limits = {}) {
    this.unityEl = unityEl;
    this.workflowCfg = workflowCfg;
    this.block = wfblock;
    this.actionMap = actionMap;
    this.canvasArea = canvasArea;
    this.operations = [];
    this.errorToastEl = null;
    this.psApiConfig = this.getPsApiConfig();
    this.serviceHandler = null;
    this.renderCachedExperience = true;
  }

  getPsApiConfig() {
    unityConfig.psEndPoint = {
      assetUpload: `${unityConfig.apiEndPoint}/asset`,
      acmpCheck: `${unityConfig.apiEndPoint}/asset/finalize`,
      removeBackground: `${unityConfig.apiEndPoint}/providers/PhotoshopRemoveBackground`,
      changeBackground: `${unityConfig.apiEndPoint}/providers/PhotoshopChangeBackground`,
    };
    return unityConfig;
  }

  hideElement(item, b) {
    if (typeof item === 'string') b?.querySelector(item)?.classList.remove('show');
    else item?.classList.remove('show');
  }

  showElement(item, b) {
    if (typeof item === 'string') b?.querySelector(item)?.classList.add('show');
    else item?.classList.add('show');
  }

  toggleElement(item, b) {
    if (typeof item === 'string') {
      if (b?.querySelector(item)?.classList.contains('show')) b?.querySelector(item)?.classList.remove('show');
      else b?.querySelector(item)?.classList.add('show');
      return;
    }
    if (item?.classList.contains('show')) item?.classList.remove('show');
    else item?.classList.add('show');
  }

  styleElement(itemSelector, propertyName, propertyValue) {
    const item = this.block.querySelector(itemSelector);
    item.style[propertyName] = propertyValue;
  }

  dispatchClickEvent(params, e) {
    const a = e.target.nodeName == 'A' ? e.target : e.target.closest('a');
    a.querySelector(params.target).click();
  }

  async executeAction(values, e) {
    for (const value of values) {
      switch (true) {
        case value.actionType == 'hide':
          value.targets.forEach((t) => this.hideElement(t, this.block));
          break;
        case value.actionType == 'setCssStyle':
          value.targets.forEach((t) => {
            this.styleElement(t, value.propertyName, value.propertyValue);
          });
          break;
        case value.actionType == 'show':
          value.targets.forEach((t) => this.showElement(t, this.block));
          break;
        case value.actionType == 'toggle':
          value.targets.forEach((t) => this.toggleElement(t, this.block));
          break;
        case value.actionType == 'removebg':
          await this.removeBackground(value);
          break;
        case value.actionType == 'changebg':
          await this.changeBackground(value);
          break;
        case value.actionType == 'imageAdjustment':
          this.changeAdjustments(e.target.value, value);
          break;
        case value.actionType == 'upload':
          this.renderCachedExperience = false;
          await this.userImgUpload(value, e);
          break;
        case value.actionType == 'continueInApp':
          await this.continueInApp(value, e);
          break;
        case value.actionType == 'dispatchClickEvent':
          this.dispatchClickEvent(value, e);
          break;
        case value.actionType == 'refresh':
          this.renderCachedExperience = true;
          value.target.src = value.sourceSrc;
          this.operations = [];
          this.resetClasses(value.target, this.canvasArea);
          break;
        default:
          break;
      }
    }
  }

  async psActionMaps(values, e) {
    if (this.workflowCfg.targetCfg.renderWidget) {
      if (!this.progressCircleEl) this.progressCircleEl = this.createSpectrumProgress();
      if (!this.errorToastEl) this.errorToastEl = await this.createErrorToast();
    }
    await this.executeAction(values, e);
  }

  async initActionListeners() {
    this.serviceHandler = new ServiceHandler(
      this.workflowCfg.targetCfg.renderWidget,
      this.canvasArea,
      this.unityEl,
    );
    for (const [key, values] of Object.entries(this.actionMap)) {
      const el = this.block.querySelector(key);
      if (!el) return;
      switch (true) {
        case el.nodeName === 'A':
          el.href = '#';
          el.addEventListener('click', async (e) => {
            e.preventDefault();
            await this.psActionMaps(values, e);
          });
          if (values.find((v) => v.actionType == 'refresh')) {
            const observer = new IntersectionObserver((entries) => {
              entries.forEach(async (entry) => {
                if (!entry.isIntersecting) {
                  await this.psActionMaps(values);
                }
              });
            });
            observer.observe(this.canvasArea);
          }
          break;
        case el.nodeName === 'INPUT':
          el.addEventListener('change', async (e) => {
            await this.psActionMaps(values, e);
          });
          break;
        default:
          break;
      }
    }
  }

  getImageBlobData(url) {
    return new Promise((res, rej) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url);
      xhr.responseType = 'blob';
      xhr.onload = () => {
        if (xhr.status === 200) res(xhr.response);
        else rej(xhr.status);
      };
      xhr.send();
    });
  }

  async uploadImgToUnity(storageUrl, id, blobData, fileType) {
    const uploadOptions = {
      method: 'PUT',
      headers: { 'Content-Type': fileType },
      body: blobData,
    };
    const response = await fetch(storageUrl, uploadOptions);
    if (response.status != 200) return '';
    return id;
  }

  getFileType() {
    if (this.operations.length) {
      const lastOperation = this.operations[this.operations.length - 1];
      if (lastOperation.operationType == 'upload') return lastOperation.fileType;
    }
    return 'image/jpeg';
  }

  async scanImgForSafety(assetId) {
    const assetData = { assetId, targetProduct: this.workflowCfg.productName };
    const optionsBody = { body: JSON.stringify(assetData) };
    const res = await this.serviceHandler.postCallToService(
      this.psApiConfig.psEndPoint.acmpCheck,
      optionsBody,
      {},
      false,
    );
    if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
      setTimeout(() => { this.scanImgForSafety(); }, 1000);
    }
  }

  async uploadAsset(imgUrl) {
    const resJson = await this.serviceHandler.postCallToService(
      this.psApiConfig.psEndPoint.assetUpload,
      {},
      {
        errorToastEl: this.errorToastEl,
        errorType: '.icon-error-request',
      },
    );
    const { id, href } = resJson;
    const blobData = await this.getImageBlobData(imgUrl);
    const fileType = this.getFileType();
    const assetId = await this.uploadImgToUnity(href, id, blobData, fileType);
    const { origin } = new URL(imgUrl);
    if ((imgUrl.startsWith('blob:')) || (origin != window.location.origin)) this.scanImgForSafety(assetId);
    return assetId;
  }

  resetClasses(img, targetEl) {
    [
      CONTAIN_OBJECT,
      IMG_LANDSCAPE,
      IMG_PORTRAIT,
      IMG_REMOVE_BG,
      MOBILE_GRAY_BG,
      FULL_HEIGHT,
    ].forEach((c) => {
      img.classList.remove(c);
    });
    targetEl.classList.remove(GRAY_BG);
  }

  async userImgUpload(params, e) {
    this.canvasArea.querySelector('img').style.filter = '';
    this.operations = [];
    const file = e.target.files[0];
    if (!file) return;
    if (['image/jpeg', 'image/png', 'image/jpg'].indexOf(file.type) == -1) {
      this.serviceHandler.showErrorToast({ errorToastEl: this.errorToastEl, errorType: '.icon-error-filetype' });
      throw new Error('File format not supported!!');
    }
    if (file.size > 40000000) {
      this.serviceHandler.showErrorToast({ errorToastEl: this.errorToastEl, errorType: '.icon-error-filesize' });
      throw new Error('File too large!!');
    }
    const operationItem = {
      operationType: 'upload',
      fileType: file.type,
    };
    const objUrl = URL.createObjectURL(file);
    params.target.src = objUrl;
    let loadSuccessful = false;
    await new Promise((res) => {
      params.target.onload = () => {
        loadSuccessful = true;
        res();
      };
      params.target.onerror = () => {
        loadSuccessful = false;
        res();
      };
    });
    if (!loadSuccessful) return;
    if (params.target.naturalWidth > 8000 || params.target.naturalHeight > 8000) {
      this.serviceHandler.showErrorToast({ errorToastEl: this.errorToastEl, errorType: '.icon-error-filetype' });
      return;
    }

    const { offsetWidth, offsetHeight } = params.target;
    params.target.classList.add(CONTAIN_OBJECT);
    params.target.classList.add(MOBILE_GRAY_BG);
    this.canvasArea.classList.add(GRAY_BG);
    if (this.canvasArea.naturalWidth > offsetWidth) {
      params.target.classList.add(IMG_LANDSCAPE);
      params.target.classList.add(FULL_HEIGHT);
    } else {
      params.target.classList.add(IMG_PORTRAIT);
      params.target.classList.add(FULL_HEIGHT);
    }
    if (
      this.canvasArea.naturalWidth == offsetWidth
      && this.canvasArea.naturalHeight == offsetHeight
    ) {
      this.resetClasses(params.target, this.canvasArea);
    }
    this.operations.push(operationItem);
    const callbackObj = [{
      itemType: 'button',
      actionType: params.callbackAction,
      source: params.callbackActionSource,
      target: params.callbackActionTarget,
    },
    ];
    await this.executeAction(callbackObj, null);
  }

  async removeBackground(params) {
    const optype = 'removeBackground';
    let { source, target } = params;
    if (typeof (source) == 'string') source = this.block.querySelector(source);
    if (typeof (target) == 'string') target = this.block.querySelector(target);
    const parsedUrl = new URL(source.src);
    const imgsrc = ((!source.src.startsWith('blob:')) && parsedUrl.origin == window.origin)
      ? `${parsedUrl.origin}${parsedUrl.pathname}`
      : source.src;
    const operationItem = {
      operationType: optype,
      sourceAssetId: null,
      sourceAssetUrl: null,
      sourceSrc: imgsrc,
      assetId: null,
      assetUrl: null,
    };
    if (params.cachedOutputUrl && this.renderCachedExperience) {
      await delay(500);
      operationItem.sourceAssetUrl = imgsrc;
      operationItem.assetUrl = params.cachedOutputUrl;
    } else {
      let assetId = null;
      if (
        this.operations.length
        && this.operations[this.operations.length - 1].assetId
      ) {
        assetId = this.operations[this.operations.length - 1].assetId;
      } else assetId = await this.uploadAsset(imgsrc);
      operationItem.sourceAssetId = assetId;
      const removeBgOptions = { body: `{"surfaceId":"Unity","assets":[{"id": "${assetId}"}]}` };
      const resJson = await this.serviceHandler.postCallToService(
        this.psApiConfig.psEndPoint[optype],
        removeBgOptions,
        {
          errorToastEl: this.errorToastEl,
          errorType: '.icon-error-request',
        },
      );
      operationItem.assetId = resJson.assetId;
      operationItem.assetUrl = resJson.outputUrl;
    }
    target.src = operationItem.assetUrl;
    await loadImg(target);
    this.operations.push(operationItem);
  }

  async changeBackground(params) {
    const opType = 'changeBackground';
    let { source, target, backgroundSrc } = params;
    if (typeof (source) == 'string') source = this.block.querySelector(source);
    if (typeof (target) == 'string') target = this.block.querySelector(target);
    if (typeof (backgroundSrc) == 'string' && !backgroundSrc.startsWith('http')) backgroundSrc = this.block.querySelector(backgroundSrc);
    const parsedUrl = new URL(backgroundSrc);
    const imgsrc = `${parsedUrl.origin}${parsedUrl.pathname}`;
    const operationItem = {
      operationType: opType,
      sourceSrc: source.src,
      backgroundSrc: imgsrc,
      assetId: null,
      assetUrl: null,
      fgId: null,
      bgId: null,
    };
    if (params.cachedOutputUrl && this.renderCachedExperience) {
      await delay(500);
      operationItem.assetUrl = params.cachedOutputUrl;
    } else {
      const fgId = this.operations[this.operations.length - 1].assetId;
      const bgId = await this.uploadAsset(imgsrc);
      const changeBgOptions = {
        body: `{
                "assets": [{ "id": "${fgId}" },{ "id": "${bgId}" }],
                "metadata": {
                  "foregroundImageId": "${fgId}",
                  "backgroundImageId": "${bgId}"
                }
              }`,
      };
      const resJson = await this.serviceHandler.postCallToService(
        this.psApiConfig.psEndPoint[opType],
        changeBgOptions,
        {
          errorToastEl: this.errorToastEl,
          errorType: '.icon-error-request',
        },
      );
      const changeBgId = resJson.assetId;
      operationItem.assetId = changeBgId;
      operationItem.fgId = fgId;
      operationItem.bgId = bgId;
      operationItem.assetUrl = resJson.outputUrl;
    }
    target.src = operationItem.assetUrl;
    await loadImg(target);
    this.operations.push(operationItem);
  }

  getFilterAttrValue(currFilter, filterName, value) {
    if (!currFilter) return value;
    const filterVals = currFilter.split(' ');
    let hasFilter = false;
    filterVals.forEach((f, i) => {
      if (f.match(filterName)) {
        hasFilter = true;
        filterVals[i] = value;
      }
    });
    if (!hasFilter) filterVals.push(value);
    return filterVals.join(' ');
  }

  changeAdjustments(value, params) {
    const { filterType, target } = params;
    const operationItem = {
      operationType: 'imageAdjustment',
      adjustmentType: filterType,
      filterValue: params,
    };
    const currFilter = target.style.filter;
    switch (filterType) {
      case 'hue':
        target.style.filter = this.getFilterAttrValue(currFilter, 'hue-rotate', `hue-rotate(${value}deg)`);
        break;
      case 'saturation':
        target.style.filter = this.getFilterAttrValue(currFilter, 'saturate', `saturate(${value}%)`);
        break;
      default:
        break;
    }
    this.operations.push(operationItem);
  }

  async continueInApp() {
    const cOpts = {
      targetProduct: this.workflowCfg.productName,
      payload: {
        locale: getLocale(),
        operations: [],
      },
    };
    this.operations.forEach((op, i) => {
      if (!cOpts.assetId && !cOpts.href) {
        if (op.sourceAssetUrl) cOpts.href = op.sourceAssetUrl;
        else if (op.sourceAssetId) cOpts.assetId = op.sourceAssetId;
      }
      const idx = cOpts.payload.operations.length;
      if (idx > 0 && cOpts.payload.operations[idx - 1] == op.operationType) cOpts.pop();
      cOpts.payload.operations.push({ name: op.operationType });
      if (op.assetId) {
        cOpts.payload.finalAssetId = op.assetId;
        if (op.operationType == 'changeBackground') cOpts.payload.operations[idx].assetIds = [op.assetId];
      } else if (op.assetUrl) {
        cOpts.payload.finalAssetUrl = op.assetUrl;
        if (op.operationType == 'changeBackground') cOpts.payload.operations[idx].hrefs = [op.assetUrl];
      }
      if (op.operationType == 'imageAdjustment' && op.adjustmentType && op.filterValue) {
        cOpts.payload.operations[idx][op.adjustmentType] = parseInt(
          op.filterValue.sliderElem.value,
          10,
        );
      }
    });
    const { url } = await this.serviceHandler.postCallToService(
      this.psApiConfig.connectorApiEndPoint,
      { body: JSON.stringify(cOpts) },
      {
        errorToastEl: this.errorToastEl,
        errorType: '.icon-error-request',
      },
    );
    window.location.href = url;
  }

  createSpectrumProgress() {
    const pdom = `<div class="spectrum-ProgressCircle-track"></div>
    <div class="spectrum-ProgressCircle-fills">
      <div class="spectrum-ProgressCircle-fillMask1">
        <div class="spectrum-ProgressCircle-fillSubMask1">
          <div class="spectrum-ProgressCircle-fill"></div>
        </div>
      </div>
      <div class="spectrum-ProgressCircle-fillMask2">
        <div class="spectrum-ProgressCircle-fillSubMask2">
          <div class="spectrum-ProgressCircle-fill"></div>
        </div>
      </div>
    </div>`;
    const loader = createTag(
      'div',
      { class: 'progress-circle' },
      createTag('div', { class: 'spectrum-ProgressCircle spectrum-ProgressCircle--indeterminate' }, pdom),
    );
    this.canvasArea.append(loader);
    return loader;
  }

  async createErrorToast() {
    const alertText = createTag('div', { class: 'alert-text' }, createTag('p', {}, 'Alert Text'));
    const alertIcon = createTag(
      'div',
      { class: 'alert-icon' },
      '<svg><use xlink:href="#unity-alert-icon"></use></svg>',
    );
    alertIcon.append(alertText);
    const alertClose = createTag(
      'a',
      { class: 'alert-close', href: '#' },
      '<svg><use xlink:href="#unity-close-icon"></use></svg>',
    );
    alertClose.append(createTag('span', { class: 'alert-close-text' }, 'Close error toast'));
    const alertContent = createTag('div', { class: 'alert-content' });
    alertContent.append(alertIcon, alertClose);
    const errholder = createTag('div', { class: 'alert-holder' }, createTag('div', { class: 'alert-toast' }, alertContent));
    alertClose.addEventListener('click', (e) => {
      e.preventDefault();
      e.target.closest('.alert-holder').classList.remove('show');
    });
    const { decorateDefaultLinkAnalytics } = await import(`${getLibs()}/martech/attributes.js`);
    decorateDefaultLinkAnalytics(errholder);
    this.canvasArea.append(errholder);
    return errholder;
  }
}
