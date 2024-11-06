/* eslint-disable eqeqeq */
/* eslint-disable no-await-in-loop */
/* eslint-disable class-methods-use-this */
/* eslint-disable no-restricted-syntax */

import {
  unityConfig,
  getUnityLibs,
  loadImg,
  loadStyle,
  createTag,
  loadSvgs,
  getLocale,
} from '../../../scripts/utils.js';

export default class ActionBinder {
  constructor(unityEl, workflowCfg, wfblock, canvasArea, actionMap = {}, limits = {}) {
    this.workflowCfg = workflowCfg;
    this.block = wfblock;
    this.actionMap = actionMap;
    this.canvasArea = canvasArea;
    this.operations = [];
    this.progressCircleEl = null;
    this.errorToastEl = null;
    this.psApiConfig = this.getPsApiConfig();
    this.serviceHandler = null;
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

  async psActionMaps(values, e) {
    const { default: ServiceHandler } = await import(`${getUnityLibs()}/core/workflow/${this.workflowCfg.name}/service-handler.js`);
    this.serviceHandler = new ServiceHandler(
      this.workflowCfg.targetCfg.renderWidget,
      this.canvasArea,
    );
    if (this.workflowCfg.targetCfg.renderWidget) {
      const svgs = this.canvasArea.querySelectorAll('.unity-widget img[src*=".svg"');
      await loadSvgs(svgs);
      if (!this.progressCircleEl) {
        this.progressCircleEl = await this.createSpectrumProgress();
        this.canvasArea.append(this.progressCircleEl);
      }
    }
    for (const value of values) {
      switch (true) {
        case value.actionType == 'hide':
          value.targets.forEach((t) => this.hideElement(t, this.block));
          break;
        case value.actionType == 'setCssStyle':
          value.targets.forEach((t) => { this.styleElement(t, value.propertyName, value.propertyValue) });
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
          this.userImgUpload(value, e);
          break;
        case value.actionType == 'continueInApp':
          this.continueInApp(value, e);
          break;
        case value.actionType == 'refresh':
          value.target.src = value.sourceSrc;
          this.operations = [];
          break;
        default:
          break;
      }
    }
    if (this.workflowCfg.targetCfg.renderWidget && this.operations.length) {
      this.canvasArea.querySelector('.widget-product-icon')?.classList.remove('show');
      [...this.canvasArea.querySelectorAll('.widget-refresh-button')].forEach((w) => w.classList.add('show'));
    }
  }

  initActionListeners() {
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
    try {
      this.serviceHandler.postCallToService(
        this.psApiConfig.psEndPoint.acmpCheck,
        optionsBody,
      );
    }
    catch(e) {
      // Finalize Api call
    }
  }

  async uploadAsset(imgUrl) {
    const resJson = await this.serviceHandler.postCallToService(
      this.psApiConfig.psEndPoint.assetUpload,
      {},
    );
    const { id, href } = resJson;
    const blobData = await this.getImageBlobData(imgUrl);
    const fileType = this.getFileType();
    const assetId = await this.uploadImgToUnity(href, id, blobData, fileType);
    const { origin } = new URL(imgUrl);
    if ((imgUrl.startsWith('blob:')) || (origin != window.location.origin)) this.scanImgForSafety(assetId);
    return assetId;
  }

  userImgUpload(params, e) {
    this.canvasArea.querySelector('img').style.filter = '';
    this.operations = [];
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 400000000) {
      // unityEl.dispatchEvent(new CustomEvent(errorToastEvent, { detail: { msg: eft } }));
      // return;
    }
    const objUrl = URL.createObjectURL(file);
    const { target } = params;
    target.src = objUrl;
  }

  async removeBackground(params) {
    const optype = 'removeBackground';
    let { source, target } = params;
    if (typeof(source) == 'string') source = this.block.querySelector(source);
    if (typeof(target) == 'string') target = this.block.querySelector(target);
    const operationItem = {
      operationType: optype,
      sourceAssetId: null,
      sourceSrc: source.src,
      assetId: null,
      assetUrl: null,
    };
    let assetId = null;
    if (this.operations.length) assetId = this.operations[this.operations - 1].assetId;
    else assetId = await this.uploadAsset(source.src);
    operationItem.sourceAssetId = assetId;
    const removeBgOptions = { body: `{"surfaceId":"Unity","assets":[{"id": "${assetId}"}]}` };
    const resJson = await this.serviceHandler.postCallToService(
      this.psApiConfig.psEndPoint[optype],
      removeBgOptions,
    );
    const opId = resJson.assetId;
    operationItem.assetId = opId;
    operationItem.assetUrl = resJson.outputUrl;
    target.src = resJson.outputUrl;
    await loadImg(target);
    this.operations.push(operationItem);
  }

  async changeBackground(params) {
    const opType = 'changeBackground';
    let { source, target, backgroundSrc} = params;
    if (typeof(source) == 'string') source = this.block.querySelector(source);
    if (typeof(target) == 'string') target = this.block.querySelector(target);
    if (typeof(backgroundSrc) == 'string' && !backgroundSrc.startsWith("http")) backgroundSrc = this.block.querySelector(backgroundSrc);
    const operationItem = {
      operationType: opType,
      sourceSrc: source.src,
      backgroundSrc: backgroundSrc.src,
      assetId: null,
      assetUrl: null,
      fgId: null,
      bgId: null,
    };
    const fgId = this.operations[this.operations.length - 1].assetId;
    const bgId = await this.uploadAsset(backgroundSrc);
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
    );
    const changeBgId = resJson.assetId;
    operationItem.assetId = changeBgId;
    operationItem.assetUrl = resJson.outputUrl;
    operationItem.fgId = fgId;
    operationItem.bgId = bgId;
    target.src = resJson.outputUrl;
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

  continueInApp() {
    const cOpts = {
      assetId: null,
      targetProduct: this.workflowCfg.productName,
      payload: {
        locale: getLocale(),
        finalAssetId: null,
        operations: [],
      },
    };
    this.operations.forEach((op, i) => {
      const idx = cOpts.payload.operations.length;
      if ((i > 0) && (this.operations[i - 1].operationType == op.operationType)) {
        cOpts.payload.operations[idx - 1][op.adjustmentType] = parseInt(op.filterValue.sliderElem.value, 10);
      } else {
        cOpts.payload.operations.push({ name: op.operationType });
        if (op.sourceAssetId && !cOpts.assetId) cOpts.assetId = op.sourceAssetId;
        if (op.assetId) cOpts.payload.finalAssetId = op.assetId;
        if (op.operationType == 'changeBackground') cOpts.payload.operations[idx].assetIds = [op.assetId];
        if (op.adjustmentType && op.filterValue) {
          cOpts.payload.operations[idx][op.adjustmentType] = parseInt(op.filterValue.sliderElem.value, 10);
        }
      }
    });
    this.serviceHandler.postCallToService(
      this.psApiConfig.connectorApiEndPoint,
      { body: JSON.stringify(cOpts) },
    );
  }

  async createSpectrumProgress() {
    await new Promise((resolve) => {
      loadStyle(`${getUnityLibs()}/core/features/progress-circle/progress-circle.css`, resolve);
    });
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
    return loader;
  }
}
