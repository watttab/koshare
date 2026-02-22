/* ============================================
   Ko Share — Application Logic
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
    incrementVisitCount();
    loadCheckIns();

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
        setTimeout(() => initMainMap(), 100);
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

    const reader = new FileReader();
    reader.onload = (event) => {
        appState.photoDataURL = event.target.result;

        // Show preview
        const preview = document.getElementById('photoPreview');
        const placeholder = document.getElementById('photoPlaceholder');
        preview.src = event.target.result;
        preview.style.display = 'block';
        placeholder.style.display = 'none';

        showToast('📷 ถ่ายภาพสำเร็จ!');
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
        // Prepare composer
        const composerWrapper = document.getElementById('composerWrapper');
        const composer = document.getElementById('imageComposer');
        const composerPhoto = document.getElementById('composerPhoto');

        composerWrapper.style.display = 'block';
        composerWrapper.style.position = 'fixed';
        composerWrapper.style.left = '-9999px';
        composerWrapper.style.top = '0';

        // Set photo background
        composerPhoto.style.backgroundImage = `url(${appState.photoDataURL})`;

        // Set text
        document.getElementById('composerLine1').textContent = document.getElementById('textLine1').value;
        document.getElementById('composerLine2').textContent = locationName;
        document.getElementById('composerLine3').textContent = document.getElementById('textLine3').value;

        // Generate QR Code
        const mapsUrl = `https://www.google.com/maps?q=${appState.latitude},${appState.longitude}`;
        const qrContainer = document.getElementById('composerQR');
        qrContainer.innerHTML = '';

        new QRCode(qrContainer, {
            text: mapsUrl,
            width: 120,
            height: 120,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.H,
        });

        // Wait for QR code to render
        await new Promise(resolve => setTimeout(resolve, 500));

        // Render with html2canvas
        const canvas = await html2canvas(composer, {
            width: 1200,
            height: 630,
            scale: 1,
            useCORS: true,
            allowTaint: true,
            backgroundColor: '#1a1a2e',
        });

        // Convert to data URL and blob
        appState.generatedImageDataURL = canvas.toDataURL('image/png');

        canvas.toBlob((blob) => {
            appState.generatedImageBlob = blob;
        }, 'image/png');

        // Show preview
        const generatedImage = document.getElementById('generatedImage');
        generatedImage.src = appState.generatedImageDataURL;
        document.getElementById('previewArea').style.display = 'block';

        // Hide composer
        composerWrapper.style.display = 'none';
        composerWrapper.style.position = '';
        composerWrapper.style.left = '';

        hideLoading();
        showToast('✅ สร้างภาพสำเร็จ!');

        // Scroll to preview
        document.getElementById('previewArea').scrollIntoView({ behavior: 'smooth', block: 'center' });

    } catch (err) {
        hideLoading();
        console.error('Generate error:', err);
        showToast('❌ เกิดข้อผิดพลาด: ' + err.message);
    }
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

    // Facebook doesn't support direct image share from web
    // We'll use the share dialog with the maps URL
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

        const response = await fetch(`${GAS_URL}?action=saveCheckIn`, {
            method: 'POST',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'text/plain' },
        });

        const result = await response.json();

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
        const response = await fetch(`${GAS_URL}?action=incrementVisit`);
        const result = await response.json();
        if (result.success) {
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
        const response = await fetch(`${GAS_URL}?action=getCheckIns`);
        const result = await response.json();

        if (result.success) {
            appState.checkIns = result.data;
            document.getElementById('statLocations').textContent = result.data.length;
            renderHomeGallery(result.data);
            renderGalleryGrid(result.data);
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
    container.innerHTML = recent.map(item => `
        <div class="gallery-card-inline" onclick="showOnMap(${item.latitude}, ${item.longitude}, '${escapeHtml(item.locationName)}')">
            <div class="inline-icon">📍</div>
            <div class="inline-info">
                <div class="inline-name">${escapeHtml(item.locationName)}</div>
                <div class="inline-date">${formatDate(item.timestamp)}</div>
                <div class="inline-coords">${Number(item.latitude).toFixed(4)}, ${Number(item.longitude).toFixed(4)}</div>
            </div>
        </div>
    `).join('');
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

    container.innerHTML = checkIns.map(item => `
        <div class="gallery-card" onclick="showOnMap(${item.latitude}, ${item.longitude}, '${escapeHtml(item.locationName)}')">
            <div class="gallery-card-image" style="display: flex; align-items: center; justify-content: center; font-size: 32px;">📍</div>
            <div class="gallery-card-info">
                <div class="gallery-card-name">${escapeHtml(item.locationName)}</div>
                <div class="gallery-card-date">${formatDate(item.timestamp)}</div>
            </div>
        </div>
    `).join('');
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
    }, 300);
}

// ============ MAP ============
function initMainMap() {
    const container = document.getElementById('mainMap');

    if (appState.mainMap) {
        appState.mainMap.invalidateSize();
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

    setTimeout(() => appState.mainMap.invalidateSize(), 200);
}

function addCheckInMarkers() {
    if (!appState.mainMap || !appState.checkIns) return;

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
        return d.toLocaleDateString('th-TH', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return dateStr;
    }
}
