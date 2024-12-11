/* eslint-disable no-await-in-loop */
/* eslint-disable class-methods-use-this */
/* eslint-disable no-restricted-syntax */

import {
  unityConfig,
  getUnityLibs
} from '../../../scripts/utils.js';

export default class ActionBinder {
  constructor(unityEl, workflowCfg, wfblock, canvasArea, actionMap = {}) {
    this.unityEl = unityEl;
    this.workflowCfg = workflowCfg;
    this.block = wfblock;
    this.actionMap = actionMap;
    this.canvasArea = canvasArea;
    this.operations = [];
    this.query = '';
    this.expressApiConfig = this.getExpressApiConfig();
    this.serviceHandler = null;
  }

  getExpressApiConfig() {
    unityConfig.expressEndpoint = {
      autoComplete: `${unityConfig.apiEndPoint}/api/v1/providers/AutoComplete`
    };
    return unityConfig;
  }

  async expressActionMaps(values) {
    const { default: ServiceHandler } = await import(`${getUnityLibs()}/core/workflow/${this.workflowCfg.name}/service-handler.js`);
    this.serviceHandler = new ServiceHandler(
      this.workflowCfg.targetCfg.renderWidget,
      this.canvasArea,
    );
    for (const value of values) {
      switch (true) {
        case value.actionType === 'autocomplete':
          await this.fetchAutocompleteSuggestions();
          break;
        case value.actionType === 'surprise':
          await this.surpriseMe();
          break;
        case value.actionType === 'generate':
          await this.generate();
          break;
        default:
          break;
      }
    }
  }

  async initActionListeners(b = this.block, actMap = this.actionMap) {
    let debounceTimer;
    for (const [key, values] of Object.entries(actMap)) {
      const el = b.querySelector(key);
      if (!el) return;
      switch (true) {
        case el.nodeName === 'A':
          el.addEventListener('click', async (e) => {
            e.preventDefault();
            await this.expressActionMaps(values);
          });
          break;
        case el.nodeName === 'INPUT':
          el.addEventListener('input', async (e) => {
            this.query = e.target.value.trim();
            clearTimeout(debounceTimer);
            if (query.length >= 3 || e.inputType === 'insertText' || e.data === ' ') {
              debounceTimer = setTimeout(async () => {
                await this.expressActionMaps(values);
              }, 1000);
            }
          });
          break;
        default:
          break;
      }
    }
  }

  async fetchAutocompleteSuggestions() {
    let suggestions = null;
    try {
      const data = { query: this.query };
      suggestions = await this.serviceHandler.postCallToService(
        this.expressApiConfig.expressEndpoint.autoComplete,
        { body: JSON.stringify(data) },
      );
      if (!suggestions) return;
      displaySuggestions(suggestions.completions); // to be implemented
    } catch (e) {
      console.log('Error fetching autocomplete suggestions:', e);
    }
  }

  async surpriseMe() {
    const prompts = this.workflowCfg.supportedTexts.prompts;
    if (!prompts) return;
    const randomIndex = Math.floor(Math.random() * prompts.length);
    this.query = prompts[randomIndex];
    return this.generate();
  }

  async generate() {
    try {
      const cOpts = { query: this.query, targetProduct: this.workflowCfg.targetProduct };
      connectorUrl = await this.serviceHandler.postCallToService(
        this.expressApiConfig.connectorApiEndPoint,
        { body: JSON.stringify(cOpts) },
      );
      window.location.href = connectorUrl;
    } catch (e) {
      console.log('Error fetching connector URL to express:', e);
    }
  }
}
