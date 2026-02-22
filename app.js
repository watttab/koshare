/* ============================================
   Ko Share — Application Logic (v2.1)
   Two-step save: GET for text + POST for image
   ============================================ */

// ============ CONFIG ============
const GAS_URL = 'https://script.google.com/macros/s/AKfycbw3E6JPNmLfMs1lxQGt909ncdR6KWYi7hCtMVmdLfYbexVq_8wzW9lRlSyGWhuOto-Gqw/exec';
const API_KEY = 'KOSHARE_2024_sKr_GoSuM';

// ============ STATE ============
const appState = {
    currentPage: 'home',
    photo: null,
    photoDataURL: null,
    photoCompressed: null,
    latitude: null,
    longitude: null,
    miniMap: null,
    mainMap: null,
    mainMapMarkers: [],
    generatedImageBlob: null,
    generatedImageDataURL: null,
    checkIns: [],
    shareCount: parseInt(localStorage.getItem('koShareCount') || '0'),
};

// ============ INIT ============
document.addEventListener('DOMContentLoaded', () => initApp());

async function initApp() {
    const cameraInput = document.getElementById('cameraInput');
    const galleryInput = document.getElementById('galleryInput');
    const photoArea = document.getElementById('photoArea');

    cameraInput.addEventListener('change', handlePhotoSelect);
    galleryInput.addEventListener('change', handlePhotoSelect);
    photoArea.addEventListener('click', () => cameraInput.click());

    document.getElementById('textLine2').addEventListener('input', updateComposerPreview);
    document.getElementById('statShares').textContent = appState.shareCount;

    // Load data (GET calls — proven working)
    try { await incrementVisitCount(); } catch (e) { console.warn('Visit:', e); }
    try { await loadCheckIns(); } catch (e) { console.warn('CheckIns:', e); }

    window.addEventListener('hashchange', () => {
        const page = location.hash.replace('#', '') || 'home';
        navigateTo(page, false);
    });
    const initialPage = location.hash.replace('#', '') || 'home';
    if (initialPage !== 'home') navigateTo(initialPage, false);
}

// ============ GAS API (GET only — reliable) ============
async function callGAS(action, data = null, requireKey = false) {
    let url = `${GAS_URL}?action=${encodeURIComponent(action)}`;
    if (requireKey) url += `&key=${encodeURIComponent(API_KEY)}`;
    if (data) url += `&data=${encodeURIComponent(JSON.stringify(data))}`;

    console.log(`[KoShare] GET ${action}`, data ? '(data)' : '');

    const response = await fetch(url, { method: 'GET', redirect: 'follow' });
    const text = await response.text();
    console.log(`[KoShare] Response ${action}:`, text.substring(0, 300));

    if (text.startsWith('<!DOCTYPE') || text.startsWith('<html')) {
        throw new Error('GAS returned HTML — redeploy needed');
    }
    return JSON.parse(text);
}

// POST image via hidden form (handles GAS 302 redirect correctly)
function postImageToGAS(checkInId, imageBase64, locationName) {
    return new Promise((resolve, reject) => {
        const frameName = 'upload_' + Date.now();
        const iframe = document.createElement('iframe');
        iframe.name = frameName;
        iframe.style.display = 'none';
        document.body.appendChild(iframe);

        const form = document.createElement('form');
        form.method = 'POST';
        form.action = `${GAS_URL}?action=uploadImage&key=${encodeURIComponent(API_KEY)}`;
        form.target = frameName;
        form.enctype = 'application/x-www-form-urlencoded';

        // Add form fields
        function addField(name, value) {
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = name;
            input.value = value;
            form.appendChild(input);
        }

        addField('checkInId', checkInId);
        addField('imageBase64', imageBase64);
        addField('locationName', locationName);

        document.body.appendChild(form);

        let resolved = false;

        iframe.onload = () => {
            if (resolved) return;
            resolved = true;
            // Give GAS time to process
            setTimeout(() => {
                try { document.body.removeChild(iframe); } catch (e) { }
                try { document.body.removeChild(form); } catch (e) { }
                resolve({ success: true });
            }, 1000);
        };

        // Timeout
        setTimeout(() => {
            if (resolved) return;
            resolved = true;
            try { document.body.removeChild(iframe); } catch (e) { }
            try { document.body.removeChild(form); } catch (e) { }
            resolve({ success: true }); // Assume success
        }, 30000);

        form.submit();
    });
}

// ============ NAVIGATION ============
function navigateTo(page, pushHash = true) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const targetPage = document.getElementById('page' + capitalize(page));
    if (targetPage) targetPage.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.page === page);
    });
    appState.currentPage = page;
    if (pushHash) location.hash = page;
    if (page === 'map') setTimeout(() => initMainMap(), 200);
    window.scrollTo(0, 0);
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ============ PHOTO ============
function handlePhotoSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    appState.photo = file;
    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            appState.photoCompressed = compressToDataURL(img, 800, 0.5);
            appState.photoDataURL = compressToDataURL(img, 1600, 0.85);
            document.getElementById('photoPreview').src = appState.photoDataURL;
            document.getElementById('photoPreview').style.display = 'block';
            document.getElementById('photoPlaceholder').style.display = 'none';
            showToast('📷 ถ่ายภาพสำเร็จ!');
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
}

function compressToDataURL(img, maxSize, quality) {
    let w = img.width, h = img.height;
    if (w > maxSize || h > maxSize) {
        if (w > h) { h = Math.round(h * (maxSize / w)); w = maxSize; }
        else { w = Math.round(w * (maxSize / h)); h = maxSize; }
    }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', quality);
}

// ============ GPS ============
function getGPSLocation() {
    const statusEl = document.getElementById('gpsStatus');
    const btnGPS = document.getElementById('btnGetGPS');
    if (!navigator.geolocation) { showToast('❌ GPS ไม่รองรับ'); return; }

    statusEl.innerHTML = '<div class="gps-waiting"><div class="gps-spinner"></div><p>กำลังรับพิกัด GPS...</p></div>';
    btnGPS.disabled = true;
    btnGPS.textContent = '⏳ รอรับพิกัด...';

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            appState.latitude = pos.coords.latitude;
            appState.longitude = pos.coords.longitude;
            statusEl.innerHTML = '<div class="gps-found"><span class="gps-found-icon">✅</span><span>ได้รับพิกัดแล้ว!</span></div>';
            document.getElementById('latValue').textContent = appState.latitude.toFixed(6);
            document.getElementById('lngValue').textContent = appState.longitude.toFixed(6);
            document.getElementById('gpsInfo').style.display = 'block';
            btnGPS.disabled = false;
            btnGPS.textContent = '🔄 ปักหมุดใหม่';
            initMiniMap(appState.latitude, appState.longitude);
            showToast('📍 ปักหมุดสำเร็จ!');
        },
        (err) => {
            const msgs = { 1: 'กรุณาอนุญาตการเข้าถึงตำแหน่ง', 2: 'หาตำแหน่งไม่ได้', 3: 'หมดเวลา' };
            const msg = msgs[err.code] || 'ไม่สามารถรับพิกัดได้';
            statusEl.innerHTML = `<div class="gps-found" style="color:var(--accent-orange)"><span class="gps-found-icon">⚠️</span><span>${msg}</span></div>`;
            btnGPS.disabled = false;
            btnGPS.textContent = '📍 ลองใหม่';
            showToast('⚠️ ' + msg);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
}

function initMiniMap(lat, lng) {
    if (appState.miniMap) appState.miniMap.remove();
    appState.miniMap = L.map('miniMap', { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false }).setView([lat, lng], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(appState.miniMap);
    L.marker([lat, lng]).addTo(appState.miniMap);
    setTimeout(() => appState.miniMap.invalidateSize(), 200);
}

// ============ IMAGE COMPOSER ============
function updateComposerPreview() {
    document.getElementById('composerLine2').textContent = document.getElementById('textLine2').value || 'ชื่อสถานที่';
}

async function generateImage() {
    if (!appState.photoDataURL) { showToast('⚠️ กรุณาถ่ายภาพก่อน'); return; }
    if (appState.latitude === null) { showToast('⚠️ กรุณาปักหมุด GPS ก่อน'); return; }
    const locationName = document.getElementById('textLine2').value.trim();
    if (!locationName) { showToast('⚠️ กรุณาพิมพ์ชื่อสถานที่'); return; }

    showLoading('กำลังสร้างภาพ...');
    try {
        const canvas = document.createElement('canvas');
        canvas.width = 1200; canvas.height = 630;
        const ctx = canvas.getContext('2d');

        const photo = await loadImage(appState.photoDataURL);
        drawImageCover(ctx, photo, 0, 0, 1200, 630);

        // Gradients
        let g = ctx.createLinearGradient(0, 0, 0, 250);
        g.addColorStop(0, 'rgba(0,0,0,0.75)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, 1200, 250);
        g = ctx.createLinearGradient(0, 380, 0, 630);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.8)');
        ctx.fillStyle = g; ctx.fillRect(0, 380, 1200, 250);

        // Text
        ctx.textAlign = 'center';
        ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 2;
        ctx.font = '700 36px Prompt, sans-serif'; ctx.fillStyle = '#fff';
        ctx.fillText(document.getElementById('textLine1').value, 600, 70);
        ctx.font = '800 48px Prompt, sans-serif'; ctx.fillStyle = '#fbbf24';
        ctx.fillText(locationName, 600, 130);

        // QR Code
        const mapsUrl = `https://www.google.com/maps?q=${appState.latitude},${appState.longitude}`;
        const qr = await generateQRCanvas(mapsUrl, 130);
        const qX = 525, qY = 400, pad = 10;
        ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 15; ctx.shadowOffsetY = 4;
        ctx.fillStyle = '#fff'; roundRect(ctx, qX - pad, qY - pad, 150 + pad * 2, 150 + pad * 2, 12); ctx.fill();
        ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
        ctx.drawImage(qr, qX, qY, 150, 150);

        // Bottom text
        ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
        ctx.font = '300 16px Prompt, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillText('สแกน QR ดูเส้นทาง', 600, 575);
        ctx.font = '600 26px Prompt, sans-serif'; ctx.fillStyle = '#fff';
        ctx.fillText(document.getElementById('textLine3').value, 600, 605);
        ctx.font = '500 14px Prompt, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fillText('📍 Ko Share', 600, 625);

        appState.generatedImageDataURL = canvas.toDataURL('image/png');
        canvas.toBlob(blob => { appState.generatedImageBlob = blob; }, 'image/png');

        document.getElementById('generatedImage').src = appState.generatedImageDataURL;
        document.getElementById('previewArea').style.display = 'block';
        hideLoading(); showToast('✅ สร้างภาพสำเร็จ!');
        setTimeout(() => document.getElementById('previewArea').scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
    } catch (err) {
        hideLoading(); console.error('Generate error:', err);
        showToast('❌ เกิดข้อผิดพลาด: ' + err.message);
    }
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

function drawImageCover(ctx, img, x, y, w, h) {
    const ir = img.width / img.height, br = w / h;
    let sw, sh, sx, sy;
    if (ir > br) { sh = img.height; sw = sh * br; sx = (img.width - sw) / 2; sy = 0; }
    else { sw = img.width; sh = sw / br; sx = 0; sy = (img.height - sh) / 2; }
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function generateQRCanvas(text, size) {
    return new Promise((resolve) => {
        const div = document.createElement('div');
        div.style.cssText = 'position:fixed;left:-9999px;top:-9999px;';
        document.body.appendChild(div);
        new QRCode(div, { text, width: size, height: size, colorDark: '#000', colorLight: '#fff', correctLevel: QRCode.CorrectLevel.H });

        const check = setInterval(() => {
            const c = div.querySelector('canvas');
            const im = div.querySelector('img');
            if (c) { clearInterval(check); document.body.removeChild(div); resolve(c); }
            else if (im && im.complete && im.naturalWidth > 0) {
                clearInterval(check);
                const cv = document.createElement('canvas'); cv.width = size; cv.height = size;
                cv.getContext('2d').drawImage(im, 0, 0, size, size);
                document.body.removeChild(div); resolve(cv);
            }
        }, 50);
        setTimeout(() => { clearInterval(check); const c = div.querySelector('canvas'); if (c) { document.body.removeChild(div); resolve(c); } else { const cv = document.createElement('canvas'); cv.width = size; cv.height = size; document.body.removeChild(div); resolve(cv); } }, 3000);
    });
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

// ============ DOWNLOAD & SHARE ============
function downloadImage() {
    if (!appState.generatedImageDataURL) { showToast('⚠️ กรุณาสร้างภาพก่อน'); return; }
    const name = document.getElementById('textLine2').value.trim() || 'location';
    const a = document.createElement('a'); a.href = appState.generatedImageDataURL;
    a.download = `KoShare_${name.replace(/\s+/g, '_')}.png`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    incrementShareCount(); showToast('💾 บันทึกภาพสำเร็จ!');
}

async function shareImage() {
    if (!appState.generatedImageBlob) { showToast('⚠️ กรุณาสร้างภาพก่อน'); return; }
    const name = document.getElementById('textLine2').value.trim() || 'แหล่งเรียนรู้';
    if (navigator.share && navigator.canShare) {
        try {
            const file = new File([appState.generatedImageBlob], `KoShare_${name.replace(/\s+/g, '_')}.png`, { type: 'image/png' });
            const shareData = { title: `Ko Share — ${name}`, text: `📍 แนะนำแหล่งเรียนรู้: ${name}\nสกร.ระดับอำเภอโกสุมพิสัย\n\nสแกน QR Code ในภาพเพื่อดูเส้นทาง!`, files: [file] };
            if (navigator.canShare(shareData)) { await navigator.share(shareData); incrementShareCount(); showToast('📤 แชร์สำเร็จ!'); return; }
        } catch (err) { if (err.name === 'AbortError') return; }
    }
    downloadImage();
}

function shareToFacebook() {
    if (!appState.generatedImageDataURL) { showToast('⚠️ กรุณาสร้างภาพก่อน'); return; }
    const url = `https://www.google.com/maps?q=${appState.latitude},${appState.longitude}`;
    const name = document.getElementById('textLine2').value.trim() || 'แหล่งเรียนรู้';
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}&quote=${encodeURIComponent(`📍 ${name} — สกร.ระดับอำเภอโกสุมพิสัย`)}`, '_blank');
    incrementShareCount();
}

function shareToLine() {
    if (!appState.generatedImageDataURL) { showToast('⚠️ กรุณาสร้างภาพก่อน'); return; }
    const url = `https://www.google.com/maps?q=${appState.latitude},${appState.longitude}`;
    const name = document.getElementById('textLine2').value.trim() || 'แหล่งเรียนรู้';
    window.open(`https://line.me/R/share?text=${encodeURIComponent(`📍 ${name}\nสกร.ระดับอำเภอโกสุมพิสัย\n🗺️ ดูเส้นทาง: ${url}`)}`, '_blank');
    incrementShareCount();
}

function incrementShareCount() {
    appState.shareCount++;
    localStorage.setItem('koShareCount', appState.shareCount.toString());
    document.getElementById('statShares').textContent = appState.shareCount;
}

// ============ SAVE TO MAP (TWO-STEP) ============
async function saveToMap() {
    if (appState.latitude === null) { showToast('⚠️ ไม่มีพิกัด GPS'); return; }
    const locationName = document.getElementById('textLine2').value.trim();
    if (!locationName) { showToast('⚠️ กรุณาพิมพ์ชื่อสถานที่'); return; }

    showLoading('กำลังบันทึกข้อมูล...');

    try {
        // === STEP 1: Save check-in text data via GET (proven working) ===
        const data = {
            locationName: locationName,
            latitude: appState.latitude,
            longitude: appState.longitude,
            description: document.getElementById('textDescription').value.trim(),
        };

        const result = await callGAS('saveCheckIn', data, true);

        if (!result.success) {
            throw new Error(result.error || 'Save failed');
        }

        const checkInId = result.data.id;
        console.log('[KoShare] Check-in saved:', checkInId);

        // === STEP 2: Upload image via form POST (if photo exists) ===
        if (appState.photoCompressed) {
            showLoading('กำลังอัปโหลดภาพ...');
            try {
                await postImageToGAS(checkInId, appState.photoCompressed, locationName);
                console.log('[KoShare] Image upload submitted');
            } catch (imgErr) {
                console.warn('[KoShare] Image upload may have failed:', imgErr);
                // Continue — check-in is saved even without image
            }
        }

        hideLoading();
        showToast('📌 บันทึกสำเร็จ!');

        // Reload data after a delay (give GAS time to process image)
        setTimeout(async () => {
            try { await loadCheckIns(); } catch (e) { }
        }, appState.photoCompressed ? 5000 : 1000);

    } catch (err) {
        hideLoading();
        console.error('Save error:', err);
        showToast('❌ บันทึกไม่สำเร็จ: ' + err.message);
    }
}

// ============ BACKEND API ============
async function incrementVisitCount() {
    try {
        const r = await callGAS('incrementVisit');
        if (r && r.success) {
            document.getElementById('visitCount').textContent = r.data.visitCount;
            document.getElementById('statVisits').textContent = r.data.visitCount;
        }
    } catch (e) { document.getElementById('visitCount').textContent = '—'; }
}

async function loadCheckIns() {
    try {
        const r = await callGAS('getCheckIns');
        if (r && r.success) {
            appState.checkIns = r.data || [];
            document.getElementById('statLocations').textContent = appState.checkIns.length;
            renderHomeGallery(appState.checkIns);
            renderGalleryGrid(appState.checkIns);
            if (appState.mainMap) addCheckInMarkers();
        }
    } catch (e) { console.warn('Load error:', e); }
}

// ============ RENDER ============
function renderHomeGallery(list) {
    const c = document.getElementById('homeGallery');
    if (!list || !list.length) { c.innerHTML = '<div class="empty-state"><span>🏞️</span><p>ยังไม่มีข้อมูล — เริ่มถ่ายภาพเลย!</p></div>'; return; }
    c.innerHTML = list.slice(0, 5).map(i => {
        const lat = Number(i.latitude), lng = Number(i.longitude), n = escapeHtml(i.locationName || ''), t = i.thumbnailUrl || '';
        return `<div class="gallery-card-inline" onclick="showOnMap(${lat},${lng},'${n.replace(/'/g, "\\'")}')">
            ${t ? `<img class="inline-thumb" src="${t}" onerror="this.outerHTML='<div class=\\'inline-icon\\'>📍</div>'">` : '<div class="inline-icon">📍</div>'}
            <div class="inline-info"><div class="inline-name">${n}</div><div class="inline-date">${formatDate(i.timestamp)}</div>
            <div class="inline-coords">${lat.toFixed(4)}, ${lng.toFixed(4)}</div></div></div>`;
    }).join('');
}

function renderGalleryGrid(list) {
    const c = document.getElementById('galleryGrid');
    if (!list || !list.length) { c.innerHTML = '<div class="empty-state"><span>🏞️</span><p>ยังไม่มีข้อมูล</p></div>'; return; }
    c.innerHTML = list.map(i => {
        const lat = Number(i.latitude), lng = Number(i.longitude), n = escapeHtml(i.locationName || '');
        const t = i.thumbnailUrl || '', f = i.imageUrl || '', d = escapeHtml(i.description || '');
        return `<div class="gallery-card" onclick="showOnMap(${lat},${lng},'${n.replace(/'/g, "\\'")}')">
            ${t ? `<img class="gallery-card-image" src="${t}" loading="lazy" onerror="this.style.display='none'">` : `<div class="gallery-card-image" style="display:flex;align-items:center;justify-content:center;font-size:32px;">📍</div>`}
            <div class="gallery-card-info"><div class="gallery-card-name">${n}</div><div class="gallery-card-date">${formatDate(i.timestamp)}</div>
            ${d ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${d}</div>` : ''}
            ${f ? `<a href="${f}" target="_blank" style="font-size:11px;color:var(--accent-primary);text-decoration:none;" onclick="event.stopPropagation()">🖼️ ดูภาพเต็ม</a>` : ''}</div></div>`;
    }).join('');
}

function showOnMap(lat, lng, name) {
    navigateTo('map');
    setTimeout(() => {
        if (appState.mainMap) {
            appState.mainMap.setView([lat, lng], 16);
            L.popup().setLatLng([lat, lng]).setContent(`<div class="popup-title">${name}</div>`).openOn(appState.mainMap);
        }
    }, 500);
}

// ============ MAP ============
function initMainMap() {
    const c = document.getElementById('mainMap');
    if (appState.mainMap) { appState.mainMap.invalidateSize(); addCheckInMarkers(); return; }
    appState.mainMap = L.map(c).setView([16.2478, 103.0650], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(appState.mainMap);
    addCheckInMarkers();
    setTimeout(() => appState.mainMap.invalidateSize(), 300);
}

function addCheckInMarkers() {
    if (!appState.mainMap) return;
    appState.mainMapMarkers.forEach(m => appState.mainMap.removeLayer(m));
    appState.mainMapMarkers = [];
    if (!appState.checkIns || !appState.checkIns.length) return;

    const bounds = [];
    appState.checkIns.forEach(i => {
        const lat = Number(i.latitude), lng = Number(i.longitude);
        if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) return;
        const url = `https://www.google.com/maps?q=${lat},${lng}`;
        const t = i.thumbnailUrl || '';
        const m = L.marker([lat, lng]).addTo(appState.mainMap);
        m.bindPopup(`<div class="popup-title">📍 ${escapeHtml(i.locationName)}</div>
            <div class="popup-date">${formatDate(i.timestamp)}</div>
            ${t ? `<img src="${t}" style="width:100%;max-width:200px;border-radius:6px;margin:6px 0;" onerror="this.style.display='none'">` : ''}
            ${i.description ? `<div style="font-size:12px;margin-bottom:4px;">${escapeHtml(i.description)}</div>` : ''}
            <a class="popup-link" href="${url}" target="_blank">🗺️ เปิดใน Google Maps</a>`);
        appState.mainMapMarkers.push(m);
        bounds.push([lat, lng]);
    });
    if (bounds.length) appState.mainMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
}

// ============ UTILITIES ============
function showToast(msg) {
    const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(t._to); t._to = setTimeout(() => t.classList.remove('show'), 3000);
}
function showLoading(t) { document.getElementById('loadingText').textContent = t || 'กำลังดำเนินการ...'; document.getElementById('loadingOverlay').style.display = 'flex'; }
function hideLoading() { document.getElementById('loadingOverlay').style.display = 'none'; }
function escapeHtml(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function formatDate(s) { if (!s) return ''; try { const d = new Date(s); return isNaN(d.getTime()) ? String(s) : d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return String(s); } }
