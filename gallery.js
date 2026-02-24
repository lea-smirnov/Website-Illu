/**
 * gallery.js — Fetches project data from a published Google Sheet
 * and renders the masonry gallery + lightbox on both index and work pages.
 *
 * Uses the Google Visualization JSONP endpoint to avoid CORS issues
 * (works even when opened from file:// origins).
 *
 * Usage:
 *   <script src="gallery.js"></script>
 *   <script>
 *     Gallery.init({
 *       sheetId: '1JHOWnRZhLHeArlwK8rtSmrmzdYsnnuulh8tUaYkqXZ0',
 *       gridSelector: '#gallery-grid',
 *       startpageOnly: false,       // true on index.html
 *       imageBasePath: 'assets/projects/',
 *       hasLightbox: true           // false on index.html
 *     });
 *   </script>
 */

const Gallery = (() => {
  /* ── Fetch sheet data via Google Visualization JSONP (bypasses CORS) ── */
  function fetchSheet(sheetId) {
    return new Promise((resolve, reject) => {
      const cbName = '_galleryCallback_' + Math.random().toString(36).slice(2);
      const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=responseHandler:${cbName}`;

      window[cbName] = (response) => {
        // Clean up
        delete window[cbName];
        document.head.removeChild(script);

        if (response.status === 'error') {
          reject(new Error(response.errors?.map(e => e.message).join(', ') || 'Sheet error'));
          return;
        }
        resolve(response.table);
      };

      const script = document.createElement('script');
      script.src = url;
      script.onerror = () => {
        delete window[cbName];
        document.head.removeChild(script);
        reject(new Error('Failed to load Google Sheet'));
      };
      document.head.appendChild(script);
    });
  }

  /* ── Convert gviz table to array of plain objects keyed by column labels ── */
  function gvizToRecords(table) {
    const headers = table.cols.map(c => (c.label || '').trim());
    return table.rows
      .filter(row => row.c && row.c.some(cell => cell && cell.v != null && cell.v !== ''))
      .map(row => {
        const obj = {};
        headers.forEach((h, i) => {
          const cell = row.c && row.c[i];
          // Prefer formatted value (f) for dates/numbers, fall back to raw (v)
          const val = cell ? (cell.f != null ? cell.f : (cell.v != null ? String(cell.v) : '')) : '';
          obj[h] = typeof val === 'string' ? val.trim() : String(val).trim();
        });
        return obj;
      });
  }

  /* ── Build a URL-safe slug from a project name ── */
  function slugify(str) {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }

  /* ── Build structured project array from sheet rows ── */
  function buildProjects(records, basePath) {
    return records.map(r => {
      const detailImages = [];
      for (let i = 1; i <= 30; i++) {
        const val = r[`image_${i}`];
        if (val) detailImages.push(basePath + val);
      }
      const coverSrc = r.cover_image ? basePath + r.cover_image : '';
      const allImages = [coverSrc, ...detailImages].filter(Boolean);

      return {
        name: r.name || '',
        slug: slugify(r.name || ''),
        subtitle: r.subtitle || '',
        description: r.description || '',
        tileColor: r.tile_color || '#ddd',
        coverImage: coverSrc,
        images: allImages.length ? allImages : [coverSrc],
        showOnStartpage: (r.show_on_startpage || '').toUpperCase() === 'TRUE'
      };
    });
  }

  /* ── Render gallery tiles into the grid ── */
  function renderTiles(projects, gridEl, { startpageOnly, hasLightbox }) {
    const filtered = startpageOnly ? projects.filter(p => p.showOnStartpage) : projects;
    gridEl.innerHTML = '';

    filtered.forEach((proj, i) => {
      const item = document.createElement('div');
      item.className = 'gallery-item col-sm-6 col-lg-4 mb-4 col-xs-12';

      const figure = document.createElement('figure');
      figure.className = 'tile';
      figure.style.setProperty('--tile-color', proj.tileColor);

      if (hasLightbox) {
        figure.dataset.images = proj.images.join('|');
        figure.dataset.subtitle = proj.subtitle;
        figure.dataset.desc = proj.description;
      }

      const img = document.createElement('img');
      img.src = proj.coverImage;
      img.alt = proj.name;
      img.className = 'img-fluid';
      img.loading = 'lazy';

      const caption = document.createElement('figcaption');
      caption.className = 'tile-title';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'tile-title-text';
      titleSpan.textContent = proj.name;
      caption.appendChild(titleSpan);

      if (proj.subtitle) {
        const dateSpan = document.createElement('span');
        dateSpan.className = 'tile-date';
        dateSpan.textContent = proj.subtitle;
        caption.appendChild(dateSpan);
      }

      figure.appendChild(img);
      figure.appendChild(caption);

      // On index page, wrap tile in a link to work.html lightbox
      if (startpageOnly) {
        const link = document.createElement('a');
        link.href = 'work.html?title=' + encodeURIComponent(proj.name) + '#' + proj.slug;
        link.style.textDecoration = 'none';
        link.style.color = 'inherit';
        link.appendChild(figure);
        item.appendChild(link);
      } else {
        item.appendChild(figure);
      }

      gridEl.appendChild(item);
    });

    return filtered;
  }

  /* ── Masonry layout init ── */
  function initMasonry(gridEl) {
    if (typeof imagesLoaded === 'undefined' || typeof Masonry === 'undefined') return;
    imagesLoaded(gridEl, () => {
      new Masonry(gridEl, {
        itemSelector: '.gallery-item',
        percentPosition: true,
        horizontalOrder: true
      });
    });
  }

  /* ── Scroll reveal animation ── */
  function initScrollAnimations() {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.style.opacity = '1';
            entry.target.style.transform = 'translateY(0)';
          }
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -50px 0px' }
    );
    document.querySelectorAll('.gallery-item').forEach(item => {
      item.style.opacity = '0';
      item.style.transform = 'translateY(30px)';
      item.style.transition = 'all 0.6s ease';
      observer.observe(item);
    });
  }

  /* ── Lightbox (only on work.html) ── */
  function initLightbox(projects, deepLinkHash) {
    const tiles = Array.from(document.querySelectorAll('#gallery-grid .tile'));

    const items = projects.map(p => ({
      title: p.name,
      slug: p.slug,
      subtitle: p.subtitle,
      desc: p.description,
      images: p.images
    }));

    const lb = document.getElementById('galleryLightbox');
    if (!lb) return;

    const lbBack = lb.querySelector('.lb-back');
    const lbMain = document.getElementById('lbMainImage');
    const lbTitle = document.getElementById('lbTitle');
    const lbSubtitle = document.getElementById('lbSubtitle');
    const lbDesc = document.getElementById('lbDesc');
    const lbThumbs = document.getElementById('lbThumbs');
    const prevWrap = document.getElementById('lbPrev');
    const nextWrap = document.getElementById('lbNext');
    const prevName = document.getElementById('lbPrevName');
    const nextName = document.getElementById('lbNextName');
    const imgPrevBtn = document.getElementById('lbImgPrev');
    const imgNextBtn = document.getElementById('lbImgNext');
    const lbMainArea = document.getElementById('lbMainArea');
    const fullscreenOverlay = document.getElementById('lbFullscreenOverlay');
    const fullscreenImg = document.getElementById('lbFullscreenImg');
    const fullscreenClose = fullscreenOverlay.querySelector('.lb-fullscreen-close');
    const fsPrevBtn = document.getElementById('lbFsPrev');
    const fsNextBtn = document.getElementById('lbFsNext');

    let currentItem = 0;
    let currentImage = 0;

    function openLightbox(index) {
      currentItem = index;
      currentImage = 0;
      render();
      lb.classList.add('preopen');
      lb.setAttribute('aria-hidden', 'false');
      requestAnimationFrame(() => {
        lb.classList.add('open');
        lb.classList.remove('preopen');
      });
      lb.scrollTop = 0;
      const scrollbarW = window.innerWidth - document.documentElement.clientWidth;
      document.body.style.overflow = 'hidden';
      document.body.style.paddingRight = scrollbarW + 'px';
      const nav = document.getElementById('mainNavbar');
      if (nav) nav.style.paddingRight = scrollbarW + 'px';
    }

    let closeLightbox = function() {
      closeFullscreen();
      lb.classList.remove('open');
      lb.setAttribute('aria-hidden', 'true');
      // Delay removing scroll-lock until the lightbox fade-out finishes (350ms)
      setTimeout(() => {
        document.body.style.overflow = '';
        document.body.style.paddingRight = '';
        const nav = document.getElementById('mainNavbar');
        if (nav) nav.style.paddingRight = '';
      }, 350);
    };

    function setMainImage(src) { lbMain.src = src; }

    function render() {
      const item = items[currentItem];
      lbTitle.textContent = item.title;
      lbSubtitle.textContent = item.subtitle || '';
      lbSubtitle.style.display = item.subtitle ? 'block' : 'none';
      lbDesc.textContent = item.desc;
      setMainImage(item.images[currentImage]);

      // Show/hide image nav arrows depending on image count
      const lbImgNav = document.getElementById('lbImgNav');
      if (lbImgNav) {
        lbImgNav.style.display = item.images.length > 1 ? 'flex' : 'none';
      }

      lbThumbs.innerHTML = '';
      item.images.forEach((src, idx) => {
        const btn = document.createElement('button');
        btn.className = 'lb-thumb' + (idx === currentImage ? ' active' : '');
        btn.setAttribute('aria-label', `Image ${idx + 1}`);
        btn.innerHTML = `<img src="${src}" alt="">`;
        btn.addEventListener('click', () => {
          currentImage = idx;
          setMainImage(src);
          updateActiveThumb();
        });
        lbThumbs.appendChild(btn);
      });

      const prevIndex = (currentItem - 1 + items.length) % items.length;
      const nextIndex = (currentItem + 1) % items.length;
      prevName.textContent = items[prevIndex].title.toUpperCase();
      nextName.textContent = items[nextIndex].title.toUpperCase();
      prevWrap.onclick = () => { currentItem = prevIndex; currentImage = 0; render(); };
      nextWrap.onclick = () => { currentItem = nextIndex; currentImage = 0; render(); };
    }

    function updateActiveThumb() {
      Array.from(lbThumbs.children).forEach((el, i) =>
        el.classList.toggle('active', i === currentImage)
      );
    }

    function goToPrevImage() {
      const item = items[currentItem];
      if (item.images.length <= 1) return;
      currentImage = (currentImage - 1 + item.images.length) % item.images.length;
      setMainImage(item.images[currentImage]);
      updateActiveThumb();
    }
    function goToNextImage() {
      const item = items[currentItem];
      if (item.images.length <= 1) return;
      currentImage = (currentImage + 1) % item.images.length;
      setMainImage(item.images[currentImage]);
      updateActiveThumb();
    }

    imgPrevBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); goToPrevImage(); });
    imgNextBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); goToNextImage(); });

    // Stop ANY click inside the overlay from bubbling up to lbMainArea (which opens fullscreen)
    const imgOverlay = document.getElementById('lbImgNav');
    if (imgOverlay) {
      imgOverlay.addEventListener('click', e => { e.stopPropagation(); });
    }

    // Fullscreen
    function openFullscreen() {
      fullscreenImg.src = lbMain.src;
      fullscreenOverlay.classList.add('open');
    }
    function closeFullscreen() {
      fullscreenOverlay.classList.remove('open');
    }
    function fsGoToPrevImage() { goToPrevImage(); fullscreenImg.src = lbMain.src; }
    function fsGoToNextImage() { goToNextImage(); fullscreenImg.src = lbMain.src; }

    lbMainArea.addEventListener('click', e => {
      // Only open fullscreen when clicking the image itself, not any overlay/button
      if (e.target === lbMain) {
        openFullscreen();
      }
    });
    fullscreenClose.addEventListener('click', closeFullscreen);
    fsPrevBtn.addEventListener('click', e => { e.stopPropagation(); fsGoToPrevImage(); });
    fsNextBtn.addEventListener('click', e => { e.stopPropagation(); fsGoToNextImage(); });
    fullscreenOverlay.addEventListener('click', e => {
      if (e.target === fullscreenOverlay || e.target === fullscreenImg) closeFullscreen();
    });

    tiles.forEach((fig, i) => {
      fig.style.cursor = 'pointer';
      fig.addEventListener('click', () => openLightbox(i));
    });

    lbBack.addEventListener('click', closeLightbox);
    lb.addEventListener('click', e => { if (e.target === lb) closeLightbox(); });

    document.addEventListener('keydown', e => {
      if (!lb.classList.contains('open')) return;
      if (fullscreenOverlay.classList.contains('open')) {
        if (e.key === 'Escape') closeFullscreen();
        if (e.key === 'ArrowLeft') fsGoToPrevImage();
        if (e.key === 'ArrowRight') fsGoToNextImage();
        return;
      }
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowRight') nextWrap.click();
      if (e.key === 'ArrowLeft') prevWrap.click();
    });

    // Deep-link: populate lightbox content if already opened from hash
    if (deepLinkHash) {
      const idx = items.findIndex(it => it.slug === deepLinkHash);
      if (idx !== -1) {
        // Lightbox is already open with spinner — just render content
        currentItem = idx;
        currentImage = 0;
        render();
        lb.scrollTop = 0;
        // Remove spinner and restore hidden elements
        const spinner = document.getElementById('lbLoadingSpinner');
        if (spinner) spinner.remove();
        lbSubtitle.style.display = '';
        lbDesc.style.display = '';
        lbThumbs.style.display = '';
        prevWrap.style.visibility = '';
        nextWrap.style.visibility = '';
      } else {
        // Hash didn't match any project — close the lightbox
        closeLightbox();
      }
      // Clean hash from URL so closing returns to normal gallery view
      const origClose = closeLightbox;
      closeLightbox = function () {
        origClose();
        history.replaceState(null, '', window.location.pathname);
      };
      lbBack.onclick = closeLightbox;
      lb.onclick = e => { if (e.target === lb) closeLightbox(); };
    }
  }

  /* ── Public init ── */
  async function init(opts) {
    const {
      sheetId,
      gridSelector = '#gallery-grid',
      startpageOnly = false,
      imageBasePath = 'assets/projects/',
      hasLightbox = false
    } = opts;

    const gridEl = document.querySelector(gridSelector);
    if (!gridEl) { console.error('Gallery: grid element not found'); return; }

    // Inject keyframes once (needed by both gallery loader and lightbox spinner)
    if (!document.getElementById('gallery-loader-css')) {
      const style = document.createElement('style');
      style.id = 'gallery-loader-css';
      style.textContent = `
        @keyframes galleryLoaderSpin { to { transform: rotate(360deg); } }
        @keyframes galleryLoaderIn { to { opacity: 1; } }
      `;
      document.head.appendChild(style);
    }

    // Detect deep-link hash (e.g. work.html#moonboots)
    const deepLinkHash = hasLightbox ? window.location.hash.replace('#', '') : '';

    // If deep-linked, open lightbox immediately with a loading spinner
    if (deepLinkHash) {
      const lb = document.getElementById('galleryLightbox');
      if (lb) {
        // Show the project title immediately from URL param
        const urlParams = new URLSearchParams(window.location.search);
        const preTitle = urlParams.get('title') || '';
        const lbTitle = document.getElementById('lbTitle');
        if (lbTitle && preTitle) lbTitle.textContent = preTitle;

        // Hide subtitle/desc/nav until data loads
        const lbSubtitle = document.getElementById('lbSubtitle');
        const lbDesc = document.getElementById('lbDesc');
        const lbThumbs = document.getElementById('lbThumbs');
        const lbPrev = document.getElementById('lbPrev');
        const lbNext = document.getElementById('lbNext');
        if (lbSubtitle) lbSubtitle.style.display = 'none';
        if (lbDesc) lbDesc.style.display = 'none';
        if (lbThumbs) lbThumbs.style.display = 'none';
        if (lbPrev) lbPrev.style.visibility = 'hidden';
        if (lbNext) lbNext.style.visibility = 'hidden';

        // Show spinner in the main image area
        const lbMainArea = document.getElementById('lbMainArea');
        if (lbMainArea) {
          lbMainArea.insertAdjacentHTML('afterbegin',
            `<div id="lbLoadingSpinner" style="
              position: absolute; inset: 0; z-index: 5;
              display: flex; align-items: center; justify-content: center;
              background: #fff;
            "><div style="
              width: 36px; height: 36px;
              border: 3px solid #e0d6e6;
              border-top-color: #9b7fb8;
              border-radius: 50%;
              animation: galleryLoaderSpin 0.8s linear infinite;
            "></div></div>`
          );
        }
        // Open lightbox shell
        lb.classList.add('preopen');
        lb.setAttribute('aria-hidden', 'false');
        requestAnimationFrame(() => {
          lb.classList.add('open');
          lb.classList.remove('preopen');
        });
        const scrollbarW = window.innerWidth - document.documentElement.clientWidth;
        document.body.style.overflow = 'hidden';
        document.body.style.paddingRight = scrollbarW + 'px';
        const nav = document.getElementById('mainNavbar');
        if (nav) nav.style.paddingRight = scrollbarW + 'px';
      }
    }

    // Show loading indicator in gallery grid (behind lightbox if deep-linked)
    gridEl.innerHTML = `
      <div class="gallery-loader" style="
        grid-column: 1 / -1;
        width: 100%;
        min-height: 60vh;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 16px;
        opacity: 0;
        animation: galleryLoaderIn 0.4s ease 0.2s forwards;
      ">
        <div style="
          width: 36px; height: 36px;
          border: 3px solid #e0d6e6;
          border-top-color: #9b7fb8;
          border-radius: 50%;
          animation: galleryLoaderSpin 0.8s linear infinite;
        "></div>
        <span style="
          font-family: 'Karla', sans-serif;
          font-size: 0.95rem;
          color: #9b7fb8;
          letter-spacing: 0.03em;
        ">Loading projects…</span>
      </div>
    `;

    try {
      const table = await fetchSheet(sheetId);
      const records = gvizToRecords(table);
      const projects = buildProjects(records, imageBasePath);

      const displayed = renderTiles(projects, gridEl, { startpageOnly, hasLightbox });

      // Wait for images then init masonry
      initMasonry(gridEl);

      // Scroll animations after a short delay
      setTimeout(initScrollAnimations, 400);

      // Lightbox (work page only)
      if (hasLightbox) {
        initLightbox(displayed, deepLinkHash);
      }
    } catch (err) {
      console.error('Gallery: failed to load data from Google Sheets', err);
      gridEl.innerHTML = `
        <div style="
          width: 100%;
          text-align: center;
          padding: 60px 20px;
          font-family: 'Karla', sans-serif;
          color: #999;
          font-size: 0.95rem;
        ">Could not load projects — please try again later.</div>
      `;
    }
  }

  return { init };
})();
