/* eslint-disable no-await-in-loop */
/* eslint-disable class-methods-use-this */
/* eslint-disable no-restricted-syntax */

import {
  unityConfig,
  getUnityLibs,
  createTag,
  localizeLink,
  priorityLoad,
  loadArea,
  loadImg,
} from '../../../scripts/utils.js';

export default class ActionBinder {
  constructor(unityEl, workflowCfg, wfblock, canvasArea, actionMap = {}, limits = {}) {
    this.unityEl = unityEl;
    this.workflowCfg = workflowCfg;
    this.block = wfblock;
    this.actionMap = actionMap;
    this.limits = limits;
    this.canvasArea = canvasArea;
    this.operations = [];
    this.acrobatApiConfig = this.getAcrobatApiConfig();
    this.serviceHandler = null;
    this.splashScreenEl = null;
    this.promiseStack = [];
    this.redirectUrl = '';
    this.redirectWithoutUpload = false;
    this.LOADER_DELAY = 800;
    this.LOADER_INCREMENT = 30;
    this.LOADER_LIMIT = 95;
  }

  getAcrobatApiConfig() {
    unityConfig.acrobatEndpoint = {
      createAsset: `${unityConfig.apiEndPoint}/asset`,
      finalizeAsset: `${unityConfig.apiEndPoint}/asset/finalize`,
      getMetadata: `${unityConfig.apiEndPoint}/asset/metadata`,
    };
    return unityConfig;
  }

  async handlePreloads() {
    const parr = [`${getUnityLibs()}/core/workflow/${this.workflowCfg.name}/service-handler.js`];
    if (this.workflowCfg.targetCfg.showSplashScreen) {
      parr.push(
        `${getUnityLibs()}/core/styles/splash-screen.css`,
        `${this.splashFragmentLink}.plain.html`,
      );
    }
    await priorityLoad(parr);
  }

  updateProgressBar(layer, percentage) {
    const p = Math.min(percentage, this.LOADER_LIMIT);
    const spb = layer.querySelector('.spectrum-ProgressBar');
    spb?.setAttribute('value', p);
    spb?.setAttribute('aria-valuenow', p);
    layer.querySelector('.spectrum-ProgressBar-percentage').innerHTML = `${p}%`;
    layer.querySelector('.spectrum-ProgressBar-fill').style.width = `${p}%`;
  }

  createProgressBar() {
    const pdom = `<div class="spectrum-ProgressBar spectrum-ProgressBar--sizeM spectrum-ProgressBar--sideLabel" value="0" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
    <div class="spectrum-FieldLabel spectrum-FieldLabel--sizeM spectrum-ProgressBar-label"></div>
    <div class="spectrum-FieldLabel spectrum-FieldLabel--sizeM spectrum-ProgressBar-percentage">0%</div>
    <div class="spectrum-ProgressBar-track">
      <div class="spectrum-ProgressBar-fill" style="width: 0%;"></div>
    </div>
    </div>`;
    return createTag('div', { class: 'progress-holder' }, pdom);
  }

  async acrobatActionMaps(values, files, eventName) {
    await this.handlePreloads();
    const { default: ServiceHandler } = await import(`${getUnityLibs()}/core/workflow/${this.workflowCfg.name}/service-handler.js`);
    this.serviceHandler = new ServiceHandler(
      this.workflowCfg.targetCfg.renderWidget,
      this.canvasArea,
    );
    for (const value of values) {
      switch (true) {
        case value.actionType === 'fillsign':
          this.promiseStack = [];
          await this.fillsign(files, eventName);
          break;
        case value.actionType === 'compress':
          this.promiseStack = [];
          await this.compress(files, eventName);
          break;    
        case value.actionType === 'continueInApp':
          await this.continueInApp();
          break;
        case value.actionType === 'interrupt':
          await this.cancelAcrobatOperation();
          break;
        default:
          break;
      }
    }
  }

  async initActionListeners(b = this.block, actMap = this.actionMap) {
    for (const [key, values] of Object.entries(actMap)) {
      const el = b.querySelector(key);
      if (!el) return;
      switch (true) {
        case el.nodeName === 'A':
          el.addEventListener('click', async (e) => {
            e.preventDefault();
            await this.acrobatActionMaps(values);
          });
          break;
        case el.nodeName === 'DIV':
          el.addEventListener('drop', async (e) => {
            e.preventDefault();
            const files = this.extractFiles(e);
            await this.acrobatActionMaps(values, files, 'drop');
          });
          break;
        case el.nodeName === 'INPUT':
          el.addEventListener('change', async (e) => {
            const files = this.extractFiles(e);
            await this.acrobatActionMaps(values, files, 'change');
            e.target.value = '';
          });
          break;
        default:
          break;
      }
    }
    //if (b === this.block) this.splashScreenEl = await this.loadSplashFragment();
    if (b === this.block) await this.delayedSplashLoader();
  }

  extractFiles(e) {
    const files = [];
    if (e.dataTransfer?.items) {
      [...e.dataTransfer.items].forEach((item) => {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          files.push(file);
        }
      });
    } else if (e.target?.files) {
      [...e.target.files].forEach((file) => {
        files.push(file);
      });
    }
    return files;
  }

  getAccountType() {
    try {
      return window.adobeIMS.getAccountType();
    } catch (e) {
      return '';
    }
  }

  async dispatchErrorToast(code, status, info = null, showError = true) {
    if (showError) {
      const errorMessage = code in this.workflowCfg.errors
        ? this.workflowCfg.errors[code]
        : await (async () => {
          const getError = (await import('../../../scripts/errors.js')).default;
          return getError(this.workflowCfg.enabledFeatures[0], code);
        })();
      const message = code.includes('cookie_not_set') ? '' : errorMessage || 'Unable to process the request';
      this.block.dispatchEvent(new CustomEvent(
        unityConfig.errorToastEvent,
        {
          detail: {
            code,
            message: `${message}`,
            status,
            info,
            accountType: this.getAccountType(),
          }
        }
      ));
    }
  }

  async fillsign(files, eventName) {
    if (!files || files.length > this.limits.maxNumFiles) {
      await this.dispatchErrorToast('verb_upload_error_only_accept_one_file');
      return;
    }
    const file = files[0];
    if (!file) return;
    await this.singleFileUpload(file, eventName);
  }

  async compress(files, eventName) {
    if (!files) {
      await this.dispatchErrorToast('verb_upload_error_only_accept_one_file');
      return;
    }
    if (files.length === 1) await this.singleFileUpload(files[0], eventName);
    else await this.multiFileUpload(files.length, eventName);
  }

  async getBlobData(file) {
    const objUrl = URL.createObjectURL(file);
    const response = await fetch(objUrl);
    if (!response.ok) {
      const error = new Error();
      error.status = response.status;
      throw error;
    }
    const blob = await response.blob();
    URL.revokeObjectURL(objUrl);
    return blob;
  }

  async uploadFileToUnity(storageUrl, blobData, fileType) {
    const uploadOptions = {
      method: 'PUT',
      headers: { 'Content-Type': fileType },
      body: blobData,
    };
    const response = await fetch(storageUrl, uploadOptions);
    return response;
  }

  async batchUpload(tasks, batchSize) {
    for (let i = 0; i < tasks.length; i += batchSize) {
      const batch = tasks.slice(i, i + batchSize);
      await Promise.all(batch);
    }
  }

  async chunkPdf(assetData, blobData, filetype) {
    const totalChunks = Math.ceil(blobData.size / assetData.blocksize);
    if (assetData.uploadUrls.length !== totalChunks) return;
    const uploadPromises = Array.from({ length: totalChunks }, (_, i) => {
      const start = i * assetData.blocksize;
      const end = Math.min(start + assetData.blocksize, blobData.size);
      const chunk = blobData.slice(start, end);
      const url = assetData.uploadUrls[i];
      return this.uploadFileToUnity(url.href, chunk, filetype);
    });
    await this.batchUpload(
      uploadPromises,
      this.limits?.batchSize || uploadPromises.length,
    );
  }

  checkCookie = () => {
    const cookies = document.cookie.split(';').map((item) => item.trim());
    const target = /^UTS_Uploaded=/;
    return cookies.some((item) => target.test(item));
  };

  waitForCookie = (timeout) => {
    return new Promise((resolve) => {
      const interval = 100;
      let elapsed = 0;
      const intervalId = setInterval(() => {
        if (this.checkCookie() || elapsed >= timeout) {
          clearInterval(intervalId);
          resolve();
        }
        elapsed += interval;
      }, interval);
    });
  };

  async continueInApp() {
    if (!this.redirectUrl || !(this.operations.length || this.redirectWithoutUpload)) return;
    this.LOADER_LIMIT = 100;
    this.updateProgressBar(this.splashScreenEl, 100);
    try {
      await this.waitForCookie(2000);
      this.updateProgressBar(this.splashScreenEl, 100);
      if (!this.checkCookie()) {
        await this.dispatchErrorToast('verb_cookie_not_set', 200, 'Not all cookies found, redirecting anyway', true);
        await new Promise(r => setTimeout(r, 500));
      }
      window.location.href = this.redirectUrl;
    } catch (e) {
      await this.showSplashScreen();
      await this.dispatchErrorToast('verb_upload_error_generic', 500, 'Exception thrown when redirecting to product.', e.showError);
    }
  }

  async cancelAcrobatOperation() {
    await this.showSplashScreen();
    this.redirectUrl = '';
    this.block.dispatchEvent(new CustomEvent(unityConfig.trackAnalyticsEvent, { detail: { event: 'cancel' } }));
    const e = new Error();
    e.message = 'Operation termination requested.';
    e.showError = false;
    const cancelPromise = Promise.reject(e);
    this.promiseStack.unshift(cancelPromise);
  }

  progressBarHandler(s, delay, i, initialize = false) {
    if (!s) return;
    delay = Math.min(delay + 100, 2000);
    i = Math.max(i - 5, 5);
    const progressBar = s.querySelector('.spectrum-ProgressBar');
    if (!initialize && progressBar?.getAttribute('value') >= this.LOADER_LIMIT) return;
    if (initialize) this.updateProgressBar(s, 0);
    setTimeout(() => {
      const v = initialize ? 0 : parseInt(progressBar.getAttribute('value'), 10);
      this.updateProgressBar(s, v + i);
      this.progressBarHandler(s, delay, i);
    }, delay);
  }

  splashVisibilityController(displayOn) {
    if (!displayOn) {
      this.LOADER_LIMIT = 95;
      this.splashScreenEl.parentElement?.classList.remove('hide-splash-overflow');
      this.splashScreenEl.classList.remove('show');
      return;
    }
    this.progressBarHandler(this.splashScreenEl, this.LOADER_DELAY, this.LOADER_INCREMENT, true);
    this.splashScreenEl.classList.add('show');
    this.splashScreenEl.parentElement?.classList.add('hide-splash-overflow');
  }

  async loadSplashFragment() {
    if (!this.workflowCfg.targetCfg.showSplashScreen) return;
    this.splashFragmentLink = localizeLink(`${window.location.origin}${this.workflowCfg.targetCfg.splashScreenConfig.fragmentLink}`);
    const resp = await fetch(`${this.splashFragmentLink}.plain.html`);
    const html = await resp.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const sections = doc.querySelectorAll('body > div');
    const f = createTag('div', { class: 'fragment splash-loader decorate', style: 'display: none' });
    f.append(...sections);
    const splashDiv = document.querySelector(this.workflowCfg.targetCfg.splashScreenConfig.splashScreenParent);
    splashDiv.append(f);
    const img = f.querySelector('img');
    if (img) loadImg(img);
    await loadArea(f);
    this.splashScreenEl = f;
    return f;
  }

  async delayedSplashLoader() {
    let eventListeners = ['mousemove', 'keydown', 'click', 'touchstart'];
    const interactionHandler = async () => {
      await this.loadSplashFragment();
      cleanup(interactionHandler);
    };

    const timeoutHandler = async () => {
      await this.loadSplashFragment();
      cleanup(interactionHandler);
    };

    // Timeout to load after 8 seconds
    let timeoutId = setTimeout(timeoutHandler, 8000);

    const cleanup = (handler) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (eventListeners) {
        eventListeners.forEach((event) =>
          document.removeEventListener(event, handler)
        );
        eventListeners = null;
      }
    }
    eventListeners.forEach((event) =>
      document.addEventListener(event, interactionHandler, { once: true })
    );
  }

  async handleSplashProgressBar() {
    const pb = this.createProgressBar();
    this.splashScreenEl.querySelector('.icon-progress-bar').replaceWith(pb);
    this.progressBarHandler(this.splashScreenEl, this.LOADER_DELAY, this.LOADER_INCREMENT, true);
  }

  handleOperationCancel() {
    const actMap = { 'a.con-button[href*="#_cancel"]': [{ actionType: 'interrupt' }] };
    this.initActionListeners(this.splashScreenEl, actMap);
  }

  async showSplashScreen(displayOn = false) {
    if (!this.splashScreenEl && !this.workflowCfg.targetCfg.showSplashScreen) return;
    if (this.splashScreenEl.classList.contains('decorate')) {
      if (this.splashScreenEl.querySelector('.icon-progress-bar')) await this.handleSplashProgressBar();
      if (this.splashScreenEl.querySelector('a.con-button[href*="#_cancel"]')) this.handleOperationCancel();
      this.splashScreenEl.classList.remove('decorate');
    }
    this.splashVisibilityController(displayOn);
  }

  async verifyContent(assetData) {
    try {
      const finalAssetData = {
        surfaceId: unityConfig.surfaceId,
        targetProduct: this.workflowCfg.productName,
        assetId: assetData.id,
      };
      const finalizeJson = await this.serviceHandler.postCallToService(
        this.acrobatApiConfig.acrobatEndpoint.finalizeAsset,
        { body: JSON.stringify(finalAssetData), signal: AbortSignal.timeout?.(80000) },
      );
      if (!finalizeJson || Object.keys(finalizeJson).length !== 0) {
        await this.showSplashScreen();
        await this.dispatchErrorToast('verb_upload_error_generic', 500, `Unexpected response from finalize call: ${finalizeJson}`, e.showError);
        this.operations = [];
        return false;
      }
    } catch (e) {
      await this.showSplashScreen();
      await this.dispatchErrorToast('verb_upload_error_generic', 500, 'Exception thrown when verifying content.', e.showError);
      this.operations = [];
      return false;
    }
    return true;
  }

  async isMaxPageLimitExceeded(assetData) {
    try {
      const intervalDuration = 500;
      const totalDuration = 5000;
      let metadata = {};
      let intervalId;
      let requestInProgress = false;
      let metadataExists = false;
      return new Promise((resolve) => {
        const handleMetadata = async () => {
          if (metadata.numPages > this.limits.maxNumPages) {
            await this.showSplashScreen();
            await this.dispatchErrorToast('verb_upload_error_max_page_count');
            resolve(true);
            return;
          }
          resolve(false);
        };
        intervalId = setInterval(async () => {
          if (requestInProgress) return;
          requestInProgress = true;
          metadata = await this.serviceHandler.getCallToService(
            this.acrobatApiConfig.acrobatEndpoint.getMetadata,
            { id: assetData.id },
          );
          requestInProgress = false;
          if (metadata?.numPages !== undefined) {
            clearInterval(intervalId);
            clearTimeout(timeoutId);
            metadataExists = true;
            await handleMetadata();
          }
        }, intervalDuration);
        const timeoutId = setTimeout(async () => {
          clearInterval(intervalId);
          if (!metadataExists) resolve(false);
          else await handleMetadata();
        }, totalDuration);
      });
    } catch (e) {
      await this.showSplashScreen();
      await this.dispatchErrorToast('verb_upload_error_generic', 500, 'Exception thrown when verifying PDF page count.', e.showError);
      this.operations = [];
      return false;
    }
  }

  async handleValidations(assetData) {
    let validated = true;
    for (const limit of Object.keys(this.limits)) {
      switch (limit) {
        case 'maxNumPages':
          const maxPageLimitExceeded = await this.isMaxPageLimitExceeded(assetData);
          if (maxPageLimitExceeded) validated = false;
          break;
        default:
          break;
      }
    }
    if (!validated) this.operations = [];
    return validated;
  }

  async getRedirectUrl(cOpts) {
    this.promiseStack.push(
      this.serviceHandler.postCallToService(
        this.acrobatApiConfig.connectorApiEndPoint,
        { body: JSON.stringify(cOpts) },
      ),
    );
    await Promise.all(this.promiseStack)
      .then(async (resArr) => {
        const response = resArr[resArr.length - 1];
        if (!response?.url) throw new Error('Error connecting to App');
        this.redirectUrl = response.url;
      })
      .catch(async (e) => {
        await this.showSplashScreen();
        await this.dispatchErrorToast('verb_upload_error_generic', 500, 'Exception thrown when retrieving redirect URL.', e.showError);
      });
  }

  isNonPdf(files) {
    return files.some((file) => file.type !== 'application/pdf');
  }

  async singleFileUpload(file, eventName) {
    const accountType = this.getAccountType();
    let cOpts = {};
    const isNonPdf = this.isNonPdf([file]);
    if (!this.limits.allowedFileTypes.includes(file.type)) {
      await this.dispatchErrorToast('verb_upload_error_unsupported_type');
      return;
    }
    if (!file.size) {
      await this.dispatchErrorToast('verb_upload_error_empty_file');
      return;
    }
    if (file.size > this.limits.maxFileSize) {
      await this.dispatchErrorToast('verb_upload_error_file_too_large');
      return;
    }
    const fileData = {
      type: file.type,
      size: file.size,
      count: 1,
    };
    this.block.dispatchEvent(
      new CustomEvent(
        unityConfig.trackAnalyticsEvent,
        { detail: { event: eventName, data: fileData } },
      ),
    );
    let assetData = null;
    try {
      await this.showSplashScreen(true);
      const blobData = await this.getBlobData(file);
      const data = {
        surfaceId: unityConfig.surfaceId,
        targetProduct: this.workflowCfg.productName,
        name: file.name,
        size: file.size,
        format: file.type,
      };
      assetData = await this.serviceHandler.postCallToService(
        this.acrobatApiConfig.acrobatEndpoint.createAsset,
        { body: JSON.stringify(data) },
      );
      if (accountType === 'guest' && isNonPdf) {
        cOpts = {
          targetProduct: this.workflowCfg.productName,
          payload: {
            languageRegion: this.workflowCfg.langRegion,
            languageCode: this.workflowCfg.langCode,
            verb: this.workflowCfg.enabledFeatures[0],
            feedback: 'nonpdf',
          },
        };
        await this.getRedirectUrl(cOpts);
        if (!this.redirectUrl) return;
        this.block.dispatchEvent(new CustomEvent(unityConfig.trackAnalyticsEvent, { detail: { event: 'redirectUrl', data: this.redirectUrl } }));
        this.redirectWithoutUpload = true;
        return;
      }
      cOpts = {
        assetId: assetData.id,
        targetProduct: this.workflowCfg.productName,
        payload: {
          languageRegion: this.workflowCfg.langRegion,
          languageCode: this.workflowCfg.langCode,
          verb: this.workflowCfg.enabledFeatures[0],
          assetMetadata: {
            [assetData.id]: {
              name: file.name,
              size: file.size,
              type: file.type,
            },
          },
          ...(isNonPdf ? { feedback: 'nonpdf' } : {}),
        },
      };
      await this.getRedirectUrl(cOpts);
      if (!this.redirectUrl) return;
      this.block.dispatchEvent(new CustomEvent(unityConfig.trackAnalyticsEvent, { detail: { event: 'redirectUrl', data: this.redirectUrl } }));
      this.block.dispatchEvent(new CustomEvent(unityConfig.trackAnalyticsEvent, { detail: { event: 'uploading', data: assetData } }));
      await this.chunkPdf(assetData, blobData, file.type);
      this.operations.push(assetData.id);
    } catch (e) {
      await this.showSplashScreen();
      this.operations = [];
      switch (e.status) {
        case 409:
          await this.dispatchErrorToast('verb_upload_error_duplicate_asset', e.status, null, e.showError);
          break;
        case 401:
          if (e.message === 'notentitled') await this.dispatchErrorToast('verb_upload_error_no_storage_provision', e.status, null, e.showError);
          else await this.dispatchErrorToast('verb_upload_error_generic', e.status, e.message, e.showError);
          break;
        case 403:
          if (e.message === 'quotaexceeded') await this.dispatchErrorToast('verb_upload_error_max_quota_exceeded', e.status, null, e.showError);
          else await this.dispatchErrorToast('verb_upload_error_no_storage_provision', e.status, null, e.showError);
          break;
        default:
          await this.dispatchErrorToast('verb_upload_error_generic', e.status, null, e.showError);
          break;
      }
      return;
    }
    const verified = await this.verifyContent(assetData);
    if (!verified) return;
    const validated = await this.handleValidations(assetData);
    if (!validated) return;
    this.block.dispatchEvent(new CustomEvent(unityConfig.trackAnalyticsEvent, { detail: { event: 'uploaded' } }));
  }

  async multiFileUpload(fileCount, eventName) {
    this.block.dispatchEvent(
      new CustomEvent(
        unityConfig.trackAnalyticsEvent,
        { detail: { event: eventName } },
      ),
    );
    this.block.dispatchEvent(new CustomEvent(unityConfig.trackAnalyticsEvent, { detail: { event: 'multifile', data: fileCount } }));
    await this.showSplashScreen(true);
    const cOpts = {
      targetProduct: this.workflowCfg.productName,
      payload: {
        languageRegion: this.workflowCfg.langRegion,
        languageCode: this.workflowCfg.langCode,
        verb: this.workflowCfg.enabledFeatures[0],
        feedback: 'multifile',
      },
    };
    await this.getRedirectUrl(cOpts);
    setTimeout(() => {
      this.updateProgressBar(this.splashScreenEl, 95);
      if (!this.redirectUrl) return;
      window.location.href = this.redirectUrl;
    }, 2500);
  }
}
