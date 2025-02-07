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

  static UPLOAD_LIMITS = {
    HIGH_END: { files: 3, chunks: 10 },
    MID_RANGE: { files: 3, chunks: 10 },
    LOW_END: { files: 2, chunks: 6 },
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
    this.serviceHandler = null;
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
    const parr = [`${getUnityLibs()}/core/workflow/${this.workflowCfg.name}/service-handler.js`];
    if (this.workflowCfg.targetCfg.showSplashScreen) {
      parr.push(
        `${getUnityLibs()}/core/styles/splash-screen.css`,
        `${this.splashFragmentLink}.plain.html`,
      );
    }
    await priorityLoad(parr);
  }

  getAccountType() {
    try {
      return window.adobeIMS.getAccountType();
    } catch (e) {
      return '';
    }
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
    await this.singleFileUpload(file, eventName);
  }

  async compress(files, totalFileSize, eventName) {
    if (!files) {
      await this.dispatchErrorToast('verb_upload_error_only_accept_one_file');
      return;
    }
    if (files.length === 1) await this.singleFileUpload(files[0], eventName);
    else await this.multiFileUpload(files, totalFileSize, eventName);
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
      this.updateProgressBar(this.splashScreenEl, 100);
      if (!this.checkCookie()) {
        await this.dispatchErrorToast('verb_cookie_not_set', 200, 'Not all cookies found, redirecting anyway', true);
        await new Promise(r => setTimeout(r, 500));
      }
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
    this.block.dispatchEvent(new CustomEvent(unityConfig.trackAnalyticsEvent, { detail: { event: 'cancel' } }));
    const e = new Error();
    e.message = 'Operation termination requested.';
    e.showError = false;
    const cancelPromise = Promise.reject(e);
    this.promiseStack.unshift(cancelPromise);
  }

  async acrobatActionMaps(values, files, totalFileSize, eventName) {
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

  isNonPdf(files) {
    return files.some((file) => file.type !== 'application/pdf');
  }

  isMixedFileTypes(files) {
    const firstFileType = files[0].type;
    for (let i = 1; i < files.length; i += 1) {
      if (files[i].type !== firstFileType) {
        return 'mixed';
      }
    }
    return firstFileType;
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

  async createAsset(file, multifile = false, workflowId = null) {
    let assetData = null;
    const data = {
      surfaceId: unityConfig.surfaceId,
      targetProduct: this.workflowCfg.productName,
      name: file.name,
      size: file.size,
      format: file.type,
      ...(multifile && { multifile }),
      ...(workflowId && { workflowId }),
    };
    assetData = await this.serviceHandler.postCallToService(
      this.acrobatApiConfig.acrobatEndpoint.createAsset,
      { body: JSON.stringify(data) },
    );
    return assetData;
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
    if (!response.ok) throw new Error(`Failed to upload: ${response.status}`);
    return response;
  }

  getDeviceType() {
    const numCores = navigator.hardwareConcurrency || null;
    if (!numCores) return 'MID_RANGE';
    if (numCores > 6) return 'HIGH_END';
    if (numCores <= 3) return 'LOW_END';
    return 'MID_RANGE';
  }

  async executeInBatches(items, batchSize, processFn) {
    const executing = new Set();
    for (const item of items) {
      const p = processFn(item).then(() => executing.delete(p)).catch(() => {
        executing.delete(p);
      });
      executing.add(p);
      if (executing.size >= batchSize) {
        await Promise.race(executing);
      }
    }
    await Promise.race(executing);
  }

  async batchUpload(tasks, batchSize) {
    await this.executeInBatches(tasks, batchSize, async (task) => {
      await task();
    });
  }

  async chunkPdf(assetDataArray, blobDataArray, filetypeArray, batchSize) {
    const uploadTasks = [];
    const failedFiles = [];
    assetDataArray.forEach((assetData, fileIndex) => {
      const blobData = blobDataArray[fileIndex];
      const fileType = filetypeArray[fileIndex];
      const totalChunks = Math.ceil(blobData.size / assetData.blocksize);
      if (assetData.uploadUrls.length !== totalChunks) return;
      let fileUploadFailed = false;
      const chunkTasks = Array.from({ length: totalChunks }, (_, i) => {
        const start = i * assetData.blocksize;
        const end = Math.min(start + assetData.blocksize, blobData.size);
        const chunk = blobData.slice(start, end);
        const url = assetData.uploadUrls[i];
        return () => {
          if (fileUploadFailed) return Promise.resolve();
          return this.uploadFileToUnity(url.href, chunk, fileType).catch(async () => {
            await this.dispatchErrorToast('verb_upload_error_generic', 500, `Error uploading chunk ${i + 1}/${totalChunks} of file ${fileIndex + 1}/${assetDataArray.length}: ${assetData.id}`, true);
            failedFiles.push(fileIndex);
            fileUploadFailed = true;
          });
        };
      });
      uploadTasks.push(...chunkTasks);
    });
    await this.batchUpload(uploadTasks, batchSize);
    return failedFiles;
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
        if (this.MULTI_FILE) return false;
        await this.showSplashScreen();
        await this.dispatchErrorToast('verb_upload_error_generic', 500, `Unexpected response from finalize call: ${finalizeJson}`);
        this.operations = [];
        return false;
      }
    } catch (e) {
      if (this.MULTI_FILE) return false;
      await this.showSplashScreen();
      await this.dispatchErrorToast('verb_upload_error_generic', 500, 'Exception thrown when verifying content.', false, e.showError);
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
      await this.dispatchErrorToast('verb_upload_error_generic', 500, 'Exception thrown when verifying PDF page count.', false, e.showError);
      this.operations = [];
      return false;
    }
  }

  async handleValidations(assetData) {
    let validated = true;
    for (const limit of Object.keys(this.limits)) {
      switch (limit) {
        case 'maxNumPages': {
          const maxPageLimitExceeded = await this.isMaxPageLimitExceeded(assetData);
          if (maxPageLimitExceeded) validated = false;
          break;
        }
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
        await this.dispatchErrorToast('verb_upload_error_generic', 500, 'Exception thrown when retrieving redirect URL.', false, e.showError);
      });
  }

  async handleRedirect(cOpts) {
    await this.getRedirectUrl(cOpts);
    if (!this.redirectUrl) return false;
    this.block.dispatchEvent(new CustomEvent(unityConfig.trackAnalyticsEvent, { detail: { event: 'redirectUrl', data: this.redirectUrl } }));
    return true;
  }

  async dispatchGenericError(info = null, showError = true) {
    this.operations = [];
    await this.showSplashScreen();
    await this.dispatchErrorToast('verb_upload_error_generic', 500, info, false, showError);
  }

  getConcurrentLimits() {
    const deviceType = this.getDeviceType();
    if (!this.MULTI_FILE) {
      return { maxConcurrentChunks: ActionBinder.UPLOAD_LIMITS[deviceType].chunks };
    }
    return {
      maxConcurrentFiles: ActionBinder.UPLOAD_LIMITS[deviceType].files,
      maxConcurrentChunks: ActionBinder.UPLOAD_LIMITS[deviceType].chunks,
    };
  }

  async singleFileUpload(file, eventName) {
    const accountType = this.getAccountType();
    const { maxConcurrentChunks } = this.getConcurrentLimits();
    let cOpts = {};
    const isNonPdf = this.isNonPdf([file]);
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
    if (!this.validateFiles([file])) return;
    try {
      await this.showSplashScreen(true);
      const [blobData, assetData] = await Promise.all([
        this.getBlobData(file),
        this.createAsset(file),
      ]);
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
        const redirectSuccess = await this.handleRedirect(cOpts);
        if (!redirectSuccess) return;
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
      const redirectSuccess = await this.handleRedirect(cOpts);
      if (!redirectSuccess) return;
      this.block.dispatchEvent(new CustomEvent(unityConfig.trackAnalyticsEvent, { detail: { event: 'uploading', data: assetData } }));
      const uploadResult = await this.chunkPdf(
        [assetData],
        [blobData],
        [file.type],
        maxConcurrentChunks,
      );
      if (uploadResult.length === 1) {
        await this.dispatchGenericError('Error uploading file chunks.');
        return;
      }
      this.operations.push(assetData.id);
      const verified = await this.verifyContent(assetData);
      if (!verified) return;
      const validated = await this.handleValidations(assetData);
      if (!validated) return;
      this.block.dispatchEvent(new CustomEvent(unityConfig.trackAnalyticsEvent, { detail: { event: 'uploaded' } }));
    } catch (e) {
      await this.showSplashScreen();
      this.operations = [];
      switch (e.status) {
        case 409:
          await this.dispatchErrorToast('verb_upload_error_duplicate_asset', e.status, null, false, e.showError);
          break;
        case 401:
          if (e.message === 'notentitled') await this.dispatchErrorToast('verb_upload_error_no_storage_provision', e.status, null, false, e.showError);
          else await this.dispatchErrorToast('verb_upload_error_generic', e.status, e.message, false, e.showError);
          break;
        case 403:
          if (e.message === 'quotaexceeded') await this.dispatchErrorToast('verb_upload_error_max_quota_exceeded', e.status, null, false, e.showError);
          else await this.dispatchErrorToast('verb_upload_error_no_storage_provision', e.status, null, false, e.showError);
          break;
        default:
          await this.dispatchErrorToast('verb_upload_error_generic', e.status, null, false, e.showError);
          break;
      }
    }
  }

  async multiFileUpload(files, totalFileSize, eventName) {
    this.MULTI_FILE = true;
    this.LOADER_LIMIT = 50;
    this.LOADER_DELAY = 800;
    this.LOADER_INCREMENT = 60;
    const isMixedFileTypes = this.isMixedFileTypes(files);
    const filesData = {
      type: isMixedFileTypes,
      size: totalFileSize,
      count: files.length,
    };
    this.block.dispatchEvent(
      new CustomEvent(
        unityConfig.trackAnalyticsEvent,
        { detail: { event: eventName, data: filesData } },
      ),
    );
    this.block.dispatchEvent(new CustomEvent(unityConfig.trackAnalyticsEvent, { detail: { event: 'multifile', data: filesData } }));
    if (!this.validateFiles(files)) return;
    const workflowId = crypto.randomUUID();
    const { maxConcurrentFiles, maxConcurrentChunks } = this.getConcurrentLimits();
    try {
      await this.showSplashScreen(true);
      const blobDataArray = [];
      const assetDataArray = [];
      const fileTypeArray = [];
      await this.executeInBatches(files, maxConcurrentFiles, async (file) => {
        try {
          const [blobData, assetData] = await Promise.all([
            this.getBlobData(file),
            this.createAsset(file, true, workflowId),
          ]);
          blobDataArray.push(blobData);
          assetDataArray.push(assetData);
          fileTypeArray.push(file.type);
        } catch (e) {
          switch (e.status) {
            case 409:
              await this.dispatchErrorToast('verb_upload_error_duplicate_asset', e.status, `Duplicate asset: ${file.name}`, true, e.showError);
              break;
            case 401:
              if (e.message === 'notentitled') await this.dispatchErrorToast('verb_upload_error_no_storage_provision', e.status, 'No storage provision', true, e.showError);
              else await this.dispatchErrorToast('verb_upload_error_generic', e.status, e.message, true, e.showError);
              break;
            case 403:
              if (e.message === 'quotaexceeded') await this.dispatchErrorToast('verb_upload_error_max_quota_exceeded', e.status, 'Max quota exceeded', true, e.showError);
              else await this.dispatchErrorToast('verb_upload_error_no_storage_provision', e.status, 'No storage provision', true, e.showError);
              break;
            default:
              await this.dispatchErrorToast('verb_upload_error_generic', e.status, 'Unable to process the request', true, e.showError);
              break;
          }
        }
      });
      if (assetDataArray.length === 0) {
        await this.dispatchGenericError();
        return;
      }
      this.updateProgressBar(this.splashScreenEl, 75);
      const cOpts = {
        targetProduct: this.workflowCfg.productName,
        assetId: assetDataArray[0].id,
        payload: {
          languageRegion: this.workflowCfg.langRegion,
          languageCode: this.workflowCfg.langCode,
          verb: this.workflowCfg.enabledFeatures[0],
          multifile: true,
          workflowId,
        },
      };
      const redirectSuccess = await this.handleRedirect(cOpts);
      if (!redirectSuccess) return;
      this.block.dispatchEvent(new CustomEvent(unityConfig.trackAnalyticsEvent, { detail: { event: 'uploading', data: filesData } }));
      const uploadResult = await this.chunkPdf(
        assetDataArray,
        blobDataArray,
        fileTypeArray,
        maxConcurrentChunks,
      );
      if (uploadResult.length === files.length) {
        await this.dispatchGenericError();
        return;
      }
      const uploadedAssets = assetDataArray.filter((_, index) => !uploadResult.includes(index));
      this.operations.push(workflowId);
      let allVerified = 0;
      await this.executeInBatches(uploadedAssets, maxConcurrentFiles, async (assetData) => {
        const verified = await this.verifyContent(assetData);
        if (!verified) {
          await this.dispatchErrorToast('verb_upload_error_generic', 500, `Verification failed for file: ${assetData.id}`, true);
        } else allVerified += 1;
      });
      if (allVerified === 0) {
        await this.dispatchGenericError();
        return;
      }
      if (files.length !== allVerified) this.multiFileFailure = 'uploaderror';
      this.updateProgressBar(this.splashScreenEl, 95);
    } catch (e) {
      await this.dispatchGenericError(null, e.showError);
      return;
    }
    this.block.dispatchEvent(new CustomEvent(unityConfig.trackAnalyticsEvent, { detail: { event: 'uploaded', data: filesData } }));
  }
}
