import {
  createTag,
  loadStyle,
  setUnityLibs,
  getUnityLibs,
  unityConfig,
  defineDeviceByScreenSize,
  getConfig,
  priorityLoad,
} from '../../scripts/utils.js';

export function getImgSrc(pic) {
  const viewport = defineDeviceByScreenSize();
  let source = '';
  if (viewport === 'MOBILE') source = pic.querySelector('source[type="image/webp"]:not([media])');
  else source = pic.querySelector('source[type="image/webp"][media]');
  return source.srcset;
}

function checkRenderStatus(targetBlock, res, rej, etime, rtime) {
  if (etime > 20000) { rej(); return; }
  if (targetBlock.querySelector('.text') && targetBlock.querySelector('.asset, .image')) res();
  else setTimeout(() => checkRenderStatus(targetBlock, res, rej, etime + rtime), rtime);
}

function intEnbReendered(targetBlock) {
  return new Promise((res, rej) => {
    try {
      checkRenderStatus(targetBlock, res, rej, 0, 100);
    } catch (err) { rej(); }
  });
}

function createInteractiveArea(el, pic) {
  const iArea = createTag('div', { class: 'interactive-area' });
  const iWidget = createTag('div', { class: 'unity-widget decorating' });
  const unityaa = createTag('div', { class: 'unity-action-area' });
  const unityoa = createTag('div', { class: 'unity-option-area' });
  iWidget.append(unityoa, unityaa);
  pic.querySelector('img').src = getImgSrc(pic);
  [...pic.querySelectorAll('source')].forEach((s) => s.remove());
  const newPic = pic.cloneNode(true);
  const p = createTag('p', {}, newPic);
  el.querySelector(':scope > div > div').prepend(p);
  iArea.append(pic, iWidget);
  if (el.classList.contains('light')) iArea.classList.add('light');
  else iArea.classList.add('dark');
  return [iArea, iWidget];
}

async function getTargetArea(el) {
  const metadataSec = el.closest('.section');
  const intEnb = metadataSec.querySelector('.marquee, .aside');
  try {
    intEnb.classList.add('unity-enabled');
    await intEnbReendered(intEnb);
  } catch (err) { return null; }
  if (el.classList.contains('mobile-image-bottom')) intEnb.classList.add('mobile-image-bottom');
  const asset = intEnb.querySelector('.asset picture, .image picture');
  const container = asset.closest('p');
  const [iArea, iWidget] = createInteractiveArea(el, asset);
  const assetArea = intEnb.querySelector('.asset, .image');
  if (container) container.replaceWith(iArea);
  else assetArea.append(iArea);
  return [iArea, iWidget];
}

function getEnabledFeatures(unityEl, wfDetail) {
  const enabledFeatures = [];
  const supportedFeatures = Object.keys(wfDetail);
  const configuredFeatures = unityEl.querySelectorAll(':scope ul > li > span.icon');
  configuredFeatures.forEach((cf) => {
    const cfName = [...cf.classList].find((cn) => cn.match('icon-'));
    if (!cfName) return;
    const fn = cfName.split('-')[1];
    const isEnabled = supportedFeatures.indexOf(fn);
    if (isEnabled > -1) {
      enabledFeatures.push(fn);
      wfDetail[fn].authorCfg = cf.closest('li');
    }
  });
  return enabledFeatures;
}

function getWorkFlowInformation(el) {
  let wfName = '';
  const workflowCfg = {
    'workflow-photoshop': {
      removebg: { endpoint: 'providers/PhotoshopRemoveBackground' },
      changebg: { endpoint: 'providers/PhotoshopChangeBackground' },
      slider: {},
    },
    'workflow-acrobat': {},
  };
  [...el.classList].forEach((cn) => { if (cn.match('workflow-')) wfName = cn; });
  if (!wfName || !workflowCfg[wfName]) return [];
  return [wfName, workflowCfg[wfName]];
}

async function initWorkflow(cfg) {
  loadStyle(`${getUnityLibs()}/core/workflow/${cfg.wfName}/${cfg.wfName}.css`);
  const { default: wfinit } = await import(`./${cfg.wfName}/${cfg.wfName}.js`);
  await wfinit(cfg);
  cfg.unityWidget?.classList.remove('decorating');
  const actionBtn = cfg.unityWidget.querySelector('.unity-action-btn');
  actionBtn?.classList.add('animate-btn');
  cfg.unityWidget.addEventListener('mouseover', () => {
    actionBtn?.classList.remove('animate-btn');
  }, { once: true });
}

class WfInitiator {
  constructor() {
    this.el = null;
    this.targetBlock = {};
    this.unityLibs = '/unityLibs';
    this.interactiveArea = null;
    this.project = 'unity';
    this.targetConfig = {};
    this.operations = {};
    this.actionMap = {};
  }

  async priorityLibFetch(workflowName) {
    const baseWfPath = `${getUnityLibs()}/core/workflow/${workflowName}`;
    const sharedWfRes = [
      `${baseWfPath}/sprite.svg`,
      `${baseWfPath}/widget.css`,
      `${baseWfPath}/widget.js`,
    ];
    const workflowRes = {
      'workflow-photoshop': [
        ...sharedWfRes,
        `${getUnityLibs()}/core/features/progress-circle/progress-circle.css`,
      ],
      'workflow-ai': sharedWfRes,
    };
    const commonResources = [
      `${baseWfPath}/target-config.json`,
      `${baseWfPath}/action-binder.js`,
    ];
    const wfRes = workflowRes[workflowName] || [];
    const priorityList = [...commonResources, ...wfRes];
    const pfr = await priorityLoad(priorityList);

    return {
      targetConfigCallRes: pfr[0],
      spriteCallRes: pfr.length > 2 ? pfr[2] : null,
    };
  }

  async init(el, project = 'unity', unityLibs = '/unitylibs', langRegion = '', langCode = '') {
    setUnityLibs(unityLibs, project);
    this.el = el;
    this.unityLibs = unityLibs;
    this.project = project;
    this.enabledFeatures = [];
    this.workflowCfg = this.getWorkFlowInformation();
    this.workflowCfg.langRegion = langRegion;
    this.workflowCfg.langCode = langCode;
    // eslint-disable-next-line max-len
    const { targetConfigCallRes: tcfg, spriteCallRes: spriteSvg } = await this.priorityLibFetch(this.workflowCfg.name);
    [this.targetBlock, this.interactiveArea, this.targetConfig] = await this.getTarget(tcfg);
    this.getEnabledFeatures();
    this.callbackMap = {};
    this.workflowCfg.targetCfg = this.targetConfig;
    if (this.targetConfig.renderWidget) {
      const { default: UnityWidget } = await import(`${getUnityLibs()}/core/workflow/${this.workflowCfg.name}/widget.js`);
      const spriteContent = await spriteSvg.text();
      this.actionMap = await new UnityWidget(
        this.interactiveArea,
        this.el,
        this.workflowCfg,
        spriteContent,
      ).initWidget();
    } else {
      this.actionMap = this.targetConfig.actionMap;
    }
    this.limits = this.targetConfig.limits;
    const { default: ActionBinder } = await import(`${getUnityLibs()}/core/workflow/${this.workflowCfg.name}/action-binder.js`);
    await new ActionBinder(
      this.el,
      this.workflowCfg,
      this.targetBlock,
      this.interactiveArea,
      this.actionMap,
      this.limits,
    ).initActionListeners();
  }

  checkRenderStatus(block, selector, res, rej, etime, rtime) {
    if (etime > 20000) { rej(); return; }
    if (block.querySelector(selector)) res();
    else setTimeout(() => this.checkRenderStatus(block, selector, res, rej, etime + rtime), rtime);
  }

  intEnbReendered(block, selector) {
    return new Promise((res, rej) => {
      try {
        this.checkRenderStatus(block, selector, res, rej, 0, 100);
      } catch (err) { rej(); }
    });
  }

  async getTarget(rawTargetConfig) {
    const targetConfig = await rawTargetConfig.json();
    const prevElem = this.el.previousElementSibling;
    const supportedBlocks = Object.keys(targetConfig);
    let targetCfg = null;
    for (let k = 0; k < supportedBlocks.length; k += 1) {
      const classes = supportedBlocks[k].split('.');
      let hasAllClasses = true;
      // eslint-disable-next-line no-restricted-syntax
      for (const c of classes) {
        const hasClass = prevElem.classList.contains(c);
        const hasChild = prevElem.querySelector(`.${c}`);
        if (!(hasClass || hasChild)) {
          hasAllClasses = false;
          break;
        }
      }
      if (hasAllClasses) {
        targetCfg = targetConfig[supportedBlocks[k]];
        break;
      }
    }
    if (!targetCfg) return [null, null, null];
    await this.intEnbReendered(prevElem, targetCfg.selector);
    let ta = null;
    ta = this.createInteractiveArea(prevElem, targetCfg.selector, targetCfg);
    prevElem.classList.add('unity-enabled');
    return [prevElem, ta, targetCfg];
  }

  getImgSrc(pic) {
    const viewport = defineDeviceByScreenSize();
    let source = '';
    if (viewport === 'MOBILE') source = pic.querySelector('source[type="image/webp"]:not([media])');
    else source = pic.querySelector('source[type="image/webp"][media]');
    return source ? source.srcset : pic.querySelector('img').src;
  }

  createInteractiveArea(block, selector, targetCfg) {
    const iArea = createTag('div', { class: 'interactive-area' });
    const asset = block.querySelector(selector);
    if (asset.nodeName === 'PICTURE') {
      asset.querySelector('img').src = this.getImgSrc(asset);
      [...asset.querySelectorAll('source')].forEach((s) => s.remove());
      const newPic = asset.cloneNode(true);
      this.el.querySelector(':scope > div > div').prepend(newPic);
    }
    if (!targetCfg.renderWidget) return null;
    asset.insertAdjacentElement('beforebegin', iArea);
    iArea.append(asset);
    if (this.el.classList.contains('light')) iArea.classList.add('light');
    else iArea.classList.add('dark');
    return iArea;
  }

  getWorkFlowInformation() {
    let wfName = '';
    const workflowCfg = {
      'workflow-photoshop': {
        productName: 'Photoshop',
        sfList: new Set(['removebg', 'changebg', 'slider']),
      },
      'workflow-acrobat': {
        productName: 'acrobat',
        sfList: new Set(['fillsign', 'compress-pdf']),
      },
      'workflow-ai': {
        productName: 'Express',
        sfList: new Set(['text-to-mage']),
        stList: new Set(['prompt', 'tip', 'legal', 'surpriseMe', 'generate']),
      },
    };
    [...this.el.classList].forEach((cn) => { if (cn.match('workflow-')) wfName = cn; });
    if (!wfName || !workflowCfg[wfName]) return [];
    return {
      name: wfName,
      productName: workflowCfg[wfName].productName,
      supportedFeatures: workflowCfg[wfName].sfList,
      enabledFeatures: [],
      featureCfg: [],
      errors: {},
      supportedTexts: workflowCfg[wfName]?.stList ?? null,
    };
  }

  getEnabledFeatures() {
    const { supportedFeatures, supportedTexts } = this.workflowCfg;
    const configuredFeatures = this.el.querySelectorAll(':scope > div > div > ul > li > span.icon');
    configuredFeatures.forEach((cf) => {
      const cfName = [...cf.classList].find((cn) => cn.match('icon-'));
      if (!cfName) return;
      const fn = cfName.trim().replace('icon-', '');
      if (supportedFeatures.has(fn)) {
        this.workflowCfg.enabledFeatures.push(fn);
        this.workflowCfg.featureCfg.push(cf.closest('li'));
      } else if (fn.includes('error')) {
        this.workflowCfg.errors[fn] = cf.closest('li').innerText;
      } else if (supportedTexts && supportedTexts.has(fn)) {
        this.workflowCfg.supportedTexts[fn] = this.workflowCfg.supportedTexts[fn] || [];
        this.workflowCfg.supportedTexts[fn].push(cf.closest('li').innerText);
      }
    });
  }
}

export default async function init(el, project = 'unity', unityLibs = '/unitylibs', unityVersion = 'v1', langRegion = 'us', langCode = 'en') {
  let uv = new URLSearchParams(window.location.search).get('unityversion') || unityVersion;
  if (el.classList.contains('workflow-ai')) uv = 'v2'; //This line will be removed once CC moves to unity V2
  const { imsClientId } = getConfig();
  if (imsClientId) unityConfig.apiKey = imsClientId;
  setUnityLibs(unityLibs, project);
  switch (uv) {
    case 'v1': {
      const [targetBlock, unityWidget] = await getTargetArea(el);
      if (!targetBlock) return;
      const [wfName, wfDetail] = getWorkFlowInformation(el);
      if (!wfName || !wfDetail) return;
      const enabledFeatures = getEnabledFeatures(el, wfDetail);
      if (!enabledFeatures) return;
      const wfConfig = {
        unityEl: el,
        targetEl: targetBlock,
        unityWidget,
        wfName,
        wfDetail,
        enabledFeatures,
        uploadState: { },
        ...unityConfig,
      };
      await initWorkflow(wfConfig);
    }
      break;
    case 'v2':
      await new WfInitiator().init(el, project, unityLibs, langRegion, langCode);
      break;
    default:
      break;
  }
}
