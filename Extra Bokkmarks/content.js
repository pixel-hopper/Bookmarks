// Extra Bookmark Bars Extension - Enhanced Edge Support
class ExtraBookmarkBars {
  constructor() {
    this.bars = [];
    this.isEnabled = true;
    this.isCollapsed = false;
    this.container = null;
    this.toggleButton = null;
    this.contextMenu = null;
    this.dragState = {
      dragging: null, // { barId, bookmarkId, index }
      overBarId: null,
      overIndex: null, // index where it will be inserted
      overBefore: true
    };
    this.currentTarget = null;
    this.nativeBookmarkBar = null;
    this.setupAttempts = 0;
    this.maxSetupAttempts = 20;
    this.init();
  }

  onItemDragStart(e, payload) {
    try {
      this.dragState.dragging = payload; // { barId, bookmarkId, index }
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/extra-bookmark', JSON.stringify(payload));
      // Some Chromium paths require a plain text payload to initiate drag
      if (!e.dataTransfer.getData('text/plain')) {
        e.dataTransfer.setData('text/plain', 'drag');
      }
    } catch (_) {}
  }

  onItemDragEnd() {
    this.dragState = { dragging: null, overBarId: null, overIndex: null, overBefore: true };
    // Remove any indicators
    document.querySelectorAll('.extra-bookmark-item.drop-before, .extra-bookmark-item.drop-after').forEach(el => {
      el.classList.remove('drop-before', 'drop-after');
    });
  }

  onItemDragOver(e, { barId, index }) {
    const dt = e.dataTransfer;
    if (!dt) return;
    if (!dt.types || (!dt.types.includes('text/extra-bookmark') && !dt.types.includes('text/plain') && !dt.types.includes('text/uri-list'))) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';

    const target = e.currentTarget; // .extra-bookmark-item
    const rect = target.getBoundingClientRect();
    const before = (e.clientX - rect.left) < rect.width / 2;

    // Update indicators
    target.classList.toggle('drop-before', before);
    target.classList.toggle('drop-after', !before);

    this.dragState.overBarId = barId;
    this.dragState.overIndex = index;
    this.dragState.overBefore = before;
  }

  onItemDrop(e, { barId, index }) {
    e.preventDefault();
    e.stopPropagation();
    const data = e.dataTransfer.getData('text/extra-bookmark');
    if (data) {
      const payload = JSON.parse(data);
      const insertIndex = this.dragState.overBefore ? index : index + 1;
      this.performMove(payload, { barId, index: insertIndex });
    } else {
      // External URL drop onto an item -> treat like drop on container at this index
      const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
      const title = e.dataTransfer.getData('text/html') ? this.extractTitleFromHTML(e.dataTransfer.getData('text/html')) : e.dataTransfer.getData('text/plain');
      if (this.isValidUrl(url)) {
        this.addBookmarkAtIndex(barId, index, url, title);
      }
    }
    this.clearDropIndicators(barId);
  }

  onContainerDragOver(e, barId) {
    const dt = e.dataTransfer;
    if (!dt) return;
    if (!dt.types || (!dt.types.includes('text/extra-bookmark') && !dt.types.includes('text/plain') && !dt.types.includes('text/uri-list'))) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    this.dragState.overBarId = barId;
    // If over container, default to append at end
    const bar = this.bars.find(b => b.id === barId);
    this.dragState.overIndex = bar ? bar.bookmarks.length : 0;
    this.dragState.overBefore = true;
  }

  onContainerDrop(e, barId) {
    e.preventDefault();
    e.stopPropagation();
    const data = e.dataTransfer.getData('text/extra-bookmark');
    if (data) {
      const payload = JSON.parse(data);
      const bar = this.bars.find(b => b.id === barId);
      const idx = bar ? bar.bookmarks.length : 0;
      this.performMove(payload, { barId, index: idx });
    } else {
      const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
      const title = e.dataTransfer.getData('text/html') ? this.extractTitleFromHTML(e.dataTransfer.getData('text/html')) : e.dataTransfer.getData('text/plain');
      if (this.isValidUrl(url)) {
        this.addBookmarkAtIndex(barId, undefined, url, title);
      }
    }
    this.clearDropIndicators(barId);
  }

  clearDropIndicators(barId) {
    document.querySelectorAll('.extra-bookmark-item.drop-before, .extra-bookmark-item.drop-after').forEach(el => {
      el.classList.remove('drop-before', 'drop-after');
    });
    if (this.dragState.overBarId === barId) {
      this.dragState.overIndex = null;
    }
  }

  performMove(source, target) {
    const { barId: fromBarId, bookmarkId } = source;
    const { barId: toBarId, index: toIndexRaw } = target;

    const fromBar = this.bars.find(b => b.id === fromBarId);
    const toBar = this.bars.find(b => b.id === toBarId);
    if (!fromBar || !toBar) return;

    const fromIndex = fromBar.bookmarks.findIndex(b => b.id === bookmarkId);
    if (fromIndex === -1) return;

    const [moved] = fromBar.bookmarks.splice(fromIndex, 1);
    let toIndex = toIndexRaw;
    if (fromBarId === toBarId && fromIndex < toIndex) {
      // Adjust index when moving forward within same array
      toIndex = Math.max(0, toIndex - 1);
    }
    toIndex = Math.min(toBar.bookmarks.length, Math.max(0, toIndex));
    toBar.bookmarks.splice(toIndex, 0, moved);

    this.saveConfiguration().then(() => this.createBookmarkBars());
  }

  async addBookmarkAtIndex(barId, index, url, title) {
    const bookmark = await this.createBookmarkFromUrl(url, title);
    const bar = this.bars.find(b => b.id === barId);
    if (!bar) return;
    if (typeof index === 'number' && index >= 0 && index <= bar.bookmarks.length) {
      bar.bookmarks.splice(index, 0, bookmark);
    } else {
      bar.bookmarks.push(bookmark);
    }
    await this.saveConfiguration();
    this.createBookmarkBars();
  }

  async init() {
    console.log('Initializing Extra Bookmark Bars on:', window.location.href);
    
    // Listen for clicks to hide context menu
    document.addEventListener('click', () => this.hideContextMenu());

    // Load saved configuration first
    await this.loadConfiguration();

    // React to global collapsed state changes from popup
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes && Object.prototype.hasOwnProperty.call(changes, 'barsCollapsed')) {
        this.isCollapsed = changes.barsCollapsed.newValue === true;
        this.applyCollapsedState();
      }
    });

    // React to bar list changes from popup
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes && Object.prototype.hasOwnProperty.call(changes, 'extraBars')) {
        const newBars = changes.extraBars.newValue || [];
        this.bars = newBars;
        this.createBookmarkBars();
      }
    });

    // React to global options changes from popup
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes && Object.prototype.hasOwnProperty.call(changes, 'globalOptions')) {
        const go = changes.globalOptions.newValue || {};
        this.globalOptions = {
          scale: (typeof go.scale === 'number') ? go.scale : 1,
          spacing: (typeof go.spacing === 'number') ? go.spacing : 0,
          opacity: (typeof go.opacity === 'number') ? go.opacity : 1
        };
        this.createBookmarkBars();
      }
    });

    // Enhanced new tab detection
    const isNewTab = this.isNewTabPage();
    console.log('Is new tab page:', isNewTab);
    
    if (isNewTab) {
      // For new tab pages, use aggressive setup approach
      this.setupForNewTab();
    } else {
      // Standard setup for regular pages
      this.setupForRegularPage();
    }
  }

  async loadConfiguration() {
    try {
      // First try to load from localStorage to avoid extension context issues
      try {
        const savedCollapsed = localStorage.getItem('extraBarsCollapsed');
        if (savedCollapsed !== null) {
          this.isCollapsed = JSON.parse(savedCollapsed);
        }
      } catch (e) {
        console.log('Could not load from localStorage, will try chrome.storage:', e);
      }
      
      // Then load other settings from chrome.storage
      try {
        if (chrome && chrome.storage && chrome.storage.sync) {
          const result = await chrome.storage.sync.get(['extraBars', 'isEnabled', 'globalOptions', 'barsCollapsed']);
          this.bars = result.extraBars || [{ id: 1, name: 'Bar 1', bookmarks: [] }];
          this.isEnabled = result.isEnabled !== false; // default to true
          this.globalOptions = result.globalOptions || { scale: 1, spacing: 0, opacity: 1 };
          
          // Only use chrome.storage collapsed state if we didn't get it from localStorage
          if (this.isCollapsed === undefined) {
            this.isCollapsed = result.barsCollapsed || false;
          }
        }
      } catch (e) {
        console.log('Could not load from chrome.storage, using defaults:', e);
        if (this.bars === undefined) this.bars = [{ id: 1, name: 'Bar 1', bookmarks: [] }];
        if (this.isEnabled === undefined) this.isEnabled = true;
        if (this.globalOptions === undefined) this.globalOptions = { scale: 1, spacing: 0, opacity: 1 };
        if (this.isCollapsed === undefined) this.isCollapsed = false;
      }
      
      // Apply the collapsed state
      this.applyCollapsedState();
      
    } catch (e) {
      console.error('Unexpected error in loadConfiguration:', e);
      // Ensure we have sane defaults
      this.bars = this.bars || [{ id: 1, name: 'Bar 1', bookmarks: [] }];
      this.isEnabled = this.isEnabled !== false;
      this.globalOptions = this.globalOptions || { scale: 1, spacing: 0, opacity: 1 };
      this.isCollapsed = this.isCollapsed || false;
    }
  }

  
  isNewTabPage() {
    // Enhanced Edge new tab detection
    const url = window.location.href;
    const isNewTabUrl = (
      url === 'about:newtab' ||
      url === 'about:blank' ||
      url === 'chrome://newtab/' ||
      url === 'edge://newtab/' ||
      url.startsWith('chrome://new-tab-page') ||
      url.startsWith('edge://new-tab-page') ||
      url.includes('newtab') ||
      url.includes('new-tab')
    );
    
    // Check for Edge-specific selectors
    const hasEdgeElements = () => {
      return (
        document.querySelector('body[data-ntp]') ||
        document.querySelector('microsoft-ntp') ||
        document.querySelector('body[class*="ntp"]') ||
        document.querySelector('#main-content') ||
        document.querySelector('body#ntp-contents') ||
        document.querySelector('[data-module-id]') ||
        document.querySelector('.ntp-content') ||
        document.querySelector('body.ntp') ||
        document.querySelector('html[newtab]')
      );
    };
    
    // Check for generic new tab indicators
    const hasNewTabIndicators = () => {
      return (
        document.title.toLowerCase().includes('new tab') ||
        document.title.toLowerCase().includes('newtab') ||
        document.querySelector('body[ntp]') ||
        document.querySelector('html[ntp]')
      );
    };
    
    return isNewTabUrl || hasEdgeElements() || hasNewTabIndicators();
  }

  setupForNewTab() {
    console.log('Setting up for new tab page');
    
    // Try immediate setup
    this.attemptSetup();
    
    // Set up multiple fallback timers
    const timers = [100, 300, 500, 1000, 2000, 3000];
    timers.forEach(delay => {
      setTimeout(() => {
        if (!this.container || !document.contains(this.container)) {
          this.attemptSetup();
        }
      }, delay);
    });
    
    // Watch for DOM changes
    this.setupMutationObserver();
    
    // Watch for when the page becomes visible
    if (document.hidden) {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
          setTimeout(() => this.attemptSetup(), 100);
        }
      });
    }
  }

  setupForRegularPage() {
    console.log('Setting up for regular page');
    
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.attemptSetup());
    } else {
      this.attemptSetup();
    }
    
    // Also set up observer for SPA navigation
    this.setupMutationObserver();
  }

  setupMutationObserver() {
    const observer = new MutationObserver((mutations) => {
      let shouldRetry = false;
      
      // Check if our container was removed
      if (this.container && !document.contains(this.container)) {
        shouldRetry = true;
      }
      
      // Check for significant DOM changes that might indicate page ready
      mutations.forEach(mutation => {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === 1) { // Element node
              // Look for Edge-specific elements that indicate page is ready
              if (node.querySelector && (
                node.querySelector('[data-module-id]') ||
                node.querySelector('.ntp-content') ||
                node.querySelector('microsoft-ntp') ||
                node.matches && (
                  node.matches('[data-module-id]') ||
                  node.matches('.ntp-content') ||
                  node.matches('microsoft-ntp')
                )
              )) {
                shouldRetry = true;
              }
            }
          });
        }
      });
      
      if (shouldRetry) {
        setTimeout(() => this.attemptSetup(), 100);
      }
    });
    
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'data-ntp', 'ntp']
    });
  }

  attemptSetup() {
    this.setupAttempts++;
    console.log(`Setup attempt ${this.setupAttempts}/${this.maxSetupAttempts}`);
    
    if (this.setupAttempts > this.maxSetupAttempts) {
      console.log('Max setup attempts reached');
      return;
    }
    
    if (!this.isEnabled) {
      console.log('Extension disabled');
      return;
    }
    
    // Check if already exists and working
    if (this.container && document.contains(this.container)) {
      console.log('Bookmark bars already exist and are visible');
      return;
    }
    
    try {
      this.createBookmarkBars();
    } catch (error) {
      console.error('Error in setup attempt:', error);
      // Try again after a delay
      if (this.setupAttempts < this.maxSetupAttempts) {
        setTimeout(() => this.attemptSetup(), 500);
      }
    }
  }

  findNativeBookmarkBar() {
    // Look for Edge's native bookmark bar to match its styling
    const selectors = [
      '.bookmark-bar',
      '[data-test-id="bookmark-bar"]',
      '.bookmarks-bar',
      '.favorites-bar',
      '[class*="bookmark"][class*="bar"]',
      '[class*="favorite"][class*="bar"]'
    ];
    
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        console.log('Found native bookmark bar:', selector);
        return element;
      }
    }
    
    return null;
  }

  createBookmarkBars() {
    console.log('Creating bookmark bars...');
    
    // Remove existing bars first
    this.removeExtraBars();

    // Find native bookmark bar for reference
    this.nativeBookmarkBar = this.findNativeBookmarkBar();
    
    // Create container
    this.container = document.createElement('div');
    this.container.id = 'extra-bookmark-bars-container';
    this.container.className = 'extra-bookmark-bars-container';
    
    // Force visibility with important styles
    Object.assign(this.container.style, {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      position: 'fixed',
      top: '0',
      left: '0',
      right: '0',
      zIndex: '999999',
      pointerEvents: 'auto'
    });

    // Calculate positioning
    let topOffset = 0;
    
    if (this.nativeBookmarkBar) {
      const rect = this.nativeBookmarkBar.getBoundingClientRect();
      topOffset = rect.bottom;
      console.log('Native bookmark bar bottom:', topOffset);
    }
    
    this.container.style.top = topOffset + 'px';

    // Create each bar
    this.bars.forEach((barData) => {
      const bar = this.createBookmarkBar(barData);
      this.container.appendChild(bar);
    });

    // Create context menu
    this.createContextMenu();

    // Insert into DOM - try multiple strategies
    this.insertIntoDOM();
    
    // Adjust page content
    this.adjustPageLayout();

    // Ensure toggle exists and reflects state
    this.ensureToggleExists();
    this.applyCollapsedState();

    // No continuous observers; position will update on state changes only
    
    console.log('Bookmark bars created and inserted');
    return true;
  }

  insertIntoDOM() {
    const insertionTargets = [
      document.body,
      document.querySelector('main'),
      document.querySelector('#content'),
      document.querySelector('.main-content'),
      document.documentElement
    ].filter(Boolean);
    
    for (const target of insertionTargets) {
      try {
        if (target.firstChild) {
          target.insertBefore(this.container, target.firstChild);
        } else {
          target.appendChild(this.container);
        }
        console.log('Successfully inserted into:', target.tagName);
        break;
      } catch (error) {
        console.log('Failed to insert into:', target.tagName, error);
      }
    }
  }

  adjustPageLayout() {
    if (!this.container) return;
    
    // Calculate total height of our bars
    const containerHeight = this.container.offsetHeight;
    console.log('Container height:', containerHeight);
    
    // Add padding to body to prevent overlap
    if (!this.isCollapsed) {
      document.body.style.paddingTop = containerHeight + 'px';
    }
    
    // Also adjust any main content areas
    const contentSelectors = [
      'main',
      '#content',
      '.main-content',
      '.ntp-content',
      '[data-module-id]'
    ];
    
    contentSelectors.forEach(selector => {
      const element = document.querySelector(selector);
      if (element) {
        if (!this.isCollapsed) {
          element.style.marginTop = '10px';
        }
      }
    });
  }

  ensureToggleExists() {
    if (!this.toggleButton) {
      this.createToggleButton();
    }
    this.updateTogglePosition();
    this.updateToggleIcon();
  }

  createToggleButton() {
    this.toggleButton = document.createElement('button');
    this.toggleButton.id = 'extra-bars-toggle';
    this.toggleButton.type = 'button';
    this.toggleButton.setAttribute('aria-label', 'Toggle extra bookmark bars');
    this.toggleButton.addEventListener('click', () => this.toggleCollapsed());
    document.documentElement.appendChild(this.toggleButton);

    // Watch for scale changes and update position
    this.observer = new MutationObserver(() => this.updateTogglePosition());
    this.observer.observe(document.documentElement, {
      attributeFilter: ['style'],
      attributes: true
    });
  }

  updateTogglePosition() {
    if (!this.toggleButton || !this.container) return;
    
    // Get the actual height of the first bar
    const firstBar = this.container.querySelector('.extra-bookmark-bar');
    if (!firstBar) return;
    
    const barHeight = firstBar.offsetHeight;
    const toggleHeight = 18; // Fixed height of the toggle button
    
    // Calculate center position based on actual bar height
    const centerOffset = Math.max(0, Math.round((barHeight - toggleHeight) / 2));
    
    // Position show arrow at top, hide arrow centered in the bar
    const topPosition = this.isCollapsed ? '0' : `${centerOffset}px`;
    this.toggleButton.style.top = topPosition;
    this.toggleButton.style.left = '6px';
  }

  updateToggleIcon() {
    if (!this.toggleButton) return;
    // Rely on CSS ::before mask; do not render text to avoid font scaling/interference
    this.toggleButton.textContent = '';
    this.toggleButton.title = this.isCollapsed ? 'Show extra bookmark bars' : 'Hide extra bookmark bars';
  }

  async toggleCollapsed() {
    this.isCollapsed = !this.isCollapsed;
    await this.saveCollapsedState();
    this.applyCollapsedState();
  }

  applyCollapsedState() {
    if (!this.container) return;
    if (this.isCollapsed) {
      this.container.classList.add('collapsed');
      this.container.classList.remove('with-toggle-offset');
      if (this.toggleButton) this.toggleButton.classList.add('collapsed');
      document.body.style.paddingTop = '';
      // Reset margins on content we may have changed
      const contentSelectors = ['main', '#content', '.main-content', '.ntp-content', '[data-module-id]'];
      contentSelectors.forEach(selector => {
        const element = document.querySelector(selector);
        if (element) element.style.marginTop = '';
      });
    } else {
      this.container.classList.remove('collapsed');
      this.container.classList.add('with-toggle-offset');
      if (this.toggleButton) this.toggleButton.classList.remove('collapsed');
      this.adjustPageLayout();
    }
    this.updateToggleIcon();
    this.updateTogglePosition();
  }

  async saveCollapsedState() {
    // Always use localStorage to avoid extension context issues in Gmail
    try {
      localStorage.setItem('extraBarsCollapsed', JSON.stringify(this.isCollapsed));
      console.log('Saved collapsed state to localStorage');
      
      // Try to sync to chrome.storage in the background if available
      if (chrome && chrome.storage && chrome.storage.sync) {
        chrome.storage.sync.set({ barsCollapsed: this.isCollapsed })
          .then(() => console.log('Synced to chrome.storage.sync in background'))
          .catch(e => console.log('Background sync to chrome.storage.sync failed:', e));
      }
    } catch (e) {
      console.error('Failed to save collapsed state:', e);
    }
  }

  createBookmarkBar(barData) {
    const bar = document.createElement('div');
    bar.className = 'extra-bookmark-bar';
    bar.dataset.barId = barData.id;

    // Apply global CSS variables (scale, spacing)
    const scale = (this.globalOptions && typeof this.globalOptions.scale === 'number') ? this.globalOptions.scale : 1;
    const spacing = (this.globalOptions && typeof this.globalOptions.spacing === 'number') ? this.globalOptions.spacing : 0;
    const opacity = (this.globalOptions && typeof this.globalOptions.opacity === 'number') ? this.globalOptions.opacity : 1;
    bar.style.setProperty('--bar-scale', String(scale));
    bar.style.setProperty('--item-spacing', `${spacing}px`);
    bar.style.setProperty('--bar-opacity', String(opacity));

    // Copy styles from native bookmark bar if found
    if (this.nativeBookmarkBar) {
      const nativeStyles = getComputedStyle(this.nativeBookmarkBar);
      bar.style.fontFamily = nativeStyles.fontFamily;
      bar.style.fontSize = nativeStyles.fontSize;
    }

    // Note: legacy bar-level DnD removed to avoid duplicate drop handling; handled at container/item level

    // Enable right-click context menu
    bar.addEventListener('contextmenu', (e) => {
      if (e.target === bar || e.target.classList.contains('extra-bar-bookmarks') || e.target.classList.contains('empty-bar-message')) {
        e.preventDefault();
        e.stopPropagation();
        this.showContextMenu(e, { type: 'bar', barId: barData.id });
      }
    });

    // Bookmarks container
    const bookmarksContainer = document.createElement('div');
    bookmarksContainer.className = 'extra-bar-bookmarks';
    // Handle dragover at container level to allow dropping at end/empty
    bookmarksContainer.addEventListener('dragover', (e) => this.onContainerDragOver(e, barData.id));
    bookmarksContainer.addEventListener('dragleave', (e) => this.clearDropIndicators(barData.id));
    bookmarksContainer.addEventListener('drop', (e) => this.onContainerDrop(e, barData.id));

    // Create bookmark items
    barData.bookmarks.forEach((bookmark, index) => {
      const bookmarkEl = this.createBookmarkElement(bookmark, barData.id, index);
      bookmarksContainer.appendChild(bookmarkEl);
    });

    // Add empty state message
    if (barData.bookmarks.length === 0) {
      const emptyMessage = document.createElement('div');
      emptyMessage.className = 'empty-bar-message';
      emptyMessage.textContent = 'Right-click to add bookmarks or drag links here';
      bookmarksContainer.appendChild(emptyMessage);
    }

    bar.appendChild(bookmarksContainer);
    return bar;
  }

  createBookmarkElement(bookmark, barId, index) {
    const bookmarkEl = document.createElement('div');
    bookmarkEl.className = 'extra-bookmark-item';
    bookmarkEl.draggable = true;
    bookmarkEl.addEventListener('dragstart', (e) => this.onItemDragStart(e, { barId, bookmarkId: bookmark.id, index }));
    bookmarkEl.addEventListener('dragend', () => this.onItemDragEnd());
    
    const link = document.createElement('a');
    link.href = bookmark.url;
    link.title = bookmark.url;
    link.target = '_self'; // Open in same tab by default

    // Handle clicks properly
    link.addEventListener('click', (e) => {
      e.preventDefault();
      
      if (e.ctrlKey || e.metaKey || e.button === 1) {
        // Ctrl+click or middle click - open in new tab
        window.open(bookmark.url, '_blank');
      } else {
        // Regular click - open in same tab
        window.location.href = bookmark.url;
      }
    });

    // Setup context menu for the bookmark
    bookmarkEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.showContextMenu(e, { type: 'bookmark', barId, bookmark });
    });

    // While dragging over items, show insertion indicator
    bookmarkEl.addEventListener('dragover', (e) => this.onItemDragOver(e, { barId, index }));
    bookmarkEl.addEventListener('dragleave', () => this.clearDropIndicators(barId));
    bookmarkEl.addEventListener('drop', (e) => this.onItemDrop(e, { barId, index }));

    // Create favicon container
    const faviconContainer = document.createElement('span');
    faviconContainer.className = 'favicon-container';
    
    // Check for emoji at start of title
    const emojiMatch = bookmark.title && bookmark.title.match(/^([\p{Emoji_Presentation}\p{Symbol}]\s*)+/u);
    
    if (emojiMatch) {
      // Use the emoji as the favicon
      const emojiFavicon = document.createElement('span');
      emojiFavicon.className = 'emoji-favicon';
      emojiFavicon.textContent = emojiMatch[0].trim();
      faviconContainer.appendChild(emojiFavicon);
      
      // Remove emoji from title
      bookmark.title = bookmark.title.replace(/^([\p{Emoji_Presentation}\p{Symbol}]\s*)+/u, '').trim();
    } else if (bookmark.favicon) {
      // Use the provided favicon
      const favicon = document.createElement('img');
      favicon.src = bookmark.favicon;
      favicon.className = 'bookmark-favicon';
      favicon.alt = '';
      
      favicon.addEventListener('error', () => {
        this.handleFaviconError(faviconContainer, bookmark.url, bookmark.title);
      });
      
      faviconContainer.appendChild(favicon);
    } else {
      // No favicon or emoji, try to get favicon from URL
      this.handleFaviconError(faviconContainer, bookmark.url, bookmark.title);
    }
    
    link.appendChild(faviconContainer);

    // Add title if present
    if (bookmark.title && bookmark.title.trim() !== '') {
      const titleSpan = document.createElement('span');
      titleSpan.textContent = bookmark.title;
      titleSpan.className = 'bookmark-title';
      link.appendChild(titleSpan);
    }

    bookmarkEl.appendChild(link);
    return bookmarkEl;
  }

  handleFaviconError(container, url, title = '') {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;
      
      // Clear container
      container.innerHTML = '';
      
      // Create text favicon as fallback
      const createTextFavicon = () => {
        const favicon = document.createElement('span');
        favicon.className = 'text-favicon';
        const firstChar = (title && title.trim() ? title.trim().charAt(0) : hostname.charAt(0)).toUpperCase();
        favicon.textContent = firstChar;
        
        // Set a consistent background color based on the first character
        const colors = [
          '#4285f4', '#34a853', '#fbbc05', '#ea4335', '#673ab7',
          '#ff5722', '#009688', '#795548', '#607d8b', '#9c27b0'
        ];
        const colorIndex = firstChar.charCodeAt(0) % colors.length;
        favicon.style.backgroundColor = colors[colorIndex];
        
        container.appendChild(favicon);
      };
      
      // Create text favicon immediately
      createTextFavicon();
      
      // Try to load favicon from various sources
      const faviconImg = document.createElement('img');
      faviconImg.className = 'bookmark-favicon';
      faviconImg.alt = '';
      faviconImg.crossOrigin = 'anonymous';
      
      // Try multiple favicon sources with different priorities
      const sources = [
        // Try the direct favicon first
        () => `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`,
        // Try favicon.ico in root
        () => `${urlObj.protocol}//${hostname}/favicon.ico?${Date.now()}`,
        // Try favicon.png in root
        () => `${urlObj.protocol}//${hostname}/favicon.png?${Date.now()}`,
        // Try apple-touch-icon
        () => `${urlObj.protocol}//${hostname}/apple-touch-icon.png?${Date.now()}`,
        // Try favicon in common locations
        () => `${urlObj.origin}/favicon.ico?${Date.now()}`,
        // Try with www prefix if not present
        () => hostname.startsWith('www.') ? null : `https://www.${hostname}/favicon.ico?${Date.now()}`,
        // Try with protocol-relative URL
        () => `//${hostname}/favicon.ico?${Date.now()}`,
        // Try favicon kit as last resort
        () => `https://api.faviconkit.com/${hostname}/32`
      ];
      
      let currentSource = 0;
      
      const tryNextSource = () => {
        if (currentSource >= sources.length) return;
        
        const getSource = sources[currentSource++];
        const src = getSource();
        
        if (!src) {
          tryNextSource();
          return;
        }
        
        faviconImg.onload = () => {
          if (faviconImg.width > 0 && faviconImg.height > 0) {
            // Valid image loaded, replace the text favicon
            container.innerHTML = '';
            container.appendChild(faviconImg);
            faviconImg.style.display = 'inline-block';
          } else {
            tryNextSource();
          }
        };
        
        faviconImg.onerror = tryNextSource;
        
        // Set source last to trigger loading
        faviconImg.src = src;
      };
      
      // Start trying sources
      tryNextSource();
      
    } catch (error) {
      console.error('Error handling favicon:', error);
      // Keep the text favicon as fallback
    }
  }

  // Removed in favor of CSS-based text favicons

  setupDragAndDrop(bar, barId) {
    // Allow dropping on the bar
    bar.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      bar.classList.add('drag-over');
    });

    bar.addEventListener('dragleave', (e) => {
      if (!bar.contains(e.relatedTarget)) {
        bar.classList.remove('drag-over');
      }
    });

    bar.addEventListener('drop', async (e) => {
      e.preventDefault();
      bar.classList.remove('drag-over');
      
      // Get dropped data
      const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
      const title = e.dataTransfer.getData('text/html') ? 
        this.extractTitleFromHTML(e.dataTransfer.getData('text/html')) : 
        e.dataTransfer.getData('text/plain');
      
      if (url && this.isValidUrl(url)) {
        await this.addBookmarkFromDrop(barId, url, title);
      }
    });
  }

  extractTitleFromHTML(html) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    const link = tempDiv.querySelector('a');
    return link ? link.textContent : '';
  }

  isValidUrl(string) {
    try {
      const url = new URL(string);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
      return string.match(/^https?:\/\/.+/i) !== null;
    }
  }

  async addBookmarkFromDrop(barId, url, title) {
    const bookmark = await this.createBookmarkFromUrl(url, title);
    
    const barIndex = this.bars.findIndex(bar => bar.id === barId);
    if (barIndex !== -1) {
      this.bars[barIndex].bookmarks.push(bookmark);
      await this.saveConfiguration();
      this.createBookmarkBars();
    }
  }

  async createBookmarkFromUrl(url, fallbackTitle) {
    let title = fallbackTitle;
    let favicon = null;

    try {
      const urlObj = new URL(url);
      favicon = `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=16`;
      
      if (!title || title === url) {
        // Try to get a clean title from the hostname
        title = urlObj.hostname.replace(/^www\./, '').split('.')[0];
        title = title.charAt(0).toUpperCase() + title.slice(1);
      }
    } catch (error) {
      console.log('Could not parse URL:', error);
      title = title || url;
    }

    return {
      id: Date.now() + Math.random(),
      title,
      url: url.startsWith('http') ? url : 'https://' + url,
      favicon,
      isCustomTitle: false
    };
  }

  createContextMenu() {
    if (this.contextMenu) {
      this.contextMenu.remove();
    }

    this.contextMenu = document.createElement('div');
    this.contextMenu.className = 'bookmark-context-menu';
    this.contextMenu.style.display = 'none';
    document.body.appendChild(this.contextMenu);
  }

  showContextMenu(event, data) {
    this.hideContextMenu();
    this.currentTarget = data;

    const menuItems = [];

    if (data.type === 'bar') {
      menuItems.push(
        { text: 'Add bookmark', action: 'addBookmark' },
        { text: 'Paste URL', action: 'pasteUrl' },
        { separator: true },
        { text: 'Add new bar', action: 'addNewBar' },
        { separator: true },
        { text: 'Delete bar', action: 'deleteBar', className: 'delete-item' }
      );
    } else if (data.type === 'bookmark') {
      menuItems.push(
        { text: 'Open in new tab', action: 'openBookmarkNewTab' },
        { text: 'Open in new window', action: 'openBookmarkNewWindow' },
        { separator: true },
        { text: 'Edit name', action: 'editBookmark' },
        { text: 'Copy URL', action: 'copyUrl' },
        { separator: true },
        { text: 'Delete', action: 'deleteBookmark', className: 'delete-item' }
      );
    }

    // Build menu HTML
    this.contextMenu.innerHTML = menuItems.map(item => {
      if (item.separator) {
        return '<div class="menu-separator"></div>';
      }
      return `<div class="menu-item ${item.className || ''}" data-action="${item.action}">${item.text}</div>`;
    }).join('');

    // Position menu
    const x = Math.min(event.pageX, window.innerWidth - 200);
    const y = Math.min(event.pageY, window.innerHeight - 300);
    
    this.contextMenu.style.left = x + 'px';
    this.contextMenu.style.top = y + 'px';
    this.contextMenu.style.display = 'block';

    // Add event listeners
    this.contextMenu.querySelectorAll('.menu-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handleContextMenuAction(item.dataset.action);
        this.hideContextMenu();
      });
    });
  }

  hideContextMenu() {
    if (this.contextMenu) {
      this.contextMenu.style.display = 'none';
    }
  }

  async handleContextMenuAction(action) {
    const target = this.currentTarget;
    if (!target) return;

    switch (action) {
      case 'addBookmark':
        await this.addBookmark(target.barId);
        break;
      case 'pasteUrl':
        await this.pasteUrl(target.barId);
        break;
      case 'addNewBar':
        await this.addNewBar();
        break;
      case 'deleteBar':
        await this.removeBar(target.barId);
        break;
      case 'openBookmarkNewTab':
        window.open(target.bookmark.url, '_blank');
        break;
      case 'openBookmarkNewWindow':
        window.open(target.bookmark.url, '_blank', 'width=1200,height=800');
        break;
      case 'editBookmark':
        await this.editBookmarkTitle(target.barId, target.bookmark.id);
        break;
      case 'copyUrl':
        await this.copyToClipboard(target.bookmark.url);
        break;
      case 'deleteBookmark':
        await this.deleteBookmark(target.barId, target.bookmark.id);
        break;
    }
  }

  async copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    }
  }

  async pasteUrl(barId) {
    try {
      const text = await navigator.clipboard.readText();
      if (this.isValidUrl(text)) {
        const bookmark = await this.createBookmarkFromUrl(text);
        const barIndex = this.bars.findIndex(bar => bar.id === barId);
        if (barIndex !== -1) {
          this.bars[barIndex].bookmarks.push(bookmark);
          await this.saveConfiguration();
          this.createBookmarkBars();
        }
      } else {
        alert('Clipboard does not contain a valid URL');
      }
    } catch (err) {
      console.error('Failed to read from clipboard:', err);
      await this.addBookmark(barId);
    }
  }

  async editBookmarkTitle(barId, bookmarkId) {
    const barIndex = this.bars.findIndex(bar => bar.id === barId);
    if (barIndex === -1) return;

    const bookmarkIndex = this.bars[barIndex].bookmarks.findIndex(b => b.id === bookmarkId);
    if (bookmarkIndex === -1) return;

    const bookmark = this.bars[barIndex].bookmarks[bookmarkIndex];
    const newTitle = prompt('Enter bookmark name (leave blank for icon only):', bookmark.title);
    
    if (newTitle !== null) {
      bookmark.title = newTitle.trim();
      bookmark.isCustomTitle = true;
      await this.saveConfiguration();
      this.createBookmarkBars();
    }
  }

  async addBookmark(barId) {
    const url = prompt('Enter bookmark URL:', window.location.href);
    if (!url) return;

    if (!this.isValidUrl(url)) {
      alert('Please enter a valid URL (starting with http:// or https://)');
      return;
    }

    const bookmark = await this.createBookmarkFromUrl(url);
    
    const barIndex = this.bars.findIndex(bar => bar.id === barId);
    if (barIndex !== -1) {
      this.bars[barIndex].bookmarks.push(bookmark);
      await this.saveConfiguration();
      this.createBookmarkBars();
    }
  }

  async deleteBookmark(barId, bookmarkId) {
    if (confirm('Delete this bookmark?')) {
      const barIndex = this.bars.findIndex(bar => bar.id === barId);
      if (barIndex !== -1) {
        this.bars[barIndex].bookmarks = this.bars[barIndex].bookmarks.filter(
          bookmark => bookmark.id !== bookmarkId
        );
        await this.saveConfiguration();
        this.createBookmarkBars();
      }
    }
  }

  async addNewBar() {
    console.log('Adding new bar...');
    const newBar = {
      id: Date.now(),
      name: `Bar ${this.bars.length + 1}`,
      bookmarks: []
    };
    this.bars.push(newBar);
    console.log('New bar added:', newBar);
    await this.saveConfiguration();
    this.createBookmarkBars();
  }

  async removeBar(barId) {
    if (this.bars.length <= 1) {
      alert('You must have at least one bookmark bar');
      return;
    }

    if (confirm('Delete this bookmark bar and all its bookmarks?')) {
      this.bars = this.bars.filter(bar => bar.id !== barId);
      await this.saveConfiguration();
      this.createBookmarkBars();
    }
  }

  removeExtraBars() {
    const existing = document.getElementById('extra-bookmark-bars-container');
    if (existing) {
      existing.remove();
      document.body.style.paddingTop = '';
      
      // Reset any content margins we added
      const contentSelectors = ['main', '#content', '.main-content', '.ntp-content', '[data-module-id]'];
      contentSelectors.forEach(selector => {
        const element = document.querySelector(selector);
        if (element) {
          element.style.marginTop = '';
        }
      });
    }

    if (this.contextMenu) {
      this.contextMenu.remove();
      this.contextMenu = null;
    }
  }

  async saveConfiguration() {
    try {
      await chrome.storage.sync.set({
        extraBars: this.bars,
        isEnabled: this.isEnabled
      });
      console.log('Configuration saved');
    } catch (error) {
      console.error('Failed to save configuration:', error);
    }
  }

  async toggleExtension() {
    this.isEnabled = !this.isEnabled;
    await this.saveConfiguration();
    
    if (this.isEnabled) {
      this.createBookmarkBars();
    } else {
      this.removeExtraBars();
    }
  }

  // Handle messages from background script and popup
  async handleMessage(request) {
    console.log('Handling message:', request);
    
    switch (request.action) {
      case 'addCurrentPage':
        await this.addCurrentPageToBar();
        break;
      case 'addLinkToBar':
        await this.addLinkToAnyBar(request.url, request.title);
        break;
      case 'addNewBar':
        await this.addNewBar();
        break;
      case 'toggleExtension':
        await this.toggleExtension();
        break;
      case 'getStatus':
        return { isEnabled: this.isEnabled };
    }
    
    return { success: true };
  }

  async addCurrentPageToBar() {
    if (this.bars.length === 1) {
      const bookmark = await this.createBookmarkFromUrl(window.location.href, document.title);
      this.bars[0].bookmarks.push(bookmark);
      await this.saveConfiguration();
      this.createBookmarkBars();
    } else {
      const barNames = this.bars.map((bar, index) => `${index + 1}. ${bar.name}`).join('\n');
      const choice = prompt(`Choose a bar for "${document.title}":\n\n${barNames}\n\nEnter number:`);
      const barIndex = parseInt(choice) - 1;
      
      if (barIndex >= 0 && barIndex < this.bars.length) {
        const bookmark = await this.createBookmarkFromUrl(window.location.href, document.title);
        this.bars[barIndex].bookmarks.push(bookmark);
        await this.saveConfiguration();
        this.createBookmarkBars();
      }
    }
  }

  async addLinkToAnyBar(url, title) {
    if (this.bars.length === 1) {
      const bookmark = await this.createBookmarkFromUrl(url, title);
      this.bars[0].bookmarks.push(bookmark);
      await this.saveConfiguration();
      this.createBookmarkBars();
    } else {
      const barNames = this.bars.map((bar, index) => `${index + 1}. ${bar.name}`).join('\n');
      const choice = prompt(`Choose a bar for this link:\n\n${barNames}\n\nEnter number:`);
      const barIndex = parseInt(choice) - 1;
      
      if (barIndex >= 0 && barIndex < this.bars.length) {
        const bookmark = await this.createBookmarkFromUrl(url, title);
        this.bars[barIndex].bookmarks.push(bookmark);
        await this.saveConfiguration();
        this.createBookmarkBars();
      }
    }
  }
}

// Initialize the extension with error handling
let extraBookmarkBars;

// Listen for messages from popup and background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Content script received message:', request);
  
  if (!extraBookmarkBars) {
    console.log('Extension not initialized yet');
    sendResponse({ success: false, error: 'Extension not initialized' });
    return;
  }
  
  extraBookmarkBars.handleMessage(request)
    .then(result => {
      sendResponse(result || { success: true });
    })
    .catch(error => {
      console.error('Error handling message:', error);
      sendResponse({ success: false, error: error.message });
    });
  
  return true; // Keep message channel open for async response
});

// Initialize the extension
console.log('Starting Extra Bookmark Bars initialization...');
extraBookmarkBars = new ExtraBookmarkBars();