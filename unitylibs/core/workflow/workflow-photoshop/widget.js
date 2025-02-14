/* eslint-disable class-methods-use-this */
import {
  createTag,
  getLibs,
  priorityLoad,
  defineDeviceByScreenSize,
} from '../../../scripts/utils.js';

export default class UnityWidget {
  constructor(target, el, workflowCfg, spriteContent) {
    this.el = el;
    this.target = target;
    this.workflowCfg = workflowCfg;
    this.widget = null;
    this.actionMap = {};
    this.spriteContent = spriteContent;
  }

  async initWidget() {
    const [iWidget, unityaa, unityoa, unitySprite] = ['unity-widget', 'unity-action-area', 'unity-option-area', 'unity-sprite-container']
      .map((c) => createTag('div', { class: c }));
    iWidget.append(unitySprite, unityoa, unityaa);
    unitySprite.innerHTML = this.spriteContent;
    this.widget = iWidget;
    this.target.append(iWidget);
    const refreshCfg = this.el.querySelector('.icon-product-icon');
    if (refreshCfg) this.addRestartOption(unityaa);
    this.workflowCfg.enabledFeatures.forEach((f, idx) => {
      const addClasses = idx === 0 ? 'ps-action-btn show' : 'ps-action-btn';
      this.addFeatureButtons(
        f,
        this.workflowCfg.featureCfg[idx],
        unityaa,
        unityoa,
        addClasses,
        idx,
        this.workflowCfg.enabledFeatures.length,
      );
    });
    const uploadCfg = this.el.querySelector('.icon-upload');
    if (uploadCfg) this.addFeatureButtons('upload', uploadCfg.closest('li'), unityaa, unityoa, 'show');
    const continueInApp = this.el.querySelector('.icon-app-connector');
    if (continueInApp) this.addFeatureButtons('continue-in-app', continueInApp.closest('li'), unityaa, unityoa, '');
    const { decorateDefaultLinkAnalytics } = await import(`${getLibs()}/martech/attributes.js`);
    decorateDefaultLinkAnalytics(iWidget);
    return this.actionMap;
  }

  createActionBtn(btnCfg, btnClass, imgId, swapOrder = false) {
    const btnIcon = createTag('div', { class: 'btn-icon' }, `<svg><use xlink:href="#unity-${imgId}-icon"></use></svg>`);
    const btnText = createTag('div', { class: 'btn-text' }, btnCfg.innerText.split('\n')[0].trim());
    const actionBtn = createTag('a', { href: '#', class: `unity-action-btn ${btnClass}` }, btnText);
    if (swapOrder) actionBtn.append(btnIcon);
    else actionBtn.prepend(btnIcon);
    return actionBtn;
  }

  initRefreshActionMap(w) {
    this.actionMap[w] = [
      {
        actionType: 'hide',
        targets: ['.ps-action-btn.show', '.unity-option-area .show', '.continue-in-app-button'],
      }, {
        actionType: 'show',
        targets: ['.ps-action-btn'],
      }, {
        actionType: 'refresh',
        sourceSrc: this.el.querySelector('img').src,
        target: this.target.querySelector('img'),
      },
    ];
  }

  refreshHandler(ih, rh, mrh) {
    this.target.querySelector('img').style.filter = '';
    ih.classList.add('show');
    rh.classList.remove('show');
    mrh.classList.remove('show');
  }

  addRestartOption(unityaa) {
    const iconHolder = createTag('div', { class: 'widget-product-icon show' }, `<svg><use xlink:href="#unity-${this.workflowCfg.productName.toLowerCase()}-icon"></use></svg>`);
    const refreshHolder = createTag('a', { href: '#', class: 'widget-refresh-button' }, '<svg><use xlink:href="#unity-refresh-icon"></use></svg>');
    refreshHolder.append(createTag('div', { class: 'widget-refresh-text' }, 'Restart'));
    unityaa.append(iconHolder);
    const mobileRefreshHolder = refreshHolder.cloneNode(true);
    [refreshHolder, mobileRefreshHolder].forEach((w) => {
      w.addEventListener('click', () => {
        this.refreshHandler(iconHolder, refreshHolder, mobileRefreshHolder);
      });
    });
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          this.refreshHandler(iconHolder, refreshHolder, mobileRefreshHolder);
        }
      });
    });
    observer.observe(this.target);
    this.initRefreshActionMap('.unity-action-area .widget-refresh-button');
    this.initRefreshActionMap('.interactive-area > .widget-refresh-button');
    unityaa.append(refreshHolder);
    this.target.append(mobileRefreshHolder);
  }

  addFeatureButtons(
    featName,
    authCfg,
    actionArea,
    optionArea,
    addClasses,
    currFeatureIdx,
    totalFeatures,
  ) {
    let btn = null;
    switch (featName) {
      case 'removebg':
        btn = this.createActionBtn(authCfg, `${featName}-button ${addClasses}`, featName);
        actionArea.append(btn);
        this.initRemoveBgActions(featName, btn, authCfg);
        break;
      case 'upload':
        {
          btn = this.createActionBtn(authCfg, `${featName}-button ${addClasses}`, featName);
          actionArea.append(btn);
          const inpel = createTag('input', {
            class: 'file-upload',
            type: 'file',
            accept: 'image/png,image/jpg,image/jpeg',
            tabIndex: -1,
          });
          btn.append(inpel);
          inpel.addEventListener('click', (e) => {
            e.stopPropagation();
          });
          this.initUploadActions(featName);
        }
        break;
      case 'continue-in-app':
        btn = this.createActionBtn(
          authCfg,
          `${featName}-button ${addClasses}`,
          this.workflowCfg.productName.toLowerCase()
        );
        actionArea.append(btn);
        this.initContinueInAppActions(featName);
        break;
      default:
        btn = this.createActionBtn(authCfg, `${featName}-button ${addClasses}`, featName);
        actionArea.append(btn);
        this.addFeatureTray(
          featName,
          authCfg,
          optionArea,
          btn,
          addClasses,
          currFeatureIdx,
          totalFeatures,
        );
    }
  }

  updateQueryParameter(url, paramName = 'format', formatName = 'jpeg') {
    try {
      const urlObj = new URL(url);
      const params = urlObj.searchParams;
      params.set(paramName, formatName);
      return urlObj.toString();
    } catch (error) {
      return null;
    }
  }

  initRemoveBgActions(featName, btn, authCfg) {
    this.actionMap[`.${featName}-button`] = [
      {
        actionType: 'show',
        targets: ['.progress-circle'],
      },
      {
        itemType: 'button',
        actionType: featName,
        source: this.target.querySelector('img'),
        target: this.target.querySelector('img'),
        cachedOutputUrl: authCfg.querySelector(':scope ul li img')
          ? this.updateQueryParameter(
            authCfg.querySelector(':scope ul li img').src,
          )
          : null,
      },
      {
        actionType: 'show',
        targets: [
          '.interactive-area > .widget-refresh-button',
          '.unity-widget .widget-refresh-button',
          '.ps-action-btn.show + .ps-action-btn',
          '.changebg-options-tray',
          '.continue-in-app-button',
        ],
      },
      {
        actionType: 'hide',
        targets: [btn, '.progress-circle', '.unity-action-area .widget-product-icon'],
      },
    ];
  }

  initChangeBgActions(key, btn, bgImg, bgSelectorTray, authCfg, currFeatureIdx, totalFeatures) {
    this.actionMap[key] = [
      {
        actionType: 'show',
        targets: ['.progress-circle'],
      },
      {
        itemType: 'button',
        actionType: 'changebg',
        backgroundSrc: bgImg.src,
        source: this.target.querySelector('img'),
        target: this.target.querySelector('img'),
        cachedOutputUrl: authCfg.querySelector(':scope ul li img')
          ? this.updateQueryParameter(
            authCfg.querySelector(':scope ul li img').src
          )
          : null,
      },
      {
        actionType: 'show',
        targets: ['.continue-in-app-button'],
      },
      {
        actionType: 'hide',
        targets: ['.progress-circle'],
      },
    ];
    if (currFeatureIdx < totalFeatures - 1) {
      this.actionMap[key].push({
        actionType: 'show',
        targets: ['.ps-action-btn.show + .ps-action-btn', '.adjustment-options-tray'],
      }, {
        actionType: 'hide',
        targets: [btn, bgSelectorTray, '.progress-circle'],
      });
    }
  }

  initUploadActions(featName) {
    this.actionMap[`.${featName}-button`] = [
      {
        actionType: 'dispatchClickEvent',
        target: '.file-upload',
      },
    ];
    this.actionMap[`.${featName}-button .file-upload`] = [
      {
        actionType: 'hide',
        targets: ['.unity-action-area .widget-product-icon'],
      },
      {
        actionType: 'show',
        targets: [
          '.progress-circle',
          '.interactive-area > .widget-refresh-button',
          '.unity-widget .widget-refresh-button'],
      }, {
        itemType: 'button',
        actionType: 'upload',
        assetType: 'img',
        target: this.target.querySelector('img'),
        callbackAction: 'removebg',
        callbackActionSource: this.target.querySelector('img'),
        callbackActionTarget: this.target.querySelector('img'),
      }, {
        actionType: 'hide',
        targets: ['.ps-action-btn.show', '.unity-option-area > div.show', '.progress-circle'],
      }, {
        actionType: 'show',
        targets: ['.changebg-button', '.unity-option-area .changebg-options-tray', '.continue-in-app-button'],
      },
    ];
  }

  initContinueInAppActions(featName) {
    this.actionMap[`.${featName}-button`] = [
      {
        itemType: 'button',
        actionType: 'continueInApp',
        appName: 'Photoshop',
      },
    ];
  }

  addFeatureTray(featName, authCfg, optionArea, btn, addClasses, currFeatureIdx, totalFeatures) {
    switch (featName) {
      case 'changebg': {
        const tray = this.addChangeBgTray(btn, authCfg, optionArea, addClasses.indexOf('show') > -1, currFeatureIdx, totalFeatures);
        this.actionMap[`.${featName}-button`] = [
          {
            actionType: 'toggle',
            targets: [tray],
          },
        ];
        break;
      }
      case 'slider': {
        const tray = this.addAdjustmentTray(btn, authCfg, optionArea, addClasses.indexOf('show') > -1);
        this.actionMap[`.${featName}-button`] = [
          {
            actionType: 'toggle',
            targets: [tray],
          },
        ];
        break;
      }
      default:
        break;
    }
  }

  updateQueryParam(url, params) {
    const parsedUrl = new URL(url);
    Object.entries(params).forEach(([key, value]) => {
      parsedUrl.searchParams.set(key, value);
    });
    return parsedUrl;
  }

  addChangeBgTray(btn, authCfg, optionArea, isVisible, currFeatureIdx, totalFeatures) {
    const bgSelectorTray = createTag('div', { class: `changebg-options-tray ${isVisible ? 'show' : ''}` });
    const bgOptions = authCfg.querySelectorAll(':scope > ul > li');
    const thumbnailSrc = [];
    [...bgOptions].forEach((o, num) => {
      let thumbnail = null;
      let bgImg = null;
      [thumbnail, bgImg] = o.querySelectorAll('img');
      if (!bgImg) bgImg = thumbnail;
      thumbnail.dataset.backgroundImg = bgImg.src;
      const optionSelector = `changebg-option option-${num}`;
      const a = createTag('a', { href: '#', class: optionSelector }, thumbnail);
      bgSelectorTray.append(a);
      this.initChangeBgActions(`.changebg-option.option-${num}`, btn, bgImg, bgSelectorTray, o, currFeatureIdx, totalFeatures);
      a.addEventListener('click', (e) => { e.preventDefault(); });
    });
    this.widget.addEventListener('click', () => {
      priorityLoad(thumbnailSrc);
    });
    optionArea.append(bgSelectorTray);
    return bgSelectorTray;
  }

  addAdjustmentTray(btn, authCfg, optionArea, isVisible) {
    const sliderTray = createTag('div', { class: `adjustment-options-tray  ${isVisible ? 'show' : ''}` });
    const sliderOptions = authCfg.querySelectorAll(':scope > ul li');
    [...sliderOptions].forEach((o) => {
      let iconName = null;
      const psAction = o.querySelector(':scope > .icon');
      [...psAction.classList].forEach((cn) => { if (cn.match('icon-')) iconName = cn; });
      const [, actionName] = iconName.split('-');
      switch (actionName) {
        case 'hue':
          this.createSlider(sliderTray, 'hue', o.innerText, -180, 180);
          break;
        case 'saturation':
          this.createSlider(sliderTray, 'saturation', o.innerText, 0, 300);
          break;
        default:
          break;
      }
    });
    optionArea.append(sliderTray);
    return sliderTray;
  }

  createSlider(tray, propertyName, label, minVal, maxVal) {
    const actionDiv = createTag('div', { class: 'adjustment-option' });
    const actionLabel = createTag('label', { class: 'adjustment-label' }, label);
    const actionSliderDiv = createTag('div', { class: `adjustment-container ${propertyName}` });
    const actionSliderInput = createTag('input', {
      type: 'range',
      min: minVal,
      max: maxVal,
      value: (minVal + maxVal) / 2,
      class: `adjustment-slider ${propertyName}`,
    });
    const actionAnalytics = createTag('div', { class: 'analytics-content' }, `Adjust ${label} slider`);
    const actionSliderCircle = createTag('a', { href: '#', class: `adjustment-circle ${propertyName}` }, actionAnalytics);
    actionSliderDiv.append(actionSliderInput, actionSliderCircle);
    actionDiv.append(actionLabel, actionSliderDiv);
    this.actionMap[`.adjustment-slider.${propertyName}`] = [
      {
        actionType: 'show',
        targets: ['.continue-in-app-button'],
      }, {
        itemType: 'slider',
        actionType: 'imageAdjustment',
        filterType: propertyName,
        sliderElem: actionSliderInput,
        target: this.target.querySelector('img'),
      },
    ];
    actionSliderInput.addEventListener('input', () => {
      const { value } = actionSliderInput;
      const centerOffset = (value - minVal) / (maxVal - minVal);
      const moveCircle = 3 + (centerOffset * 94);
      actionSliderCircle.style.left = `${moveCircle}%`;
    });
    actionSliderInput.addEventListener('change', () => {
      actionSliderCircle.click();
    });
    actionSliderCircle.addEventListener('click', (evt) => {
      evt.preventDefault();
    });
    tray.append(actionDiv);
  }
}
