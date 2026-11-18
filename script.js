(() => {
  'use strict';

  const MENU_API_URL =
    'https://script.google.com/macros/s/AKfycbzkQQFgI5iLwlE7YNclKNxIcmuNu5Ve-z13IHT6nUZ4ksPR-Li7gohQTboAHXwyYy41/exec';

  const SKELETON_COUNT = 3;

  const FALLBACK_IMAGE_SVG = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" role="img" aria-label="Hình ảnh thực đơn">' +
      '<rect width="400" height="300" fill="#EADBC8"/>' +
      '<rect x="16" y="16" width="368" height="268" rx="12" fill="#DFCCB5" fill-opacity="0.55"/>' +
      '<g fill="none" stroke="#8D4F2A" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M150 132h84v44a34 34 0 0 1-34 34h-16a34 34 0 0 1-34-34v-44Z" fill="#F5EFE6"/>' +
        '<path d="M234 144h16a16 16 0 0 1 0 32h-16"/>' +
        '<path d="M138 220h108"/>' +
        '<path d="M174 114c0-10 8-12 8-22" stroke-opacity="0.7"/>' +
        '<path d="M196 114c0-10 8-12 8-22" stroke-opacity="0.7"/>' +
        '<path d="M218 114c0-10 8-12 8-22" stroke-opacity="0.7"/>' +
      '</g>' +
    '</svg>'
  )}`;

  const viNumberFormatter = new Intl.NumberFormat('vi-VN');

  let isLoading = false;

  /**
   * Format price values for Vietnamese currency display.
   * Preserves already-formatted strings containing a currency symbol.
   */
  function formatPrice(value) {
    if (value === null || value === undefined) {
      return 'Liên hệ';
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return `${viNumberFormatter.format(value)}₫`;
    }

    const trimmed = String(value).trim();
    if (!trimmed) {
      return 'Liên hệ';
    }

    // Preserve strings that already contain a currency unit/symbol
    if (/[₫đĐ$€£¥]|vnd|vnđ/i.test(trimmed)) {
      return trimmed;
    }

    // Plain numeric string (e.g. "45000" or "45000.0")
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) {
        return `${viNumberFormatter.format(numeric)}₫`;
      }
    }

    // Thousands-grouped integer string without currency symbol (e.g. "45.000" or "45,000")
    if (/^\d{1,3}([.,]\d{3})+$/.test(trimmed)) {
      const numeric = Number(trimmed.replace(/[.,]/g, ''));
      if (Number.isFinite(numeric)) {
        return `${viNumberFormatter.format(numeric)}₫`;
      }
    }

    return trimmed;
  }

  /**
   * Map trangThai value to the corresponding badge modifier class.
   */
  function getBadgeClass(status) {
    const normalized = status.normalize('NFC').trim().toLowerCase();

    if (
      normalized.includes('bán chạy') ||
      normalized.includes('ban chay') ||
      normalized.includes('hot')
    ) {
      return 'product-badge--hot';
    }

    if (
      normalized.includes('món mới') ||
      normalized.includes('mon moi') ||
      normalized.includes('new')
    ) {
      return 'product-badge--new';
    }

    return 'product-badge--default';
  }

  /**
   * Convert common Google Drive sharing links into direct image URLs and validate URL safety.
   */
  function resolveImageUrl(rawUrl) {
    if (typeof rawUrl !== 'string') {
      return FALLBACK_IMAGE_SVG;
    }

    const trimmed = rawUrl.trim();
    if (!trimmed) {
      return FALLBACK_IMAGE_SVG;
    }

    // Reject unsafe protocols such as javascript: or data: from external sheet input
    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
      return FALLBACK_IMAGE_SVG;
    }

    // Convert Google Drive links (/file/d/<id>/view, /open?id=<id>, /uc?id=<id>)
    const driveFileMatch = trimmed.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i);
    if (driveFileMatch) {
      return `https://drive.google.com/thumbnail?id=${driveFileMatch[1]}&sz=w800`;
    }

    const driveQueryMatch = trimmed.match(
      /drive\.google\.com\/(?:open|uc)\?[^#]*\bid=([a-zA-Z0-9_-]+)/i
    );
    if (driveQueryMatch) {
      return `https://drive.google.com/thumbnail?id=${driveQueryMatch[1]}&sz=w800`;
    }

    return trimmed;
  }

  /**
   * Convert a 2D array ([headers, ...rows]) into an array of row objects.
   */
  function rowsToObjects(matrix) {
    if (!Array.isArray(matrix) || matrix.length < 2 || !Array.isArray(matrix[0])) {
      return [];
    }

    const headers = matrix[0].map((header) => String(header ?? '').trim());
    return matrix.slice(1).map((row) => {
      const obj = {};
      if (Array.isArray(row)) {
        headers.forEach((key, index) => {
          if (key) {
            obj[key] = row[index];
          }
        });
      }
      return obj;
    });
  }

  /**
   * Extract raw array of items from either a top-level array or common wrapper objects.
   */
  function extractRecords(payload) {
    let rawList = null;

    if (Array.isArray(payload)) {
      rawList = payload;
    } else if (payload && typeof payload === 'object') {
      const candidateKeys = ['data', 'records', 'items', 'products', 'rows', 'result', 'values'];
      for (const key of candidateKeys) {
        if (Array.isArray(payload[key])) {
          rawList = payload[key];
          break;
        }
      }
    }

    if (!Array.isArray(rawList)) {
      return null;
    }

    if (rawList.length > 0 && Array.isArray(rawList[0])) {
      return rowsToObjects(rawList);
    }

    return rawList;
  }

  /**
   * Read a field from a row object, preferring the exact column name with case-insensitive fallback.
   */
  function readField(row, exactKey) {
    if (Object.prototype.hasOwnProperty.call(row, exactKey)) {
      return row[exactKey];
    }

    const target = exactKey.toLowerCase();
    for (const key of Object.keys(row)) {
      if (key.trim().toLowerCase() === target) {
        return row[key];
      }
    }

    return undefined;
  }

  /**
   * Normalize and filter product rows from Google Sheets.
   */
  function normalizeProducts(records) {
    const products = [];

    records.forEach((row, index) => {
      if (!row || typeof row !== 'object') {
        return;
      }

      const rawId = readField(row, 'id');
      const rawName = readField(row, 'tenMon');
      const rawPrice = readField(row, 'giaBan');
      const rawImage = readField(row, 'linkAnh');
      const rawStatus = readField(row, 'trangThai');

      const tenMon = rawName !== undefined && rawName !== null ? String(rawName).trim() : '';
      const hasPrice =
        rawPrice !== undefined && rawPrice !== null && String(rawPrice).trim() !== '';

      // Skip blank rows from the spreadsheet
      if (!tenMon && !hasPrice) {
        return;
      }

      const id =
        rawId !== undefined && rawId !== null && String(rawId).trim() !== ''
          ? String(rawId).trim()
          : String(index + 1);

      const trangThai =
        rawStatus !== undefined && rawStatus !== null ? String(rawStatus).trim() : '';

      products.push({
        id,
        tenMon: tenMon || 'Món chưa đặt tên',
        giaBan: rawPrice,
        linkAnh: rawImage !== undefined && rawImage !== null ? String(rawImage).trim() : '',
        trangThai,
      });
    });

    return products;
  }

  /**
   * Build loading skeleton cards matching the initial markup contract.
   */
  function renderSkeletons(menuGrid) {
    const fragment = document.createDocumentFragment();

    for (let i = 0; i < SKELETON_COUNT; i += 1) {
      const card = document.createElement('article');
      card.className = 'bento-card product-card product-card--skeleton';
      card.setAttribute('aria-hidden', 'true');

      const imageWrap = document.createElement('div');
      imageWrap.className = 'product-image-wrap skeleton-img';

      const body = document.createElement('div');
      body.className = 'product-body';

      const line1 = document.createElement('div');
      line1.className = 'skeleton-line';

      const line2 = document.createElement('div');
      line2.className = 'skeleton-line skeleton-line--short';

      body.appendChild(line1);
      body.appendChild(line2);
      card.appendChild(imageWrap);
      card.appendChild(body);
      fragment.appendChild(card);
    }

    menuGrid.replaceChildren(fragment);
  }

  /**
   * Build a single product card DOM node using safe DOM APIs.
   */
  function createProductCard(product) {
    const article = document.createElement('article');
    article.className = 'bento-card product-card';
    article.dataset.productId = product.id;

    const imageWrap = document.createElement('div');
    imageWrap.className = 'product-image-wrap';

    const img = document.createElement('img');
    img.className = 'product-image';
    img.alt = product.tenMon;
    img.loading = 'lazy';
    img.decoding = 'async';

    const resolvedSrc = resolveImageUrl(product.linkAnh);
    img.src = resolvedSrc;

    if (resolvedSrc !== FALLBACK_IMAGE_SVG) {
      img.addEventListener('error', () => {
        if (img.dataset.fallbackApplied === 'true') {
          return;
        }
        img.dataset.fallbackApplied = 'true';
        img.src = FALLBACK_IMAGE_SVG;
      });
    }

    imageWrap.appendChild(img);

    if (product.trangThai) {
      const badge = document.createElement('span');
      badge.className = `product-badge ${getBadgeClass(product.trangThai)}`;
      badge.textContent = product.trangThai;
      imageWrap.appendChild(badge);
    }

    const body = document.createElement('div');
    body.className = 'product-body';

    const nameHeading = document.createElement('h3');
    nameHeading.className = 'product-name';
    nameHeading.textContent = product.tenMon;

    const footer = document.createElement('div');
    footer.className = 'product-footer';

    const price = document.createElement('span');
    price.className = 'product-price font-mono';
    price.textContent = formatPrice(product.giaBan);

    footer.appendChild(price);
    body.appendChild(nameHeading);
    body.appendChild(footer);

    article.appendChild(imageWrap);
    article.appendChild(body);

    return article;
  }

  /**
   * Render an empty or error state card inside #menu-grid.
   */
  function renderMenuState(menuGrid, message, onRetry) {
    const stateBox = document.createElement('div');
    stateBox.className = 'menu-state';
    stateBox.setAttribute('role', 'status');

    const text = document.createElement('p');
    text.className = 'menu-state-text';
    text.textContent = message;
    stateBox.appendChild(text);

    if (typeof onRetry === 'function') {
      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'menu-retry-btn';
      retryBtn.textContent = 'Thử tải lại';
      retryBtn.addEventListener('click', onRetry);
      stateBox.appendChild(retryBtn);
    }

    menuGrid.replaceChildren(stateBox);
  }

  /**
   * Fetch products from Google Sheets Apps Script endpoint and update the DOM.
   */
  async function loadMenu(menuGrid, menuStatus, { showSkeletons = false } = {}) {
    if (isLoading) {
      return;
    }

    isLoading = true;
    menuGrid.setAttribute('aria-busy', 'true');
    if (menuStatus) {
      menuStatus.textContent = 'Đang tải thực đơn...';
    }
    if (showSkeletons) {
      renderSkeletons(menuGrid);
    }

    const retryHandler = () => {
      loadMenu(menuGrid, menuStatus, { showSkeletons: true });
    };

    try {
      const response = await fetch(MENU_API_URL, {
        method: 'GET',
        redirect: 'follow',
      });

      if (!response.ok) {
        throw new Error(`HTTP_${response.status}`);
      }

      const rawText = await response.text();
      let payload;
      try {
        payload = JSON.parse(rawText);
      } catch {
        throw new Error('INVALID_JSON');
      }

      const records = extractRecords(payload);
      if (records === null) {
        throw new Error('UNEXPECTED_SCHEMA');
      }

      const products = normalizeProducts(records);
      menuGrid.setAttribute('aria-busy', 'false');

      if (products.length === 0) {
        if (menuStatus) {
          menuStatus.textContent = '0 món';
        }
        renderMenuState(
          menuGrid,
          'Thực đơn hiện chưa có món nào. Vui lòng quay lại sau.',
          retryHandler
        );
        return;
      }

      const fragment = document.createDocumentFragment();
      products.forEach((product) => {
        fragment.appendChild(createProductCard(product));
      });

      menuGrid.replaceChildren(fragment);

      if (menuStatus) {
        menuStatus.textContent = `${products.length} món`;
      }
    } catch (error) {
      menuGrid.setAttribute('aria-busy', 'false');

      if (menuStatus) {
        menuStatus.textContent = 'Không thể tải thực đơn';
      }

      const errorMessage =
        error && error.message === 'INVALID_JSON'
          ? 'Không thể đọc dữ liệu thực đơn từ Google Sheets (kiểm tra quyền truy cập công khai của Web App).'
          : 'Không thể kết nối tới bảng thực đơn. Vui lòng kiểm tra mạng và thử lại.';

      renderMenuState(menuGrid, errorMessage, retryHandler);
    } finally {
      isLoading = false;
    }
  }

  function initMenu() {
    const menuGrid = document.getElementById('menu-grid');
    const menuStatus = document.getElementById('menu-status');

    if (!menuGrid) {
      return;
    }

    loadMenu(menuGrid, menuStatus, { showSkeletons: false });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMenu);
  } else {
    initMenu();
  }
})();
