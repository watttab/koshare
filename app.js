/* ============================================
   Ko Share — Application Logic (v4.0)
   Scalable + Secure
   ============================================ */

// ============ CONFIG ============
const GAS_URL = 'https://script.google.com/macros/s/AKfycbw3E6JPNmLfMs1lxQGt909ncdR6KWYi7hCtMVmdLfYbexVq_8wzW9lRlSyGWhuOto-Gqw/exec';

// ============ STATE ============
const appState = {
    currentPage: 'home',
    photo: null,
    photoDataURL: null,
    photoThumbnail: null,
    latitude: null,
    longitude: null,
    miniMap: null,
    mainMap: null,
    mainMapMarkers: null, // MarkerClusterGroup
    generatedImageBlob: null,
    generatedImageDataURL: null,
    checkIns: [],
    shareCount: parseInt(localStorage.getItem('koShareCount') || '0'),
    // Pagination
    galleryPage: 1,
    galleryTotalPages: 1,
    galleryTotal: 0,
    galleryItemsPerPage: 10,
    gallerySearchQuery: '',
    // Auth
    authToken: localStorage.getItem('koShareToken') || '',
    isLoggedIn: false,
    // Thumbnail cache
    thumbCache: {},
    thumbLoading: {},
    // Observer
    thumbObserver: null,
};

// ============ INIT ============
document.addEventListener('DOMContentLoaded', async () => {
    setupNavigation();
    setupPhotoInput();
    setupGPS();
    setupSearch();
    initThumbObserver();
    registerSW();

    // Check auth token
    if (appState.authToken) {
        await verifyExistingToken();
    }
    updateAuthUI();

    // Load data
    await incrementVisitCount();
    await loadCheckIns(1);

    const hash = location.hash.replace('#', '') || 'home';
    navigateTo(hash, false);
});

function registerSW() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW:', err));
    }
}

// ============ API CALLS ============
async function callGAS(action, data, requiresToken) {
    let url = `${GAS_URL}?action=${encodeURIComponent(action)}`;
    if (requiresToken && appState.authToken) {
        url += `&token=${encodeURIComponent(appState.authToken)}`;
    }
    if (data) url += `&data=${encodeURIComponent(JSON.stringify(data))}`;

    const resp = await fetch(url, { redirect: 'follow' });
    const text = await resp.text();
    const result = JSON.parse(text);

    // Handle auth errors
    if (result.code === 'AUTH_REQUIRED') {
        appState.isLoggedIn = false;
        appState.authToken = '';
        localStorage.removeItem('koShareToken');
        updateAuthUI();
        showLoginModal();
        throw new Error('กรุณาเข้าสู่ระบบก่อน');
    }

    return result;
}

// ============ AUTH ============
async function verifyExistingToken() {
    try {
        const r = await callGAS('verifyToken', null, false);
        const url2 = `${GAS_URL}?action=verifyToken&token=${encodeURIComponent(appState.authToken)}`;
        const resp = await fetch(url2, { redirect: 'follow' });
        const result = JSON.parse(await resp.text());
        appState.isLoggedIn = result.success && result.data && result.data.valid;
        if (!appState.isLoggedIn) {
            appState.authToken = '';
            localStorage.removeItem('koShareToken');
        }
    } catch (e) {
        appState.isLoggedIn = false;
    }
}

function showLoginModal() {
    document.getElementById('loginModal').classList.add('active');
    document.getElementById('pinInput').value = '';
    document.getElementById('pinInput').focus();
    document.getElementById('loginError').textContent = '';
}

function hideLoginModal() {
    document.getElementById('loginModal').classList.remove('active');
    appState._pendingCapture = false;
}

async function submitLogin() {
    const pin = document.getElementById('pinInput').value.trim();
    if (!pin) { document.getElementById('loginError').textContent = 'กรุณาใส่ PIN'; return; }

    const btn = document.getElementById('loginBtn');
    btn.disabled = true;
    btn.textContent = 'กำลังเข้าสู่ระบบ...';
    document.getElementById('loginError').textContent = '';

    try {
        const url = `${GAS_URL}?action=login&pin=${encodeURIComponent(pin)}`;
        const resp = await fetch(url, { redirect: 'follow' });
        const result = JSON.parse(await resp.text());

        if (result.success) {
            appState.authToken = result.data.token;
            appState.isLoggedIn = true;
            localStorage.setItem('koShareToken', result.data.token);
            hideLoginModal();
            updateAuthUI();
            showToast('🔓 เข้าสู่ระบบสำเร็จ!');
            // Navigate to capture if that was the intent
            if (appState._pendingCapture) {
                appState._pendingCapture = false;
                navigateTo('capture');
            }
        } else {
            document.getElementById('loginError').textContent = result.error || 'PIN ไม่ถูกต้อง';
        }
    } catch (e) {
        document.getElementById('loginError').textContent = 'เกิดข้อผิดพลาด กรุณาลองใหม่';
    }

    btn.disabled = false;
    btn.textContent = 'เข้าสู่ระบบ';
}

function logout() {
    appState.authToken = '';
    appState.isLoggedIn = false;
    localStorage.removeItem('koShareToken');
    updateAuthUI();
    showToast('🔒 ออกจากระบบแล้ว');
}

function updateAuthUI() {
    const loginBtn = document.getElementById('headerLoginBtn');
    const logoutBtn = document.getElementById('headerLogoutBtn');
    if (appState.isLoggedIn) {
        loginBtn.style.display = 'none';
        logoutBtn.style.display = 'flex';
    } else {
        loginBtn.style.display = 'flex';
        logoutBtn.style.display = 'none';
    }
}

function requireLogin() {
    if (appState.isLoggedIn) return true;
    showLoginModal();
    return false;
}

// ============ NAVIGATION ============
function navigateTo(page, pushHash = true) {
    // Capture tab requires login - block navigation if not logged in
    if (page === 'capture' && !appState.isLoggedIn) {
        appState._pendingCapture = true;
        showLoginModal();
        return;
    }

    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const targetPage = document.getElementById('page' + capitalize(page));
    if (targetPage) targetPage.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.page === page);
    });
    appState.currentPage = page;
    if (pushHash) location.hash = page;
    if (page === 'map') setTimeout(() => initMainMap(), 200);
    if (page === 'gallery') loadCheckIns(appState.galleryPage);
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
            appState.photoDataURL = compressToDataURL(img, 1600, 0.85);
            appState.photoThumbnail = compressToDataURL(img, 100, 0.15);
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
        const ratio = Math.min(maxSize / w, maxSize / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
    }
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', quality);
}

// ============ SETUP ============
function setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => navigateTo(item.dataset.page));
    });
    window.addEventListener('hashchange', () => {
        const hash = location.hash.replace('#', '') || 'home';
        navigateTo(hash, false);
    });
}

function setupPhotoInput() {
    const cam = document.getElementById('cameraInput');
    const gal = document.getElementById('galleryInput');
    if (cam) cam.addEventListener('change', handlePhotoSelect);
    if (gal) gal.addEventListener('change', handlePhotoSelect);
    // Clicking photo area triggers camera
    const area = document.getElementById('photoArea');
    if (area) area.addEventListener('click', () => { if (cam) cam.click(); });
}

function setupGPS() {
    if ('geolocation' in navigator) {
        navigator.geolocation.watchPosition(pos => {
            appState.latitude = pos.coords.latitude;
            appState.longitude = pos.coords.longitude;
            updateGPSDisplay();
        }, err => {
            document.getElementById('gpsStatus').textContent = '❌ ไม่สามารถรับ GPS';
        }, { enableHighAccuracy: true, maximumAge: 30000, timeout: 15000 });
    }
}

function setupSearch() {
    const input = document.getElementById('gallerySearch');
    if (input) {
        input.addEventListener('input', debounce(() => {
            appState.gallerySearchQuery = input.value.trim();
            appState.galleryPage = 1;
            loadCheckIns(1);
        }, 400));
    }
}

function debounce(fn, ms) {
    let timer;
    return function (...args) { clearTimeout(timer); timer = setTimeout(() => fn.apply(this, args), ms); };
}

function updateGPSDisplay() {
    const el = document.getElementById('gpsStatus');
    if (appState.latitude !== null) {
        el.textContent = `📍 ${appState.latitude.toFixed(6)}, ${appState.longitude.toFixed(6)}`;
    }
}

// ============ THUMBNAIL LAZY LOADER ============
function initThumbObserver() {
    appState.thumbObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const el = entry.target;
                const id = el.dataset.thumbId;
                if (id && !appState.thumbCache[id] && !appState.thumbLoading[id]) {
                    loadThumbnail(id, el);
                }
            }
        });
    }, { rootMargin: '100px' });
}

async function loadThumbnail(id, imgEl) {
    if (appState.thumbCache[id]) {
        applyThumb(imgEl, appState.thumbCache[id]);
        return;
    }
    appState.thumbLoading[id] = true;
    try {
        const url = `${GAS_URL}?action=getThumbnail&id=${encodeURIComponent(id)}`;
        const resp = await fetch(url, { redirect: 'follow' });
        const result = JSON.parse(await resp.text());
        if (result.success && result.data && result.data.thumbnail) {
            appState.thumbCache[id] = result.data.thumbnail;
            applyThumb(imgEl, result.data.thumbnail);
        }
    } catch (e) { }
    appState.thumbLoading[id] = false;
}

function applyThumb(el, src) {
    if (el && src) {
        el.src = src;
        el.classList.add('thumb-loaded');
    }
}

// ============ MINI MAP ============
function initMiniMap() {
    if (appState.latitude === null) return;
    const c = document.getElementById('miniMap');
    if (!c) return;
    if (appState.miniMap) { appState.miniMap.setView([appState.latitude, appState.longitude], 15); return; }
    appState.miniMap = L.map(c, { zoomControl: false, attributionControl: false, dragging: false }).setView([appState.latitude, appState.longitude], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(appState.miniMap);
    L.marker([appState.latitude, appState.longitude]).addTo(appState.miniMap);
}

// ============ IMAGE COMPOSER ============
function updatePreview() {
    document.getElementById('composerLine1').textContent = document.getElementById('textLine1').value || 'สกร.ระดับอำเภอ';
    document.getElementById('composerLine2').textContent = document.getElementById('textLine2').value || 'ชื่อแหล่งเรียนรู้';
}

async function generateImage() {
    if (!appState.photoDataURL) { showToast('⚠️ กรุณาถ่ายภาพก่อน'); return; }
    if (appState.latitude === null) { showToast('⚠️ กำลังรอ GPS...'); return; }

    showLoading('กำลังสร้างภาพ...');

    try {
        // Update composer content
        const line1 = document.getElementById('textLine1').value || 'แนะนำแหล่งเรียนรู้';
        const line2 = document.getElementById('textLine2').value || 'ชื่อสถานที่';
        const line3 = document.getElementById('textLine3').value || 'สกร.ระดับอำเภอโกสุมพิสัย';
        document.getElementById('composerLine1').textContent = line1;
        document.getElementById('composerLine2').textContent = line2;
        document.getElementById('composerLine3').textContent = document.getElementById('textLine2').value || 'ชื่อสถานที่';

        // Set photo as background
        const composerPhoto = document.getElementById('composerPhoto');
        composerPhoto.style.backgroundImage = `url(${appState.photoDataURL})`;

        // Generate QR code
        const qrContainer = document.getElementById('composerQR');
        qrContainer.innerHTML = '';
        const mapsUrl = `https://www.google.com/maps?q=${appState.latitude},${appState.longitude}`;
        new QRCode(qrContainer, { text: mapsUrl, width: 80, height: 80, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });

        // Show composer for rendering
        const wrapper = document.getElementById('composerWrapper');
        wrapper.style.display = 'block';
        wrapper.style.position = 'absolute';
        wrapper.style.left = '-9999px';
        wrapper.style.top = '0';

        // Init mini map
        initMiniMap();
        await new Promise(r => setTimeout(r, 1000));

        const composer = document.getElementById('imageComposer');
        const canvas = await html2canvas(composer, { useCORS: true, scale: 2, backgroundColor: null, logging: false });

        // Hide composer
        wrapper.style.display = 'none';
        wrapper.style.position = '';
        wrapper.style.left = '';
        wrapper.style.top = '';

        appState.generatedImageDataURL = canvas.toDataURL('image/png');
        canvas.toBlob(blob => { appState.generatedImageBlob = blob; });
        document.getElementById('generatedImage').src = appState.generatedImageDataURL;
        document.getElementById('previewArea').style.display = 'block';
        document.getElementById('previewArea').scrollIntoView({ behavior: 'smooth' });
        Swal.fire({ icon: 'success', title: 'สร้างภาพสำเร็จ!', text: 'กดบันทึกลงแผนที่เพื่อบันทึกข้อมูล', timer: 2500, showConfirmButton: false });
    } catch (err) {
        console.error('generateImage error:', err);
        Swal.fire({ icon: 'error', title: 'สร้างภาพไม่สำเร็จ', text: err.message || String(err), confirmButtonText: 'ตกลง' });
    }
}

function downloadImage() {
    if (!appState.generatedImageDataURL) return;
    const a = document.createElement('a');
    a.href = appState.generatedImageDataURL;
    a.download = `koshare_${Date.now()}.png`;
    a.click();
}

async function shareImage() {
    if (!appState.generatedImageBlob) return;
    if (navigator.share) {
        try {
            await navigator.share({ files: [new File([appState.generatedImageBlob], 'koshare.png', { type: 'image/png' })], title: 'Ko Share', text: '📍 แหล่งเรียนรู้' });
            incrementShareCount();
        } catch (e) { }
    } else { showToast('เบราว์เซอร์ไม่รองรับการแชร์'); }
}

function shareToFacebook() {
    const url = `https://www.google.com/maps?q=${appState.latitude},${appState.longitude}`;
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, '_blank');
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
    const el = document.getElementById('statShares');
    if (el) el.textContent = appState.shareCount;
}

// ============ SAVE TO MAP ============
async function saveToMap() {
    if (!appState.isLoggedIn) { showLoginModal(); return; }
    if (appState.latitude === null) { Swal.fire({ icon: 'warning', title: 'ไม่มีพิกัด GPS', text: 'กรุณาเปิด GPS และรอสักครู่', confirmButtonText: 'ตกลง' }); return; }
    const locationName = document.getElementById('textLine2').value.trim();
    if (!locationName) { Swal.fire({ icon: 'warning', title: 'กรุณาพิมพ์ชื่อสถานที่', confirmButtonText: 'ตกลง' }); return; }

    Swal.fire({ title: 'กำลังบันทึก...', text: 'กรุณารอสักครู่', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
        const data = {
            locationName,
            latitude: appState.latitude,
            longitude: appState.longitude,
            description: document.getElementById('textDescription').value.trim(),
            category: document.getElementById('categorySelect').value || 'อื่นๆ',
        };
        if (appState.photoThumbnail) data.thumbnail = appState.photoThumbnail;

        const action = appState.photoThumbnail ? 'saveWithImage' : 'saveCheckIn';
        const result = await callGAS(action, data, true);
        if (!result.success) throw new Error(result.error || 'Save failed');

        Swal.fire({ icon: 'success', title: 'บันทึกสำเร็จ!', text: `${locationName} ถูกบันทึกลงแผนที่แล้ว`, timer: 2500, showConfirmButton: false });
        setTimeout(() => loadCheckIns(1), 1500);
    } catch (err) {
        Swal.fire({ icon: 'error', title: 'บันทึกไม่สำเร็จ', text: err.message, confirmButtonText: 'ตกลง' });
    }
}

// ============ LOAD DATA ============
async function incrementVisitCount() {
    try {
        const r = await callGAS('incrementVisit');
        if (r.success) {
            const el = document.getElementById('statVisits');
            if (el) el.textContent = r.data.visitCount;
        }
    } catch (e) { }
}

async function loadCheckIns(page) {
    const c = document.getElementById('galleryGrid');
    // Show skeleton loading
    if (c) c.innerHTML = Array(4).fill('<div class="gallery-card skeleton-card"><div class="skeleton-img"></div><div class="skeleton-text"><div class="skeleton-line"></div><div class="skeleton-line short"></div></div></div>').join('');
    try {
        let url = `${GAS_URL}?action=getCheckIns&page=${page || 1}&limit=${appState.galleryItemsPerPage}`;
        const resp = await fetch(url, { redirect: 'follow' });
        const result = JSON.parse(await resp.text());
        if (result.success) {
            appState.checkIns = result.data || [];
            appState.galleryPage = result.pagination.page;
            appState.galleryTotalPages = result.pagination.totalPages;
            appState.galleryTotal = result.pagination.total;

            const el = document.getElementById('statLocations');
            if (el) el.textContent = result.pagination.total;

            renderHomeGallery(appState.checkIns);
            renderGalleryGrid();
            if (appState.mainMap) addCheckInMarkers();
        }
    } catch (e) { console.warn('Load error:', e); }
}

// ============ RENDER ============
function getThumb(item) {
    const t = item.thumbnail || item.imageUrl || item.thumbnailUrl || '';
    if (t && (t.startsWith('data:image') || t.startsWith('http'))) return t;
    return '';
}

function renderHomeGallery(list) {
    const c = document.getElementById('homeGallery');
    if (!list || !list.length) { c.innerHTML = '<div class="empty-state"><span>🏞️</span><p>ยังไม่มีข้อมูล — เริ่มถ่ายภาพเลย!</p></div>'; return; }
    c.innerHTML = list.slice(0, 5).map(i => {
        const lat = Number(i.latitude), lng = Number(i.longitude), n = escapeHtml(i.locationName || '');
        return `<div class="gallery-card-inline" onclick="showOnMap(${lat},${lng},'${n.replace(/'/g, "\\'")}')">
            <img class="inline-thumb thumb-lazy" data-thumb-id="${i.id}" src="" style="background:var(--bg-secondary)"
                 onerror="this.outerHTML='<div class=\\'inline-icon\\'>📍</div>'">
            <div class="inline-info"><div class="inline-name">${n}</div><div class="inline-date">${formatDate(i.timestamp)}</div>
            <div class="inline-coords">${lat.toFixed(4)}, ${lng.toFixed(4)}</div></div></div>`;
    }).join('');
    observeNewThumbs();
}

function renderGalleryGrid() {
    const list = appState.checkIns;
    const c = document.getElementById('galleryGrid');
    const countEl = document.getElementById('galleryCount');
    const paginationEl = document.getElementById('galleryPagination');

    countEl.textContent = `ทั้งหมด ${appState.galleryTotal} แห่ง (หน้า ${appState.galleryPage}/${appState.galleryTotalPages || 1})`;

    if (!list || !list.length) {
        c.innerHTML = '<div class="empty-state"><span>🏞️</span><p>ยังไม่มีข้อมูล</p></div>';
        paginationEl.style.display = 'none';
        return;
    }

    c.innerHTML = list.map(i => {
        const lat = Number(i.latitude), lng = Number(i.longitude), n = escapeHtml(i.locationName || '');
        const d = escapeHtml(i.description || '');
        const cat = i.category || 'อื่นๆ';
        const catEmoji = getCategoryEmoji(cat);
        const mapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;
        const deleteBtn = appState.isLoggedIn ? `<button class="btn-delete-card" onclick="event.stopPropagation();confirmDelete('${i.id}','${n.replace(/'/g, "\\'")}')" title="ลบ">×</button>` : '';
        return `<div class="gallery-card">
            ${deleteBtn}
            <div class="gallery-card-image" onclick="showOnMap(${lat},${lng},'${n.replace(/'/g, "\\'")}')" style="display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:pointer">
                <img class="thumb-lazy" data-thumb-id="${i.id}" src=""
                     style="width:100%;height:100%;object-fit:cover;background:var(--bg-secondary)"
                     onerror="this.outerHTML='<div style=display:flex;align-items:center;justify-content:center;font-size:32px;width:100%;height:100%>${catEmoji}</div>'">
            </div>
            <div class="gallery-card-info">
                <div class="gallery-card-name">${n}</div>
                <div class="gallery-card-date">${formatDate(i.timestamp)}</div>
                <div style="display:flex;align-items:center;gap:4px;margin-top:2px">
                    <span class="category-badge">${catEmoji} ${escapeHtml(cat)}</span>
                </div>
                ${d ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${d}</div>` : ''}
                <a href="${mapsUrl}" target="_blank" style="font-size:11px;color:var(--accent-primary);text-decoration:none;display:block;margin-top:2px;" onclick="event.stopPropagation()">🗺️ นำทาง</a>
            </div></div>`;
    }).join('');

    // Pagination
    if (appState.galleryTotalPages > 1) {
        paginationEl.style.display = 'flex';
        document.getElementById('pageInfo').textContent = `${appState.galleryPage} / ${appState.galleryTotalPages}`;
        document.getElementById('btnPrevPage').disabled = (appState.galleryPage <= 1);
        document.getElementById('btnNextPage').disabled = (appState.galleryPage >= appState.galleryTotalPages);
    } else {
        paginationEl.style.display = 'none';
    }

    observeNewThumbs();
}

function observeNewThumbs() {
    document.querySelectorAll('.thumb-lazy:not(.thumb-observed)').forEach(el => {
        el.classList.add('thumb-observed');
        const id = el.dataset.thumbId;
        if (appState.thumbCache[id]) {
            applyThumb(el, appState.thumbCache[id]);
        } else if (appState.thumbObserver) {
            appState.thumbObserver.observe(el);
        }
    });
}

function filterGallery() {
    appState.galleryPage = 1;
    loadCheckIns(1);
}

function clearSearch() {
    document.getElementById('gallerySearch').value = '';
    document.getElementById('searchClear').style.display = 'none';
    appState.gallerySearchQuery = '';
    appState.galleryPage = 1;
    loadCheckIns(1);
}

function changePage(delta) {
    const newPage = appState.galleryPage + delta;
    if (newPage < 1 || newPage > appState.galleryTotalPages) return;
    appState.galleryPage = newPage;
    loadCheckIns(newPage);
    document.getElementById('galleryGrid').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    if (appState.mainMap) { appState.mainMap.invalidateSize(); loadAllForMap(); return; }
    appState.mainMap = L.map(c).setView([16.2478, 103.0650], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(appState.mainMap);

    // Marker cluster group
    if (typeof L.markerClusterGroup === 'function') {
        appState.mainMapMarkers = L.markerClusterGroup();
        appState.mainMap.addLayer(appState.mainMapMarkers);
    }

    loadAllForMap();
    setTimeout(() => appState.mainMap.invalidateSize(), 300);
}

async function loadAllForMap() {
    // Clear existing markers first
    if (appState.mainMapMarkers) {
        appState.mainMapMarkers.clearLayers();
    }
    appState._mapMarkerIds = new Set(); // Track added IDs to prevent duplicates

    // Load all check-ins for the map
    try {
        const url = `${GAS_URL}?action=getCheckIns&page=1&limit=100`;
        const resp = await fetch(url, { redirect: 'follow' });
        const result = JSON.parse(await resp.text());
        if (result.success) {
            addCheckInMarkersFromData(result.data || []);

            // Load remaining pages if needed
            if (result.pagination.totalPages > 1) {
                for (let p = 2; p <= Math.min(result.pagination.totalPages, 30); p++) {
                    const url2 = `${GAS_URL}?action=getCheckIns&page=${p}&limit=100`;
                    const resp2 = await fetch(url2, { redirect: 'follow' });
                    const r2 = JSON.parse(await resp2.text());
                    if (r2.success) addCheckInMarkersFromData(r2.data || []);
                }
            }
        }
    } catch (e) { console.warn('Map load error:', e); }
}

function addCheckInMarkers() {
    addCheckInMarkersFromData(appState.checkIns);
}

function addCheckInMarkersFromData(data) {
    if (!appState.mainMap) return;
    if (!appState._mapMarkerIds) appState._mapMarkerIds = new Set();

    const cluster = appState.mainMapMarkers;
    const useCluster = cluster && typeof cluster.addLayer === 'function';

    const bounds = [];
    data.forEach(i => {
        const lat = Number(i.latitude), lng = Number(i.longitude);
        if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) return;
        // Skip duplicates
        const markerId = i.id || `${lat},${lng}`;
        if (appState._mapMarkerIds.has(markerId)) return;
        appState._mapMarkerIds.add(markerId);
        const url = `https://www.google.com/maps?q=${lat},${lng}`;
        const m = L.marker([lat, lng]);
        m.bindPopup(`<div class="popup-title">📍 ${escapeHtml(i.locationName)}</div>
            <div class="popup-date">${formatDate(i.timestamp)}</div>
            ${i.description ? `<div style="font-size:12px;margin-bottom:4px;">${escapeHtml(i.description)}</div>` : ''}
            <a class="popup-link" href="${url}" target="_blank">🗺️ เปิดใน Google Maps</a>`);

        if (useCluster) {
            cluster.addLayer(m);
        } else {
            m.addTo(appState.mainMap);
        }
        bounds.push([lat, lng]);
    });

    if (bounds.length > 0) {
        try { appState.mainMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 }); } catch (e) { }
    }
}

// ============ UTILS ============
function formatDate(ts) {
    if (!ts) return '';
    try {
        const d = new Date(ts);
        return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }) + ' ' +
            d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ts; }
}

function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

function showToast(msg) {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
}

function showLoading(msg) {
    let o = document.getElementById('loadingOverlay');
    if (!o) {
        o = document.createElement('div'); o.id = 'loadingOverlay'; o.className = 'loading-overlay';
        o.innerHTML = '<div class="loading-content"><div class="spinner"></div><div id="loadingText"></div></div>';
        document.body.appendChild(o);
    }
    document.getElementById('loadingText').textContent = msg || 'กำลังโหลด...';
    o.classList.add('show');
}

function hideLoading() {
    const o = document.getElementById('loadingOverlay');
    if (o) o.classList.remove('show');
}

// ============ CATEGORY HELPERS ============
function getCategoryEmoji(cat) {
    const map = {
        'สถานที่': '📍', 'บุคคล': '👤', 'สื่อและนวัตกรรม': '💡',
        'อื่นๆ': '📍'
    };
    return map[cat] || '📍';
}

// ============ DELETE ============
async function confirmDelete(id, name) {
    if (!appState.isLoggedIn) { showLoginModal(); return; }
    const result = await Swal.fire({
        title: 'ลบสถานที่นี้?',
        text: name,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        confirmButtonText: 'ลบ',
        cancelButtonText: 'ยกเลิก'
    });
    if (!result.isConfirmed) return;

    Swal.fire({ title: 'กำลังลบ...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
        const url = `${GAS_URL}?action=deleteCheckIn&id=${encodeURIComponent(id)}&token=${encodeURIComponent(appState.authToken)}`;
        const resp = await fetch(url, { redirect: 'follow' });
        const res = JSON.parse(await resp.text());
        if (!res.success) throw new Error(res.error);
        Swal.fire({ icon: 'success', title: 'ลบสำเร็จ!', timer: 1500, showConfirmButton: false });
        loadCheckIns(appState.galleryPage);
    } catch (err) {
        Swal.fire({ icon: 'error', title: 'ลบไม่สำเร็จ', text: err.message, confirmButtonText: 'ตกลง' });
    }
}

// ============ CHANGE PIN ============
async function changePinUI() {
    if (!appState.isLoggedIn) { showLoginModal(); return; }
    const { value: newPin } = await Swal.fire({
        title: 'เปลี่ยน PIN',
        input: 'text',
        inputLabel: 'PIN ใหม่ (4-6 หลัก)',
        inputAttributes: { maxlength: 6, inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off' },
        inputValidator: (v) => { if (!v || v.length < 4) return 'PIN ต้องมี 4-6 หลัก'; },
        showCancelButton: true,
        confirmButtonText: 'เปลี่ยน',
        cancelButtonText: 'ยกเลิก'
    });
    if (!newPin) return;

    Swal.fire({ title: 'กำลังเปลี่ยน PIN...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
        const url = `${GAS_URL}?action=changePin&newPin=${encodeURIComponent(newPin)}&token=${encodeURIComponent(appState.authToken)}`;
        const resp = await fetch(url, { redirect: 'follow' });
        const res = JSON.parse(await resp.text());
        if (!res.success) throw new Error(res.error);
        Swal.fire({ icon: 'success', title: 'เปลี่ยน PIN สำเร็จ!', text: 'PIN ใหม่: ' + newPin, timer: 2500, showConfirmButton: false });
    } catch (err) {
        Swal.fire({ icon: 'error', title: 'เปลี่ยนไม่สำเร็จ', text: err.message, confirmButtonText: 'ตกลง' });
    }
}

// ============ EXPORT PDF ============
async function exportPDF() {
    if (!appState.isLoggedIn) { showLoginModal(); return; }

    Swal.fire({ title: 'กำลังโหลดข้อมูล...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
        let all = [];
        let page = 1, totalPages = 1;
        while (page <= totalPages && page <= 10) {
            const url = `${GAS_URL}?action=getCheckIns&page=${page}&limit=100`;
            const resp = await fetch(url, { redirect: 'follow' });
            const result = JSON.parse(await resp.text());
            if (result.success) {
                all = all.concat(result.data || []);
                totalPages = result.pagination.totalPages;
            }
            page++;
        }

        if (!all.length) {
            Swal.fire({ icon: 'info', title: 'ไม่มีข้อมูล', confirmButtonText: 'ตกลง' });
            return;
        }

        const today = new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
        const rows = all.map((item, idx) => {
            const cat = item.category || 'อื่นๆ';
            const catEmoji = getCategoryEmoji(cat);
            return `<tr>
                <td style="text-align:center">${idx + 1}</td>
                <td>${item.locationName || ''}</td>
                <td style="text-align:center">${catEmoji} ${cat}</td>
                <td>${item.description || '-'}</td>
                <td style="font-size:10px">${Number(item.latitude).toFixed(4)}, ${Number(item.longitude).toFixed(4)}</td>
                <td style="text-align:center"><a href="https://www.google.com/maps?q=${item.latitude},${item.longitude}" target="_blank">🗺️</a></td>
                <td style="text-align:center;font-size:11px">${item.timestamp ? new Date(item.timestamp).toLocaleDateString('th-TH') : '-'}</td>
            </tr>`;
        }).join('');

        const html = `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8">
<title>รายงานแหล่งเรียนรู้ — Ko Share</title>
<style>
    @import url('https://fonts.googleapis.com/css2?family=Prompt:wght@300;400;600;700&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Prompt', sans-serif; padding: 24px; color: #1a1a1a; }
    .header { text-align: center; margin-bottom: 24px; border-bottom: 3px solid #1e3a5f; padding-bottom: 16px; }
    .header h1 { font-size: 20px; color: #1e3a5f; margin-bottom: 4px; }
    .header h2 { font-size: 16px; font-weight: 400; color: #555; margin-bottom: 4px; }
    .header .date { font-size: 12px; color: #888; }
    .summary { display: flex; justify-content: center; gap: 32px; margin-bottom: 20px; }
    .summary-item { text-align: center; }
    .summary-item .num { font-size: 28px; font-weight: 700; color: #1e3a5f; }
    .summary-item .label { font-size: 11px; color: #666; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { background: #1e3a5f; color: white; padding: 8px 6px; font-weight: 600; font-size: 12px; }
    td { padding: 6px; border-bottom: 1px solid #e0e0e0; vertical-align: top; }
    tr:nth-child(even) { background: #f8f9fa; }
    tr:hover { background: #e8f0fe; }
    a { color: #1e3a5f; text-decoration: none; }
    .footer { text-align: center; margin-top: 24px; font-size: 11px; color: #999; border-top: 1px solid #ddd; padding-top: 12px; }
    @media print { body { padding: 12px; } .no-print { display: none; } }
</style></head><body>
<div class="header">
    <h1>📍 รายงานแหล่งเรียนรู้</h1>
    <h2>สกร.ระดับอำเภอโกสุมพิสัย</h2>
    <div class="date">ข้อมูล ณ วันที่ ${today} — รวม ${all.length} แห่ง</div>
</div>
<div class="summary">
    <div class="summary-item"><div class="num">${all.filter(i => (i.category || '') === 'สถานที่').length}</div><div class="label">📍 สถานที่</div></div>
    <div class="summary-item"><div class="num">${all.filter(i => (i.category || '') === 'บุคคล').length}</div><div class="label">👤 บุคคล</div></div>
    <div class="summary-item"><div class="num">${all.filter(i => (i.category || '') === 'สื่อและนวัตกรรม').length}</div><div class="label">💡 สื่อฯ</div></div>
</div>
<table>
    <thead><tr><th>ที่</th><th>ชื่อแหล่งเรียนรู้</th><th>ประเภท</th><th>รายละเอียด</th><th>พิกัด</th><th>แผนที่</th><th>วันที่</th></tr></thead>
    <tbody>${rows}</tbody>
</table>
<div class="footer">สร้างโดย Ko Share — https://watttab.github.io/koshare/</div>
<div class="no-print" style="text-align:center;margin-top:20px">
    <button onclick="window.print()" style="padding:12px 32px;font-size:16px;font-family:Prompt;background:#1e3a5f;color:white;border:none;border-radius:8px;cursor:pointer">🖨️ พิมพ์ / บันทึก PDF</button>
</div>
</body></html>`;

        const win = window.open('', '_blank');
        win.document.write(html);
        win.document.close();
        Swal.close();
    } catch (err) {
        Swal.fire({ icon: 'error', title: 'Export ไม่สำเร็จ', text: err.message, confirmButtonText: 'ตกลง' });
    }
}
