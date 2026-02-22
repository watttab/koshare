/* ============================================
   Ko Share — Application Logic (v1.1 — Bug Fixes)
   ============================================ */

// ============ CONFIG ============
const GAS_URL = 'https://script.google.com/macros/s/AKfycbw3E6JPNmLfMs1lxQGt909ncdR6KWYi7hCtMVmdLfYbexVq_8wzW9lRlSyGWhuOto-Gqw/exec';

// ============ STATE ============
const appState = {
    currentPage: 'home',
    photo: null,
    photoDataURL: null,
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
    // Set up camera/gallery inputs
    const cameraInput = document.getElementById('cameraInput');
    const galleryInput = document.getElementById('galleryInput');
    const photoArea = document.getElementById('photoArea');

    cameraInput.addEventListener('change', handlePhotoSelect);
    galleryInput.addEventListener('change', handlePhotoSelect);
    photoArea.addEventListener('click', () => cameraInput.click());

    // Live preview for text inputs
    document.getElementById('textLine2').addEventListener('input', updateComposerPreview);

    // Update share count display
    document.getElementById('statShares').textContent = appState.shareCount;

    // Load data from backend
    try {
        await incrementVisitCount();
    } catch (e) {
        console.warn('Visit count failed:', e);
    }
    try {
        await loadCheckIns();
    } catch (e) {
        console.warn('Load check-ins failed:', e);
    }

    // Handle hash navigation
    window.addEventListener('hashchange', () => {
        const page = location.hash.replace('#', '') || 'home';
        navigateTo(page, false);
    });

    // Check initial hash
    const initialPage = location.hash.replace('#', '') || 'home';
    if (initialPage !== 'home') {
        navigateTo(initialPage, false);
    }
}

// ============ GAS API HELPER ============
// GAS web apps redirect (302) which can cause CORS issues.
// This helper uses fetch with proper redirect handling and JSONP fallback.
async function callGAS(action, data = null) {
    let url = `${GAS_URL}?action=${encodeURIComponent(action)}`;

    // For saveCheckIn, send data as URL parameter (avoids POST redirect issues)
    if (data) {
        url += `&data=${encodeURIComponent(JSON.stringify(data))}`;
    }

    console.log(`[KoShare] API call: ${action}`, data || '');

    // Try fetch first
    try {
        const response = await fetch(url, {
            method: 'GET',
            redirect: 'follow',
        });

        const text = await response.text();
        console.log(`[KoShare] API response for ${action}:`, text.substring(0, 200));

        // GAS sometimes returns HTML instead of JSON when there's an error
        if (text.startsWith('<!DOCTYPE') || text.startsWith('<html')) {
            throw new Error('GAS returned HTML instead of JSON — check deployment');
        }

        return JSON.parse(text);
    } catch (fetchError) {
        console.warn(`[KoShare] Fetch failed for ${action}, trying JSONP:`, fetchError);

        // Fallback: JSONP approach
        return new Promise((resolve, reject) => {
            const callbackName = 'koShareCallback_' + Date.now();
            const script = document.createElement('script');

            // Set timeout
            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error('JSONP timeout'));
            }, 15000);

            function cleanup() {
                clearTimeout(timeout);
                delete window[callbackName];
                if (script.parentNode) script.parentNode.removeChild(script);
            }

            window[callbackName] = (result) => {
                cleanup();
                resolve(result);
            };

            // Use a different approach - create an iframe to handle the redirect
            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            document.body.appendChild(iframe);

            iframe.onload = () => {
                try {
                    // Try to read the response - this may fail due to CORS
                    const content = iframe.contentDocument.body.textContent;
                    const result = JSON.parse(content);
                    document.body.removeChild(iframe);
                    cleanup();
                    resolve(result);
                } catch (e) {
                    document.body.removeChild(iframe);
                    cleanup();
                    reject(new Error('Cannot read API response'));
                }
            };

            iframe.onerror = () => {
                document.body.removeChild(iframe);
                cleanup();
                reject(new Error('API request failed'));
            };

            iframe.src = url;
        });
    }
}

// ============ NAVIGATION ============
function navigateTo(page, pushHash = true) {
    // Hide all pages
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

    // Show target page
    const targetPage = document.getElementById('page' + capitalize(page));
    if (targetPage) {
        targetPage.classList.add('active');
    }

    // Update nav
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.page === page);
    });

    appState.currentPage = page;

    if (pushHash) {
        location.hash = page;
    }

    // Initialize map if needed
    if (page === 'map') {
        setTimeout(() => initMainMap(), 200);
    }

    // Scroll to top
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

    // Compress image for better performance
    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            // Resize if too large (max 1600px on longest side)
            const maxSize = 1600;
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

            appState.photoDataURL = canvas.toDataURL('image/jpeg', 0.85);

            // Show preview
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

            // Update UI
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

            // Show mini map
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
        {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 0
        }
    );
}

function initMiniMap(lat, lng) {
    const container = document.getElementById('miniMap');

    if (appState.miniMap) {
        appState.miniMap.remove();
    }

    appState.miniMap = L.map(container, {
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
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
    // Validation
    if (!appState.photoDataURL) {
        showToast('⚠️ กรุณาถ่ายภาพก่อน');
        return;
    }
    if (appState.latitude === null || appState.longitude === null) {
        showToast('⚠️ กรุณาปักหมุด GPS ก่อน');
        return;
    }
    const locationName = document.getElementById('textLine2').value.trim();
    if (!locationName) {
        showToast('⚠️ กรุณาพิมพ์ชื่อสถานที่');
        return;
    }

    showLoading('กำลังสร้างภาพ...');

    try {
        // === APPROACH: Draw everything on Canvas directly (no html2canvas dependency for QR) ===
        const canvas = document.createElement('canvas');
        canvas.width = 1200;
        canvas.height = 630;
        const ctx = canvas.getContext('2d');

        // 1. Draw photo background
        const photo = await loadImage(appState.photoDataURL);
        drawImageCover(ctx, photo, 0, 0, 1200, 630);

        // 2. Draw gradient overlay
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

        // 3. Draw top text: "แนะนำแหล่งเรียนรู้"
        ctx.textAlign = 'center';
        ctx.shadowColor = 'rgba(0,0,0,0.6)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetY = 2;

        ctx.font = '700 36px Prompt, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(document.getElementById('textLine1').value, 600, 70);

        // 4. Draw location name (line 2)
        ctx.font = '800 48px Prompt, sans-serif';
        ctx.fillStyle = '#fbbf24';
        ctx.fillText(locationName, 600, 130);

        // 5. Generate QR code as canvas
        const mapsUrl = `https://www.google.com/maps?q=${appState.latitude},${appState.longitude}`;
        const qrCanvas = await generateQRCanvas(mapsUrl, 130);

        // Draw QR code with white background/padding
        const qrX = 600 - 75;
        const qrY = 400;
        const qrPadding = 10;

        // White rounded rect behind QR
        ctx.shadowColor = 'rgba(0,0,0,0.4)';
        ctx.shadowBlur = 15;
        ctx.shadowOffsetY = 4;
        ctx.fillStyle = '#ffffff';
        roundRect(ctx, qrX - qrPadding, qrY - qrPadding, 150 + qrPadding * 2, 150 + qrPadding * 2, 12);
        ctx.fill();

        // Reset shadow
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;

        // Draw QR
        ctx.drawImage(qrCanvas, qrX, qrY, 150, 150);

        // 6. "สแกน QR ดูเส้นทาง" text
        ctx.shadowColor = 'rgba(0,0,0,0.6)';
        ctx.shadowBlur = 8;
        ctx.shadowOffsetY = 2;
        ctx.font = '300 16px Prompt, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillText('สแกน QR ดูเส้นทาง', 600, 575);

        // 7. Draw bottom text: "สกร.ระดับอำเภอโกสุมพิสัย"
        ctx.font = '600 26px Prompt, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(document.getElementById('textLine3').value, 600, 605);

        // 8. Brand
        ctx.font = '500 14px Prompt, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fillText('📍 Ko Share', 600, 625);

        // Reset shadow
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;

        // Convert canvas to image
        appState.generatedImageDataURL = canvas.toDataURL('image/png');

        canvas.toBlob((blob) => {
            appState.generatedImageBlob = blob;
        }, 'image/png');

        // Show preview
        const generatedImage = document.getElementById('generatedImage');
        generatedImage.src = appState.generatedImageDataURL;
        document.getElementById('previewArea').style.display = 'block';

        hideLoading();
        showToast('✅ สร้างภาพสำเร็จ!');

        // Scroll to preview
        setTimeout(() => {
            document.getElementById('previewArea').scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);

    } catch (err) {
        hideLoading();
        console.error('Generate error:', err);
        showToast('❌ เกิดข้อผิดพลาด: ' + err.message);
    }
}

// Helper: Load image as promise
function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

// Helper: Draw image with "cover" behavior
function drawImageCover(ctx, img, x, y, w, h) {
    const imgRatio = img.width / img.height;
    const boxRatio = w / h;
    let sw, sh, sx, sy;

    if (imgRatio > boxRatio) {
        sh = img.height;
        sw = sh * boxRatio;
        sx = (img.width - sw) / 2;
        sy = 0;
    } else {
        sw = img.width;
        sh = sw / boxRatio;
        sx = 0;
        sy = (img.height - sh) / 2;
    }

    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

// Helper: Generate QR Code directly on canvas (no DOM dependency)
function generateQRCanvas(text, size) {
    return new Promise((resolve) => {
        // Create a temporary container for QRCode library
        const tempDiv = document.createElement('div');
        tempDiv.style.position = 'fixed';
        tempDiv.style.left = '-9999px';
        tempDiv.style.top = '-9999px';
        document.body.appendChild(tempDiv);

        new QRCode(tempDiv, {
            text: text,
            width: size,
            height: size,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.H,
        });

        // QRCode library creates a canvas element inside the div
        // Wait for it to render
        const checkQR = setInterval(() => {
            const qrCanvas = tempDiv.querySelector('canvas');
            const qrImg = tempDiv.querySelector('img');

            if (qrCanvas) {
                clearInterval(checkQR);
                document.body.removeChild(tempDiv);
                resolve(qrCanvas);
            } else if (qrImg && qrImg.complete && qrImg.src) {
                clearInterval(checkQR);
                // Convert img to canvas
                const c = document.createElement('canvas');
                c.width = size;
                c.height = size;
                const cctx = c.getContext('2d');
                cctx.drawImage(qrImg, 0, 0, size, size);
                document.body.removeChild(tempDiv);
                resolve(c);
            }
        }, 50);

        // Timeout safety
        setTimeout(() => {
            clearInterval(checkQR);
            const qrCanvas = tempDiv.querySelector('canvas');
            if (qrCanvas) {
                document.body.removeChild(tempDiv);
                resolve(qrCanvas);
            } else {
                // Last resort: create a simple placeholder
                const c = document.createElement('canvas');
                c.width = size;
                c.height = size;
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

// Helper: Rounded rectangle
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
    if (!appState.generatedImageDataURL) {
        showToast('⚠️ กรุณาสร้างภาพก่อน');
        return;
    }

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
    if (!appState.generatedImageBlob) {
        showToast('⚠️ กรุณาสร้างภาพก่อน');
        return;
    }

    const locationName = document.getElementById('textLine2').value.trim() || 'แหล่งเรียนรู้';

    if (navigator.share && navigator.canShare) {
        try {
            const file = new File(
                [appState.generatedImageBlob],
                `KoShare_${locationName.replace(/\s+/g, '_')}.png`,
                { type: 'image/png' }
            );

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
            console.warn('Share API failed:', err);
        }
    }

    // Fallback: download the image
    downloadImage();
}

function shareToFacebook() {
    if (!appState.generatedImageDataURL) {
        showToast('⚠️ กรุณาสร้างภาพก่อน');
        return;
    }

    const mapsUrl = `https://www.google.com/maps?q=${appState.latitude},${appState.longitude}`;
    const locationName = document.getElementById('textLine2').value.trim() || 'แหล่งเรียนรู้';
    const fbUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(mapsUrl)}&quote=${encodeURIComponent(`📍 แนะนำแหล่งเรียนรู้: ${locationName}\nสกร.ระดับอำเภอโกสุมพิสัย`)}`;

    window.open(fbUrl, '_blank');
    incrementShareCount();
    showToast('📤 กำลังเปิด Facebook...\n💡 Tip: ใช้ปุ่ม "แชร์" เพื่อส่งภาพตรง');
}

function shareToLine() {
    if (!appState.generatedImageDataURL) {
        showToast('⚠️ กรุณาสร้างภาพก่อน');
        return;
    }

    const mapsUrl = `https://www.google.com/maps?q=${appState.latitude},${appState.longitude}`;
    const locationName = document.getElementById('textLine2').value.trim() || 'แหล่งเรียนรู้';
    const text = `📍 แนะนำแหล่งเรียนรู้: ${locationName}\nสกร.ระดับอำเภอโกสุมพิสัย\n🗺️ ดูเส้นทาง: ${mapsUrl}`;
    const lineUrl = `https://line.me/R/share?text=${encodeURIComponent(text)}`;

    window.open(lineUrl, '_blank');
    incrementShareCount();
    showToast('📤 กำลังเปิด LINE...\n💡 Tip: ใช้ปุ่ม "แชร์" เพื่อส่งภาพตรง');
}

function incrementShareCount() {
    appState.shareCount++;
    localStorage.setItem('koShareCount', appState.shareCount.toString());
    document.getElementById('statShares').textContent = appState.shareCount;
}

// ============ SAVE TO MAP ============
async function saveToMap() {
    if (appState.latitude === null || appState.longitude === null) {
        showToast('⚠️ ไม่มีพิกัด GPS');
        return;
    }

    const locationName = document.getElementById('textLine2').value.trim();
    if (!locationName) {
        showToast('⚠️ กรุณาพิมพ์ชื่อสถานที่');
        return;
    }

    showLoading('กำลังบันทึกลงแผนที่...');

    try {
        const data = {
            locationName: locationName,
            latitude: appState.latitude,
            longitude: appState.longitude,
            description: document.getElementById('textDescription').value.trim(),
        };

        // Use GET with data parameter (more reliable with GAS redirects)
        const result = await callGAS('saveCheckIn', data);

        if (result.success) {
            hideLoading();
            showToast('📌 บันทึกลงแผนที่สำเร็จ!');
            // Reload check-ins
            loadCheckIns();
        } else {
            throw new Error(result.error || 'Unknown error');
        }
    } catch (err) {
        hideLoading();
        console.error('Save error:', err);
        showToast('❌ บันทึกไม่สำเร็จ: ' + err.message);
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

            // Refresh map markers if map is already loaded
            if (appState.mainMap) {
                addCheckInMarkers();
            }
        }
    } catch (err) {
        console.warn('Load check-ins error:', err);
    }
}

function renderHomeGallery(checkIns) {
    const container = document.getElementById('homeGallery');

    if (!checkIns || checkIns.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <span>🏞️</span>
                <p>ยังไม่มีข้อมูล — เริ่มถ่ายภาพเลย!</p>
            </div>
        `;
        return;
    }

    const recent = checkIns.slice(0, 5);
    container.innerHTML = recent.map(item => {
        const lat = Number(item.latitude);
        const lng = Number(item.longitude);
        const name = escapeHtml(item.locationName || '');
        return `
        <div class="gallery-card-inline" onclick="showOnMap(${lat}, ${lng}, '${name.replace(/'/g, "\\'")}')">
            <div class="inline-icon">📍</div>
            <div class="inline-info">
                <div class="inline-name">${name}</div>
                <div class="inline-date">${formatDate(item.timestamp)}</div>
                <div class="inline-coords">${lat.toFixed(4)}, ${lng.toFixed(4)}</div>
            </div>
        </div>
        `;
    }).join('');
}

function renderGalleryGrid(checkIns) {
    const container = document.getElementById('galleryGrid');

    if (!checkIns || checkIns.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <span>🏞️</span>
                <p>ยังไม่มีข้อมูล</p>
            </div>
        `;
        return;
    }

    container.innerHTML = checkIns.map(item => {
        const lat = Number(item.latitude);
        const lng = Number(item.longitude);
        const name = escapeHtml(item.locationName || '');
        const desc = escapeHtml(item.description || '');
        const mapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;
        return `
        <div class="gallery-card" onclick="showOnMap(${lat}, ${lng}, '${name.replace(/'/g, "\\'")}')">
            <div class="gallery-card-image" style="display: flex; align-items: center; justify-content: center; font-size: 32px; flex-direction: column; gap: 4px;">
                <span>📍</span>
                <span style="font-size: 11px; color: var(--text-muted);">${lat.toFixed(3)}, ${lng.toFixed(3)}</span>
            </div>
            <div class="gallery-card-info">
                <div class="gallery-card-name">${name}</div>
                <div class="gallery-card-date">${formatDate(item.timestamp)}</div>
                ${desc ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${desc}</div>` : ''}
            </div>
        </div>
        `;
    }).join('');
}

function showOnMap(lat, lng, name) {
    navigateTo('map');
    setTimeout(() => {
        if (appState.mainMap) {
            appState.mainMap.setView([lat, lng], 16);
            L.popup()
                .setLatLng([lat, lng])
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
        // Re-add markers in case data was loaded after map init
        addCheckInMarkers();
        return;
    }

    // Default center: Kosumphisai, Maha Sarakham
    const defaultLat = 16.2478;
    const defaultLng = 103.0650;

    appState.mainMap = L.map(container).setView([defaultLat, defaultLng], 12);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19,
    }).addTo(appState.mainMap);

    // Add check-in markers
    addCheckInMarkers();

    setTimeout(() => appState.mainMap.invalidateSize(), 300);
}

function addCheckInMarkers() {
    if (!appState.mainMap) return;

    // Remove existing markers
    appState.mainMapMarkers.forEach(m => appState.mainMap.removeLayer(m));
    appState.mainMapMarkers = [];

    if (!appState.checkIns || appState.checkIns.length === 0) return;

    const bounds = [];

    appState.checkIns.forEach(item => {
        const lat = Number(item.latitude);
        const lng = Number(item.longitude);
        if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) return;

        const mapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;

        const marker = L.marker([lat, lng]).addTo(appState.mainMap);
        marker.bindPopup(`
            <div class="popup-title">📍 ${escapeHtml(item.locationName)}</div>
            <div class="popup-date">${formatDate(item.timestamp)}</div>
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
    toast._timeout = setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
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
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch (e) {
        return String(dateStr);
    }
}
