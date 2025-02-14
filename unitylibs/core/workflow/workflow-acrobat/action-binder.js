/* eslint-disable max-classes-per-file */
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

class ServiceHandler {
  getGuestAccessToken() {
    try {
      return window.adobeIMS.getAccessToken();
    } catch (e) {
      return '';
    }
  }

  async getRefreshToken() {
    try {
      const { tokenInfo } = await window.adobeIMS.refreshToken();
      return `Bearer ${tokenInfo.token}`;
    } catch (e) {
      return '';
    }
  }

  async getHeaders() {
    let token = '';
    let refresh = false;
    const guestAccessToken = this.getGuestAccessToken();
    if (!guestAccessToken || guestAccessToken.expire.valueOf() <= Date.now() + (5 * 60 * 1000)) {
      token = await this.getRefreshToken();
      refresh = true;
    } else {
      token = `Bearer ${guestAccessToken.token}`;
    }

    if (!token) {
      const error = new Error();
      error.status = 401;
      error.message = `Access Token is null. Refresh token call was executed: ${refresh}`
      throw error;
    }

    return {
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
        'x-api-key': unityConfig.apiKey,
      },
    };
  }

  async fetchFromService(url, options) {
    try {
      const response = await fetch(url, options);
      const error = new Error();
      const contentLength = response.headers.get('Content-Length');
      if (response.status !== 200) {
        if (contentLength !== '0') {
          const resJson = await response.json();
          ['quotaexceeded', 'notentitled'].forEach((errorMessage) => {
            if (resJson.reason?.includes(errorMessage)) error.message = errorMessage;
          });
        }
        error.status = response.status;
        throw error;
      }
      if (contentLength === '0') return {};
      return response.json();
    } catch (error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        error.status = 504;
      }
      throw error;
    }
  }

  async postCallToService(api, options) {
    const headers = await this.getHeaders();
    const postOpts = {
      method: 'POST',
      ...headers,
      ...options,
    };
    return this.fetchFromService(api, postOpts);
  }

  async getCallToService(api, params) {
    const headers = await this.getHeaders();
    const getOpts = {
      method: 'GET',
      ...headers,
    };
    const queryString = new URLSearchParams(params).toString();
    const url = `${api}?${queryString}`;
    return this.fetchFromService(url, getOpts);
  }
}

export default class ActionBinder {
  static SINGLE_FILE_ERROR_MESSAGES = {
    UNSUPPORTED_TYPE: 'verb_upload_error_unsupported_type',
    EMPTY_FILE: 'verb_upload_error_empty_file',
    FILE_TOO_LARGE: 'verb_upload_error_file_too_large',
  };

  static MULTI_FILE_ERROR_MESSAGES = {
    UNSUPPORTED_TYPE: 'verb_upload_error_unsupported_type_multi',
    EMPTY_FILE: 'verb_upload_error_empty_file_multi',
    FILE_TOO_LARGE: 'verb_upload_error_file_too_large_multi',
  };

  constructor(unityEl, workflowCfg, wfblock, canvasArea, actionMap = {}, limits = {}) {
    this.unityEl = unityEl;
    this.workflowCfg = workflowCfg;
    this.block = wfblock;
    this.actionMap = actionMap;
    this.limits = limits;
    this.canvasArea = canvasArea;
    this.operations = [];
    this.acrobatApiConfig = this.getAcrobatApiConfig();
    this.serviceHandler = new ServiceHandler();
    this.uploadHandler = null;
    this.splashScreenEl = null;
    this.promiseStack = [];
    this.redirectUrl = '';
    this.redirectWithoutUpload = false;
    this.LOADER_DELAY = 800;
    this.LOADER_INCREMENT = 30;
    this.LOADER_LIMIT = 95;
    this.MULTI_FILE = false;
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
    const parr = [];
    if (this.workflowCfg.targetCfg.showSplashScreen) {
      parr.push(
        `${getUnityLibs()}/core/styles/splash-screen.css`,
        `${this.splashFragmentLink}.plain.html`,
      );
    }
    await priorityLoad(parr);
  }

  getAccountType() {
    return window.adobeIMS?.getAccountType?.() || '';
  }

  async dispatchErrorToast(code, status, info = null, lanaOnly = false, showError = true) {
    if (showError) {
      const errorMessage = code in this.workflowCfg.errors
        ? this.workflowCfg.errors[code]
        : await (async () => {
          const getError = (await import('../../../scripts/errors.js')).default;
          return getError(this.workflowCfg.enabledFeatures[0], code);
        })();
      const message = lanaOnly ? '' : errorMessage || 'Unable to process the request';
      this.block.dispatchEvent(new CustomEvent(
        unityConfig.errorToastEvent,
        {
          detail: {
            code,
            message: `${message}`,
            status,
            info,
            accountType: this.getAccountType(),
          },
        },
      ));
    }
  }

  async dispatchAnalyticsEvent(eventName, data = null) {
    const detail = { event: eventName, ...(data && { data }) };
    this.block.dispatchEvent(new CustomEvent(unityConfig.trackAnalyticsEvent, { detail }));
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

  isMixedFileTypes(files) {
    const fileTypes = new Set(files.map((file) => file.type));
    return fileTypes.size > 1 ? 'mixed' : files[0].type;
  }

  async validateFiles(files) {
    const errorMessages = files.length === 1
      ? ActionBinder.SINGLE_FILE_ERROR_MESSAGES
      : ActionBinder.MULTI_FILE_ERROR_MESSAGES;
    let allFilesFailed = true;
    const errorTypes = new Set();
    for (const file of files) {
      let fail = false;
      if (!this.limits.allowedFileTypes.includes(file.type)) {
        if (this.MULTI_FILE) await this.dispatchErrorToast(errorMessages.UNSUPPORTED_TYPE, null, `File type: ${file.type}`, true);
        else await this.dispatchErrorToast(errorMessages.UNSUPPORTED_TYPE);
        fail = true;
        errorTypes.add('UNSUPPORTED_TYPE');
      }
      if (!file.size) {
        if (this.MULTI_FILE) await this.dispatchErrorToast(errorMessages.EMPTY_FILE, null, 'Empty file', true);
        else await this.dispatchErrorToast(errorMessages.EMPTY_FILE);
        fail = true;
        errorTypes.add('EMPTY_FILE');
      }
      if (file.size > this.limits.maxFileSize) {
        if (this.MULTI_FILE) await this.dispatchErrorToast(errorMessages.FILE_TOO_LARGE, null, `File too large: ${file.size}`, true);
        else await this.dispatchErrorToast(errorMessages.FILE_TOO_LARGE);
        fail = true;
        errorTypes.add('FILE_TOO_LARGE');
      }
      if (!fail) allFilesFailed = false;
    }
    if (allFilesFailed) {
      if (this.MULTI_FILE) {
        if (errorTypes.size === 1) {
          const errorType = Array.from(errorTypes)[0];
          await this.dispatchErrorToast(errorMessages[errorType]);
        } else {
          await this.dispatchErrorToast('verb_upload_error_generic');
        }
      }
      return false;
    }
    return true;
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
        await this.dispatchErrorToast('verb_upload_error_generic', 500, 'Exception thrown when retrieving redirect URL.', false, e.showError);
      });
  }

  async handleRedirect(cOpts) {
    await this.getRedirectUrl(cOpts);
    if (!this.redirectUrl) return false;
    this.dispatchAnalyticsEvent('redirectUrl', this.redirectUrl);
    return true;
  }

  async handleSingleFileUpload(file, eventName) {
    const fileData = { type: file.type, size: file.size, count: 1 };
    this.dispatchAnalyticsEvent(eventName, fileData);
    if (!await this.validateFiles([file])) return;
    const isGuest = this.getAccountType() === 'guest';
    const { default: UploadHandler } = await import(`${getUnityLibs()}/core/workflow/${this.workflowCfg.name}/upload-handler.js`);
    this.uploadHandler = new UploadHandler(this, this.serviceHandler);
    if (isGuest) await this.uploadHandler.singleFileGuestUpload(file);
    else await this.uploadHandler.singleFileUserUpload(file);
  }

  async handleMultiFileUpload(files, totalFileSize, eventName) {
    this.MULTI_FILE = true;
    this.LOADER_LIMIT = 65;
    const isMixedFileTypes = this.isMixedFileTypes(files);
    const filesData = { type: isMixedFileTypes, size: totalFileSize, count: files.length };
    this.dispatchAnalyticsEvent(eventName, filesData);
    this.dispatchAnalyticsEvent('multifile', filesData);
    if (!await this.validateFiles(files)) return;
    const isGuest = this.getAccountType() === 'guest';
    const { default: UploadHandler } = await import(`${getUnityLibs()}/core/workflow/${this.workflowCfg.name}/upload-handler.js`);
    this.uploadHandler = new UploadHandler(this, this.serviceHandler);
    if (isGuest) await this.uploadHandler.multiFileGuestUpload();
    else await this.uploadHandler.multiFileUserUpload(files, filesData);
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

  async fillsign(files, eventName) {
    if (!files || files.length > this.limits.maxNumFiles) {
      await this.dispatchErrorToast('verb_upload_error_only_accept_one_file');
      return;
    }
    const file = files[0];
    if (!file) return;
    await this.handleSingleFileUpload(file, eventName);
  }

  async compress(files, totalFileSize, eventName) {
    if (!files) {
      await this.dispatchErrorToast('verb_upload_error_only_accept_one_file');
      return;
    }
    const isSingleFile = files.length === 1;
    if (isSingleFile) await this.handleSingleFileUpload(files[0], eventName);
    else await this.handleMultiFileUpload(files, totalFileSize, eventName);
  }

  delay(ms) {
    return new Promise((res) => { setTimeout(() => { res(); }, ms); });
  }

  checkCookie = () => {
    const cookies = document.cookie.split(';').map((item) => item.trim());
    const target = /^UTS_Uploaded=/;
    return cookies.some((item) => target.test(item));
  };

  waitForCookie = (timeout) => new Promise((resolve) => {
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

  async continueInApp() {
    if (!this.redirectUrl || !(this.operations.length || this.redirectWithoutUpload)) return;
    this.LOADER_LIMIT = 100;
    this.updateProgressBar(this.splashScreenEl, 100);
    try {
      await this.waitForCookie(2000);
      if (!this.checkCookie()) {
        await this.dispatchErrorToast('verb_cookie_not_set', 200, 'Not all cookies found, redirecting anyway', true);
      }
      await this.delay(500);
      if (this.multiFileFailure && this.redirectUrl.includes('#folder')) {
        window.location.href = `${this.redirectUrl}&feedback=${this.multiFileFailure}`;
      } else window.location.href = this.redirectUrl;
    } catch (e) {
      await this.showSplashScreen();
      await this.dispatchErrorToast('verb_upload_error_generic', 500, 'Exception thrown when redirecting to product.', false, e.showError);
    }
  }

  async cancelAcrobatOperation() {
    await this.showSplashScreen();
    this.redirectUrl = '';
    this.dispatchAnalyticsEvent('cancel');
    const e = new Error();
    e.message = 'Operation termination requested.';
    e.showError = false;
    const cancelPromise = Promise.reject(e);
    this.promiseStack.unshift(cancelPromise);
  }

  async acrobatActionMaps(values, files, totalFileSize, eventName) {
    await this.handlePreloads();
    for (const value of values) {
      switch (true) {
        case value.actionType === 'fillsign':
          this.promiseStack = [];
          await this.fillsign(files, eventName);
          break;
        case value.actionType === 'compress':
          this.promiseStack = [];
          await this.compress(files, totalFileSize, eventName);
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

  extractFiles(e) {
    const files = [];
    let totalFileSize = 0;
    if (e.dataTransfer?.items) {
      [...e.dataTransfer.items].forEach((item) => {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          files.push(file);
          totalFileSize += file.size;
        }
      });
    } else if (e.target?.files) {
      [...e.target.files].forEach((file) => {
        files.push(file);
        totalFileSize += file.size;
      });
    }
    return { files, totalFileSize };
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
    const splashDiv = document.querySelector(
      this.workflowCfg.targetCfg.splashScreenConfig.splashScreenParent,
    );
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
        eventListeners.forEach((event) => document.removeEventListener(event, handler));
        eventListeners = null;
      }
    };
    eventListeners.forEach((event) => document.addEventListener(
      event,
      interactionHandler,
      { once: true },
    ));
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
            const { files, totalFileSize } = this.extractFiles(e);
            await this.acrobatActionMaps(values, files, totalFileSize, 'drop');
          });
          break;
        case el.nodeName === 'INPUT':
          el.addEventListener('change', async (e) => {
            const { files, totalFileSize } = this.extractFiles(e);
            await this.acrobatActionMaps(values, files, totalFileSize, 'change');
            e.target.value = '';
          });
          break;
        default:
          break;
      }
    }
    if (b === this.block) await this.delayedSplashLoader();
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

  async showSplashScreen(displayOn = false) {
    if (!this.splashScreenEl && !this.workflowCfg.targetCfg.showSplashScreen) return;
    if (this.splashScreenEl.classList.contains('decorate')) {
      if (this.splashScreenEl.querySelector('.icon-progress-bar')) await this.handleSplashProgressBar();
      if (this.splashScreenEl.querySelector('a.con-button[href*="#_cancel"]')) this.handleOperationCancel();
      this.splashScreenEl.classList.remove('decorate');
    }
    this.splashVisibilityController(displayOn);
  }
}
