/**
 * Window-level drop handler.
 * Detects dragged file type and routes to the correct handler:
 *   - .json files → settings load
 *   - image/* or video/* → first visible ImageUploadParameter
 *
 * Usage: after ParameterPanel.render(), call:
 *   windowDropHandler.init(parameterPanel);
 */
const windowDropHandler = (function () {
  let _panel = null;
  let _overlay = null;
  let _label = null;
  let _enterCount = 0; // track nested dragenter/dragleave

  function _getFileType(e) {
    const items = e.dataTransfer && e.dataTransfer.items;
    if (!items || items.length === 0) return 'unknown';
    const item = items[0];
    if (item.type.startsWith('image/')) return 'media';
    if (item.type.startsWith('video/')) return 'media';
    if (item.type === 'application/json') return 'json';
    // Most OS report .json as empty MIME — assume json for non-media
    return 'json';
  }

  function _createOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'drop-overlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 9999;
      background: rgba(14, 14, 12, 0.85);
      display: none; align-items: center; justify-content: center;
    `;
    const label = document.createElement('div');
    label.style.cssText = `
      font-family: 'Söhne Mono', monospace;
      font-size: 18px; color: #EEEDDB;
      border: 2px dashed #504F49; border-radius: 20px;
      padding: 40px 60px; text-align: center;
    `;
    overlay.appendChild(label);
    // Overlay must handle dragover to allow drop
    overlay.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    overlay.addEventListener('drop', _onDrop);
    document.body.appendChild(overlay);
    return { overlay, label };
  }

  function _show(type) {
    if (!_overlay) {
      const els = _createOverlay();
      _overlay = els.overlay;
      _label = els.label;
    }
    _label.textContent = type === 'media'
      ? 'Drop image or video'
      : 'Drop JSON to load settings';
    _overlay.style.display = 'flex';
  }

  function _hide() {
    if (_overlay) _overlay.style.display = 'none';
  }

  function _onDragEnter(e) {
    e.preventDefault();
    _enterCount++;
    if (_enterCount === 1) {
      _show(_getFileType(e));
    }
  }

  function _onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }

  function _onDragLeave(e) {
    e.preventDefault();
    _enterCount--;
    if (_enterCount <= 0) {
      _enterCount = 0;
      _hide();
    }
  }

  function _onDrop(e) {
    e.preventDefault();
    _enterCount = 0;
    _hide();

    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    const file = files[0];

    // Route by actual file properties (available on drop)
    if (file.name.endsWith('.json') || file.type === 'application/json') {
      _handleJSON(file);
    } else if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
      _handleMedia(file);
    }
  }

  function _handleJSON(file) {
    if (!_panel) return;
    // Call the panel's existing _loadSettingsFromFile
    _panel._loadSettingsFromFile(file);
  }

  function _handleMedia(file) {
    if (!_panel) return;
    // Find the first ImageUploadParameter
    let uploadParam = null;
    _panel.parameters.forEach((param) => {
      if (!uploadParam && param.type === 'image') {
        uploadParam = param;
      }
    });
    if (!uploadParam) return;

    const previewImg = document.getElementById(uploadParam.id + '-preview-img');
    const previewVideo = document.getElementById(uploadParam.id + '-preview-video');
    const preview = document.getElementById(uploadParam.id + '-preview');
    const videoControls = uploadParam._videoControlsContainer;
    const playBtn = videoControls ? videoControls.querySelector('.parameter__video-btn') : null;

    if (previewImg && preview) {
      uploadParam._handleFile(file, previewImg, previewVideo, preview, null, videoControls, playBtn);
    }
  }

  return {
    init(panel) {
      _panel = panel;
      window.addEventListener('dragenter', _onDragEnter);
      window.addEventListener('dragover', _onDragOver);
      window.addEventListener('dragleave', _onDragLeave);
      window.addEventListener('drop', _onDrop);
    },
    destroy() {
      window.removeEventListener('dragenter', _onDragEnter);
      window.removeEventListener('dragover', _onDragOver);
      window.removeEventListener('dragleave', _onDragLeave);
      window.removeEventListener('drop', _onDrop);
      _panel = null;
    }
  };
})();
