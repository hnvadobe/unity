/* eslint-disable eqeqeq */
/* eslint-disable no-await-in-loop */
/* eslint-disable class-methods-use-this */
/* eslint-disable no-restricted-syntax */

import {
  unityConfig,
} from '../../../scripts/utils.js';

export default class ServiceHandler {
  constructor(renderWidget = false, canvasArea = null) {
    this.renderWidget = renderWidget;
    this.canvasArea = canvasArea;
  }

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
    let token = "";
    let guestAccessToken = this.getGuestAccessToken();
    if (!guestAccessToken || guestAccessToken.expire.valueOf() <= Date.now() + (5 * 60 * 1000)) {
      token = await this.getRefreshToken();
    } else {
      token = `Bearer ${guestAccessToken.token}`;
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
