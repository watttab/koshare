/* ============================================
   Ko Share — Application Logic (v2.0)
   Google Drive image upload + Security
   ============================================ */

// ============ CONFIG ============
const GAS_URL = 'https://script.google.com/macros/s/AKfycbw3E6JPNmLfMs1lxQGt909ncdR6KWYi7hCtMVmdLfYbexVq_8wzW9lRlSyGWhuOto-Gqw/exec';
const API_KEY = 'KOSHARE_2024_sKr_GoSuM';

// ============ STATE ============
const appState = {
    currentPage: 'home',
    photo: null,
    photoDataURL: null,
    photoCompressed: null, // compressed base64 for upload
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
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

async function initApp() {
    const cameraInput = document.getElementById('cameraInput');
    const galleryInput = document.getElementById('galleryInput');
    const photoArea = document.getElementById('photoArea');

    cameraInput.addEventListener('change', handlePhotoSelect);
    galleryInput.addEventListener('change', handlePhotoSelect);
    photoArea.addEventListener('click', () => cameraInput.click());

    document.getElementById('textLine2').addEventListener('input', updateComposerPreview);
    document.getElementById('statShares').textContent = appState.shareCount;

    // Load data
    try { await incrementVisitCount(); } catch (e) { console.warn('Visit:', e); }
    try { await loadCheckIns(); } catch (e) { console.warn('CheckIns:', e); }

    window.addEventListener('hashchange', () => {
        const page = location.hash.replace('#', '') || 'home';
        navigateTo(page, false);
    });

    const initialPage = location.hash.replace('#', '') || 'home';
    if (initialPage !== 'home') navigateTo(initialPage, false);
}

// ============ GAS API HELPER ============
async function callGAS(action, data = null, requireKey = false) {
    let url = `${GAS_URL}?action=${encodeURIComponent(action)}`;
    if (requireKey) {
        url += `&key=${encodeURIComponent(API_KEY)}`;
    }

    let options = { method: 'GET', redirect: 'follow' };

    // For large payloads (with image), use POST
    if (data && data.imageBase64) {
        options.method = 'POST';
        options.body = JSON.stringify(data);
        options.headers = { 'Content-Type': 'text/plain' };
        if (requireKey) {
            url = `${GAS_URL}?action=${encodeURIComponent(action)}&key=${encodeURIComponent(API_KEY)}`;
        }
    } else if (data) {
        url += `&data=${encodeURIComponent(JSON.stringify(data))}`;
    }

    console.log(`[KoShare] API: ${action}`, data ? '(with data)' : '');

    try {
        const response = await fetch(url, options);
        const text = await response.text();
        console.log(`[KoShare] Response ${action}:`, text.substring(0, 300));

        if (text.startsWith('<!DOCTYPE') || text.startsWith('<html')) {
            throw new Error('GAS returned HTML — check deployment');
        }

        return JSON.parse(text);
    } catch (err) {
        console.error(`[KoShare] API error (${action}):`, err);
        throw err;
    }
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

function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

// ============ PHOTO HANDLING ============
function handlePhotoSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    appState.photo = file;

    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            // Compress for upload (max 800px, quality 0.6 → ~100-200KB)
            const uploadCanvas = compressImage(img, 800, 0.6);
            appState.photoCompressed = uploadCanvas.toDataURL('image/jpeg', 0.6);

            // Higher quality for display/compose (max 1600px)
            const displayCanvas = compressImage(img, 1600, 0.85);
            appState.photoDataURL = displayCanvas.toDataURL('image/jpeg', 0.85);

            const preview = document.getElementById('photoPreview');
            const placeholder = document.getElementById('photoPlaceholder');
            preview.src = appState.photoDataURL;
            preview.style.display = 'block';
            placeholder.style.display = 'none';
            showToast('📷 ถ่ายภาพสำเร็จ!');
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
}

function compressImage(img, maxSize, quality) {
    let width = img.width;
    let height = img.height;

    if (width > maxSize || height > maxSize) {
        if (width > height) {
            height = Math.round(height * (maxSize / width));
            width = maxSize;
        } else {
            width = Math.round(width * (maxSize / height));
            height = maxSize;
        }
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    return canvas;
}

// ============ GPS ============
function getGPSLocation() {
    const statusEl = document.getElementById('gpsStatus');
    const btnGPS = document.getElementById('btnGetGPS');

    if (!navigator.geolocation) {
        showToast('❌ เบราว์เซอร์ไม่รองรับ GPS');
        return;
    }

    statusEl.innerHTML = `
        <div class="gps-waiting">
            <div class="gps-spinner"></div>
            <p>กำลังรับพิกัด GPS...</p>
        </div>
    `;
    btnGPS.disabled = true;
    btnGPS.textContent = '⏳ รอรับพิกัด...';

    navigator.geolocation.getCurrentPosition(
        (position) => {
            appState.latitude = position.coords.latitude;
            appState.longitude = position.coords.longitude;

            statusEl.innerHTML = `
                <div class="gps-found">
                    <span class="gps-found-icon">✅</span>
                    <span>ได้รับพิกัดแล้ว!</span>
                </div>
            `;

            document.getElementById('latValue').textContent = appState.latitude.toFixed(6);
            document.getElementById('lngValue').textContent = appState.longitude.toFixed(6);
            document.getElementById('gpsInfo').style.display = 'block';

            btnGPS.disabled = false;
            btnGPS.textContent = '🔄 ปักหมุดใหม่';

            initMiniMap(appState.latitude, appState.longitude);
            showToast('📍 ปักหมุดสำเร็จ!');
        },
        (error) => {
            let msg = 'ไม่สามารถรับพิกัดได้';
            switch (error.code) {
                case 1: msg = 'กรุณาอนุญาตการเข้าถึงตำแหน่ง'; break;
                case 2: msg = 'ไม่สามารถหาตำแหน่งได้'; break;
                case 3: msg = 'หมดเวลารอรับตำแหน่ง'; break;
            }
            statusEl.innerHTML = `
                <div class="gps-found" style="color: var(--accent-orange)">
                    <span class="gps-found-icon">⚠️</span>
                    <span>${msg}</span>
                </div>
            `;
            btnGPS.disabled = false;
            btnGPS.textContent = '📍 ลองใหม่';
            showToast('⚠️ ' + msg);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
}

function initMiniMap(lat, lng) {
    const container = document.getElementById('miniMap');
    if (appState.miniMap) appState.miniMap.remove();

    appState.miniMap = L.map(container, {
        zoomControl: false, attributionControl: false,
        dragging: false, scrollWheelZoom: false,
    }).setView([lat, lng], 15);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(appState.miniMap);
    L.marker([lat, lng]).addTo(appState.miniMap);
    setTimeout(() => appState.miniMap.invalidateSize(), 200);
}

// ============ IMAGE COMPOSER ============
function updateComposerPreview() {
    const line2 = document.getElementById('textLine2').value || 'ชื่อสถานที่';
    document.getElementById('composerLine2').textContent = line2;
}

async function generateImage() {
    if (!appState.photoDataURL) { showToast('⚠️ กรุณาถ่ายภาพก่อน'); return; }
    if (appState.latitude === null) { showToast('⚠️ กรุณาปักหมุด GPS ก่อน'); return; }
    const locationName = document.getElementById('textLine2').value.trim();
    if (!locationName) { showToast('⚠️ กรุณาพิมพ์ชื่อสถานที่'); return; }

    showLoading('กำลังสร้างภาพ...');

    try {
        const canvas = document.createElement('canvas');
        canvas.width = 1200;
        canvas.height = 630;
        const ctx = canvas.getContext('2d');

        // 1. Photo background
        const photo = await loadImage(appState.photoDataURL);
        drawImageCover(ctx, photo, 0, 0, 1200, 630);

        // 2. Gradient overlays
        const gradTop = ctx.createLinearGradient(0, 0, 0, 250);
        gradTop.addColorStop(0, 'rgba(0,0,0,0.75)');
        gradTop.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gradTop;
        ctx.fillRect(0, 0, 1200, 250);

        const gradBottom = ctx.createLinearGradient(0, 380, 0, 630);
        gradBottom.addColorStop(0, 'rgba(0,0,0,0)');
        gradBottom.addColorStop(1, 'rgba(0,0,0,0.8)');
        ctx.fillStyle = gradBottom;
        ctx.fillRect(0, 380, 1200, 250);

        // 3. Text overlays
        ctx.textAlign = 'center';
        ctx.shadowColor = 'rgba(0,0,0,0.6)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetY = 2;

        ctx.font = '700 36px Prompt, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(document.getElementById('textLine1').value, 600, 70);

        ctx.font = '800 48px Prompt, sans-serif';
        ctx.fillStyle = '#fbbf24';
        ctx.fillText(locationName, 600, 130);

        // 4. QR Code
        const mapsUrl = `https://www.google.com/maps?q=${appState.latitude},${appState.longitude}`;
        const qrCanvas = await generateQRCanvas(mapsUrl, 130);

        const qrX = 600 - 75;
        const qrY = 400;
        const qrPadding = 10;

        ctx.shadowColor = 'rgba(0,0,0,0.4)';
        ctx.shadowBlur = 15;
        ctx.shadowOffsetY = 4;
        ctx.fillStyle = '#ffffff';
        roundRect(ctx, qrX - qrPadding, qrY - qrPadding, 150 + qrPadding * 2, 150 + qrPadding * 2, 12);
        ctx.fill();

        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
        ctx.drawImage(qrCanvas, qrX, qrY, 150, 150);

        // 5. Bottom text
        ctx.shadowColor = 'rgba(0,0,0,0.6)';
        ctx.shadowBlur = 8;
        ctx.shadowOffsetY = 2;
        ctx.font = '300 16px Prompt, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillText('สแกน QR ดูเส้นทาง', 600, 575);

        ctx.font = '600 26px Prompt, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(document.getElementById('textLine3').value, 600, 605);

        ctx.font = '500 14px Prompt, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fillText('📍 Ko Share', 600, 625);

        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;

        // Convert
        appState.generatedImageDataURL = canvas.toDataURL('image/png');
        canvas.toBlob((blob) => { appState.generatedImageBlob = blob; }, 'image/png');

        document.getElementById('generatedImage').src = appState.generatedImageDataURL;
        document.getElementById('previewArea').style.display = 'block';

        hideLoading();
        showToast('✅ สร้างภาพสำเร็จ!');

        setTimeout(() => {
            document.getElementById('previewArea').scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);

    } catch (err) {
        hideLoading();
        console.error('Generate error:', err);
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
    const imgRatio = img.width / img.height;
    const boxRatio = w / h;
    let sw, sh, sx, sy;
    if (imgRatio > boxRatio) {
        sh = img.height; sw = sh * boxRatio; sx = (img.width - sw) / 2; sy = 0;
    } else {
        sw = img.width; sh = sw / boxRatio; sx = 0; sy = (img.height - sh) / 2;
    }
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function generateQRCanvas(text, size) {
    return new Promise((resolve) => {
        const tempDiv = document.createElement('div');
        tempDiv.style.cssText = 'position:fixed;left:-9999px;top:-9999px;';
        document.body.appendChild(tempDiv);

        new QRCode(tempDiv, {
            text, width: size, height: size,
            colorDark: '#000000', colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.H,
        });

        const checkQR = setInterval(() => {
            const qrCanvas = tempDiv.querySelector('canvas');
            const qrImg = tempDiv.querySelector('img');

            if (qrCanvas) {
                clearInterval(checkQR);
                document.body.removeChild(tempDiv);
                resolve(qrCanvas);
            } else if (qrImg && qrImg.complete && qrImg.src && qrImg.naturalWidth > 0) {
                clearInterval(checkQR);
                const c = document.createElement('canvas');
                c.width = size; c.height = size;
                c.getContext('2d').drawImage(qrImg, 0, 0, size, size);
                document.body.removeChild(tempDiv);
                resolve(c);
            }
        }, 50);

        setTimeout(() => {
            clearInterval(checkQR);
            const qrCanvas = tempDiv.querySelector('canvas');
            if (qrCanvas) {
                document.body.removeChild(tempDiv);
                resolve(qrCanvas);
            } else {
                const c = document.createElement('canvas');
                c.width = size; c.height = size;
                const cctx = c.getContext('2d');
                cctx.fillStyle = '#ffffff';
                cctx.fillRect(0, 0, size, size);
                cctx.fillStyle = '#333';
                cctx.font = '10px sans-serif';
                cctx.textAlign = 'center';
                cctx.fillText('QR Error', size / 2, size / 2);
                document.body.removeChild(tempDiv);
                resolve(c);
            }
        }, 3000);
    });
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

// ============ DOWNLOAD & SHARE ============
function downloadImage() {
    if (!appState.generatedImageDataURL) { showToast('⚠️ กรุณาสร้างภาพก่อน'); return; }
    const locationName = document.getElementById('textLine2').value.trim() || 'location';
    const link = document.createElement('a');
    link.href = appState.generatedImageDataURL;
    link.download = `KoShare_${locationName.replace(/\s+/g, '_')}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    incrementShareCount();
    showToast('💾 บันทึกภาพสำเร็จ!');
}

async function shareImage() {
    if (!appState.generatedImageBlob) { showToast('⚠️ กรุณาสร้างภาพก่อน'); return; }
    const locationName = document.getElementById('textLine2').value.trim() || 'แหล่งเรียนรู้';

    if (navigator.share && navigator.canShare) {
        try {
            const file = new File([appState.generatedImageBlob],
                `KoShare_${locationName.replace(/\s+/g, '_')}.png`, { type: 'image/png' });
            const shareData = {
                title: `Ko Share — ${locationName}`,
                text: `📍 แนะนำแหล่งเรียนรู้: ${locationName}\nสกร.ระดับอำเภอโกสุมพิสัย\n\nสแกน QR Code ในภาพเพื่อดูเส้นทาง!`,
                files: [file],
            };
            if (navigator.canShare(shareData)) {
                await navigator.share(shareData);
                incrementShareCount();
                showToast('📤 แชร์สำเร็จ!');
                return;
            }
        } catch (err) {
            if (err.name === 'AbortError') return;
        }
    }
    downloadImage();
}

function shareToFacebook() {
    if (!appState.generatedImageDataURL) { showToast('⚠️ กรุณาสร้างภาพก่อน'); return; }
    const mapsUrl = `https://www.google.com/maps?q=${appState.latitude},${appState.longitude}`;
    const locationName = document.getElementById('textLine2').value.trim() || 'แหล่งเรียนรู้';
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(mapsUrl)}&quote=${encodeURIComponent(`📍 ${locationName} — สกร.ระดับอำเภอโกสุมพิสัย`)}`, '_blank');
    incrementShareCount();
    showToast('📤 เปิด Facebook แล้ว');
}

function shareToLine() {
    if (!appState.generatedImageDataURL) { showToast('⚠️ กรุณาสร้างภาพก่อน'); return; }
    const mapsUrl = `https://www.google.com/maps?q=${appState.latitude},${appState.longitude}`;
    const locationName = document.getElementById('textLine2').value.trim() || 'แหล่งเรียนรู้';
    const text = `📍 แนะนำแหล่งเรียนรู้: ${locationName}\nสกร.ระดับอำเภอโกสุมพิสัย\n🗺️ ดูเส้นทาง: ${mapsUrl}`;
    window.open(`https://line.me/R/share?text=${encodeURIComponent(text)}`, '_blank');
    incrementShareCount();
    showToast('📤 เปิด LINE แล้ว');
}

function incrementShareCount() {
    appState.shareCount++;
    localStorage.setItem('koShareCount', appState.shareCount.toString());
    document.getElementById('statShares').textContent = appState.shareCount;
}

// ============ SAVE TO MAP (with image upload) ============
async function saveToMap() {
    if (appState.latitude === null) { showToast('⚠️ ไม่มีพิกัด GPS'); return; }
    const locationName = document.getElementById('textLine2').value.trim();
    if (!locationName) { showToast('⚠️ กรุณาพิมพ์ชื่อสถานที่'); return; }

    showLoading('กำลังอัปโหลดภาพ & บันทึก...');

    try {
        const data = {
            locationName: locationName,
            latitude: appState.latitude,
            longitude: appState.longitude,
            description: document.getElementById('textDescription').value.trim(),
        };

        // Include compressed photo for Drive upload
        if (appState.photoCompressed) {
            data.imageBase64 = appState.photoCompressed;
        }

        // Use saveCheckInWithImage action (POST for image data)
        const result = await callGAS('saveCheckInWithImage', data, true);

        if (result.success) {
            hideLoading();
            showToast('📌 บันทึกสำเร็จ! ภาพอัปโหลดไป Google Drive แล้ว');
            loadCheckIns();
        } else {
            throw new Error(result.error || 'Unknown error');
        }
    } catch (err) {
        hideLoading();
        console.error('Save error:', err);

        // Fallback: save without image
        try {
            showLoading('บันทึกข้อมูลอย่างเดียว...');
            const data = {
                locationName: locationName,
                latitude: appState.latitude,
                longitude: appState.longitude,
                description: document.getElementById('textDescription').value.trim(),
            };
            const result = await callGAS('saveCheckIn', data, true);
            hideLoading();
            if (result.success) {
                showToast('📌 บันทึกข้อมูลสำเร็จ (ไม่ได้อัปโหลดภาพ)');
                loadCheckIns();
            } else {
                showToast('❌ บันทึกไม่สำเร็จ');
            }
        } catch (e2) {
            hideLoading();
            showToast('❌ บันทึกไม่สำเร็จ: ' + err.message);
        }
    }
}

// ============ BACKEND API ============
async function incrementVisitCount() {
    try {
        const result = await callGAS('incrementVisit');
        if (result && result.success) {
            document.getElementById('visitCount').textContent = result.data.visitCount;
            document.getElementById('statVisits').textContent = result.data.visitCount;
        }
    } catch (err) {
        console.warn('Visit count error:', err);
        document.getElementById('visitCount').textContent = '—';
    }
}

async function loadCheckIns() {
    try {
        const result = await callGAS('getCheckIns');
        if (result && result.success) {
            appState.checkIns = result.data || [];
            document.getElementById('statLocations').textContent = appState.checkIns.length;
            renderHomeGallery(appState.checkIns);
            renderGalleryGrid(appState.checkIns);
            if (appState.mainMap) addCheckInMarkers();
        }
    } catch (err) {
        console.warn('Load check-ins error:', err);
    }
}

// ============ RENDER GALLERY ============
function renderHomeGallery(checkIns) {
    const container = document.getElementById('homeGallery');
    if (!checkIns || checkIns.length === 0) {
        container.innerHTML = `<div class="empty-state"><span>🏞️</span><p>ยังไม่มีข้อมูล — เริ่มถ่ายภาพเลย!</p></div>`;
        return;
    }

    container.innerHTML = checkIns.slice(0, 5).map(item => {
        const lat = Number(item.latitude);
        const lng = Number(item.longitude);
        const name = escapeHtml(item.locationName || '');
        const thumb = item.thumbnailUrl || '';
        return `
        <div class="gallery-card-inline" onclick="showOnMap(${lat}, ${lng}, '${name.replace(/'/g, "\\'")}')">
            ${thumb
                ? `<img class="inline-thumb" src="${thumb}" onerror="this.outerHTML='<div class=\\'inline-icon\\'>📍</div>'">`
                : `<div class="inline-icon">📍</div>`
            }
            <div class="inline-info">
                <div class="inline-name">${name}</div>
                <div class="inline-date">${formatDate(item.timestamp)}</div>
                <div class="inline-coords">${lat.toFixed(4)}, ${lng.toFixed(4)}</div>
            </div>
        </div>`;
    }).join('');
}

function renderGalleryGrid(checkIns) {
    const container = document.getElementById('galleryGrid');
    if (!checkIns || checkIns.length === 0) {
        container.innerHTML = `<div class="empty-state"><span>🏞️</span><p>ยังไม่มีข้อมูล</p></div>`;
        return;
    }

    container.innerHTML = checkIns.map(item => {
        const lat = Number(item.latitude);
        const lng = Number(item.longitude);
        const name = escapeHtml(item.locationName || '');
        const desc = escapeHtml(item.description || '');
        const thumb = item.thumbnailUrl || '';
        const fullImg = item.imageUrl || '';
        return `
        <div class="gallery-card" onclick="showOnMap(${lat}, ${lng}, '${name.replace(/'/g, "\\'")}')">
            ${thumb
                ? `<img class="gallery-card-image" src="${thumb}" loading="lazy" onerror="this.style.display='none'">`
                : `<div class="gallery-card-image" style="display:flex;align-items:center;justify-content:center;font-size:32px;flex-direction:column;gap:4px;">
                    <span>📍</span>
                    <span style="font-size:11px;color:var(--text-muted);">${lat.toFixed(3)}, ${lng.toFixed(3)}</span>
                  </div>`
            }
            <div class="gallery-card-info">
                <div class="gallery-card-name">${name}</div>
                <div class="gallery-card-date">${formatDate(item.timestamp)}</div>
                ${desc ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${desc}</div>` : ''}
                ${fullImg ? `<a href="${fullImg}" target="_blank" style="font-size:11px;color:var(--accent-primary);text-decoration:none;" onclick="event.stopPropagation()">🖼️ ดูภาพเต็ม</a>` : ''}
            </div>
        </div>`;
    }).join('');
}

function showOnMap(lat, lng, name) {
    navigateTo('map');
    setTimeout(() => {
        if (appState.mainMap) {
            appState.mainMap.setView([lat, lng], 16);
            L.popup().setLatLng([lat, lng])
                .setContent(`<div class="popup-title">${name}</div>`)
                .openOn(appState.mainMap);
        }
    }, 500);
}

// ============ MAP ============
function initMainMap() {
    const container = document.getElementById('mainMap');
    if (appState.mainMap) {
        appState.mainMap.invalidateSize();
        addCheckInMarkers();
        return;
    }

    appState.mainMap = L.map(container).setView([16.2478, 103.0650], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap', maxZoom: 19,
    }).addTo(appState.mainMap);

    addCheckInMarkers();
    setTimeout(() => appState.mainMap.invalidateSize(), 300);
}

function addCheckInMarkers() {
    if (!appState.mainMap) return;

    appState.mainMapMarkers.forEach(m => appState.mainMap.removeLayer(m));
    appState.mainMapMarkers = [];
    if (!appState.checkIns || appState.checkIns.length === 0) return;

    const bounds = [];
    appState.checkIns.forEach(item => {
        const lat = Number(item.latitude);
        const lng = Number(item.longitude);
        if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) return;

        const mapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;
        const thumb = item.thumbnailUrl || '';

        const marker = L.marker([lat, lng]).addTo(appState.mainMap);
        marker.bindPopup(`
            <div class="popup-title">📍 ${escapeHtml(item.locationName)}</div>
            <div class="popup-date">${formatDate(item.timestamp)}</div>
            ${thumb ? `<img src="${thumb}" style="width:100%;max-width:200px;border-radius:6px;margin:6px 0;" onerror="this.style.display='none'">` : ''}
            ${item.description ? `<div style="font-size:12px;margin-bottom:4px;">${escapeHtml(item.description)}</div>` : ''}
            <a class="popup-link" href="${mapsUrl}" target="_blank">🗺️ เปิดใน Google Maps</a>
        `);

        appState.mainMapMarkers.push(marker);
        bounds.push([lat, lng]);
    });

    if (bounds.length > 0) {
        appState.mainMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
    }
}

// ============ UTILITIES ============
function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => toast.classList.remove('show'), 3000);
}

function showLoading(text = 'กำลังดำเนินการ...') {
    document.getElementById('loadingText').textContent = text;
    document.getElementById('loadingOverlay').style.display = 'flex';
}

function hideLoading() {
    document.getElementById('loadingOverlay').style.display = 'none';
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return String(dateStr);
        return d.toLocaleDateString('th-TH', {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    } catch (e) { return String(dateStr); }
}
