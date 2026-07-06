/**
 * ParameterPanel - Image Sampler Motion
 * Extends shared base with video export, palette detection, and gradient editor.
 */
class ParameterPanel extends ParameterPanelBase {
  _getSubtitle() { return 'Tabscape'; }
  _getExportPrefix() { return 'tabscape'; }
  _getSettingsFilePrefix() { return 'tabscape-settings'; }

  _onRenderContent(content) {
    // Duo Tone: two color pickers. Fade to Grey slider controls the grey threshold
    // on both gradient maps (how far up the tonal range grey extends before color).

    const COLOR_POS = 0.66;

    const buildStops = (color, greyThreshold, greyColor) => {
      // greyThreshold 0-100: 0 = color starts immediately, 100 = all grey
      // Map threshold to the position where grey ends and color begins
      const greyEnd = (greyThreshold / 100) * COLOR_POS;
      return [
        { pos: 0, color: greyColor },
        { pos: Math.max(greyEnd, 0.01), color: greyColor },
        { pos: COLOR_POS, color: color },
        { pos: 1, color: '#ffffff' }
      ];
    };

    const syncGradients = () => {
      const color1 = stateManager.get('duotoneColor1') || '#ff2a7f';
      const color2 = stateManager.get('duotoneColor2') || '#8f77f8';
      const grey = stateManager.get('fadeToGrey') ?? 0;
      const greyColor = stateManager.get('postFadeTarget') || '#808080';
      stateManager.set('duotoneWarmStops', buildStops(color1, grey, greyColor));
      stateManager.set('duotoneCoolStops', buildStops(color2, grey, greyColor));
    };

    // Subscribe to fadeToGrey and backgroundColor changes to update gradient maps
    stateManager.subscribe('fadeToGrey', () => syncGradients());
    stateManager.subscribe('backgroundColor', () => syncGradients());

    requestAnimationFrame(() => {
      const selectEl = document.getElementById('colorRemapMode');
      if (!selectEl) return;
      const selectRow = selectEl.closest('.parameter');
      if (!selectRow) return;
      const parent = selectRow.parentNode;

      const PALETTE = ['#FD817C','#E35B6C','#A06279','#64737E','#48BEC5','#52C584','#9BAD3B'];

      const wrap = document.createElement('div');
      wrap.className = 'duotone-controls';

      // ── Custom color picker widget ──
      // Shows: color swatch (click to open popup) + hex input
      // Popup: saturation/lightness pad, hue strip, palette swatches
      const buildColorRow = (labelText, stateKey, defaultColor) => {
        const row = document.createElement('div');
        row.className = 'parameter parameter--color';
        let currentColor = stateManager.get(stateKey) || defaultColor;

        const label = document.createElement('label');
        label.className = 'parameter__label';
        label.textContent = labelText;

        // Color swatch button
        const swatchBtn = document.createElement('div');
        swatchBtn.className = 'parameter__color';
        swatchBtn.style.cssText = 'cursor:pointer;border-radius:calc(3px * var(--s));';
        swatchBtn.style.backgroundColor = currentColor;

        const setColor = (hex) => {
          currentColor = hex.toLowerCase();
          swatchBtn.style.backgroundColor = currentColor;
          stateManager.set(stateKey, currentColor);
          syncGradients();
        };

        // ── Popup ──
        let popup = null;
        let isOpen = false;

        // HSV helpers
        const hexToHsv = (hex) => {
          const r = parseInt(hex.slice(1,3),16)/255, g = parseInt(hex.slice(3,5),16)/255, b = parseInt(hex.slice(5,7),16)/255;
          const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max - min;
          let h = 0, s = max === 0 ? 0 : d / max, v = max;
          if (d !== 0) {
            if (max === r) h = ((g-b)/d + (g<b?6:0))/6;
            else if (max === g) h = ((b-r)/d+2)/6;
            else h = ((r-g)/d+4)/6;
          }
          return { h: h*360, s, v };
        };
        const hsvToHex = (h, s, v) => {
          h = ((h%360)+360)%360;
          const c = v*s, x = c*(1-Math.abs((h/60)%2-1)), m = v-c;
          let r,g,b;
          if(h<60){r=c;g=x;b=0;}else if(h<120){r=x;g=c;b=0;}else if(h<180){r=0;g=c;b=x;}
          else if(h<240){r=0;g=x;b=c;}else if(h<300){r=x;g=0;b=c;}else{r=c;g=0;b=x;}
          const toHex = (n) => Math.round((n+m)*255).toString(16).padStart(2,'0');
          return '#' + toHex(r) + toHex(g) + toHex(b);
        };

        let hsv = hexToHsv(currentColor);

        const openPopup = () => {
          if (isOpen) { closePopup(); return; }
          isOpen = true;
          hsv = hexToHsv(currentColor);

          popup = document.createElement('div');
          popup.style.cssText = 'position:absolute;z-index:100;background:var(--card-bg);border:1px solid var(--input-border);border-radius:calc(8px * var(--s));padding:calc(10px * var(--s));box-shadow:0 4px 16px rgba(0,0,0,0.4);width:calc(220px * var(--s));';

          // SV pad (saturation x, value y)
          const padSize = 200;
          const pad = document.createElement('canvas');
          pad.width = padSize; pad.height = padSize;
          pad.style.cssText = 'width:100%;aspect-ratio:1;border-radius:calc(4px * var(--s));cursor:crosshair;display:block;';

          const drawPad = () => {
            const ctx = pad.getContext('2d');
            const w = pad.width, h = pad.height;
            // Base hue
            ctx.fillStyle = hsvToHex(hsv.h, 1, 1);
            ctx.fillRect(0, 0, w, h);
            // White gradient left→right
            const gw = ctx.createLinearGradient(0, 0, w, 0);
            gw.addColorStop(0, 'rgba(255,255,255,1)');
            gw.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = gw; ctx.fillRect(0, 0, w, h);
            // Black gradient top→bottom
            const gb = ctx.createLinearGradient(0, 0, 0, h);
            gb.addColorStop(0, 'rgba(0,0,0,0)');
            gb.addColorStop(1, 'rgba(0,0,0,1)');
            ctx.fillStyle = gb; ctx.fillRect(0, 0, w, h);
            // Cursor
            const cx = hsv.s * w, cy = (1 - hsv.v) * h;
            ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI*2);
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
            ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
          };

          let padSetColor = setColor; // will be replaced with setColorAndInputs once inputs exist
          const padMove = (e) => {
            const rect = pad.getBoundingClientRect();
            hsv.s = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            hsv.v = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
            padSetColor(hsvToHex(hsv.h, hsv.s, hsv.v));
            drawPad(); drawHueStrip();
          };
          pad.addEventListener('mousedown', (e) => {
            padMove(e);
            const onMove = (ev) => padMove(ev);
            const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
          });

          // Hue strip
          const hueCanvas = document.createElement('canvas');
          hueCanvas.width = padSize; hueCanvas.height = 14;
          hueCanvas.style.cssText = 'width:100%;height:calc(14px * var(--s));border-radius:calc(3px * var(--s));cursor:pointer;display:block;margin-top:calc(8px * var(--s));';

          const drawHueStrip = () => {
            const ctx = hueCanvas.getContext('2d');
            const w = hueCanvas.width, h = hueCanvas.height;
            const g = ctx.createLinearGradient(0, 0, w, 0);
            for (let i = 0; i <= 6; i++) g.addColorStop(i/6, hsvToHex(i*60, 1, 1));
            ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
            // Cursor
            const cx = (hsv.h / 360) * w;
            ctx.beginPath(); ctx.arc(cx, h/2, h/2 - 1, 0, Math.PI*2);
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
          };

          const hueMove = (e) => {
            const rect = hueCanvas.getBoundingClientRect();
            hsv.h = Math.max(0, Math.min(360, ((e.clientX - rect.left) / rect.width) * 360));
            padSetColor(hsvToHex(hsv.h, hsv.s, hsv.v));
            drawPad(); drawHueStrip();
          };
          hueCanvas.addEventListener('mousedown', (e) => {
            hueMove(e);
            const onMove = (ev) => hueMove(ev);
            const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
          });

          // Palette swatches
          const swatchRow = document.createElement('div');
          swatchRow.style.cssText = 'display:flex;gap:4px;margin-top:calc(8px * var(--s));';
          PALETTE.forEach(c => {
            const swatch = document.createElement('div');
            swatch.style.cssText = 'flex:1;height:calc(18px * var(--s));border-radius:calc(3px * var(--s));cursor:pointer;transition:transform 0.1s ease;background:' + c + ';';
            swatch.addEventListener('mouseenter', () => { swatch.style.transform = 'scale(1.1)'; });
            swatch.addEventListener('mouseleave', () => { swatch.style.transform = ''; });
            swatch.addEventListener('click', () => {
              hsv = hexToHsv(c);
              padSetColor(c);
              drawPad(); drawHueStrip();
            });
            swatchRow.appendChild(swatch);
          });

          // Hex + RGB inputs row
          const inputStyle = 'width:100%;font-family:inherit;font-size:calc(12px * var(--s));background:transparent;border:1px solid var(--input-border);border-radius:calc(3px * var(--s));color:var(--text-primary);padding:3px 4px;text-align:center;box-sizing:border-box;';
          const labelStyle = 'font-size:calc(10px * var(--s));color:var(--text-muted);text-align:center;margin-top:2px;';

          const inputsRow = document.createElement('div');
          inputsRow.style.cssText = 'display:flex;gap:4px;margin-top:calc(8px * var(--s));align-items:start;';

          // Hex
          const hexCol = document.createElement('div');
          hexCol.style.cssText = 'flex:2;';
          const hexIn = document.createElement('input');
          hexIn.type = 'text'; hexIn.maxLength = 7;
          hexIn.style.cssText = inputStyle;
          hexIn.value = currentColor.toUpperCase();
          const hexLbl = document.createElement('div');
          hexLbl.style.cssText = labelStyle; hexLbl.textContent = 'HEX';
          hexCol.appendChild(hexIn); hexCol.appendChild(hexLbl);

          // R
          const rCol = document.createElement('div');
          rCol.style.cssText = 'flex:1;';
          const rIn = document.createElement('input');
          rIn.type = 'text'; rIn.maxLength = 3;
          rIn.style.cssText = inputStyle;
          const rLbl = document.createElement('div');
          rLbl.style.cssText = labelStyle; rLbl.textContent = 'R';
          rCol.appendChild(rIn); rCol.appendChild(rLbl);

          // G
          const gCol = document.createElement('div');
          gCol.style.cssText = 'flex:1;';
          const gIn = document.createElement('input');
          gIn.type = 'text'; gIn.maxLength = 3;
          gIn.style.cssText = inputStyle;
          const gLbl = document.createElement('div');
          gLbl.style.cssText = labelStyle; gLbl.textContent = 'G';
          gCol.appendChild(gIn); gCol.appendChild(gLbl);

          // B
          const bCol = document.createElement('div');
          bCol.style.cssText = 'flex:1;';
          const bIn = document.createElement('input');
          bIn.type = 'text'; bIn.maxLength = 3;
          bIn.style.cssText = inputStyle;
          const bLbl = document.createElement('div');
          bLbl.style.cssText = labelStyle; bLbl.textContent = 'B';
          bCol.appendChild(bIn); bCol.appendChild(bLbl);

          inputsRow.appendChild(hexCol);
          inputsRow.appendChild(rCol);
          inputsRow.appendChild(gCol);
          inputsRow.appendChild(bCol);

          // Sync RGB inputs from current color
          const updateInputs = () => {
            hexIn.value = currentColor.toUpperCase();
            rIn.value = parseInt(currentColor.slice(1,3), 16);
            gIn.value = parseInt(currentColor.slice(3,5), 16);
            bIn.value = parseInt(currentColor.slice(5,7), 16);
          };
          updateInputs();

          // Now that inputs exist, upgrade padSetColor to also update them
          padSetColor = (hex) => { setColor(hex); updateInputs(); };

          // Hex input commit
          const commitHex = () => {
            let v = hexIn.value.trim();
            if (!v.startsWith('#')) v = '#' + v;
            if (/^#[0-9a-fA-F]{6}$/.test(v)) {
              hsv = hexToHsv(v);
              padSetColor(v);
              drawPad(); drawHueStrip();
            } else { updateInputs(); }
          };
          hexIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') hexIn.blur(); });
          hexIn.addEventListener('blur', commitHex);

          // RGB input commit
          const commitRgb = () => {
            const r = Math.max(0, Math.min(255, parseInt(rIn.value) || 0));
            const g = Math.max(0, Math.min(255, parseInt(gIn.value) || 0));
            const b = Math.max(0, Math.min(255, parseInt(bIn.value) || 0));
            const hex = '#' + [r,g,b].map(c => c.toString(16).padStart(2,'0')).join('');
            hsv = hexToHsv(hex);
            padSetColor(hex);
            drawPad(); drawHueStrip();
          };
          [rIn, gIn, bIn].forEach(inp => {
            inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
            inp.addEventListener('blur', commitRgb);
          });

          // Prevent clicks inside popup from bubbling to swatch toggle
          popup.addEventListener('click', (e) => e.stopPropagation());

          popup.appendChild(pad);
          popup.appendChild(hueCanvas);
          popup.appendChild(swatchRow);
          popup.appendChild(inputsRow);

          // Position next to the swatch button
          swatchBtn.style.position = 'relative';
          popup.style.right = '0';
          popup.style.top = '100%';
          popup.style.marginTop = 'calc(4px * var(--s))';
          swatchBtn.appendChild(popup);

          requestAnimationFrame(() => { drawPad(); drawHueStrip(); });

          // Close on outside click
          setTimeout(() => {
            this._popupCloseHandler = (e) => {
              if (!popup.contains(e.target) && e.target !== swatchBtn) closePopup();
            };
            document.addEventListener('mousedown', this._popupCloseHandler);
          }, 0);
        };

        const closePopup = () => {
          if (popup && popup.parentNode) popup.parentNode.removeChild(popup);
          popup = null;
          isOpen = false;
          if (this._popupCloseHandler) {
            document.removeEventListener('mousedown', this._popupCloseHandler);
            this._popupCloseHandler = null;
          }
        };

        swatchBtn.addEventListener('click', openPopup);

        row.appendChild(label);
        row.appendChild(swatchBtn);
        return row;
      };

      wrap.appendChild(buildColorRow('Colour 1', 'duotoneColor1', '#ff2a7f'));
      wrap.appendChild(buildColorRow('Colour 2', 'duotoneColor2', '#8f77f8'));

      // Insert after select row
      parent.insertBefore(wrap, selectRow.nextSibling);

      // Tri Tone controls — three colour pickers blended by luminance bands
      const triWrap = document.createElement('div');
      triWrap.className = 'tritone-controls';
      triWrap.appendChild(buildColorRow('Colour 1 (Shadow)', 'tritoneColor1', '#ff2a7f'));
      triWrap.appendChild(buildColorRow('Colour 2 (Mid)', 'tritoneColor2', '#8f77f8'));
      triWrap.appendChild(buildColorRow('Colour 3 (Highlight)', 'tritoneColor3', '#48bec5'));
      parent.insertBefore(triWrap, wrap.nextSibling);

      // Initial gradient sync
      syncGradients();

      // Show/hide based on mode
      const updateVisibility = (mode) => {
        wrap.style.display = mode === 'duotone' ? '' : 'none';
        triWrap.style.display = mode === 'tritone' ? '' : 'none';
      };
      updateVisibility(stateManager.get('colorRemapMode') || 'none');
      stateManager.subscribe('colorRemapMode', (val) => {
        updateVisibility(val);
      });

      // ── Background Color: upgrade native input to custom picker ──
      const bgInput = document.getElementById('backgroundColor');
      if (bgInput) {
        const bgRow = bgInput.closest('.parameter');
        if (bgRow) {
          // Remove native color input
          bgInput.style.display = 'none';

          // Build custom swatch + popup picker
          let bgCurrentColor = stateManager.get('backgroundColor') || '#FFFEF7';
          const bgSwatch = document.createElement('div');
          bgSwatch.className = 'parameter__color';
          bgSwatch.style.cssText = 'cursor:pointer;border-radius:calc(3px * var(--s));';
          bgSwatch.style.backgroundColor = bgCurrentColor;
          bgRow.appendChild(bgSwatch);

          const bgSetColor = (hex) => {
            bgCurrentColor = hex.toLowerCase();
            bgSwatch.style.backgroundColor = bgCurrentColor;
            bgInput.value = bgCurrentColor; // keep native input in sync for undo/redo
            stateManager.set('backgroundColor', bgCurrentColor);
          };

          let bgPopup = null, bgIsOpen = false;
          const BG_PALETTE = ['#FFFEF7','#0E0E0C','#F5F0E8','#1A1A2E','#2D3436','#DFE6E9','#FFEAA7'];

          const bgHexToHsv = (hex) => {
            const r = parseInt(hex.slice(1,3),16)/255, g = parseInt(hex.slice(3,5),16)/255, b = parseInt(hex.slice(5,7),16)/255;
            const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max - min;
            let h = 0, s = max === 0 ? 0 : d / max, v = max;
            if (d !== 0) {
              if (max === r) h = ((g-b)/d + (g<b?6:0))/6;
              else if (max === g) h = ((b-r)/d+2)/6;
              else h = ((r-g)/d+4)/6;
            }
            return { h: h*360, s, v };
          };
          const bgHsvToHex = (h, s, v) => {
            h = ((h%360)+360)%360;
            const c = v*s, x = c*(1-Math.abs((h/60)%2-1)), m = v-c;
            let r,g,b;
            if(h<60){r=c;g=x;b=0;}else if(h<120){r=x;g=c;b=0;}else if(h<180){r=0;g=c;b=x;}
            else if(h<240){r=0;g=x;b=c;}else if(h<300){r=x;g=0;b=c;}else{r=c;g=0;b=x;}
            const toHex = (n) => Math.round((n+m)*255).toString(16).padStart(2,'0');
            return '#' + toHex(r) + toHex(g) + toHex(b);
          };

          let bgHsv = bgHexToHsv(bgCurrentColor);

          const openBgPopup = () => {
            if (bgIsOpen) { closeBgPopup(); return; }
            bgIsOpen = true;
            bgHsv = bgHexToHsv(bgCurrentColor);

            bgPopup = document.createElement('div');
            bgPopup.style.cssText = 'position:absolute;z-index:100;background:var(--card-bg);border:1px solid var(--input-border);border-radius:calc(8px * var(--s));padding:calc(10px * var(--s));box-shadow:0 4px 16px rgba(0,0,0,0.4);width:calc(220px * var(--s));';

            const padSize = 200;
            const pad = document.createElement('canvas');
            pad.width = padSize; pad.height = padSize;
            pad.style.cssText = 'width:100%;aspect-ratio:1;border-radius:calc(4px * var(--s));cursor:crosshair;display:block;';

            const drawPad = () => {
              const ctx = pad.getContext('2d');
              const w = pad.width, h = pad.height;
              ctx.fillStyle = bgHsvToHex(bgHsv.h, 1, 1);
              ctx.fillRect(0, 0, w, h);
              const gw = ctx.createLinearGradient(0, 0, w, 0);
              gw.addColorStop(0, 'rgba(255,255,255,1)');
              gw.addColorStop(1, 'rgba(255,255,255,0)');
              ctx.fillStyle = gw; ctx.fillRect(0, 0, w, h);
              const gb = ctx.createLinearGradient(0, 0, 0, h);
              gb.addColorStop(0, 'rgba(0,0,0,0)');
              gb.addColorStop(1, 'rgba(0,0,0,1)');
              ctx.fillStyle = gb; ctx.fillRect(0, 0, w, h);
              const cx = bgHsv.s * w, cy = (1 - bgHsv.v) * h;
              ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI*2);
              ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
              ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
            };

            let bgPadSetColor = bgSetColor;
            const padMove = (e) => {
              const rect = pad.getBoundingClientRect();
              bgHsv.s = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              bgHsv.v = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
              bgPadSetColor(bgHsvToHex(bgHsv.h, bgHsv.s, bgHsv.v));
              drawPad(); drawHueStrip();
            };
            pad.addEventListener('mousedown', (e) => {
              padMove(e);
              const onMove = (ev) => padMove(ev);
              const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
              document.addEventListener('mousemove', onMove);
              document.addEventListener('mouseup', onUp);
            });

            const hueCanvas = document.createElement('canvas');
            hueCanvas.width = padSize; hueCanvas.height = 14;
            hueCanvas.style.cssText = 'width:100%;height:calc(14px * var(--s));border-radius:calc(3px * var(--s));cursor:pointer;display:block;margin-top:calc(8px * var(--s));';

            const drawHueStrip = () => {
              const ctx = hueCanvas.getContext('2d');
              const w = hueCanvas.width, h = hueCanvas.height;
              const g = ctx.createLinearGradient(0, 0, w, 0);
              for (let i = 0; i <= 6; i++) g.addColorStop(i/6, bgHsvToHex(i*60, 1, 1));
              ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
              const cx = (bgHsv.h / 360) * w;
              ctx.beginPath(); ctx.arc(cx, h/2, h/2 - 1, 0, Math.PI*2);
              ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
            };

            const hueMove = (e) => {
              const rect = hueCanvas.getBoundingClientRect();
              bgHsv.h = Math.max(0, Math.min(360, ((e.clientX - rect.left) / rect.width) * 360));
              bgPadSetColor(bgHsvToHex(bgHsv.h, bgHsv.s, bgHsv.v));
              drawPad(); drawHueStrip();
            };
            hueCanvas.addEventListener('mousedown', (e) => {
              hueMove(e);
              const onMove = (ev) => hueMove(ev);
              const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
              document.addEventListener('mousemove', onMove);
              document.addEventListener('mouseup', onUp);
            });

            const swatchRow = document.createElement('div');
            swatchRow.style.cssText = 'display:flex;gap:4px;margin-top:calc(8px * var(--s));';
            BG_PALETTE.forEach(c => {
              const swatch = document.createElement('div');
              swatch.style.cssText = 'flex:1;height:calc(18px * var(--s));border-radius:calc(3px * var(--s));cursor:pointer;transition:transform 0.1s ease;background:' + c + ';border:1px solid var(--input-border);';
              swatch.addEventListener('mouseenter', () => { swatch.style.transform = 'scale(1.1)'; });
              swatch.addEventListener('mouseleave', () => { swatch.style.transform = ''; });
              swatch.addEventListener('click', () => {
                bgHsv = bgHexToHsv(c);
                bgPadSetColor(c);
                drawPad(); drawHueStrip();
              });
              swatchRow.appendChild(swatch);
            });

            // Hex + RGB inputs
            const inputStyle = 'width:100%;font-family:inherit;font-size:calc(12px * var(--s));background:transparent;border:1px solid var(--input-border);border-radius:calc(3px * var(--s));color:var(--text-primary);padding:3px 4px;text-align:center;box-sizing:border-box;';
            const labelStyle = 'font-size:calc(10px * var(--s));color:var(--text-muted);text-align:center;margin-top:2px;';

            const inputsRow = document.createElement('div');
            inputsRow.style.cssText = 'display:flex;gap:4px;margin-top:calc(8px * var(--s));align-items:start;';

            const hexCol = document.createElement('div'); hexCol.style.cssText = 'flex:2;';
            const hexIn = document.createElement('input'); hexIn.type = 'text'; hexIn.maxLength = 7;
            hexIn.style.cssText = inputStyle; hexIn.value = bgCurrentColor.toUpperCase();
            const hexLbl = document.createElement('div'); hexLbl.style.cssText = labelStyle; hexLbl.textContent = 'HEX';
            hexCol.appendChild(hexIn); hexCol.appendChild(hexLbl);

            const rCol = document.createElement('div'); rCol.style.cssText = 'flex:1;';
            const rIn = document.createElement('input'); rIn.type = 'text'; rIn.maxLength = 3; rIn.style.cssText = inputStyle;
            const rLbl = document.createElement('div'); rLbl.style.cssText = labelStyle; rLbl.textContent = 'R';
            rCol.appendChild(rIn); rCol.appendChild(rLbl);

            const gCol = document.createElement('div'); gCol.style.cssText = 'flex:1;';
            const gIn = document.createElement('input'); gIn.type = 'text'; gIn.maxLength = 3; gIn.style.cssText = inputStyle;
            const gLbl = document.createElement('div'); gLbl.style.cssText = labelStyle; gLbl.textContent = 'G';
            gCol.appendChild(gIn); gCol.appendChild(gLbl);

            const bCol = document.createElement('div'); bCol.style.cssText = 'flex:1;';
            const bIn = document.createElement('input'); bIn.type = 'text'; bIn.maxLength = 3; bIn.style.cssText = inputStyle;
            const bLbl = document.createElement('div'); bLbl.style.cssText = labelStyle; bLbl.textContent = 'B';
            bCol.appendChild(bIn); bCol.appendChild(bLbl);

            inputsRow.appendChild(hexCol); inputsRow.appendChild(rCol); inputsRow.appendChild(gCol); inputsRow.appendChild(bCol);

            const updateInputs = () => {
              hexIn.value = bgCurrentColor.toUpperCase();
              rIn.value = parseInt(bgCurrentColor.slice(1,3), 16);
              gIn.value = parseInt(bgCurrentColor.slice(3,5), 16);
              bIn.value = parseInt(bgCurrentColor.slice(5,7), 16);
            };
            updateInputs();
            bgPadSetColor = (hex) => { bgSetColor(hex); updateInputs(); };

            const commitHex = () => {
              let v = hexIn.value.trim();
              if (!v.startsWith('#')) v = '#' + v;
              if (/^#[0-9a-fA-F]{6}$/.test(v)) {
                bgHsv = bgHexToHsv(v);
                bgPadSetColor(v);
                drawPad(); drawHueStrip();
              } else { updateInputs(); }
            };
            hexIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') hexIn.blur(); });
            hexIn.addEventListener('blur', commitHex);

            const commitRgb = () => {
              const r = Math.max(0, Math.min(255, parseInt(rIn.value) || 0));
              const g = Math.max(0, Math.min(255, parseInt(gIn.value) || 0));
              const b = Math.max(0, Math.min(255, parseInt(bIn.value) || 0));
              const hex = '#' + [r,g,b].map(c => c.toString(16).padStart(2,'0')).join('');
              bgHsv = bgHexToHsv(hex);
              bgPadSetColor(hex);
              drawPad(); drawHueStrip();
            };
            [rIn, gIn, bIn].forEach(inp => {
              inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
              inp.addEventListener('blur', commitRgb);
            });

            bgPopup.addEventListener('click', (e) => e.stopPropagation());
            bgPopup.appendChild(pad);
            bgPopup.appendChild(hueCanvas);
            bgPopup.appendChild(swatchRow);
            bgPopup.appendChild(inputsRow);

            bgSwatch.style.position = 'relative';
            bgPopup.style.right = '0';
            bgPopup.style.top = '100%';
            bgPopup.style.marginTop = 'calc(4px * var(--s))';
            bgSwatch.appendChild(bgPopup);

            requestAnimationFrame(() => { drawPad(); drawHueStrip(); });

            setTimeout(() => {
              this._bgPopupCloseHandler = (e) => {
                if (!bgPopup.contains(e.target) && e.target !== bgSwatch) closeBgPopup();
              };
              document.addEventListener('mousedown', this._bgPopupCloseHandler);
            }, 0);
          };

          const closeBgPopup = () => {
            if (bgPopup && bgPopup.parentNode) bgPopup.parentNode.removeChild(bgPopup);
            bgPopup = null;
            bgIsOpen = false;
            if (this._bgPopupCloseHandler) {
              document.removeEventListener('mousedown', this._bgPopupCloseHandler);
              this._bgPopupCloseHandler = null;
            }
          };

          bgSwatch.addEventListener('click', openBgPopup);

          // Sync swatch when state changes externally (undo/redo)
          stateManager.subscribe('backgroundColor', (hex) => {
            bgCurrentColor = hex || '#FFFEF7';
            bgSwatch.style.backgroundColor = bgCurrentColor;
          });
        }
      }

      // ── Motion Presets ──
      const motionPresets = [
        {
          label: 'Preset 1',
          values: {
            forceDriver: 'cursor',
            velocityPushAmount: 40, cursorRadius: 200,
            attractorRepulsion: 100, springDamping: 0.75, springStrength: 80,
            autoRippleRate: 0
          }
        },
        {
          label: 'Preset 2',
          values: {
            scaleMax: 299, effectMode: 'ripple',
            brightnessVariance: -6, scaleHueRange: 68,
            forceDriver: 'null', nullMode: 'noise',
            noiseNullCount: 4, noiseNullFreq: 0.2, noiseNullStrength: 330,
            velocityPushAmount: 30, cursorRadius: 160,
            attractorRepulsion: 150, springDamping: 0.75, springStrength: 55,
            autoRippleRate: 0, rippleSpeed: 300, rippleWidth: 110,
            rippleDecay: 2, pulseStrength: 50
          }
        },
        {
          label: 'Preset 3',
          values: {
            scaleMax: 299, effectMode: 'ripple',
            brightnessVariance: -6, scaleHueRange: 119,
            forceDriver: 'null', nullMode: 'noise',
            noiseNullCount: 2, noiseNullFreq: 0.2, noiseNullStrength: 500,
            velocityPushAmount: 20, cursorRadius: 380,
            attractorRepulsion: 210, springDamping: 0.75, springStrength: 55,
            autoRippleRate: 0.5, rippleSpeed: 300, rippleWidth: 110,
            rippleDecay: 2, pulseStrength: 16
          }
        },
      ];

      // Find Motion group header
      const groups = content.querySelectorAll('.parameter-group');
      let motionGroup = null;
      groups.forEach(g => {
        const title = g.querySelector('.parameter-group__title');
        if (title && title.textContent.trim() === 'Motion') motionGroup = g;
      });

      if (motionGroup) {
        const gc = motionGroup.querySelector('.parameter-group__content');
        if (gc) {
          const presetBar = document.createElement('div');
          presetBar.style.cssText = 'display:flex;gap:calc(6px * var(--s));margin-bottom:calc(10px * var(--s));';

          const presetBtns = [];

          const checkActive = () => {
            for (let i = 0; i < motionPresets.length; i++) {
              const preset = motionPresets[i];
              const keys = Object.keys(preset.values);
              if (keys.length === 0) { presetBtns[i].classList.remove('parameter__group-btn--active'); continue; }
              const match = keys.every(k => {
                const current = stateManager.get(k);
                const target = preset.values[k];
                return typeof target === 'string' ? current === target : Math.abs((current ?? 0) - target) < 0.01;
              });
              presetBtns[i].classList.toggle('parameter__group-btn--active', match);
            }
          };

          motionPresets.forEach((preset, i) => {
            const btn = document.createElement('button');
            btn.className = 'parameter__group-btn';
            btn.textContent = preset.label;
            btn.style.cssText = 'flex:1;border:1px solid var(--input-border);border-radius:100px;height:var(--btn-group-h);';
            btn.addEventListener('click', () => {
              if (Object.keys(preset.values).length === 0) return;
              stateManager.beginBatch();
              for (const [k, v] of Object.entries(preset.values)) {
                stateManager.set(k, v);
                const param = this.parameters.get(k);
                if (param) {
                  param.value = v;
                  const el = document.getElementById(k);
                  if (el) {
                    if (el.tagName === 'SELECT') el.value = v;
                    else el.value = v;
                    const display = el.closest('.parameter')?.querySelector('.parameter__value');
                    if (display) display.value = v;
                  }
                }
              }
              stateManager.endBatch();
              checkActive();
            });
            presetBtns.push(btn);
            presetBar.appendChild(btn);
          });

          gc.insertBefore(presetBar, gc.firstChild);

          // Subscribe to all motion param changes to update active state
          const motionKeys = new Set();
          motionPresets.forEach(p => Object.keys(p.values).forEach(k => motionKeys.add(k)));
          motionKeys.forEach(k => stateManager.subscribe(k, checkActive));
          checkActive();
        }
      }
    });

    // ── Auto Position indicator ──
    // When Force Driver = Auto + Auto Mode = Position, hovering the Position X/Y
    // sliders shows a dot on the canvas at the configured position. Hidden during export.
    requestAnimationFrame(() => {
      const canvasContainer = document.getElementById('canvas-container');
      if (!canvasContainer) return;
      if (getComputedStyle(canvasContainer).position === 'static') {
        canvasContainer.style.position = 'relative';
      }

      const dot = document.createElement('div');
      dot.className = 'position-indicator';
      dot.style.cssText =
        'position:absolute;width:18px;height:18px;' +
        'border:2px solid rgba(255,255,255,0.95);border-radius:50%;' +
        'box-shadow:0 0 0 1px rgba(0,0,0,0.6),0 0 8px rgba(0,0,0,0.4);' +
        'pointer-events:none;transform:translate(-50%,-50%);' +
        'transition:opacity 0.12s;opacity:0;z-index:10;display:none';
      canvasContainer.appendChild(dot);

      let hovering = false;

      const updatePos = () => {
        const canvas = canvasContainer.querySelector('canvas');
        if (!canvas) return;
        const cRect = canvas.getBoundingClientRect();
        const pRect = canvasContainer.getBoundingClientRect();
        const nx = stateManager.get('nullPositionX') ?? 50;
        const ny = stateManager.get('nullPositionY') ?? 50;
        dot.style.left = ((cRect.left - pRect.left) + (nx / 100) * cRect.width) + 'px';
        dot.style.top  = ((cRect.top  - pRect.top ) + (ny / 100) * cRect.height) + 'px';
      };

      const isExporting = () =>
        typeof app !== 'undefined' && app.renderer && app.renderer._exportInProgress;
      const isActive = () =>
        stateManager.get('forceDriver') === 'null' &&
        stateManager.get('nullMode') === 'position' &&
        hovering && !isExporting();

      const applyVisibility = () => {
        if (isActive()) {
          dot.style.display = '';
          updatePos();
          requestAnimationFrame(() => { dot.style.opacity = '1'; });
        } else {
          dot.style.opacity = '0';
          setTimeout(() => { if (!isActive()) dot.style.display = 'none'; }, 150);
        }
      };

      const attachHover = (id) => {
        const el = document.getElementById(id);
        if (!el) return;
        const row = el.closest('.parameter');
        if (!row) return;
        row.addEventListener('mouseenter', () => { hovering = true; applyVisibility(); });
        row.addEventListener('mouseleave', () => { hovering = false; applyVisibility(); });
      };
      attachHover('nullPositionX');
      attachHover('nullPositionY');

      stateManager.subscribe('nullPositionX', () => { if (isActive()) updatePos(); });
      stateManager.subscribe('nullPositionY', () => { if (isActive()) updatePos(); });
      stateManager.subscribe('forceDriver', applyVisibility);
      stateManager.subscribe('nullMode', applyVisibility);
    });

    // ── Loop Duration display override ──
    // The slider stores a percentage (10-100) of the source video length,
    // but we display the derived seconds value so users can see how long
    // the resulting loop will be.
    requestAnimationFrame(() => {
      const slider = document.getElementById('loopTrim');
      if (!slider) return;
      const row = slider.closest('.parameter');
      const valueEl = row ? row.querySelector('.parameter__value') : null;
      if (!valueEl) return;

      const getSourceDur = () => {
        if (typeof imageSampler !== 'undefined' && imageSampler && imageSampler.hasVideo()) {
          const d = imageSampler.getVideoDuration();
          if (d > 0 && isFinite(d)) return d;
        }
        return 10; // static image fallback (matches _syncLoopDuration)
      };

      const isInput = valueEl.tagName === 'INPUT';
      const write = (txt) => { if (isInput) valueEl.value = txt; else valueEl.textContent = txt; };
      const read  = () => (isInput ? valueEl.value : valueEl.textContent);

      let expected = '';
      const format = () => {
        const pct = parseFloat(slider.value) || 0;
        const secs = (pct / 100) * getSourceDur();
        expected = secs.toFixed(1) + 's';
        if (read() !== expected) write(expected);
      };

      // Slider input fires after the default handler, which writes raw pct → overwrite with seconds.
      slider.addEventListener('input', format);
      stateManager.subscribe('loopTrim', format);

      // If the value is an editable input, allow the user to type seconds directly.
      if (isInput) {
        valueEl.addEventListener('blur', () => {
          const typed = parseFloat(valueEl.value);
          const srcDur = getSourceDur();
          if (!isNaN(typed) && srcDur > 0) {
            const pct = Math.max(10, Math.min(100, (typed / srcDur) * 100));
            slider.value = pct;
            stateManager.set('loopTrim', pct);
          }
          format();
        });
      }

      this._refreshLoopDurationDisplay = format;
      format();
    });
  }

  _buildRandomizerRow() {
    const randBar = document.createElement('div');
    randBar.className = 'settings-bar settings-bar--randomizer';

    const randBtn = document.createElement('button');
    randBtn.className = 'settings-bar__btn settings-bar__btn--randomize';
    randBtn.textContent = 'Randomize';

    // Groups excluded from randomization
    const excludedGroups = new Set(['Motion', 'Fade to Color']);
    // Param IDs that should never be randomized (mode selectors)
    const excludedIds = new Set(['maskMode', 'textureMode', 'forceDriver']);

    randBtn.addEventListener('click', () => {
      stateManager.beginBatch();
      const lowPct = 0.2;
      const highPct = 0.8;

      this.parameters.forEach((param) => {
        if (param.locked) return;
        if (param.hidden) return;
        if (excludedGroups.has(param.group)) return;
        if (excludedIds.has(param.id)) return;
        if (param.type !== 'slider' && param.type !== 'button-group' && param.type !== 'number') return;

        // Only randomize visible params (respects conditional visibility)
        const el = document.getElementById(param.id);
        if (el) {
          const row = el.closest('.parameter');
          if (row && row.style.display === 'none') return;
        }

        if (param.type === 'button-group') {
          const opts = param.options;
          const pick = opts[Math.floor(Math.random() * opts.length)];
          param.setValue(pick.value);
          if (param._buttonRow) {
            param._buttonRow.querySelectorAll('.parameter__group-btn').forEach(b => {
              b.classList.toggle('parameter__group-btn--active', String(b.dataset.value) === String(pick.value));
            });
          }
          return;
        }

        const range = param.max - param.min;
        const minVal = param.min + range * lowPct;
        const maxVal = param.min + range * highPct;
        const steps = Math.round((maxVal - minVal) / param.step);
        const randomSteps = Math.floor(Math.random() * (steps + 1));
        const val = parseFloat((minVal + randomSteps * param.step).toFixed(10));
        const clamped = Math.max(param.min, Math.min(param.max, val));

        param.setValue(clamped);
        stateManager.set(param.id, clamped);

        if (el) {
          el.value = clamped;
          const container = el.closest('.parameter');
          const display = container ? container.querySelector('.parameter__value') : null;
          if (display) display.value = clamped;
        }
      });

      // Randomize video timeline position (if video loaded and not locked)
      if (typeof app !== 'undefined' && app._defaultVideoScrubLocked !== true &&
          typeof imageSampler !== 'undefined' && imageSampler && imageSampler.hasVideo()) {
        const pct = Math.random();
        imageSampler.seekPercent(pct);
        if (app._defaultProgressBar) {
          app._defaultProgressBar.value = pct * 1000;
        }
      }
      stateManager.endBatch();
    });

    randBar.appendChild(randBtn);
    return randBar;
  }

  _getExtraSettingsData() {
    const extra = {};
    if (typeof imageSampler !== 'undefined' && imageSampler && imageSampler.hasVideo()) {
      extra._defaultTextureProgress = imageSampler.getVideoProgress();
      extra._defaultTexturePaused = !imageSampler.isPlaying;
    }
    return extra;
  }

  _onSettingsApplied(settings) {
    if (typeof settings._defaultTextureProgress !== 'number') return;

    // The default-texture video may still be loading (async) when settings
    // are applied — e.g. on page load, or after a textureMode flip. Retry
    // until hasVideo() is true, then seek.
    const pct = settings._defaultTextureProgress;
    const shouldPause = settings._defaultTexturePaused === true;
    let tries = 0;
    const tryApply = () => {
      if (typeof imageSampler === 'undefined' || !imageSampler || !imageSampler.hasVideo()) {
        if (tries++ < 40) setTimeout(tryApply, 50);
        return;
      }
      imageSampler.seekPercent(pct);
      if (typeof app !== 'undefined' && app && app._defaultProgressBar) {
        app._defaultProgressBar.value = pct * 1000;
      }
      if (shouldPause) {
        imageSampler.pause();
        if (typeof app !== 'undefined' && app && app._defaultPlayBtn) {
          app._defaultPlayBtn.innerHTML = '\u25b6';
        }
      } else {
        // Match save-time playing state: start playing from the seeked point.
        imageSampler.play();
        if (typeof app !== 'undefined' && app && app._defaultPlayBtn) {
          app._defaultPlayBtn.innerHTML = '\u275a\u275a';
        }
      }
    };
    tryApply();
  }

  _processLoadedSettings(settings) {
    // Detect palette-only JSON and route to PaletteProcessor
    if (typeof PaletteProcessor !== 'undefined' && PaletteProcessor.isPaletteJSON &&
        PaletteProcessor.isPaletteJSON(settings)) {
      if (typeof paletteProcessor !== 'undefined' && paletteProcessor) {
        paletteProcessor.loadSettings(settings);
        stateManager.set('colorProcessingMode', 'loop-generator');
        stateManager.set('hueGradientEnable', true);
        const modeEl = document.getElementById('colorProcessingMode');
        if (modeEl) { modeEl.value = 'loop-generator'; }
        const enableEl = document.getElementById('hueGradientEnable');
        if (enableEl) { enableEl.checked = true; }
        console.log('Palette settings loaded into PaletteProcessor');
      }
    } else {
      this._applySettings(settings);
      console.log('Settings loaded successfully');
    }
  }

  _buildExportRow(cardBody) {
    const exportBar = document.createElement('div');
    exportBar.className = 'settings-bar settings-bar--export';

    const formatSelect = document.createElement('select');
    formatSelect.className = 'settings-bar__select';
    formatSelect.id = 'exportFormat';
    for (const [value, label, videoOnly] of [
      ['svg', 'SVG', false],
      ['png', 'PNG', false],
      ['png-sequence', 'PNG Sequence', true],
      ['mp4', 'MP4', true],
      ['gif', 'GIF', true],
      ['mp4-record', 'MP4 Recording', false],
    ]) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      if (videoOnly) {
        opt.disabled = true;
        opt.dataset.videoOnly = 'true';
      }
      formatSelect.appendChild(opt);
    }

    // Enable/disable video options when a video is loaded
    this._updateVideoExportOptions = () => {
      const hasVideo = typeof imageSampler !== 'undefined' && imageSampler && imageSampler.hasVideo();
      formatSelect.querySelectorAll('option[data-video-only]').forEach(opt => {
        opt.disabled = !hasVideo;
      });
    };

    const resSelect = document.createElement('select');
    resSelect.className = 'settings-bar__select';
    resSelect.id = 'exportResolution';
    resSelect.style.display = 'none';

    const fpsSelect = document.createElement('select');
    fpsSelect.className = 'settings-bar__select';
    fpsSelect.id = 'exportFramerate';
    fpsSelect.style.display = 'none';

    const updateResolutionOptions = () => {
      const format = formatSelect.value;
      const resMap = {
        'svg': null,
        'png': [1024, 2048, 4096, 8192, 12288, 16384],
        'png-sequence': [1024, 2048, 4096, 8192, 12288, 16384],
        'mp4': [720, 1080, 1440, 2048, 4096],
        'gif': [320, 480, 640, 720],
      };
      const defaultRes = { 'png': 4096, 'png-sequence': 4096, 'mp4': 1080, 'gif': 480 };
      const sizes = resMap[format];
      if (!sizes) {
        resSelect.style.display = 'none';
      } else {
        resSelect.style.display = '';
        resSelect.innerHTML = '';
        for (const size of sizes) {
          const opt = document.createElement('option');
          opt.value = size;
          opt.textContent = size + 'px';
          if (size === defaultRes[format]) opt.selected = true;
          resSelect.appendChild(opt);
        }
      }

      // Framerate options: only for video-frame exports (not gif — capped separately)
      const fpsMap = {
        'png-sequence': [24, 30, 60, 120],
        'mp4': [24, 30, 60, 120],
      };
      const sourceFps = (typeof imageSampler !== 'undefined' && imageSampler && imageSampler.videoFramerate)
        ? Math.round(imageSampler.videoFramerate) : 30;
      const fpsList = fpsMap[format];
      if (!fpsList) {
        fpsSelect.style.display = 'none';
      } else {
        fpsSelect.style.display = '';
        fpsSelect.innerHTML = '';
        // Include the source video's native fps if not already in the list
        const merged = Array.from(new Set([...fpsList, sourceFps])).sort((a, b) => a - b);
        for (const fps of merged) {
          const opt = document.createElement('option');
          opt.value = fps;
          opt.textContent = fps + ' fps' + (fps === sourceFps ? ' (source)' : '');
          if (fps === sourceFps) opt.selected = true;
          fpsSelect.appendChild(opt);
        }
      }
    };
    const updateExportBtn = () => {
      const isRecording = formatSelect.value === 'mp4-record';
      exportBtn.textContent = isRecording
        ? (app.realtimeRecorder && app.realtimeRecorder.isRecording ? 'Stop' : 'Record')
        : 'Export';
    };
    formatSelect.addEventListener('change', () => { updateResolutionOptions(); updateExportBtn(); });
    updateResolutionOptions();

    const exportBtn = document.createElement('button');
    exportBtn.className = 'settings-bar__btn settings-bar__btn--export-action';
    exportBtn.textContent = 'Export';
    exportBtn.addEventListener('click', () => {
      const format = formatSelect.value;
      switch (format) {
        case 'svg': this._exportSVG(); break;
        case 'png': this._exportPNG(); break;
        case 'png-sequence': this._startVideoExport('png'); break;
        case 'mp4': this._startVideoExport('mp4'); break;
        case 'gif': this._startVideoExport('gif'); break;
        case 'mp4-record': this._toggleRecordExport(exportBtn); break;
      }
    });

    // Settings button: opens a popup containing the resolution + framerate
    // dropdowns for the current format. The dropdowns themselves still live
    // in the DOM (inside the popup) so existing #exportResolution /
    // #exportFramerate lookups in _startVideoExport / _exportPNG still work.
    const settingsWrap = document.createElement('div');
    settingsWrap.style.cssText = 'position:relative;display:inline-flex;';

    const settingsBtn = document.createElement('button');
    settingsBtn.className = 'settings-bar__btn settings-bar__btn--export-action settings-bar__btn--export-settings';
    settingsBtn.type = 'button';
    settingsBtn.setAttribute('aria-label', 'Export settings');
    settingsBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

    let settingsPopup = null;
    let settingsOpen = false;
    let settingsCloseHandler = null;

    const closeSettingsPopup = () => {
      // Move the selects back to the hidden host so id lookups still resolve.
      if (typeof hiddenHost !== 'undefined' && hiddenHost) {
        if (resSelect.parentNode !== hiddenHost) hiddenHost.appendChild(resSelect);
        if (fpsSelect.parentNode !== hiddenHost) hiddenHost.appendChild(fpsSelect);
      }
      if (settingsPopup) {
        if (settingsPopup._cleanup) settingsPopup._cleanup();
        if (settingsPopup.parentNode) settingsPopup.parentNode.removeChild(settingsPopup);
      }
      settingsPopup = null;
      settingsOpen = false;
      if (settingsCloseHandler) {
        document.removeEventListener('mousedown', settingsCloseHandler);
        settingsCloseHandler = null;
      }
    };

    const openSettingsPopup = () => {
      if (settingsOpen) { closeSettingsPopup(); return; }
      settingsOpen = true;

      settingsPopup = document.createElement('div');
      // position:fixed escapes any ancestor overflow:hidden (panels, capsules)
      settingsPopup.style.cssText = 'position:fixed;z-index:1000;background:var(--card-bg);border:1px solid var(--input-border);border-radius:calc(8px * var(--s));padding:calc(10px * var(--s));box-shadow:0 4px 16px rgba(0,0,0,0.4);display:flex;flex-direction:column;gap:calc(8px * var(--s));min-width:calc(180px * var(--s));';

      const makeRow = (labelText, control) => {
        if (control.style.display === 'none') return null;
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:calc(10px * var(--s));';
        const lbl = document.createElement('span');
        lbl.textContent = labelText;
        lbl.style.cssText = 'font-size:calc(11px * var(--s));color:var(--text-muted, #aaa);';
        control.style.flex = '1';
        row.appendChild(lbl);
        row.appendChild(control);
        return row;
      };

      const resRow = makeRow('Resolution', resSelect);
      const fpsRow = makeRow('Framerate', fpsSelect);
      if (resRow) settingsPopup.appendChild(resRow);
      if (fpsRow) settingsPopup.appendChild(fpsRow);
      if (!resRow && !fpsRow) {
        const empty = document.createElement('div');
        empty.textContent = 'No settings for this format.';
        empty.style.cssText = 'font-size:calc(11px * var(--s));color:var(--text-muted, #aaa);';
        settingsPopup.appendChild(empty);
      }

      settingsPopup.addEventListener('click', (e) => e.stopPropagation());
      // Append to body so it escapes any ancestor overflow clipping
      document.body.appendChild(settingsPopup);

      // Position below the gear button, right-aligned to it
      const positionPopup = () => {
        const r = settingsBtn.getBoundingClientRect();
        const margin = 6;
        // Measure popup after it's in the DOM
        const pw = settingsPopup.offsetWidth;
        const ph = settingsPopup.offsetHeight;
        let left = r.right - pw;
        let top = r.bottom + margin;
        // Clamp to viewport
        left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
        if (top + ph > window.innerHeight - 8) {
          top = Math.max(8, r.top - ph - margin);
        }
        settingsPopup.style.left = left + 'px';
        settingsPopup.style.top = top + 'px';
      };
      positionPopup();
      // Reposition on scroll/resize while open
      const reposition = () => positionPopup();
      window.addEventListener('scroll', reposition, true);
      window.addEventListener('resize', reposition);
      settingsPopup._cleanup = () => {
        window.removeEventListener('scroll', reposition, true);
        window.removeEventListener('resize', reposition);
      };

      setTimeout(() => {
        settingsCloseHandler = (e) => {
          if (settingsPopup && !settingsPopup.contains(e.target) && e.target !== settingsBtn && !settingsBtn.contains(e.target)) {
            closeSettingsPopup();
          }
        };
        document.addEventListener('mousedown', settingsCloseHandler);
      }, 0);
    };
    settingsBtn.addEventListener('click', openSettingsPopup);

    const updateSettingsBtnVisibility = () => {
      const anyVisible = resSelect.style.display !== 'none' || fpsSelect.style.display !== 'none';
      settingsWrap.style.display = anyVisible ? '' : 'none';
      if (!anyVisible && settingsOpen) closeSettingsPopup();
    };
    formatSelect.addEventListener('change', () => {
      // If popup is open when format changes, rebuild it so rows reflect the new format
      if (settingsOpen) { closeSettingsPopup(); }
      updateSettingsBtnVisibility();
    });
    updateSettingsBtnVisibility();

    settingsWrap.appendChild(settingsBtn);

    exportBar.appendChild(formatSelect);
    exportBar.appendChild(settingsWrap);
    exportBar.appendChild(exportBtn);

    // Keep the dropdowns in the DOM (hidden) when popup is closed so id-based
    // lookups still resolve. They get reparented into the popup on open.
    const hiddenHost = document.createElement('div');
    hiddenHost.style.display = 'none';
    hiddenHost.appendChild(resSelect);
    hiddenHost.appendChild(fpsSelect);
    exportBar.appendChild(hiddenHost);

    // Progress container
    const progressContainer = document.createElement('div');
    progressContainer.className = 'export-progress';
    progressContainer.id = 'videoExportProgress';
    progressContainer.style.display = 'none';

    const progressBar = document.createElement('div');
    progressBar.className = 'export-progress__bar';
    const progressFill = document.createElement('div');
    progressFill.className = 'export-progress__fill';
    progressFill.id = 'videoExportFill';
    progressBar.appendChild(progressFill);

    const progressLabel = document.createElement('span');
    progressLabel.className = 'export-progress__label';
    progressLabel.id = 'videoExportLabel';
    progressLabel.textContent = '0 / 0';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'export-progress__cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => this._cancelVideoExport());

    progressContainer.appendChild(progressBar);
    progressContainer.appendChild(progressLabel);
    progressContainer.appendChild(cancelBtn);

    const exportsLabel = document.createElement('div');
    exportsLabel.className = 'settings-bar__label settings-bar__label--exports';
    exportsLabel.textContent = 'Exports';

    cardBody.appendChild(exportsLabel);
    cardBody.appendChild(exportBar);
    cardBody.appendChild(progressContainer);

  }

  _startVideoExport(format) {
    if (typeof app === 'undefined' || !app.renderer || !imageSampler || !imageSampler.hasVideo()) {
      alert('Cannot export video: no video loaded or renderer not initialized.');
      return;
    }

    const fpsSelect = document.getElementById('exportFramerate');
    const sourceFps = Math.round(imageSampler.videoFramerate) || 30;
    const framerate = parseInt(fpsSelect ? fpsSelect.value : '') || sourceFps;
    const resSelect = document.getElementById('exportResolution');
    const size = parseInt(resSelect ? resSelect.value : '') || (format === 'mp4' ? 1080 : 4096);

    const progressEl = document.getElementById('videoExportProgress');
    const fillEl = document.getElementById('videoExportFill');
    const labelEl = document.getElementById('videoExportLabel');
    progressEl.style.display = '';

    this._videoExporter = new VideoExporter({
      p5Instance: app.p5Instance,
      renderer: app.renderer,
      imageSampler: imageSampler,
    });

    this._videoExporter.onProgress = (frame, total) => {
      const pct = (frame / total * 100).toFixed(1);
      fillEl.style.width = pct + '%';
      labelEl.textContent = frame + ' / ' + total;
    };

    this._videoExporter.onComplete = () => {
      progressEl.style.display = 'none';
      fillEl.style.width = '0%';
      this._videoExporter = null;
    };

    this._videoExporter.onError = (err) => {
      alert('Export failed: ' + err.message);
      progressEl.style.display = 'none';
      fillEl.style.width = '0%';
      this._videoExporter = null;
    };

    // Derive export dims from the *padded* live canvas aspect (live canvas is
    // already fit to texture aspect; the 200px motion buffer in the renderer
    // shifts the aspect slightly). Matching this aspect means the live render
    // fits the export buffer exactly — no letterbox bands.
    let exportW = size, exportH = size;
    const liveW = app.p5Instance.width || 0;
    const liveH = app.p5Instance.height || 0;
    const RENDER_PAD_PX = 200; // must match WebGLGridRenderer.renderToTarget
    if (liveW > 0 && liveH > 0) {
      const paddedW = liveW + 2 * RENDER_PAD_PX;
      const paddedH = liveH + 2 * RENDER_PAD_PX;
      const aspect = paddedW / paddedH;
      if (aspect >= 1) {
        exportW = size;
        exportH = Math.round(size / aspect);
      } else {
        exportH = size;
        exportW = Math.round(size * aspect);
      }
      // Force even dims for H.264
      exportW = Math.max(2, exportW - (exportW % 2));
      exportH = Math.max(2, exportH - (exportH % 2));
    }
    const opts = { framerate, width: exportW, height: exportH };
    if (format === 'png') {
      this._videoExporter.exportPNGSequence(opts);
    } else if (format === 'gif') {
      // GIF: cap framerate for file size, use source fps capped at 15
      opts.framerate = Math.min(framerate, 15);
      this._videoExporter.exportGIF(opts);
    } else {
      this._videoExporter.exportMP4(opts);
    }
  }

  _cancelVideoExport() {
    if (this._videoExporter) {
      this._videoExporter.cancel();
    }
  }

  // ─── Real-time recording via export dropdown ─────────────────

  async _toggleRecordExport(btn) {
    const recorder = app.realtimeRecorder;
    if (!recorder) return;

    if (recorder.isRecording) {
      await recorder.stop();
      btn.textContent = 'Record';
      btn.classList.remove('is-recording');
      if (this._recordingInterval) {
        clearInterval(this._recordingInterval);
        this._recordingInterval = null;
      }
    } else {
      if (!app.p5Instance) return;

      recorder.onError = (err) => {
        alert('Recording failed: ' + err.message);
        btn.textContent = 'Record';
        btn.classList.remove('is-recording');
        if (this._recordingInterval) { clearInterval(this._recordingInterval); this._recordingInterval = null; }
      };

      recorder.onStop = () => {
        btn.textContent = 'Record';
        btn.classList.remove('is-recording');
        if (this._recordingInterval) { clearInterval(this._recordingInterval); this._recordingInterval = null; }
      };

      const canvasEl = app.p5Instance.drawingContext.canvas;
      await recorder.start(canvasEl);

      if (recorder.isRecording) {
        btn.classList.add('is-recording');
        btn.textContent = '00:00';
        this._recordingInterval = setInterval(() => {
          const secs = recorder.getElapsedSeconds();
          const m = Math.floor(secs / 60);
          const s = Math.floor(secs % 60);
          btn.textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
        }, 500);
      }
    }
  }

  /**
   * PNG export: render the current frame at high resolution via WebGL.
   * Uses the screen-resolution grid layout scaled up to export size so
   * push offsets and scale values match the live view exactly.
   */
  _exportPNG() {
    if (typeof app === 'undefined' || !app.renderer) {
      alert('Cannot export PNG: renderer not initialized');
      return;
    }
    const renderer = app.renderer;
    const resSelect = document.getElementById('exportResolution');
    const size = parseInt(resSelect ? resSelect.value : '') || 4096;
    const prefix = this._getExportPrefix();

    // Preserve the padded live canvas aspect (what PNG-sequence uses) so the
    // export buffer matches the live composition exactly — no letterbox, no
    // mismatched geometry.
    const srcW = app.p5Instance.width;
    const srcH = app.p5Instance.height;
    const aspect = srcW / srcH;
    let exportW, exportH;
    if (aspect >= 1) { exportW = size; exportH = Math.round(size / aspect); }
    else { exportH = size; exportW = Math.round(size * aspect); }

    renderer._exportTransparent = true;
    const finalPixels = renderer.renderToPixels(exportW, exportH);
    renderer._exportTransparent = false;
    if (!finalPixels) { alert('PNG export failed'); return; }

    const canvas = document.createElement('canvas');
    canvas.width = exportW; canvas.height = exportH;
    const ctx = canvas.getContext('2d');
    ctx.putImageData(new ImageData(finalPixels, exportW, exportH), 0, 0);

    canvas.toBlob((pngBlob) => {
      if (!pngBlob) return;
      const url = URL.createObjectURL(pngBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = prefix + '-' + exportW + 'x' + exportH + '-' + this._exportTimestamp() + '.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 'image/png');
  }
}
