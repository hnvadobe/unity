import { createTag, createActionBtn } from '../../scripts/utils.js';

const CONTAIN_OBJECT = 'contain-object';
const MOBILE_GRAY_BG = 'mobile-gray-bg';
const GRAY_BG = 'gray-bg';
const FULL_HEIGHT = 'full-height';
export const IMG_LANDSCAPE = 'img-landscape';
export const IMG_PORTRAIT = 'img-portrait';
export const IMG_REMOVE_BG = 'img-removebg';

export function resetClasses(img, targetEl) {
  if (img.classList.contains(CONTAIN_OBJECT)) img.classList.remove(CONTAIN_OBJECT);
  if (img.classList.contains(IMG_LANDSCAPE)) img.classList.remove(IMG_LANDSCAPE);
  if (img.classList.contains(IMG_PORTRAIT)) img.classList.remove(IMG_PORTRAIT);
  if (img.classList.contains(IMG_REMOVE_BG)) img.classList.remove(IMG_REMOVE_BG);
  if (img.classList.contains(MOBILE_GRAY_BG)) img.classList.remove(MOBILE_GRAY_BG);
  if (targetEl.classList.contains(GRAY_BG)) targetEl.classList.remove(GRAY_BG);
}

export default async function createUpload(cfg, target, callback = null) {
  const { refreshWidgetEvent, targetEl, unityEl } = cfg;
  const li = unityEl.querySelector('.icon-upload').parentElement;
  const a = await createActionBtn(li, 'show');
  const input = createTag('input', { class: 'file-upload', type: 'file', accept: 'image/png,image/jpg,image/jpeg', tabIndex: -1 });
  a.insertAdjacentElement('afterend', input);
  input.addEventListener('change', async (e) => {
    let flag = true;
    const fileUpload = e.target || input;
    const { default: showProgressCircle } = await import('../features/progress-circle/progress-circle.js');
    const { showErrorToast } = await import('../../scripts/utils.js');
    const file = fileUpload.files[0];
    if (!file) return;
    if (['image/jpeg', 'image/png', 'image/jpg'].indexOf(file.type) == -1) {
      await showErrorToast(targetEl, unityEl, '.icon-error-filetype');
      return;
    }
    const MAX_FILE_SIZE = 40000000;
    if (file.size > MAX_FILE_SIZE) {
      await showErrorToast(targetEl, unityEl, '.icon-error-filesize');
      return;
    }
    const objUrl = URL.createObjectURL(file);
    resetClasses(target, targetEl);
    target.src = objUrl;
    target.onload = async () => {
      cfg.uploadState.filetype = file.type;
      cfg.isUpload = true;
      if (callback && flag) {
        flag = false;
        try {
          const targetElWidth = targetEl.offsetWidth;
          const targetElHeight = targetEl.offsetHeight;
          if (!target.classList.contains(CONTAIN_OBJECT)) {
            target.classList.add(CONTAIN_OBJECT);
          }
          if (!target.classList.contains(MOBILE_GRAY_BG)) {
            target.classList.add(MOBILE_GRAY_BG);
          }
          if (!targetEl.classList.contains(GRAY_BG)) targetEl.classList.add(GRAY_BG);
          if (target.naturalWidth > targetElWidth) {
              cfg.imgDisplay = 'landscape';
              if (!target.classList.contains(IMG_LANDSCAPE)) target.classList.add(IMG_LANDSCAPE);
              if (target.classList.contains(FULL_HEIGHT)) target.classList.remove(FULL_HEIGHT);
          } else {
            cfg.imgDisplay = 'portrait';
            if (!target.classList.contains(IMG_PORTRAIT)) target.classList.add(IMG_PORTRAIT);
            if (!target.classList.contains(FULL_HEIGHT)) target.classList.add(FULL_HEIGHT);
          }
          if (target.naturalWidth == targetElWidth && target.naturalHeight == targetElHeight) {
            cfg.imgDisplay = '';
            resetClasses(target, targetEl);
          }
          showProgressCircle(targetEl);
          await callback(cfg);
          if (target.classList.contains(MOBILE_GRAY_BG)) target.classList.remove(MOBILE_GRAY_BG);
          showProgressCircle(targetEl);
        } catch (err) {
          showProgressCircle(targetEl);
          await showErrorToast(targetEl, unityEl, '.icon-error-request');
        }
      }
      const alertHolder = targetEl.querySelector('.alert-holder');
      if (alertHolder && alertHolder.style.display === 'flex') {
        unityEl.dispatchEvent(new CustomEvent(refreshWidgetEvent));
      }
    };
    target.onerror = async () => {
      await showErrorToast(targetEl, unityEl, '.icon-error-request');
    };
    fileUpload.value = '';
  });
  a.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.click();
  });
  a.addEventListener('click', () => input.click()); 
  return a;
}
