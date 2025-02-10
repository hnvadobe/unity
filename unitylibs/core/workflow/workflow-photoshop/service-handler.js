/* eslint-disable eqeqeq */
/* eslint-disable no-await-in-loop */
/* eslint-disable class-methods-use-this */
/* eslint-disable no-restricted-syntax */

import {
  getUnityLibs,
  createTag,
  getGuestAccessToken,
  decorateDefaultLinkAnalytics,
  unityConfig,
} from '../../../scripts/utils.js';

export default class ServiceHandler {
  constructor(renderWidget = false, canvasArea = null) {
    this.renderWidget = renderWidget;
    this.errorToastEl = null;
    this.canvasArea = canvasArea;
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

  async postCallToService(api, options) {
    const postOpts = {
      method: 'POST',
      ...this.getHeaders(),
      ...options,
    };
    try {
      const response = await fetch(api, postOpts);
      const resJson = await response.json();
      return resJson;
    } catch (err) {
      if (this.renderWidget) await this.errorToast(err);
    }
    return {};
  }

  async errorToast(e) {
    console.log(e);
    if (!this.errorToastEl) {
      this.errorToastEl = await this.createErrorToast();
      this.canvasArea.append(this.errorToastEl);
    }
  }

  async createErrorToast() {
    const [alertImg, closeImg] = await Promise.all([
      fetch(`${getUnityLibs()}/img/icons/alert.svg`).then((res) => res.text()),
      fetch(`${getUnityLibs()}/img/icons/close.svg`).then((res) => res.text()),
    ]);
    const alertContent = createTag('div', { class: 'alert-content' });
    const errholder = createTag('div', { class: 'alert-holder' }, createTag('div', { class: 'alert-toast' }, alertContent));
    const alertIcon = createTag('div', { class: 'alert-icon' }, alertImg);
    const alertText = createTag('div', { class: 'alert-text' }, createTag('p', {}, 'Alert Text'));
    alertIcon.append(alertText);
    const alertClose = createTag('a', { class: 'alert-close', href: '#' }, closeImg);
    alertClose.append(createTag('span', { class: 'alert-close-text' }, 'Close error toast'));
    alertContent.append(alertIcon, alertClose);
    alertClose.addEventListener('click', (e) => {
      e.preventDefault();
      e.target.closest('.alert-holder').classList.remove('show');
    });
    decorateDefaultLinkAnalytics(errholder);
    return errholder;
  }
}
