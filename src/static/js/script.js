const API = 'http://127.0.0.1:5000'; // backend base
let activeColour = 'red';
let enabledMaskColors = new Set(); // colors currently visible
// let requestRepaint = null;         // hook to ask current canvas to redraw
let requestSetCurrentMask = null;
let requestSetMaskShow = null;
let canvas = null;
// predefined mask categories mapped to colors
let maskCategories = [];
const FALLBACK_CATEGORIES = [
  { id: 'rbc', 
    name: 'Red blood cells',   
    color: '#DC143C' 
  },

  { id: 'wbc', 
    name: 'White blood cells', 
    color: '#FF1493' 
  },

  { id: 'plasma', 
    name: 'Plasma',
    color: '#40E0D0' 
  },
  // trial colour
  { id: 'benikakehana', 
    name: 'Benikakenhana', 
    color:'#4E4F97'
  }

];

const VIS_GLOBAL_KEY = '__global__';
const maskVisibilityByImage = new Map();

function getVisibleSetForCurrentImage() {
  const key = currentFile || VIS_GLOBAL_KEY;
  if (!maskVisibilityByImage.has(key)) maskVisibilityByImage.set(key, new Set());
  return maskVisibilityByImage.get(key);
}

function openColorModal(initialHex = '#9999ff', onPicked) {
  const modal   = document.getElementById('colorModal');
  const sv      = document.getElementById('svCanvas');
  const hueBar  = document.getElementById('hueCanvas');
  const hexIn   = document.getElementById('uiHex');
  const preview = document.getElementById('uiPreview');
  const btnUse  = document.getElementById('colorUse');
  const btnCancel = document.getElementById('colorCancel');
  if (!modal || !sv || !hueBar || !hexIn || !preview || !btnUse || !btnCancel) return;

  // ---------- math utils ----------
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  function hexNorm(h){ let s=String(h||'').trim().replace('#',''); if(s.length===3)s=s.split('').map(c=>c+c).join(''); if(!/^[0-9a-fA-F]{6}$/.test(s)) s='9999ff'; return '#'+s.toLowerCase(); }
  function hexToRgb(h){ h=hexNorm(h).slice(1); const i=parseInt(h,16); return {r:(i>>16)&255,g:(i>>8)&255,b:i&255}; }
  function rgbToHex(r,g,b){ return '#'+[r,g,b].map(v=>clamp(v,0,255).toString(16).padStart(2,'0')).join(''); }
  function rgbToHsv(r,g,b){
    r/=255; g/=255; b/=255;
    const max=Math.max(r,g,b), min=Math.min(r,g,b), d=max-min;
    let h=0;
    if (d!==0){
      if (max===r) h=((g-b)/d)%6;
      else if (max===g) h=(b-r)/d+2;
      else h=(r-g)/d+4;
      h*=60; if(h<0)h+=360;
    }
    const s = max===0 ? 0 : d/max;
    return {h, s, v:max};
  }
  function hsvToRgb(h,s,v){
    const c=v*s, x=c*(1-Math.abs(((h/60)%2)-1)), m=v-c;
    let r=0,g=0,b=0;
    if (0<=h&&h<60){r=c;g=x;}
    else if (60<=h&&h<120){r=x;g=c;}
    else if (120<=h&&h<180){g=c;b=x;}
    else if (180<=h&&h<240){g=x;b=c;}
    else if (240<=h&&h<300){r=x;b=c;}
    else {r=c;b=x;}
    return { r:Math.round((r+m)*255), g:Math.round((g+m)*255), b:Math.round((b+m)*255) };
  }

  // ---------- canvas helpers ----------
  const DPR = window.devicePixelRatio || 1;
  function setupCanvas(canvas, cssW, cssH){
    canvas.width = Math.round(cssW*DPR); canvas.height=Math.round(cssH*DPR);
    canvas.style.width = cssW+'px'; canvas.style.height = cssH+'px';
    const ctx = canvas.getContext('2d'); ctx.setTransform(DPR,0,0,DPR,0,0);
    return ctx;
  }
  const svW=260, svH=160, hueW=260, hueH=16;
  const svCtx  = setupCanvas(sv, svW, svH);
  const hueCtx = setupCanvas(hueBar, hueW, hueH);

  // ---------- state ----------
  // start from hex -> hsv
  const {r:ir,g:ig,b:ib} = hexToRgb(initialHex);
  let {h, s, v} = rgbToHsv(ir, ig, ib);

  function currentHex(){
    const {r,g,b} = hsvToRgb(h,s,v);
    return rgbToHex(r,g,b);
  }
  function setHexUI(){
    const hex = currentHex();
    hexIn.value = hex;
    preview.style.background = hex;
  }

  // ---------- drawing ----------
  function drawHue(){
    const grad = hueCtx.createLinearGradient(0,0,hueW,0);
    const stops = [
      [0,'#ff0000'], [1/6,'#ffff00'], [2/6,'#00ff00'],
      [3/6,'#00ffff'], [4/6,'#0000ff'], [5/6,'#ff00ff'], [1,'#ff0000']
    ];
    stops.forEach(([p,c])=>grad.addColorStop(p,c));
    hueCtx.clearRect(0,0,hueW,hueH);
    hueCtx.fillStyle = grad; hueCtx.fillRect(0,0,hueW,hueH);

    // marker
    const x = clamp((h/360)*hueW, 0, hueW-1);
    hueCtx.beginPath();
    hueCtx.arc(x, hueH/2, 7, 0, Math.PI*2);
    hueCtx.lineWidth = 2;
    hueCtx.strokeStyle = '#fff';
    hueCtx.stroke();
    hueCtx.beginPath();
    hueCtx.arc(x, hueH/2, 4, 0, Math.PI*2);
    hueCtx.fillStyle = currentHex();
    hueCtx.fill();
    hueCtx.strokeStyle = 'rgba(0,0,0,.35)';
    hueCtx.stroke();
  }

  function drawSV(){
    // base hue at full sat/value
    const base = hsvToRgb(h,1,1);
    svCtx.clearRect(0,0,svW,svH);

    // horizontal: white -> hue
    const g1 = svCtx.createLinearGradient(0,0,svW,0);
    g1.addColorStop(0, 'rgba(255,255,255,1)');
    g1.addColorStop(1, `rgba(${base.r},${base.g},${base.b},1)`);
    svCtx.fillStyle = g1; svCtx.fillRect(0,0,svW,svH);

    // vertical: transparent -> black
    const g2 = svCtx.createLinearGradient(0,0,0,svH);
    g2.addColorStop(0, 'rgba(0,0,0,0)');
    g2.addColorStop(1, 'rgba(0,0,0,1)');
    svCtx.fillStyle = g2; svCtx.fillRect(0,0,svW,svH);

    // marker
    const x = clamp(s*svW, 0, svW-1);
    const y = clamp((1-v)*svH, 0, svH-1);
    svCtx.beginPath();
    svCtx.arc(x, y, 7, 0, Math.PI*2);
    svCtx.lineWidth = 2;
    svCtx.strokeStyle = '#fff';
    svCtx.stroke();
    svCtx.beginPath();
    svCtx.arc(x, y, 4, 0, Math.PI*2);
    svCtx.fillStyle = currentHex();
    svCtx.fill();
    svCtx.strokeStyle = 'rgba(0,0,0,.35)';
    svCtx.stroke();
  }

  function redraw(){ drawHue(); drawSV(); setHexUI(); }

  // ---------- interactions ----------
  function pickSV(ev){
    const r = sv.getBoundingClientRect();
    const x = clamp(ev.clientX - r.left, 0, svW);
    const y = clamp(ev.clientY - r.top,  0, svH);
    s = clamp(x / svW, 0, 1);
    v = clamp(1 - y / svH, 0, 1);
    redraw();
  }
  function pickHue(ev){
    const r = hueBar.getBoundingClientRect();
    const x = clamp(ev.clientX - r.left, 0, hueW);
    h = clamp((x / hueW) * 360, 0, 360);
    redraw();
  }

  let dragSV=false, dragHue=false;
  sv.addEventListener('pointerdown', e => { dragSV=true; sv.setPointerCapture(e.pointerId); pickSV(e); });
  sv.addEventListener('pointermove', e => { if (dragSV) pickSV(e); });
  sv.addEventListener('pointerup',   e => { dragSV=false; try{sv.releasePointerCapture(e.pointerId);}catch{} });
  sv.addEventListener('pointerleave',() => { dragSV=false; });

  hueBar.addEventListener('pointerdown', e => { dragHue=true; hueBar.setPointerCapture(e.pointerId); pickHue(e); });
  hueBar.addEventListener('pointermove', e => { if (dragHue) pickHue(e); });
  hueBar.addEventListener('pointerup',   e => { dragHue=false; try{hueBar.releasePointerCapture(e.pointerId);}catch{} });
  hueBar.addEventListener('pointerleave',() => { dragHue=false; });

  // manual hex edit
  const onHex = () => {
    const {r,g,b} = hexToRgb(hexIn.value);
    const hsv = rgbToHsv(r,g,b);
    h=hsv.h; s=hsv.s; v=hsv.v;
    redraw();
  };
  hexIn.addEventListener('input', onHex);

  function cleanup(){
    hexIn.removeEventListener('input', onHex);
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden','true');
    document.removeEventListener('keydown', onEsc);
  }
  function onEsc(e){ if (e.key === 'Escape') cleanup(); }
  document.addEventListener('keydown', onEsc);

  btnUse.onclick = () => { onPicked && onPicked(currentHex()); cleanup(); };
  btnCancel.onclick = cleanup;

  // show + first paint
  modal.classList.add('open');
  modal.setAttribute('aria-hidden','false');
  redraw();
}

function resetEnabledMaskColors(){
  enabledMaskColors = new Set(maskCategories.map(c => String(c.id)));
}

async function refreshCoverageUI() {
  if (!currentFile) return;

  const covered = await loadCoverageForCurrentImage();

  const visibleSet = getVisibleSetForCurrentImage();
  visibleSet.clear();
  covered.forEach(id => visibleSet.add(String(id)));

  enabledMaskColors = new Set(visibleSet);
  maskCategories.forEach(cat => {
    const id = String(cat.id);
    const chk = document.getElementById(`mask_${id}`);
    if (chk) chk.checked = visibleSet.has(id);
  });

  if (typeof requestSetMaskShow === 'function') requestSetMaskShow();
}


async function loadCoverageForCurrentImage() {
  if (!currentFile) return new Set();
  const q = new URLSearchParams({ file: currentFile });
  const res = await fetch(`/mask-coverage?${q.toString()}`);
  if (!res.ok) return new Set();
  const data = await res.json();
  return new Set((data || []).map(r => String(r.id)));
}

async function loadCategories() {
  try {
    const res = await fetch(`${API}/categories`);
    if (!res.ok) throw new Error('fetch failed');
    const data = await res.json();
    // normalize id to string so canvas layer map works consistently
    maskCategories = data.map(c => ({ ...c, id: String(c.id) }));
  } catch {
    // if backend not ready, use fallback
    maskCategories = FALLBACK_CATEGORIES.slice();
  }
  enabledMaskColors = new Set(getVisibleSetForCurrentImage());
  renderMaskUI();
}

async function createCategory(name, color) {
  const res = await fetch(`${API}/categories`, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ name, color })
  });
  if (!res.ok) {
    const err = await res.json().catch(()=> ({}));
    throw new Error(err.error || 'failed to create category');
  }
  return res.json();
}

// build Mask + Color UI
function renderMaskUI(){
  const colorOptsContainer = document.getElementById('colorOptions');
  if (colorOptsContainer && !colorOptsContainer.dataset._boundStop) {
    colorOptsContainer.addEventListener('click', (e) => e.stopPropagation());
    colorOptsContainer.dataset._boundStop = '1';
  }
  if (colorOptsContainer){
    colorOptsContainer.innerHTML = '';
    maskCategories.forEach(cat => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '8px';
      row.style.cursor = 'pointer';

      const sw = document.createElement('div');
      sw.className = 'color-option';
      sw.dataset.color = cat.color;
      sw.style.backgroundColor = cat.color;
      sw.title = cat.name;

      const label = document.createElement('span');
      label.textContent = cat.name;

      row.appendChild(sw);
      row.appendChild(label);
      row.addEventListener('click', () => {
        if (typeof requestSetCurrentMask === 'function') requestSetCurrentMask(String(cat.id), cat.color);
        try { document.getElementById('colorBtnr').style.backgroundColor = cat.color; } catch {}
      });
      colorOptsContainer.appendChild(row);
    });
  }

  const maskList = document.getElementById('maskList');
  const visibleSet = getVisibleSetForCurrentImage();
  if (maskList && !maskList.dataset._boundStop) {
    maskList.addEventListener('click', (e) => e.stopPropagation());
    maskList.dataset._boundStop = '1';
  }
  if (maskList){
    maskList.innerHTML = '';

    // --- form: name + color (via modal) ---
    const form = document.createElement('div');
    form.style.display = 'grid';
    form.style.gridTemplateColumns = '1fr auto auto';
    form.style.gap = '6px';
    form.style.margin = '6px 0 10px 0';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'New mask name';
    nameInput.style.padding = '6px 8px';

    // hidden storage + preview chip + "Pick color" button
    const colorInput = document.createElement('input');
    colorInput.type = 'hidden';
    colorInput.value = '#9999ff';

    const colorCell = document.createElement('div');
    colorCell.style.display = 'flex';
    colorCell.style.alignItems = 'center';
    colorCell.style.gap = '8px';

    const preview = document.createElement('span');
    preview.style.cssText = 'display:inline-block;width:28px;height:28px;border-radius:6px;border:1px solid #ccc;';
    preview.style.background = colorInput.value;

    const pickBtn = document.createElement('button');
    pickBtn.type = 'button';
    pickBtn.className = 'btn ghost';
    pickBtn.textContent = 'Pick color';
    pickBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openColorModal(colorInput.value, (hex) => {
        colorInput.value = hex;
        preview.style.background = hex;
      });
    });

    colorCell.appendChild(preview);
    colorCell.appendChild(pickBtn);

    const addBtn = document.createElement('button');
    addBtn.textContent = 'Add mask category';
    addBtn.className = 'btn secondary';
    addBtn.type = 'button';
    addBtn.addEventListener('click', async ()=>{
      const name = (nameInput.value||'').trim();
      if(!name){ alert('Please enter a name'); return; }
      // Check for duplicate name (case-insensitive)
      const duplicate = maskCategories.some(cat => cat.name.trim().toLowerCase() === name.toLowerCase());
      if (duplicate) {
        alert('A category with this name already exists.');
        return;
      }
      const color = colorInput.value || '#9999ff';

      // Check for similar color (hex distance)
      function hexToRgb(hex) {
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(c => c+c).join('');
        const num = parseInt(hex, 16);
        return {
          r: (num >> 16) & 255,
          g: (num >> 8) & 255,
          b: num & 255
        };
      }
      function colorDistance(c1, c2) {
        return Math.sqrt(
          Math.pow(c1.r - c2.r, 2) +
          Math.pow(c1.g - c2.g, 2) +
          Math.pow(c1.b - c2.b, 2)
        );
      }
      const newRgb = hexToRgb(color);
      const SIMILARITY_THRESHOLD = 40; // Lower = more strict, 40 is visually close
      const tooSimilar = maskCategories.some(cat => {
        const catRgb = hexToRgb(cat.color);
        return colorDistance(newRgb, catRgb) < SIMILARITY_THRESHOLD;
      });
      if (tooSimilar) {
        alert('This color is too similar to an existing category. Please pick a more distinct color.');
        return;
      }

      try {
        const created = await createCategory(name, color);
        await loadCategories(); // refresh list
        
        // Automatically set the newly created category as active
        const newMaskId = String(created.id);
        if (typeof requestSetCurrentMask === 'function') {
          requestSetCurrentMask(newMaskId, created.color);
        }
        
        // Update the color button display
        try { 
          document.getElementById('colorBtnr').style.backgroundColor = created.color; 
        } catch {}
        
        // Update the current mask ID so user can start drawing immediately
        currentMaskId = newMaskId;
        
        if (typeof requestSetMaskShow === 'function') requestSetMaskShow();
        nameInput.value = '';
      } catch (e) {
        alert(e.message || 'Failed to create mask category');
      }
    });

    form.appendChild(nameInput);
    form.appendChild(colorCell);
    form.appendChild(addBtn);
    maskList.appendChild(form);

    // existing categories (unchanged)
    maskCategories.forEach(cat => {
      const label = document.createElement('label');
      label.style.display = 'flex';
      label.style.alignItems = 'center';
      label.style.gap = '8px';

      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.id = `mask_${cat.id}`;
      const idStr = String(cat.id);
      chk.checked = visibleSet.has(idStr);

      chk.addEventListener('change', () => {
        if (chk.checked) {
          visibleSet.add(idStr);
          enabledMaskColors.add(idStr);
          if (canvas) onMaskChecked(chk.id);
        } else {
          visibleSet.delete(idStr);
          enabledMaskColors.delete(idStr);
        }
        if (typeof requestSetMaskShow === 'function') requestSetMaskShow();
      });

      const chip = document.createElement('span');
      chip.style.display = 'inline-block';
      chip.style.width = '12px';
      chip.style.height = '12px';
      chip.style.borderRadius = '3px';
      chip.style.backgroundColor = cat.color;

      const txt = document.createElement('span');
      txt.textContent = cat.name;
      txt.style.flex = '1';

      label.appendChild(chk);
      label.appendChild(chip);
      label.appendChild(txt);
      
      // Add edit button for all categories except 'Red blood cells'
      if (!(cat.name === 'Red blood cells' || cat.id === 'rbc' || cat.id === 1)) {
        const editBtn = document.createElement('button');
        editBtn.innerHTML = '📝';
        editBtn.style.border = 'none';
        editBtn.style.background = 'none';
        editBtn.style.cursor = 'pointer';
        editBtn.style.marginLeft = 'auto';
        editBtn.title = 'Edit category name';
        editBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const newName = prompt('Enter new name for this category:', cat.name);
          if (!newName || newName.trim() === cat.name) return;
          
          const trimmedName = newName.trim();
          
          // Check for duplicate name (case-insensitive)
          const duplicate = maskCategories.some(c => 
            c.id !== cat.id && c.name.trim().toLowerCase() === trimmedName.toLowerCase()
          );
          
          if (duplicate) {
            alert('A category with this name already exists.');
            return;
          }
          
          try {
            const res = await fetch(`${API}/categories/${cat.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: trimmedName, color: cat.color })
            });
            
            if (!res.ok) {
              const err = await res.json();
              throw new Error(err.error || 'Failed to update category');
            }
            
            await loadCategories(); // refresh the list
            if (typeof requestSetMaskShow === 'function') requestSetMaskShow();
          } catch (err) {
            alert('Failed to update category: ' + (err.message || 'Unknown error'));
          }
        });
        label.appendChild(editBtn);
      }
      
      // Only show delete button if not 'Red blood cells'
      if (!(cat.name === 'Red blood cells' || cat.id === 'rbc' || cat.id === 1)) {
        const deleteBtn = document.createElement('button');
        deleteBtn.innerHTML = '🗑️';
        deleteBtn.style.border = 'none';
        deleteBtn.style.background = 'none';
        deleteBtn.style.cursor = 'pointer';
        deleteBtn.style.marginLeft = '8px';
        deleteBtn.title = 'Delete category';
        deleteBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (confirm(`Delete category \"${cat.name}\"?`)) {
            try {
              const res = await fetch(`${API}/categories/${cat.id}`, {
                method: 'DELETE'
              });
              if (!res.ok) throw new Error('Failed to delete category');
              await loadCategories(); // refresh the list
            } catch (err) {
              alert('Failed to delete category: ' + (err.message || 'Unknown error'));
            }
          }
        });
        label.appendChild(deleteBtn);
      }

      label.addEventListener('click', (e)=>{
        if (e.target && e.target.tagName === 'INPUT') return;
        if (e.target && e.target.tagName === 'BUTTON') return;
        if (typeof requestSetCurrentMask === 'function') requestSetCurrentMask(String(cat.id), cat.color);
        try { document.getElementById('colorBtnr').style.backgroundColor = cat.color; } catch {}
      });

      maskList.appendChild(label);
    });
  }
}

async function onMaskChecked(cat) {
    const data = await fetchMaskData(cat);
    const formatted_data = convertPoints(data);
    if (formatted_data) {
      
        const cleanId = cat.split('mask_')[1];
        polygons[cleanId] = formatted_data;
        const maskCanvas = canvas.getMask(cleanId);
        const ctx = maskCanvas.getContext('2d');
        highlightPolygon(null, formatted_data, ctx);
        //drawMaskOnCanvas(data.masks, data.maskId);
    }
}

function convertPoints(data) {
  console.log('new_test');
  // data.masks is an array of objects, each with a location_data array
  const raw = data.masks;
  console.log(raw);
  // Map over all masks, converting each location_data into polygon format
  const polygons = raw.map(mask => {
    // Handle both array format [x, y] and object format {x, y}
    return mask.location_data.map(point => {
      if (Array.isArray(point)) {
        // Handle [x, y] format
        return { x: point[0], y: point[1] };
      } else {
        // Handle {x, y} format
        return { x: point.x, y: point.y };
      }
    });
  });
  return polygons; 
}


async function fetchMaskData(cat) {
    try {
        const maskId = encodeURIComponent(cat); 
        const file = encodeURIComponent(currentFile);
        const response = await fetch(`/load-masks?id=${maskId}&file=${file}`, { method: 'GET' });
        if (!response.ok) {
            throw new Error('Network response was not ok: ' + response.status);
        }
        const masks = await response.json();
        return {masks};
    } catch (err) {
        console.error('Failed to load masks:', err);
        return null;
    }
}



// new function for export
// --- Export relate elements

try { document.getElementById("colorBtnr").addEventListener("click", () => setActiveColor(activeColour)); } catch {}

const btnExport   = document.getElementById('btnExport');
const exportModal = document.getElementById('exportModal');
const expKeep     = document.getElementById('expKeep');
const expPNG      = document.getElementById('expPNG');
const expJPG      = document.getElementById('expJPG');
const expTIFF     = document.getElementById('expTIFF'); // new image format for tiff
const expCancel   = document.getElementById('expCancel');

// collectiong the path of file（subdir/filename）
function selectedFiles(){
  return [...document.querySelectorAll('#imgList li input[type=checkbox]:checked')]
    .map(chk => {
      const li = chk.closest('li');
      const sub = li.dataset.subdir ? li.dataset.subdir + '/' : '';
      return sub + li.dataset.filename;
    });
}

function setActiveColor(color) {
activeColour = color || activeColour;
document.documentElement.style.setProperty("--active-color", activeColour);
}

function showExportModal(){
  exportModal.classList.add('open');
  exportModal.setAttribute('aria-hidden','false');
}
function hideExportModal(){
  exportModal.classList.remove('open');
  exportModal.setAttribute('aria-hidden','true');
}

btnExport?.addEventListener('click', () => {
  const files = selectedFiles();
  if (!files.length) { alert('select image you want to export'); return; }
  showExportModal();
});


function filenameFromDisposition(dispo) {
if (!dispo) return null;
const mStar = dispo.match(/filename\*\=UTF-8''([^;]+)/i);
if (mStar) return decodeURIComponent(mStar[1]);
const m = dispo.match(/filename\=\"?([^\";]+)\"?/i);
return m ? m[1] : null;
}


function extFromContentType(ct) {
if (!ct) return 'bin';
ct = ct.split(';')[0].toLowerCase();
if (ct === 'application/zip') return 'zip';
if (ct === 'image/png')      return 'png';
if (ct === 'image/jpeg')     return 'jpg';
return 'bin';
}


async function requestSingleExport(relPath, format) {
const res = await fetch(`${API}/api/export`, {
  method: 'POST',
  headers: {'Content-Type':'application/json'},
  body: JSON.stringify({ files: [relPath], format }) // single file
});
if (!res.ok) {
  const err = await res.json().catch(()=> ({}));
  throw new Error(err.error || 'export failed');
}
const blob = await res.blob();
const dispo = res.headers.get('Content-Disposition') || res.headers.get('content-disposition');
let filename = filenameFromDisposition(dispo);
if (!filename) {
  const ext = extFromContentType(res.headers.get('Content-Type'));
  const base = relPath.split('/').pop().replace(/\.[^.]+$/, '');
  filename = `${base}.${ext}`;
}
return { blob, filename };
}


async function fileExists(dirHandle, name) {
try { await dirHandle.getFileHandle(name, { create: false }); return true; }
catch { return false; }
}
async function uniqueName(dirHandle, name) {
const dot = name.lastIndexOf('.');
const base = dot >= 0 ? name.slice(0, dot) : name;
const ext  = dot >= 0 ? name.slice(dot) : '';
let i = 1, cand = name;
while (await fileExists(dirHandle, cand)) {
  cand = `${base} (${i++})${ext}`;
  if (i > 9999) { cand = `${base}-${Date.now()}${ext}`; break; }
}
return cand;
}


async function exportManyToFolder(files, format) {
// download at http://localhost / https 
const dir = await window.showDirectoryPicker(); 
for (const rel of files) {
  const { blob, filename } = await requestSingleExport(rel, format);
  const finalName = (await fileExists(dir, filename)) ? (await uniqueName(dir, filename)) : filename;
  const fh = await dir.getFileHandle(finalName, { create: true });
  const w = await fh.createWritable();
  await w.write(blob);
  await w.close();
}
alert(`Saved ${files.length} files into folder:${dir.name}`);
}


async function exportManyAsSeparateDownloads(files, format) {
for (const rel of files) {
  const { blob, filename } = await requestSingleExport(rel, format);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
  await new Promise(r => setTimeout(r, 150));
}
alert(`Exported ${files.length} files.`);
}



async function doExport(format){
const files = selectedFiles();
if (!files.length) { hideExportModal(); return; }
hideExportModal();

if (files.length === 1) {
  
  const { blob, filename } = await requestSingleExport(files[0], format);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
  return;
}

// muti file priority choose save in the floder
if ('showDirectoryPicker' in window) {
  try {
    await exportManyToFolder(files, format);
    return;
  } catch (e) {
    console.warn('directory picker failed, fallback to multi download', e);
  }
}
// download one by one
await exportManyAsSeparateDownloads(files, format);
}

expKeep.onclick   = () => doExport('keep');
console.log("expPNG:", expPNG);
expPNG.onclick    = () => doExport('png');

expJPG.onclick    = () => doExport('jpg');
expTIFF.onclick   = () => doExport('tiff'); // new image format for tiff
expCancel.onclick = hideExportModal;

//----------------------------------------------------------------------------

// buttons & inputs
const btnNew = document.getElementById('btnNew');
const fileInput = document.getElementById('fileInput');
const ul = document.getElementById('imgList');

// modal refs
const fmtModal = document.getElementById('fmtModal');
const toPng = document.getElementById('toPng');
const toJpg = document.getElementById('toJpg');
const toTiff = document.getElementById('toTiff');
const cancelFmt = document.getElementById('cancelFmt');

// patches modal
const patchesModal = document.getElementById('patchesModal')
const name = document.getElementById('patchName')
const number = document.getElementById('patchCount')
const resolution = document.getElementById('patchLevel')
const confirmPatches = document.getElementById('submitPatches')
const cancelPatches = document.getElementById('cancelPatches')

// holds all svs files from the current selection
let pendingSVSFiles = [];
let currentDir = "";    // list everything
let currentSort = "mtime";
let currentOrder = "asc";

 // render all images
async function loadPatches({dir = currentDir, sort = currentSort, order = currentOrder} = {}) {
  currentDir = dir; 
  currentSort = sort; 
  currentOrder = order;
  const q = new URLSearchParams({ dir, sort, order });
  const res = await fetch(`${API}/api/list_patches?${q.toString()}`);
  const data = await res.json();
  if (!data?.items) return;
  renderList(data.items, { reset: true });
}

// init: load everything once DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
  await loadCategories(); // populates maskCategories + renderMaskUI
  // ensure default tool highlight color is set (red by default)
  try { setActiveColor(maskCategories[0]?.color || 'red'); } catch {}
  try { document.getElementById('colorBtnr').style.backgroundColor = maskCategories[0]?.color || 'red'; } catch {}
  loadPatches();
  const swatchBtn = document.getElementById('colorBtnr');
  if (swatchBtn) {
    swatchBtn.style.cursor = 'default';
    swatchBtn.addEventListener('click', (e) => e.stopPropagation());
  }
});

btnNew.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async () => {
  if (!fileInput.files.length) return;

  const files = [...fileInput.files];
  const svsFiles   = files.filter(f => /\.svs$/i.test(f.name));
  const otherFiles = files.filter(f => !/\.svs$/i.test(f.name));

  if (otherFiles.length) await uploadFiles(otherFiles); // POST /api/upload

  if (svsFiles.length) {
    if (svsFiles.length != 1){
      alert('You can only selete one svs file each time.');
      return;
    }
    pendingSVSFiles = svsFiles.slice();
    showFormatModal(); // one popup per selection
  }

  fileInput.value = '';
});

toPng.onclick     = () => convertAllSVS('png');
toJpg.onclick     = () => convertAllSVS('jpg');
toTiff.onclick     = () => convertAllSVS('tiff');
cancelFmt.onclick = () => { pendingSVSFiles = []; hideFormatModal(); };

function showFormatModal(){
  fmtModal.classList.add('open');
  fmtModal.setAttribute('aria-hidden','false');
}
function hideFormatModal(){
  fmtModal.classList.remove('open');
  fmtModal.setAttribute('aria-hidden','true');
}

// show and hide the patches window
function showPatchesModal() {
  patchesModal.classList.add('open');
  patchesModal.setAttribute('aria-hidden','false');
}

function hidePatchesModal() {
  patchesModal.classList.remove('open');
  patchesModal.setAttribute('aria-hidden','true');
}

async function uploadFiles(files){
  const fd = new FormData();
  files.forEach(f => fd.append('files', f));
  const res = await fetch(`${API}/api/upload`, { method:'POST', body: fd });
  const data = await res.json();
  await loadPatches();
}

function showLoading(msg = "Processing...") {
  const overlay = document.getElementById("loadingOverlay");
  if (!overlay) return;
    overlay.style.display = "flex";
    overlay.querySelector("p").textContent = msg;
}

function hideLoading() {
  const overlay = document.getElementById("loadingOverlay");
  if (!overlay) return;
    overlay.style.display = "none";
}

// keep global state
let lastSavedSVS = [];

// helper
const $ = (sel) => document.querySelector(sel);
function getPatchFormValues() {
  return {
    name:  $('#patchName')?.value?.trim() || 'new_image',
    count: parseInt($('#patchCount')?.value ?? '0', 10) || 0,
    level: parseInt($('#patchLevel')?.value ?? '0', 10) || 0,
  };
}

// button highlight
let current_Sort = null;
function setActiveButton(buttonId, sort, order) {
    // clear active state from all
    document.querySelectorAll(".btn.secondary").forEach(btn => {
        btn.classList.remove("active", "asc", "desc");
    });

    // set active on clicked button
    const btn = document.getElementById(buttonId);
    btn.classList.add("active", order);

    // update state
    current_Sort = sort;
    currentOrder = order;

    // reload patches
    loadPatches({ sort, order });
}

// newest first
document.getElementById("sortNew").addEventListener("click", () => {
    let order = (currentSort === "mtime" && currentOrder === "asc") ? "desc" : "asc";
    setActiveButton("sortNew", "mtime", order);
});

// alphabetical
document.getElementById("sortName").addEventListener("click", () => {
    let order = (currentSort === "name" && currentOrder === "asc") ? "desc" : "asc";
    setActiveButton("sortName", "name", order);
});


// Patching
async function patching(fmt){
  const confirmBtn = $('#submitPatches');
  if (confirmBtn) confirmBtn.disabled = true;

  try {
    if (!lastSavedSVS.length) {
      alert('No converted SVS available to patch. Please convert first.');
      return;
    }

    const { name, count, level } = getPatchFormValues();
    if (!count || count < 1) {
      alert('Please enter a valid number of patches (> 0).');
      return;
    }

    showLoading("Patching in progress...");

    const fd = new FormData();
    fd.append("filename", lastSavedSVS[0]);
    fd.append("name", name);
    fd.append("format", fmt);
    fd.append("patches", String(count));
    fd.append("level", String(level));

    const res  = await fetch(`${API}/api/tiles`, { method: "POST", body: fd });
    const data = await res.json();

    hideLoading();

    if (!res.ok) {
      alert(data?.error || 'Patching failed.');
      return;
    }

    if (data.suggested && data.suggested !== data.target) {
      alert(`Requested ${data.target} patches; closest achievable is ${data.suggested}.\n` +
            `We created ${data.count} patches with tile_size=${data.tile_size}.`);
    }

    hidePatchesModal();

    if (data?.dir) {
      await loadPatches({ sort: 'mtime', order: 'asc' });
    } else {
      await loadPatches();
    }
  } catch (err) {
    hideLoading();
    console.error(err);
    alert('Unexpected error while patching.');
  } finally {
    if (confirmBtn) confirmBtn.disabled = false;
  }
}

// ------------------------------------------------------------------
// Convert selected SVS then open patch modal
// ------------------------------------------------------------------
async function convertAllSVS(fmt){
  if (!pendingSVSFiles.length) { hideFormatModal(); return; }
  showLoading("Wait, ready for sliding...");

  const created  = [];
  const svsNames = [];

  for (const f of pendingSVSFiles) {
    const fd = new FormData();
    fd.append('file', f);
    fd.append('format', fmt);

    const res  = await fetch(`${API}/api/convert`, { method:'POST', body: fd });
    const data = await res.json();

    if (res.ok) {
      if (data?.output_file) created.push({ filename: data.output_file });
      if (data?.input_file)  svsNames.push(data.input_file);
    } else {
      alert(`Failed to convert ${f.name}: ${data?.error || 'Unknown error'}`);
    }
  }

  pendingSVSFiles = [];
  hideFormatModal();
  lastSavedSVS = svsNames;
  hideLoading();

  if (lastSavedSVS.length){
    showPatchesModal();

    const form       = $('#patchesForm');
    const confirmBtn = $('#submitPatches');
    const cancelBtn  = $('#cancelPatches');

    if (form) {
      form.onsubmit = (e) => { e.preventDefault(); patching(); };
    }
    if (confirmBtn) {
      confirmBtn.onclick = () => patching(fmt);
    }
    if (cancelBtn) {
      cancelBtn.onclick = () => { pendingSVSFiles = []; hidePatchesModal(); };
    }
  } else {
    await loadPatches({ sort: 'mtime', order: 'asc' });
  }
}

const selectAllBtn = document.getElementById('selectAll');

let allItems = [];
// use a stable key for each item
let selected = new Set(); 

const keyOf = it => (it.subdir ? `${it.subdir}/` : '') + it.filename;

// select all functionality
function isAllSelected() {
  return allItems.length > 0 && selected.size === allItems.length;
}

function refreshSelectAllVisual() {
  selectAllBtn.classList.toggle('active', isAllSelected());
  selectAllBtn.textContent = isAllSelected() ? 'Unselect All' : 'Select All';
}

selectAllBtn.addEventListener('click', () => {
  const makeSelected = !isAllSelected();
  if (makeSelected) {
    selected = new Set(allItems.map(keyOf));
  } else {
    selected.clear();
  }
  // reflect in UI without re-render
  document.querySelectorAll('#imgList input[type=checkbox]')
    .forEach(cb => cb.checked = makeSelected);
  refreshSelectAllVisual();
});

// render the list
function renderList(items, { reset = false } = {}) {
  if (reset) {
    ul.innerHTML = '';
    allItems = items.slice();
    // default: select all on fresh load
    selected = new Set(allItems.map(keyOf));
  } else {
    // on incremental renders, extend our list
    allItems = [...allItems, ...items];
  }

  items.forEach(it => {
    const k = keyOf(it);

    const li = document.createElement('li');
    li.className = 'row';
    li.dataset.url = it.url;
    li.dataset.displayUrl = it.display_url || it.url;
    li.dataset.filename = it.filename;
    li.dataset.subdir = it.subdir || '';

    li.innerHTML = `
      <div class="avatar">🖼️</div>
      <div class="label"><div class="name">${it.filename}</div>
      <button id="renameImg" style="border: none; background: none; cursor: pointer;">📝</button>
      <button id="removeImg" style="border: none; background: none; cursor: pointer;">🗑️</button></div>
      <label class="tick"><input type="checkbox" class="pick" /></label>
    `;

    const cb = li.querySelector('input.pick');
    // reflect current state
    cb.checked = selected.has(k);
    cb.addEventListener('change', () => {
      if (cb.checked) selected.add(k);
      else selected.delete(k);
      refreshSelectAllVisual();
    });

    // preview click
    li.addEventListener('click', (ev) => {
      if (ev.target && ev.target.tagName === 'INPUT') return;
      document.querySelectorAll('#imgList li').forEach(el => el.classList.remove('active'));
      li.classList.add('active');

      currentFile = it.subdir ? `${it.subdir}/${it.filename}` : it.filename;
      if (li.dataset.displayUrl) showImage(li.dataset.displayUrl, it.filename);
    });
    ul.prepend(li);
  });

  refreshSelectAllVisual();
}

// run once
ul.addEventListener('click', async (e) => {
  const li = e.target.closest('li');
  if (!li) return;

  const renameBtn = e.target.closest('#renameImg');
  const removeBtn = e.target.closest('#removeImg');

  // helper (frontend to backend)
  async function renameOnServer({ subdir, oldName, newName }) {
    const res = await fetch('/api/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subdir, old: oldName, new: newName })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Rename failed (${res.status})`);
    }
    return res.json();
  }

  // ---- rename ----
  if (renameBtn) {
    e.stopPropagation();

    const nameEl = li.querySelector('.name');
    const oldName = li.dataset.filename;
    const subdir  = li.dataset.subdir || '';

    const i   = oldName.lastIndexOf('.');
    const base = i !== -1 ? oldName.slice(0, i) : oldName;
    const ext  = i !== -1 ? oldName.slice(i) : '';

    const newBase = prompt('Enter new name:', base);
    if (!newBase || newBase.trim() === base) return;

    const newName = `${newBase.trim()}${ext}`;

    try {
      const data = await renameOnServer({ subdir, oldName, newName, ext });
      nameEl.textContent   = data.filename;
      li.dataset.filename  = data.filename;
      if (data.display_url) li.dataset.displayUrl = data.display_url;
      showImage();
      loadPatches();
    } catch (err) {
      alert(err.message);
    }
    return;
  }

  // ---- remove ----
  if (removeBtn) {
    e.stopPropagation();

    const imgId = li.dataset.id;
    const filename = li.dataset.filename;
    const subdir   = li.dataset.subdir || '';
    if (!confirm(`Delete "${filename}" from folder?`)) return;

    try {
      const res = await fetch('/api/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imgId, subdir, filename })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Remove failed (${res.status})`);
      }

      // update UI & state
      li.remove();
      const k = keyOf({ url: li.dataset.url });
      selected.delete(k);
      allItems = allItems.filter(it => keyOf(it) !== k);
      showImage();
      refreshSelectAllVisual();
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
    return;
  }
});

let currentFile = null;

let allpolygons = {};
let polygons = {};
let prev_url = '';
let currentMaskId = '1';

let panSelected = false;
let selectSelected = false;

function showImage(url, altText = '') {
const stage = document.querySelector('.stage');
stage.innerHTML = ''; // clean

const img = new Image();
img.crossOrigin = 'anonymous'; // Required if loading images from another origin
if (!url){
  return;
}
img.src = url.startsWith('http') ? url : `${API}${url}`;
img.alt = altText;

img.onload = () => {
  // function maybeTurnOffIfEmpty() {
  //   const idStr = String(currentMaskId);
  //   const arr = polygons[idStr] || [];
  //   if (arr.length === 0) {
  //     const visibleSet = getVisibleSetForCurrentImage();
  //     visibleSet.delete(idStr);
  //     enabledMaskColors.delete(idStr);
  //     const chk = document.getElementById(`mask_${idStr}`);
  //     if (chk) chk.checked = false;
  //     if (typeof requestSetMaskShow === 'function') requestSetMaskShow();
  //   }
  // }
  onMaskChecked("mask_1");
  allpolygons[prev_url] = polygons;
  polygons = allpolygons[url] || {};
  prev_url = url;

  let selectedIndex = -1;
  
  canvas = new Canvas(stage);
  const [canvasImage, canvasDraw] = canvas.setup(img);
  const ctxDraw = canvasDraw.getContext('2d');

  const drawingToolManager = new DrawingToolManager(ctxDraw, canvas);
  const undoRedoManager = new UndoRedoManager(10);
  const brush = new Brush();
  const free = new Free();
  const circle = new Circle();
  const square = new Square();
  const eraser = new Eraser();
  const pan = new Pan(canvas);
  const select = 'select';

  const uiCtx = ctxDraw;

  for (const mask of maskCategories) {
    canvas.addMask(mask.id, mask.color);
    highlightPolygon(null, polygons[mask.id], canvas.getMask(mask.id).getContext('2d'));
  }
  drawingToolManager.setContext(canvas.getMask(currentMaskId).getContext('2d'));

  eraser.setContexts({
    maskCtx: canvas.getMask(currentMaskId).getContext('2d'),
    uiCtx,
  });
  
  const toolElements = new Map([
    [free, document.getElementById('toolPencil')],
    [brush, document.getElementById('toolBrush')],
    [circle, document.getElementById('toolCircle')],
    [square, document.getElementById('toolSquare')],
    [eraser, document.getElementById('toolEraser')],
    [pan, document.getElementById('toolPan')],
    [select, document.getElementById('toolSelect')],
  ]);
  const eraserSizeEl        = document.getElementById('eraserSize');
  const eraserSizeValueEl   = document.getElementById('eraserSizeValue');
  const eraserSizeContainer = document.getElementById('eraserSizeContainer');
  const zoomInBtn           = document.getElementById('zoomInBtn');
  const zoomOutBtn          = document.getElementById('zoomOutBtn');
  const zoomPctEl           = document.getElementById('zoomPct');
  
  function setTool(tool) {
    // Set active icon
    for (const element of toolElements.values()) {
      element?.classList.remove('active');
    }
    toolElements.get(tool)?.classList.add('active');

    panSelected = (tool === pan);
    selectSelected = (tool === select);

    if (panSelected) {
        stage.style.cursor = 'grab';
    } else if (selectSelected) {
        stage.style.cursor = 'pointer';
    } else if (tool instanceof Eraser) {
      stage.style.cursor = 'url("/static/img/eraser-cursor.png") 4 4, auto';
    } else {
        stage.style.cursor = 'crosshair';
    }

    if (eraserSizeContainer) eraserSizeContainer.style.display = (tool === eraser || tool === brush) ? 'inline-flex' : 'none';

    if (!panSelected && !selectSelected) {
      drawingToolManager.setDrawingTool(tool);
    }
  }

  // Default tool
  setTool(free);

  for (const [tool, element] of toolElements) {
    element.addEventListener('click', () => setTool(tool));
  }

  let zoom = canvas.getZoom();

  function updateZoom(newZoom) {
    zoom = Math.max(0.1, Math.min(5, newZoom));
    canvas.setZoom(zoom);

    if (zoomPctEl) {
      zoomPctEl.textContent = `${Math.round(zoom * 100)}%`;
    }
  }

  zoomInBtn?.addEventListener('click', () => updateZoom(zoom * 1.2));
  zoomOutBtn?.addEventListener('click', () => updateZoom(zoom / 1.2));

  // Undo/Redo button event listeners
  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');
  
  undoBtn?.addEventListener('click', async () => {
    if (undoRedoManager.canUndo()) {
      undoRedoManager.undo(canvas.canvasMasks, polygons);
      // Save the updated state to database
      await saveUpdatedMasksToDatabase();
      await refreshCoverageUI();
    }
  });
  
  redoBtn?.addEventListener('click', async () => {
    if (undoRedoManager.canRedo()) {
      undoRedoManager.redo(canvas.canvasMasks, polygons);
      // Save the updated state to database
      await saveUpdatedMasksToDatabase();
      await refreshCoverageUI();
    }
  });

  eraserSizeEl?.addEventListener('input', () => {
    const v = parseInt(eraserSizeEl.value) || 50;
    drawingToolManager.setBrushSize(v);
    if (eraserSizeValueEl) eraserSizeValueEl.textContent = String(v);
  });

  requestSetCurrentMask = setCurrentMask;

  function setCurrentMask(id, colour) {
    highlightPolygon(null, polygons[currentMaskId], canvas.getMask(String(currentMaskId)).getContext('2d'));
    let mask = canvas.getMask(id);
    if (mask === null) { canvas.addMask(id, colour); mask = canvas.getMask(id); }
    const mctx = mask.getContext('2d');
    drawingToolManager.setContext(mctx);
    eraser.setContexts({ maskCtx: mctx, uiCtx });   // keep eraser updated
    currentMaskId = id;
  }

  // function redrawMask(maskId) {
  //   const maskCanvas = canvas.getMask(String(maskId));
  //   if (!maskCanvas) return;
  //   const mctx = maskCanvas.getContext('2d');
  //   mctx.clearRect(0, 0, mctx.canvas.width, mctx.canvas.height);
  //   mctx.lineJoin = 'round';
  //   mctx.lineCap  = 'round';
  //   const list = polygons[String(maskId)] || [];
  //   for (const p of list) drawPolyline(p, mctx);
  // }


  requestSetMaskShow = setMaskShow;

  (async () => {
    await refreshCoverageUI();
    for (const id of enabledMaskColors) onMaskChecked(`mask_${id}`);
    
    // Save the state after all existing annotations are loaded
    // This becomes the baseline for undo/redo operations in this session
    undoRedoManager.saveState(canvas.canvasMasks, polygons);
    
    // Clear the undo stack so undo button is disabled at session start
    undoRedoManager.clearUndoStack();
  })();


  function setMaskShow() {
    for (const mask of maskCategories) {
      if (canvas.getMask(mask.id) != null) canvas.hideMask(mask.id);
    }
    for (const id of enabledMaskColors) {
      if (canvas.getMask(id) != null) canvas.showMask(id);
    }
  }

  stage.addEventListener("mousedown", (e) => {
    if (panSelected) {
      stage.style.cursor = 'grabbing';
      pan.startPan(e);
    }
  });

  stage.addEventListener("mousemove", (e) => {
    if (panSelected) {
      pan.pan(e);
    }
  });

  stage.addEventListener("mouseup", (e) => {
    if (panSelected) {
      stage.style.cursor = 'grab';
      pan.endPan();
    }   
  });
  
  stage.addEventListener("mouseout", (e) => {
    if (panSelected) {
      stage.style.cursor = 'grab';
      pan.endPan();
    }   
  });

  // Wheel behavior:
  // - Mouse wheel: zoom at cursor
  // - Touchpad two-finger scroll: pan horizontally/vertically
  stage.addEventListener('wheel', (e) => {
    // prevent page scroll/zoom
    e.preventDefault();

    const absDeltaX = Math.abs(e.deltaX);
    const absDeltaY = Math.abs(e.deltaY);
    // Heuristic: small pixel deltas and/or nonzero deltaX => touchpad scroll → pan
    const TOUCHPAD_PIX_THRESHOLD = 40; // typical mouse wheel deltas are >= 100
    const isLikelyTouchpad = (absDeltaX > 0) || (absDeltaY < TOUCHPAD_PIX_THRESHOLD);

    if (isLikelyTouchpad) {
      const { x: offX, y: offY } = canvas.getOffset();
      if (absDeltaX >= absDeltaY) {
        // Horizontal dominant: pan X (natural)
        canvas.setOffset(offX - e.deltaX, offY);
      } else {
        // Vertical dominant: pan Y (natural)
        canvas.setOffset(offX, offY - e.deltaY);
      }
      return;
    }

    // Otherwise: treat as mouse wheel → zoom at cursor position
    const rect = stage.getBoundingClientRect();
    const pointerX = e.clientX - rect.left;
    const pointerY = e.clientY - rect.top;

    const oldZoom = zoom;
    const scaleFactor = Math.pow(1.0015, -e.deltaY); // wheel up (negative) → zoom in
    const newZoom = Math.max(0.1, Math.min(5, oldZoom * scaleFactor));

    const { x: offX2, y: offY2 } = canvas.getOffset();
    // Compute content coords under cursor in image space before zoom
    const contentX = (pointerX - offX2) / oldZoom;
    const contentY = (pointerY - offY2) / oldZoom;
    // New offsets to keep the same content point under the cursor after zoom
    const newOffX = pointerX - contentX * newZoom;
    const newOffY = pointerY - contentY * newZoom;

    canvas.setOffset(newOffX, newOffY);
    updateZoom(newZoom);
  }, { passive: false });

  // let eraserTargets = null;
  canvasDraw.addEventListener("mousedown", (e) => {
    if (selectSelected || panSelected) return;

    if (drawingToolManager.drawingTool instanceof Eraser) {
      const pt = canvas.getCursorPosition(e);
      const hitId = [...enabledMaskColors].find(id =>
        (polygons[id] || []).some(poly => isPointInPolygon(pt, poly))
      );
      eraserTargets = hitId ? [hitId] : null; 
    }

    
    // Save state before starting to draw for undo functionality
    undoRedoManager.saveState(canvas.canvasMasks, polygons);
    
    drawingToolManager.startDraw(e);
  });

  canvasDraw.addEventListener("mousemove", (e) => {
    if (selectSelected || panSelected) return;
    drawingToolManager.draw(e);
  });

  async function onMouseUp() {
  if (selectSelected || panSelected) return;

  if (!polygons[currentMaskId]) {
    polygons[currentMaskId] = [];
  }

  const result = drawingToolManager.endDraw();
  if (!result || result.length === 0) return;


  if (drawingToolManager.drawingTool instanceof Eraser) {
    const eraserStroke = result;
    const eraserPoly   = cleanPolygon(eraserStroke);
    if (!eraserPoly || eraserPoly.length < 3) return;

    const candidateIds = Array.from(enabledMaskColors);

    const changedIds = [];

    for (const id of candidateIds) {
      const list = polygons[id] || [];
      const newList = [];
      let changed = false;

      for (const p of list) {
        const pieces = erasePolyline(p, eraserPoly, 3);
        if (pieces.length !== 1 || pieces[0].length !== p.length) changed = true;

        for (const seg of pieces) if (seg.length >= 2) newList.push(seg);
      }

      if (changed) {
        polygons[id] = newList;
        const maskCanvas = canvas.getMask(String(id));
        if (maskCanvas) {
          const mctx = maskCanvas.getContext('2d');
          mctx.clearRect(0, 0, mctx.canvas.width, mctx.canvas.height);
          mctx.lineJoin = 'round';
          mctx.lineCap  = 'round';
          for (const seg of newList) drawPolyline(seg, mctx);
        }
        changedIds.push(id);
      }
    }
    
  for (const id of changedIds) {
    await saveUpdatedMasksToDatabaseFor(id);
  }
  await refreshCoverageUI();
  return;
  }

  const raw = result;
  const polygon = closeIfUserClosed(raw);
  polygons[currentMaskId].push(polygon);
  console.log('added polygon', polygons[currentMaskId].length - 1, 'in', currentMaskId);

  const maskNumericId = parseInt(String(currentMaskId).replace(/^mask_/, ''), 10);
  const payload = {
    file: currentFile,        
    maskId: maskNumericId,    
    polygon: polygon          
  };

  const chkId = `mask_${currentMaskId}`;
  const chkEl = document.getElementById(chkId);
  if (chkEl && !chkEl.checked) {
    chkEl.checked = true;
    const visibleSet = getVisibleSetForCurrentImage();
    visibleSet.add(String(currentMaskId));
    enabledMaskColors.add(String(currentMaskId));
    if (typeof requestSetMaskShow === 'function') requestSetMaskShow();
  }
  
  exportMask(payload);
}

  canvasDraw.addEventListener("mouseup", onMouseUp);
  
  canvasDraw.addEventListener("mouseout", onMouseUp);

  canvasDraw.addEventListener('click', (e) => {
    if (!selectSelected) return;

    const cursor = canvas.getCursorPosition(e);

    const visibleIdsInZ = maskCategories
      .map(m => String(m.id))
      .filter(id => enabledMaskColors.has(id))
      .reverse(); 

    let hit = null;

    for (const id of visibleIdsInZ) {
      const polys = polygons[id] || [];
      let idx = polys.findIndex(p => isPointInPolygon(cursor, p));
      if (idx === -1) {
        const TOL = 4;
        idx = polys.findIndex(p => isPointNearPolyline?.(cursor, p, TOL));
      }
      if (idx !== -1) {
        hit = { id, idx };
        break;
      }
    }

    if (hit) {
      currentMaskId = hit.id;
      selectedIndex = hit.idx;

      const layerPolygons = polygons[hit.id] || [];
      const ctx = canvas.getMask(String(hit.id)).getContext('2d');
      highlightPolygon(layerPolygons[hit.idx], layerPolygons, ctx);

      try {
        const cat = maskCategories.find(c => String(c.id) === String(hit.id));
        if (cat) document.getElementById('colorBtnr').style.backgroundColor = cat.color;
      } catch {}
    } else {
      const ctx = canvas.getMask(String(currentMaskId)).getContext('2d');
      highlightPolygon(null, polygons[currentMaskId] || [], ctx);
      selectedIndex = -1;
    }
  });

  document.addEventListener('keydown', async(e) => {
    // Undo/Redo keyboard shortcuts
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (undoRedoManager.canUndo()) {
          undoRedoManager.undo(canvas.canvasMasks, polygons);
          // Save the updated state to database
          await saveUpdatedMasksToDatabase();
          await refreshCoverageUI();
        }
        return;
      }
      if ((e.key === 'y') || (e.key === 'z' && e.shiftKey)) {
        e.preventDefault();
        if (undoRedoManager.canRedo()) {
          undoRedoManager.redo(canvas.canvasMasks, polygons);
          // Save the updated state to database
          await saveUpdatedMasksToDatabase();
          await refreshCoverageUI();
        }
        return;
      }
    }
    
    if (e.key === 'Backspace') {
      if (polygons[currentMaskId] && selectedIndex != -1) {
        // Save state before deletion for undo functionality
        undoRedoManager.saveState(canvas.canvasMasks, polygons);
        
        polygons[currentMaskId].splice(selectedIndex, 1);

        highlightPolygon(null, polygons[currentMaskId], canvas.getMask(String(currentMaskId)).getContext('2d'));

        console.log('Deleted polygon', selectedIndex, 'in', currentMaskId);
        
        selectedIndex = -1;

        await saveUpdatedMasksToDatabase();
        await refreshCoverageUI();
      }
    }
  });

  function exportMask(payload) {
    return fetch("/save-mask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    .then(async (r) => {
      if (!r.ok) {
        const msg = await r.text().catch(() => "");
        throw new Error(`save-mask failed (${r.status}): ${msg}`);
      }
      return r.json();
    })
    .then(async (data) => {
      console.log("POST /save-mask OK:", data);
      await refreshCoverageUI();
      return data;
    })
    .catch((err) => {
      console.error("POST /save-mask error:", err);
    });
  }

  async function saveUpdatedMasksToDatabaseFor(maskIdStr) {
    if (!currentFile || !maskIdStr) return;

    try {
      const maskId = encodeURIComponent(maskIdStr);
      const file   = encodeURIComponent(currentFile);
      const response = await fetch(`/load-masks?id=${maskId}&file=${file}`, { method: 'GET' });
      if (!response.ok) throw new Error('Failed to load existing masks: ' + response.status);

      const existingMasks   = await response.json();
      const currentPolygons = polygons[maskIdStr] || [];

      // delete excess
      if (currentPolygons.length < existingMasks.length) {
        const ids = existingMasks.slice(currentPolygons.length).map(m => m.id);
        if (ids.length) {
          await fetch('/delete-masks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids })
          });
        }
      }

      // update overlap
      const updates = [];
      for (let i = 0; i < Math.min(currentPolygons.length, existingMasks.length); i++) {
        updates.push({ id: existingMasks[i].id, location_data: currentPolygons[i] });
      }
      if (updates.length) {
        const r = await fetch('/update-masks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ updates })
        });
        if (!r.ok) throw new Error('Failed to update masks: ' + r.status);
      }

      // create new beyond existing
      for (let i = existingMasks.length; i < currentPolygons.length; i++) {
        const maskNumericId = parseInt(String(maskIdStr).replace(/^mask_/, ''), 10) || parseInt(maskIdStr, 10);
        const payload = { file: currentFile, maskId: maskNumericId, polygon: currentPolygons[i] };
        await fetch("/save-mask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
    } catch (err) {
      console.error('Failed to save mask', maskIdStr, err);
    }
  }

  async function saveUpdatedMasksToDatabase() {
    if (!currentFile || !currentMaskId) {
      console.warn("No current file or mask ID for saving updated masks");
      return;
    }

    try {
      // Load existing masks from database to get their IDs
      const maskId = encodeURIComponent(currentMaskId); 
      const file = encodeURIComponent(currentFile);
      const response = await fetch(`/load-masks?id=${maskId}&file=${file}`, { method: 'GET' });
      
      if (!response.ok) {
        throw new Error('Failed to load existing masks: ' + response.status);
      }
      
      const existingMasks = await response.json();
      const currentPolygons = polygons[currentMaskId] || [];
      
      // If we have fewer polygons than existing masks, delete the excess masks
      if (currentPolygons.length < existingMasks.length) {
        const masksToDelete = existingMasks.slice(currentPolygons.length).map(m => m.id);
        if (masksToDelete.length > 0) {
          await fetch('/delete-masks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: masksToDelete })
          });
          console.log(`Deleted ${masksToDelete.length} excess masks`);
        }
      }
      
      // Update existing masks with new polygon data
      const updates = [];
      for (let i = 0; i < Math.min(currentPolygons.length, existingMasks.length); i++) {
        updates.push({
          id: existingMasks[i].id,
          location_data: currentPolygons[i]
        });
      }
      
      // Send updates to the database
      if (updates.length > 0) {
        const updateResponse = await fetch('/update-masks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ updates: updates })
        });
        
        if (!updateResponse.ok) {
          throw new Error('Failed to update masks: ' + updateResponse.status);
        }
        
        console.log(`Successfully updated ${updates.length} masks in database`);
      }
      
      // Create new masks for additional polygons (if any)
      for (let i = existingMasks.length; i < currentPolygons.length; i++) {
        const maskNumericId = parseInt(String(currentMaskId).replace(/^mask_/, ''), 10);
        const payload = {
          file: currentFile,
          maskId: maskNumericId,
          polygon: currentPolygons[i]
        };
        await exportMask(payload);
      }
      
    } catch (err) {
      console.error('Failed to save updated masks to database:', err);
    }
  }



  // function exportMask() {
  //   const payload = {
  //     image: currentFile,
  //     paths: drawnPaths
  //   };

  //   return fetch('/save-mask', {
  //     method:'POST',
  //     headers:{'Content-Type':'application/json'},
  //     body: JSON.stringify(payload)
  //   })
  //   .then(r => r.ok ? r.json() : r.json().then(Promise.reject))
  //   .then(() => loadMasks())
  //   .catch(() => loadMasks());
  // }
};
}
