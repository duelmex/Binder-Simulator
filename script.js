// Define the current application version for import/export
const APP_VERSION = "1.0";
// Define the localStorage key for persistence
const LOCAL_STORAGE_KEY = 'pokemonBinderState';
const DARK_MODE_KEY = 'darkModeEnabled'; // New key for dark mode preference

// Helper to get DOM elements more concisely, converting kebab-case IDs to camelCase properties
const getElements = (ids) => ids.reduce((acc, id) => {
    // Convert kebab-case ID to camelCase property name (e.g., 'dark-mode-toggle' -> 'darkModeToggle')
    const camelCaseId = id.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
    const element = document.getElementById(id);
    if (!element) {
        console.error(`DOM element with ID '${id}' not found!`);
    }
    acc[camelCaseId] = element;
    return acc;
}, {});

const dom = getElements([
    'layout-controls',
    'binder-container',
    'card-slots-grid',
    'empty-binder-message',
    'clear-all-button',
    'prev-page-button',
    'next-page-button',
    'page-indicator',
    'add-page-button',
    'export-binder-button',
    'import-binder-button',
    'import-file-input',
    'search-input',
    'search-results-dropdown',
    'draggable-card-preview',
    'draggable-card-preview-image',
    'layout-message',
    'add-next-button',
    'undo-button',
    'total-slots-input',
    'set-capacity-button',
    'cards-tracker',
    'hidden-canvas',
    'sort-by-hue-button',
    'sort-by-hue-column-button', // Added for column-wise sorting
    'loading-overlay',
    'loading-message',
    'loading-progress',
    'dark-mode-toggle',
    'import-pricecharting-button',
    'import-pricecharting-file-input',
    'cancel-import-button',
    'first-page-button',
    'last-page-button',
    'progress-bar',
    'progress-bar-container',
    'insert-highlight', // NEW: Added for the drag-and-drop highlight (now functionally unused for insert)
    'custom-modal', // Added for custom confirmation modal
    'modal-message',
    'modal-confirm-button',
    'modal-cancel-button'
]);

const hiddenContext = dom.hiddenCanvas ? dom.hiddenCanvas.getContext('2d') : null; // Check for existence before getting context

// Cache for hue values to avoid recalculating
const hueCache = new Map();

/**
 * Displays a temporary message on a button and reverts it after a duration.
 * @param {HTMLElement} buttonElement - The button element to display the message on.
 * @param {string} message - The temporary message to display.
 * @param {number} duration - The duration in milliseconds to display the message.
 */
function showTemporaryButtonMessage(buttonElement, message, duration) {
    if (!buttonElement) {
        console.warn('Attempted to show temporary message on a null buttonElement.');
        return;
    }
    const originalText = buttonElement.textContent;
    buttonElement.textContent = message;
    setTimeout(() => buttonElement.textContent = originalText, duration);
}

/**
 * Converts RGB to HSL.
 * Assumes r, g, and b are contained in the set [0, 255] and
 * returns h, s, and l in the set [0, 1].
 * From https://en.wikipedia.org/wiki/HSL_and_HSV#From_RGB
 * @param {number} r - Red component (0-255).
 * @param {number} g - Green component (0-255).
 * @param {number} b - Blue component (0-255).
 * @returns {number[]} HSL values [h, s, l] where h is in degrees [0-360].
 */
function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;

    if (max === min) {
        h = s = 0; // achromatic
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return [h * 360, s, l]; // Return hue in degrees [0-360]
}

/**
 * Custom modal for confirmations, replacing native confirm().
 * @param {string} message - The message to display in the modal.
 * @returns {Promise<boolean>} Resolves to true if confirmed, false if cancelled.
 */
function showCustomConfirm(message) {
    return new Promise((resolve) => {
        if (!dom.customModal || !dom.modalMessage || !dom.modalConfirmButton || !dom.modalCancelButton) {
            console.error("Custom modal elements not found, falling back to native confirm.");
            resolve(confirm(message)); // Fallback if elements are missing
            return;
        }

        dom.modalMessage.textContent = message;
        dom.customModal.classList.add('active'); // Show modal

        const onConfirm = () => {
            dom.customModal.classList.remove('active');
            dom.modalConfirmButton.removeEventListener('click', onConfirm);
            dom.modalCancelButton.removeEventListener('click', onCancel);
            resolve(true);
        };

        const onCancel = () => {
            dom.customModal.classList.remove('active');
            dom.modalConfirmButton.removeEventListener('click', onConfirm);
            dom.modalCancelButton.removeEventListener('click', onCancel);
            resolve(false);
        };

        dom.modalConfirmButton.addEventListener('click', onConfirm);
        dom.modalCancelButton.addEventListener('click', onCancel);
    });
}

/**
 * Class to manage the state and logic of the trading card binder.
 * Encapsulates all binder-related data and operations.
 */
class Binder {
    constructor() {
        console.log('Binder constructor called (synchronous part).');
        this.cardsData = []; // Stores Objects: {imageUrl: string, name: string, setName: string, cardNumber: string, hue: number | null, isDirectImage: boolean} (can contain nulls for empty slots)
        this.selectedLayout = null; // Default to no layout selected
        this.cardsPerPage = 0; // No cards per page until layout is selected
        this.currentPage = 1;    // Current page number (1-indexed)
        this.currentDragOverSlot = null; // To track which slot is currently being hovered over for highlighting
        this.currentDraggedCardGlobalIndex = -1; // To store the index of the card being dragged from a binder slot
        this.searchTimeout = null; // For debouncing the search input
        this.selectedCardForAdd = null; // Stores the card object selected from search for "Add Next" button (also used for copy/paste)
        this.currentSearchRequestId = 0; // New: To prevent out-of-order search results

        this.history = []; // Stores snapshots of binder state for undo/redo
        this.historyPointer = -1; // Points to the current state in history
        this.MAX_HISTORY_SIZE = 20; // Limit history size to prevent excessive memory usage
        this.cancelImportFlag = false; // New flag to control import cancellation
        this.bulkImportActive = false; // New flag to indicate a bulk import is active

        this.pageTurnTimer = null; // For automatic page turning during drag
        this.lastPageTurnedTo = -1; // To prevent immediate re-triggering of page turn on same page
        
        // Touch drag-and-drop variables for the preview image
        this.isTouchDraggingPreview = false;
        this.touchDragOffsetX = 0;
        this.touchDragOffsetY = 0;
        this.touchListenersAdded = false; // Flag to track if touch listeners are attached to the preview
    }

    /**
     * Asynchronous initialization method for the Binder.
     * This separates async operations from the synchronous constructor.
     */
    async init() {
        console.log('Binder init() method called (asynchronous setup).');
        await this.loadBinderState(); // Await the loading of state from localStorage

        // Explicitly disable search input at startup
        if (dom.searchInput) {
            dom.searchInput.disabled = true;
            console.log('Search input initially disabled.');
        }

        // If no layout was loaded from localStorage or if it was invalid, automatically select the first one.
        if (this.selectedLayout === null || this.cardsPerPage === 0) {
            const defaultRadio = document.querySelector('input[name="gridSize"]');
            if (defaultRadio) {
                // Ensure the first radio button is checked in the DOM
                if (!document.querySelector('input[name="gridSize"]:checked')) {
                    defaultRadio.checked = true;
                }
                this.selectedLayout = parseInt(defaultRadio.value);
                this.cardsPerPage = this.selectedLayout * this.selectedLayout;
                console.log("No layout loaded from storage or invalid, defaulting to first available layout:", this.selectedLayout);
                this.hideInitialMessage(); // Hide initial message as a layout is now active
            } else {
                console.warn("No layout radio buttons found in HTML. Please ensure layout controls are present.");
                this.showInitialMessage(); // Keep showing message if no layout options are available at all
            }
        }

        // Ensure the totalSlotsInput is updated to reflect the loaded cardsData.length
        if (dom.totalSlotsInput) dom.totalSlotsInput.value = this.cardsData.length;
        
        // This is safe to call now that all methods including updateActionButtonsState are defined
        this.saveStateToHistory(); 

        this.initLayoutControls(); // Initializes event listeners for layout radio buttons
        this.renderCurrentPage(); // Render initial state (either loaded or default)
        this.updateActionButtonsState(); // Call after initLayoutControls to ensure elements are ready
        this.updatePaginationButtonsState();
        this.updateTrackerDisplay(); // Initial tracker display
        this.loadDarkModePreference(); // Load dark mode preference on initialization
        
        // Debugging for insert-highlight
        console.log('Highlight Debug: dom.insertHighlight after init:', dom.insertHighlight);

        console.log('Binder init() method complete.');
    }

    /**
     * Calculates the average hue of an image, using a cache.
     * @param {string} imageUrl - The URL of the image.
     * @returns {Promise<number|null>} A promise that resolves with the hue (0-360) or null if error.
     */
    async calculateAverageHue(imageUrl) {
        if (hueCache.has(imageUrl)) return hueCache.get(imageUrl);
        if (!dom.hiddenCanvas || !hiddenContext) {
            console.error("Hidden canvas or context not available for hue calculation.");
            return null;
        }

        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = "Anonymous";
            img.src = `https://corsproxy.io/?${encodeURIComponent(imageUrl)}`;

            const handleResult = (hue) => {
                hueCache.set(imageUrl, hue);
                resolve(hue);
            };

            img.onload = () => {
                try {
                    const maxWidth = 100, maxHeight = 140;
                    let { naturalWidth: width, naturalHeight: height } = img;

                    if (width > height) { if (width > maxWidth) { height *= maxWidth / width; width = maxWidth; } }
                    else { if (height > maxHeight) { width *= maxHeight / height; height = maxHeight; } }

                    dom.hiddenCanvas.width = width;
                    dom.hiddenCanvas.height = height;
                    hiddenContext.clearRect(0, 0, dom.hiddenCanvas.width, dom.hiddenCanvas.height);
                    hiddenContext.drawImage(img, 0, 0, width, height);

                    const imageData = hiddenContext.getImageData(0, 0, dom.hiddenCanvas.width, dom.hiddenCanvas.height);
                    const data = imageData.data;
                    let rSum = 0, gSum = 0, bSum = 0, count = 0;
                    const step = Math.max(1, Math.floor((width * height) / 1000));

                    for (let i = 0; i < data.length; i += 4 * step) {
                        rSum += data[i]; gSum += data[i + 1]; bSum += data[i + 2];
                        count++;
                    }

                    handleResult(count > 0 ? rgbToHsl(rSum / count, gSum / count, bSum / count)[0] : null);
                } catch (e) {
                    console.error("Error processing image for hue calculation:", e, "URL:", imageUrl);
                    handleResult(null);
                }
            };
            img.onerror = () => {
                console.error("Failed to load image for hue calculation, potential CORS issue or bad URL:", imageUrl);
                handleResult(null);
            };
        });
    }

    /**
     * Toggles dark mode on/off and saves the preference.
     */
    toggleDarkMode() {
        document.body.classList.toggle('dark-mode');
        const isDarkMode = document.body.classList.contains('dark-mode');
        localStorage.setItem(DARK_MODE_KEY, isDarkMode);
        if (dom.darkModeToggle) dom.darkModeToggle.textContent = isDarkMode ? 'Light Mode' : 'Dark Mode';
    }

    /**
     * Loads dark mode preference from localStorage and applies it.
     */
    loadDarkModePreference() {
        const savedPreference = localStorage.getItem(DARK_MODE_KEY);
        const isDarkMode = savedPreference === 'true';
        document.body.classList.toggle('dark-mode', isDarkMode);
        if (dom.darkModeToggle) dom.darkModeToggle.textContent = isDarkMode ? 'Light Mode' : 'Dark Mode';
    }

    /**
     * Updates the card tracker display (e.g., "Cards: 5 / 9 slots used").
     */
    updateTrackerDisplay() {
        const nonNullCardsCount = this.cardsData.filter(card => card !== null).length;
        const totalSlots = this.cardsData.length;
        if (dom.cardsTracker) dom.cardsTracker.textContent = `Cards: ${nonNullCardsCount} / ${totalSlots} slots used`;
        if (dom.totalSlotsInput) dom.totalSlotsInput.value = totalSlots;
    }

    /**
     * Saves the current application state (cardsData, layout, page) to the history array.
     * This method should be called after any action that modifies the binder's content or layout.
     */
    saveStateToHistory() {
        if (this.historyPointer < this.history.length - 1) {
            this.history = this.history.slice(0, this.historyPointer + 1);
        }

        this.history.push({
            cardsData: this.cardsData.map(card => card ? { ...card } : null),
            selectedLayout: this.selectedLayout,
            currentPage: this.currentPage
        });

        if (this.history.length > this.MAX_HISTORY_SIZE) {
            this.history.shift();
        } else {
            this.historyPointer++;
        }
        this.updateActionButtonsState(); 
    }

    /**
     * Undoes the last action by reverting to the previous state in history.
     */
    undoLastAction() {
        if (this.historyPointer > 0) {
            this.historyPointer--;
            const prevState = this.history[this.historyPointer];

            this.cardsData = prevState.cardsData.map(card => card ? { ...card } : null);
            this.selectedLayout = prevState.selectedLayout;
            this.currentPage = prevState.currentPage;

            const layoutRadio = document.querySelector(`input[name="gridSize"]:checked`);
            if (layoutRadio && parseInt(layoutRadio.value) !== this.selectedLayout) {
                 // Only change if a different layout was in history
                document.querySelector(`input[name="gridSize"][value="${this.selectedLayout}"]`).checked = true;
                this.cardsPerPage = this.selectedLayout * this.selectedLayout;
            } else if (!layoutRadio && this.selectedLayout !== null) {
                // If no layout was checked but history has one, check it
                document.querySelector(`input[name="gridSize"][value="${this.selectedLayout}"]`).checked = true;
                this.cardsPerPage = this.selectedLayout * this.selectedLayout;
            }


            this.renderCurrentPage();
            this.saveBinderState();
            this.saveStateToHistory();
            this.updateTrackerDisplay();
        }
    }

    /**
     * Helper function to check if a URL is likely a direct image URL (by extension or data URL prefix).
     * @param {string} url - The URL to check.
     * @returns {boolean} True if the URL is likely a direct image, false otherwise.
     */
    isLikelyImageUrl(url) {
        const imageExtensions = /\.(jpeg|jpg|png|gif|webp|svg)(\?.*)?$/i;
        return url.startsWith('data:') || imageExtensions.test(url);
    }

    /**
     * Shows the initial message to select a binder layout.
     */
    showInitialMessage() {
        if (dom.layoutMessage) {
            dom.layoutMessage.textContent = 'Please select a binder layout to begin!';
            dom.layoutMessage.style.display = 'block';
        }
    }

    /**
     * Hides the initial message.
     */
    hideInitialMessage() {
        if (dom.layoutMessage) dom.layoutMessage.style.display = 'none';
    }

    /**
     * Shows the global loading overlay.
     * @param {string} message - The main message to display.
     * @param {number|null} progress - Optional progress percentage (0-100).
     */
    showLoading(message = "Processing...", progress = null) {
        if (!dom.loadingOverlay) return;
        if (dom.loadingMessage) dom.loadingMessage.textContent = message;
        if (dom.loadingProgress) dom.loadingProgress.textContent = progress !== null ? `${Math.round(progress)}%` : '';
        dom.loadingOverlay.classList.add('active');
        if (dom.progressBarContainer) dom.progressBarContainer.style.display = progress !== null ? 'block' : 'none';
        if (dom.progressBar) dom.progressBar.style.width = progress !== null ? `${progress}%` : '0%';
    }

    /**
     * Hides the global loading overlay.
     */
    hideLoading() {
        if (!dom.loadingOverlay) return;
        dom.loadingOverlay.classList.remove('active');
        if (dom.cancelImportButton) dom.cancelImportButton.style.display = 'none';
        if (dom.loadingProgress) dom.loadingProgress.textContent = '';
        if (dom.progressBarContainer) dom.progressBarContainer.style.display = 'none';
        if (dom.progressBar) dom.progressBar.style.width = '0%';
    }

    /**
     * Initializes event listeners for layout radio buttons.
     */
    initLayoutControls() {
        console.log('initLayoutControls called. dom.layoutControls:', dom.layoutControls);
        if (dom.layoutControls) {
            dom.layoutControls.addEventListener('change', () => this.handleLayoutChange());
        }
    }

    /**
     * Handles changes in the layout radio buttons.
     * Updates the selected layout, recalculates cards per page, and re-renders from page 1.
     */
    handleLayoutChange() {
        console.log('handleLayoutChange called.');
        const checkedRadio = document.querySelector('input[name="gridSize"]:checked');
        if (!checkedRadio) {
            console.warn('No layout radio button checked.');
            return;
        }

        this.selectedLayout = parseInt(checkedRadio.value);
        this.cardsPerPage = this.selectedLayout * this.selectedLayout;
        this.currentPage = 1;

        if (this.cardsData.length === 0) {
            this.cardsData = new Array(this.cardsPerPage).fill(null);
        } else if (this.cardsData.length % this.cardsPerPage !== 0) {
            const currentLength = this.cardsData.length;
            const newAlignedLength = Math.ceil(currentLength / this.cardsPerPage) * this.cardsPerPage;
            this.cardsData.length = newAlignedLength; // Resize array and fill new part with undefined
            this.cardsData.fill(null, currentLength); // Explicitly fill with nulls
        }
        this.hideInitialMessage();

        this.renderCurrentPage();
        this.saveBinderState();
        this.saveStateToHistory();
        this.updateTrackerDisplay();
        this.updateActionButtonsState(); // Ensure this is called to enable search input
        console.log('Layout changed to:', this.selectedLayout);
    }

    /**
     * Calculates the total number of pages based on the current capacity (including nulls).
     * @returns {number} The total number of pages (minimum 1).
     */
    calculateTotalPages() {
        if (!this.selectedLayout || this.cardsPerPage === 0 || this.cardsData.length === 0) return 1;
        return Math.max(1, Math.ceil(this.cardsData.length / this.cardsPerPage));
    }

    /**
     * Renders the current page of cards in the binder.
     */
    renderCurrentPage() {
        if (this.selectedLayout === null) {
            this.showInitialMessage();
            this.updatePaginationButtonsState();
            this.updateActionButtonsState();
            if (dom.cardSlotsGrid) dom.cardSlotsGrid.style.display = 'none';
            if (dom.emptyBinderMessage) dom.emptyBinderMessage.style.display = 'none';
            return;
        }

        this.hideInitialMessage();
        const fragment = document.createDocumentFragment();
        if (dom.cardSlotsGrid) dom.cardSlotsGrid.style.gridTemplateColumns = `repeat(${this.selectedLayout}, 1fr)`;

        const startIndex = (this.currentPage - 1) * this.cardsPerPage;
        const nonNullCardsCount = this.cardsData.filter(card => card !== null).length;

        if (dom.emptyBinderMessage) dom.emptyBinderMessage.style.display = (nonNullCardsCount === 0 && this.cardsData.length === 0) ? 'block' : 'none';
        if (dom.cardSlotsGrid) dom.cardSlotsGrid.style.display = 'grid';

        const endIndex = Math.min(startIndex + this.cardsPerPage, this.cardsData.length);
        for (let i = startIndex; i < endIndex; i++) {
            const slot = document.createElement('div');
            slot.classList.add('card-slot');
            const globalCardIndex = i;

            if (this.cardsData[globalCardIndex]) {
                const card = this.cardsData[globalCardIndex];
                const altText = card.name || 'Unknown';
                const titleText = `${card.name || 'Unknown Card'}${card.setName ? ` (${card.setName})` : ''}${card.cardNumber ? ` #${card.cardNumber}` : ''}`;

                if (card.isDirectImage) {
                    const img = document.createElement('img');
                    img.src = card.imageUrl;
                    img.alt = altText;
                    img.title = titleText;
                    img.draggable = true;
                    img.dataset.globalIndex = globalCardIndex;
                    img.classList.add('fade-in');
                    img.onload = () => setTimeout(() => img.classList.remove('fade-in'), 50);
                    img.onerror = () => {
                        img.src = "https://placehold.co/150x210/cccccc/333333?text=Broken+Image";
                        img.style.objectFit = "contain";
                        console.error("Broken image link detected:", card.imageUrl);
                    };
                    slot.appendChild(img);
                } else {
                    const textDiv = document.createElement('div');
                    textDiv.classList.add('card-placeholder-text');
                    let placeholderText = `Card: ${card.name}`;
                    if (card.setName && card.setName !== 'N/A') placeholderText += `<br>Set: ${card.setName}`;
                    if (card.cardNumber) placeholderText += `<br>No.: ${card.cardNumber}`;
                    placeholderText += `<br>(No Image Found)`;
                    textDiv.innerHTML = placeholderText;
                    textDiv.title = `Original CSV Entry: ${card.name} (${card.setName}) #${card.cardNumber}`;
                    slot.appendChild(textDiv);
                }
                slot.classList.add('has-image');

                const deleteButton = document.createElement('button');
                deleteButton.classList.add('delete-card-button');
                deleteButton.textContent = 'X';
                deleteButton.dataset.cardIndex = globalCardIndex;
                slot.appendChild(deleteButton);
            }
            fragment.appendChild(slot);
        }
        if (dom.cardSlotsGrid) {
            dom.cardSlotsGrid.innerHTML = '';
            dom.cardSlotsGrid.appendChild(fragment);
            // Re-append the highlight element as innerHTML clears it
            if (dom.insertHighlight) {
                dom.cardSlotsGrid.appendChild(dom.insertHighlight);
            }
        }

        this.updatePaginationButtonsState();
        this.updateActionButtonsState();
        this.updateTrackerDisplay();
    }

    /**
     * Sets the total allocated capacity of the binder.
     * @param {number} inputCapacity - The desired total number of slots.
     */
    async setBinderTotalCapacity(inputCapacity) {
        if (this.selectedLayout === null) {
            showTemporaryButtonMessage(dom.setCapacityButton, 'Select Layout First!', 1500);
            return;
        }

        let newTargetCapacity = parseInt(inputCapacity);
        if (isNaN(newTargetCapacity) || newTargetCapacity < 0) {
            showTemporaryButtonMessage(dom.setCapacityButton, 'Invalid Number!', 1500);
            return;
        }

        // Round up to the nearest multiple of cardsPerPage
        newTargetCapacity = Math.ceil(newTargetCapacity / this.cardsPerPage) * this.cardsPerPage;

        const currentNonNullCards = this.cardsData.filter(card => card !== null).length;

        if (newTargetCapacity < currentNonNullCards) {
            const confirmed = await showCustomConfirm(`Reducing capacity to ${newTargetCapacity} will remove some cards from your binder. Are you sure?`);
            if (!confirmed) {
                if (dom.totalSlotsInput) dom.totalSlotsInput.value = this.cardsData.length;
                return;
            }
            const retainedCards = this.cardsData.filter(card => card !== null).slice(0, newTargetCapacity);
            this.cardsData = new Array(newTargetCapacity).fill(null);
            retainedCards.forEach((card, index) => this.cardsData[index] = card);
            console.warn(`Capacity reduced. Some cards might have been removed.`);
        } else {
            // Expand or shrink non-destructively
            this.cardsData.length = newTargetCapacity;
            this.cardsData.fill(null, currentNonNullCards); // Fill new slots with nulls
        }

        // Ensure current page is still valid after capacity change
        const totalPagesAfterResize = this.calculateTotalPages();
        this.currentPage = Math.max(1, Math.min(this.currentPage, totalPagesAfterResize));
        
        this.renderCurrentPage();
        this.saveBinderState();
        this.saveStateToHistory();
        showTemporaryButtonMessage(dom.setCapacityButton, 'Capacity Updated!', 1500);
        this.updateTrackerDisplay();
    }

    /**
     * Handles deleting a specific card.
     * @param {number} cardIndexToDelete - The global index of the card to delete.
     */
    handleDeleteCard(cardIndexToDelete) {
        const slotElement = dom.cardSlotsGrid.children[cardIndexToDelete % this.cardsPerPage];
        const imgElement = slotElement ? slotElement.querySelector('img') : null;

        const performDeletion = () => {
            if (cardIndexToDelete >= 0 && cardIndexToDelete < this.cardsData.length) {
                this.cardsData[cardIndexToDelete] = null;
            }
            const nonNullCardsCount = this.cardsData.filter(card => card !== null).length;
            const totalPages = this.calculateTotalPages();

            if (nonNullCardsCount === 0 && this.cardsData.length === 0) {
                this.cardsData = [];
                this.currentPage = 1;
            } else if (this.currentPage > totalPages) {
                this.currentPage = totalPages;
            } else {
                const cardsOnCurrentPage = this.cardsData.slice((this.currentPage - 1) * this.cardsPerPage, this.currentPage * this.cardsPerPage)
                                                    .filter(card => card !== null).length;
                if (cardsOnCurrentPage === 0 && this.currentPage > 1) {
                    this.currentPage--;
                }
            }
            this.renderCurrentPage();
            this.saveBinderState();
            this.saveStateToHistory();
            this.updateTrackerDisplay();
        };

        if (imgElement) {
            imgElement.classList.add('fade-out');
            imgElement.addEventListener('transitionend', () => {
                if (imgElement.classList.contains('fade-out')) {
                    performDeletion();
                }
            }, { once: true });
        } else {
            performDeletion();
        }
    }

    /**
     * Adds a card object to the cardsData array at a specific index or next empty slot.
     * Handles hue calculation and array integrity.
     * @param {string} imageUrl - The URL of the image.
     * @param {string} cardName - The name of the card.
     * @param {string} setName - The name of the card's set.
     * @param {string} cardNumber - The card's number within its set.
     * @param {boolean} isDirectImage - True if this URL directly points to an image file.
     * @param {number} [targetIndex] - The global index to place the image. If undefined, finds next empty slot or appends.
     * @param {boolean} [suppressRendering=false] - If true, this function won't call renderCurrentPage and saveState.
     * @returns {Promise<boolean>} True if successful, false otherwise.
     */
    async addCardToBinder(imageUrl, cardName, setName, cardNumber, isDirectImage, targetIndex, suppressRendering = false) {
        if (this.selectedLayout === null) {
            console.warn("Cannot add card: No binder layout selected.");
            return false;
        }

        if (!suppressRendering && !this.bulkImportActive) this.showLoading();
        let hue = null;

        try {
            if (imageUrl && isDirectImage) {
                hue = await this.calculateAverageHue(imageUrl);
            }
        } finally {
            if (!suppressRendering && !this.bulkImportActive) this.hideLoading();
        }

        const cardObject = { imageUrl, name: cardName, setName, cardNumber, hue, isDirectImage };

        let actualTargetIndex = targetIndex;
        // If no targetIndex is provided (e.g., "Add to Next Empty Slot" button or drop on general binder background),
        // find the next empty spot or append.
        if (actualTargetIndex === undefined || actualTargetIndex === -1) {
            let firstEmptyIndex = this.cardsData.indexOf(null);
            actualTargetIndex = (firstEmptyIndex !== -1) ? firstEmptyIndex : this.cardsData.length;
        }

        // Ensure array is large enough to set at actualTargetIndex
        const oldLength = this.cardsData.length;
        const minLengthForTarget = actualTargetIndex + 1;
        if (this.cardsData.length < minLengthForTarget) {
            this.cardsData.length = minLengthForTarget;
            // Now, fill only the NEWLY CREATED part with nulls
            this.cardsData.fill(null, oldLength);
        }

        // Always place/replace at the actualTargetIndex.
        this.cardsData[actualTargetIndex] = cardObject;

        // After adding, ensure overall array length is a multiple of cardsPerPage
        const currentLength = this.cardsData.length;
        if (currentLength % this.cardsPerPage !== 0) {
            const newAlignedLength = Math.ceil(currentLength / this.cardsPerPage) * this.cardsPerPage;
            // If the array grew beyond a page boundary, ensure it's expanded to the next full page
            if (newAlignedLength > currentLength) { 
                 this.cardsData.length = newAlignedLength;
                 this.cardsData.fill(null, currentLength); // Fill new space with nulls
            } else if (newAlignedLength < currentLength) {
                // This case ideally shouldn't happen with this logic, but as a safeguard, trim it.
                this.cardsData.length = newAlignedLength;
            }
        }


        // Adjust current page to show the added card's new location if needed
        this.currentPage = Math.floor(actualTargetIndex / this.cardsPerPage) + 1;
        const totalPages = this.calculateTotalPages();
        if (this.currentPage > totalPages) this.currentPage = totalPages;


        if (!suppressRendering) {
            this.renderCurrentPage();
            this.saveBinderState();
            this.saveStateToHistory();
            this.updateTrackerDisplay();
        }
        return true;
    }

    /**
     * Handles the dragstart event when dragging an image from a card slot.
     * Stores the global index of the dragged card.
     * @param {DragEvent} e - The drag event.
     */
    handleCardMoveDragStart(e) {
        if (e.target.tagName === 'IMG' && e.target.closest('.card-slot')) {
            const globalIndex = e.target.dataset.globalIndex;
            e.dataTransfer.setData('text/x-card-move-index', globalIndex);
            e.dataTransfer.effectAllowed = 'move';
            this.currentDraggedCardGlobalIndex = parseInt(globalIndex);
            e.target.classList.add('dragging');
        }
    }

    /**
     * Handles the dragend event for internal card moves.
     * Cleans up the 'dragging' class.
     * @param {DragEvent} e - The dragend event.
     */
    handleCardMoveDragEnd(e) {
        if (e.target) e.target.classList.remove('dragging'); // Ensure target exists
        // Clear page turn timer and tracking when drag ends
        clearTimeout(this.pageTurnTimer);
        this.pageTurnTimer = null;
        this.lastPageTurnedTo = -1;
        this.hideInsertHighlight(); // Hide highlight on drag end
        // Also remove the is-drop-target class from any active slot
        const activeTargetSlot = document.querySelector('.card-slot.is-drop-target');
        if (activeTargetSlot) {
            activeTargetSlot.classList.remove('is-drop-target');
        }
    }

    /**
     * Handles the drop event, processing the dropped files or URLs or moving existing cards.
     * @param {DragEvent} e - The drop event.
     */
    async handleDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        if (dom.binderContainer) dom.binderContainer.classList.remove('highlight');
        // Clear page turn timer on drop
        clearTimeout(this.pageTurnTimer);
        this.pageTurnTimer = null;
        this.lastPageTurnedTo = -1;
        this.hideInsertHighlight(); // Hide highlight on drop

        // Also remove the is-drop-target class from any active slot
        const activeTargetSlot = document.querySelector('.card-slot.is-drop-target');
        if (activeTargetSlot) {
            activeTargetSlot.classList.remove('is-drop-target');
        }

        if (this.selectedLayout === null) {
            console.warn("Cannot drop card: No binder layout selected.");
            return;
        }

        const cardIndexToMove = e.dataTransfer.getData('text/x-card-move-index');

        if (cardIndexToMove) { // Internal move operation (SWAP)
            const sourceGlobalIndex = parseInt(cardIndexToMove);
            const targetSlotElement = e.target.closest('.card-slot');
            
            if (!targetSlotElement) {
                // If dropped outside any slot during an internal drag, just re-render to clear highlight
                this.currentDraggedCardGlobalIndex = -1;
                this.renderCurrentPage();
                return;
            }

            const localIndex = Array.from(dom.cardSlotsGrid.children).indexOf(targetSlotElement);
            const dropGlobalIndex = (this.currentPage - 1) * this.cardsPerPage + localIndex;
            
            // If dropping on the same exact slot, do nothing
            if (sourceGlobalIndex === dropGlobalIndex) {
                this.currentDraggedCardGlobalIndex = -1;
                this.renderCurrentPage();
                return;
            }

            // Get the card object from its original position
            const cardToMove = this.cardsData[sourceGlobalIndex];
            const targetCard = this.cardsData[dropGlobalIndex];
            
            // Perform the swap
            this.cardsData[dropGlobalIndex] = cardToMove;
            this.cardsData[sourceGlobalIndex] = targetCard;

            // No complex splice/re-padding needed for a direct swap of existing elements.
            // Adjust current page to show the moved card's new location if needed
            this.currentPage = Math.floor(dropGlobalIndex / this.cardsPerPage) + 1; // Go to target page
            const totalPages = this.calculateTotalPages();
            if (this.currentPage > totalPages) this.currentPage = totalPages;

            this.currentDraggedCardGlobalIndex = -1; // Reset dragged index
            this.renderCurrentPage();
            this.saveBinderState();
            this.saveStateToHistory();
            this.updateTrackerDisplay();
            return;
        }

        // External drop handling (from search results, file, URL)
        let cardData = null; // Object to hold {imageUrl, name, setName, cardNumber, isDirectImage}
        let dropGlobalIndex; // This will be the index where the card is placed or inserted

        const targetSlotElement = e.target.closest('.card-slot');
        if (targetSlotElement) {
            // Dropped directly on a card slot - replace or fill this specific slot
            const localIndex = Array.from(dom.cardSlotsGrid.children).indexOf(targetSlotElement);
            dropGlobalIndex = (this.currentPage - 1) * this.cardsPerPage + localIndex;
        } else {
            // Dropped on the binder-container but not a specific card slot - find next empty or append
            let firstEmptyIndex = this.cardsData.indexOf(null);
            dropGlobalIndex = firstEmptyIndex !== -1 ? firstEmptyIndex : this.cardsData.length;
        }


        // Try to parse from JSON (from search preview or copied card data)
        const droppedText = e.dataTransfer.getData('text/plain');
        if (droppedText) {
            try {
                const parsedData = JSON.parse(droppedText);
                if (parsedData?.imageUrl) {
                    cardData = { 
                        imageUrl: parsedData.imageUrl, 
                        name: parsedData.name || 'Dropped Card', 
                        setName: parsedData.setName || '', 
                        cardNumber: parsedData.cardNumber || '',
                        isDirectImage: this.isLikelyImageUrl(parsedData.imageUrl)
                    };
                }
            } catch (jsonError) {
                // Not JSON, check if it's a direct URL
                if (droppedText.startsWith('http://') || droppedText.startsWith('https://')) {
                    cardData = { 
                        imageUrl: droppedText, 
                        name: 'External URL', 
                        setName: '', 
                        cardNumber: '',
                        isDirectImage: this.isLikelyImageUrl(droppedText)
                    };
                }
            }
        }
        
        // If not from text, try from HTML (dragged image from browser)
        if (!cardData) {
            const html = e.dataTransfer.getData('text/html');
            if (html) {
                const imgElement = new DOMParser().parseFromString(html, 'text/html').querySelector('img');
                if (imgElement?.src) {
                    cardData = { 
                        imageUrl: imgElement.src, 
                        name: imgElement.alt || 'Dragged Image', 
                        setName: '', 
                        cardNumber: '',
                        isDirectImage: this.isLikelyImageUrl(imgElement.src)
                    };
                    // Further check for dataset.cardDataUrl from search preview
                    try {
                        const dataCardUrl = imgElement.dataset.cardDataUrl;
                        if (dataCardUrl) {
                            const parsedData = JSON.parse(dataCardUrl);
                            if (parsedData) {
                                cardData.name = parsedData.name || cardData.name;
                                cardData.setName = parsedData.setName || cardData.setName;
                                cardData.cardNumber = parsedData.cardNumber || cardData.cardNumber;
                            }
                        }
                    } catch (jsonParseError) {
                        console.warn("Failed to parse cardDataUrl from dragged HTML image:", jsonParseError);
                    }
                }
            }
        }

        // If not from HTML, try from files (local file drag)
        if (!cardData && e.dataTransfer.files.length > 0) {
            const droppedFile = e.dataTransfer.files[0];
            if (droppedFile.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = async (event) => {
                    await this.addCardToBinder(event.target.result, droppedFile.name || 'Local File', 'N/A', '', true, dropGlobalIndex);
                };
                reader.readAsDataURL(droppedFile);
                return; // Return here as async file read needs separate handling
            }
        }

        if (cardData) {
            await this.addCardToBinder(cardData.imageUrl, cardData.name, cardData.setName, cardData.cardNumber, cardData.isDirectImage, dropGlobalIndex);
        }
    }

    /**
     * Saves the current binder state to localStorage.
     */
    saveBinderState() {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
            cardsData: this.cardsData,
            selectedLayout: this.selectedLayout,
            currentPage: this.currentPage,
            appVersion: APP_VERSION
        }));
        console.log("Binder state saved.");
    }

    /**
     * Loads the binder state from localStorage.
     */
    async loadBinderState() {
        try {
            const savedState = localStorage.getItem(LOCAL_STORAGE_KEY);
            if (savedState) {
                const parsedState = JSON.parse(savedState);
                
                const skipHueRecalculation = parsedState.appVersion === APP_VERSION;
                console.log(`Loaded version: ${parsedState.appVersion || 'none'}, App version: ${APP_VERSION}, Skip hue recalculation: ${skipHueRecalculation}`);

                this.cardsData = [];
                this.showLoading("Loading saved state...", 0);
                
                const totalCardsToLoad = parsedState.cardsData.length;
                let loadedCount = 0;

                const promises = parsedState.cardsData.map(async (card) => {
                    if (this.cancelImportFlag) {
                        console.log("Loading cancelled by user during state loading.");
                        return Promise.reject(new Error("Loading cancelled"));
                    }
                    if (card && card.imageUrl) {
                        const isLikely = this.isLikelyImageUrl(card.imageUrl);
                        let newHue = card.hue;
                        let newIsDirectImage = isLikely;

                        if (skipHueRecalculation && card.hue !== undefined && card.hue !== null && card.isDirectImage !== undefined) {
                            newHue = card.hue;
                            newIsDirectImage = card.isDirectImage;
                        } else if (isLikely) {
                            newHue = await this.calculateAverageHue(card.imageUrl);
                            newIsDirectImage = true;
                        } else {
                            console.warn("Skipping hue calculation for loaded URL that does not look like a direct image or data URL:", card.imageUrl);
                            newHue = null;
                            newIsDirectImage = false;
                        }
                        
                        loadedCount++;
                        const progress = (loadedCount / totalCardsToLoad) * 100;
                        this.showLoading("Loading saved state...", progress);
                        return { ...card, hue: newHue, isDirectImage: newIsDirectImage }; 
                    }
                    loadedCount++;
                    const progress = (loadedCount / totalCardsToLoad) * 100;
                    this.showLoading("Loading saved state...", progress);
                    return null;
                });

                const results = await Promise.allSettled(promises);
                this.cardsData = results
                                .filter(result => result.status === 'fulfilled')
                                .map(result => result.value);
                
                if (this.cardsData.length === 0 && parsedState.cardsData.length > 0 && this.cancelImportFlag) {
                    console.log("Partial load due to cancellation. Cards data reset.");
                    this.cardsData = [];
                }

                if (typeof parsedState.selectedLayout === 'number') {
                    this.selectedLayout = parsedState.selectedLayout;
                    // Note: We don't explicitly set checked=true here, as the constructor's default logic handles it if needed
                    // and initLayoutControls will ensure it's synced.
                    this.cardsPerPage = this.selectedLayout * this.selectedLayout;
                }

                if (typeof parsedState.currentPage === 'number') {
                    this.currentPage = parsedState.currentPage;
                }
                
                if (this.selectedLayout !== null) {
                    const currentLength = this.cardsData.length;
                    if (currentLength % this.cardsPerPage !== 0) {
                        const newAlignedLength = Math.ceil(currentLength / this.cardsPerPage) * this.cardsPerPage;
                        this.cardsData.length = newAlignedLength;
                        this.cardsData.fill(null, currentLength);
                    }
                }

                if (this.selectedLayout !== null) {
                    this.hideInitialMessage();
                } else {
                    this.showInitialMessage();
                }
                this.updateTrackerDisplay();
                console.log("Binder state loaded from localStorage.");
            } else {
                console.log("No saved binder state found in localStorage.");
            }
        } catch (e) {
            console.error("Error loading binder state from localStorage, resetting:", e);
            localStorage.removeItem(LOCAL_STORAGE_KEY);
            this.cardsData = [];
            this.selectedLayout = null;
            this.currentPage = 1;
            this.showInitialMessage();
            this.updateTrackerDisplay();
        } finally {
            this.hideLoading();
            this.cancelImportFlag = false;
        }
    }

    /**
     * Sorts the cards in the binder by hue value in a row-major order.
     * Empty slots are maintained in their relative positions.
     */
    async sortCardsByHue() {
        console.log("Sorting by Hue (Rows) - BEFORE:", JSON.stringify(this.cardsData.map(c => c ? c.name || c.cardNumber : null)));

        if (!this.selectedLayout) {
            showTemporaryButtonMessage(dom.sortByHueButton, 'Select Layout First!', 1500);
            return;
        }

        const initialTotalSlots = this.cardsData.length;
        // Filter out nulls to get only the actual cards for sorting
        const cardsToProcess = this.cardsData.filter(card => card !== null); 

        if (cardsToProcess.length < 2) {
            showTemporaryButtonMessage(dom.sortByHueButton, 'Need 2+ Cards!', 1500);
            return;
        }
        
        this.showLoading("Calculating hues for sorting...", 0);
        if (dom.cancelImportButton) dom.cancelImportButton.style.display = 'none';

        // Calculate hues for cards if not already present
        let processedCount = 0;
        for (let i = 0; i < cardsToProcess.length; i++) {
            const cardItem = cardsToProcess[i];
            if (cardItem.hue === null && cardItem.isDirectImage) {
                try {
                    cardItem.hue = await this.calculateAverageHue(cardItem.imageUrl);
                } catch (e) {
                    console.error("Error calculating hue for sorting:", e);
                    cardItem.hue = null;
                }
            }
            processedCount++;
            this.showLoading("Calculating hues for sorting...", (processedCount / cardsToProcess.length) * 100);
            await new Promise(resolve => requestAnimationFrame(resolve));
        }
        this.hideLoading();

        // Sort only the actual cards by hue
        cardsToProcess.sort((a, b) => {
            if (a.hue === null && b.hue !== null) return 1;
            if (a.hue !== null && b.hue === null) return -1;
            if (a.hue === null && b.hue === null) return 0;
            return a.hue - b.hue;
        });

        const newCardsData = new Array(initialTotalSlots).fill(null); // Create a fresh array based on initial total slots
        
        // Place the sorted cards sequentially (row-major order in the linear array)
        cardsToProcess.forEach((card, index) => {
            if (index < initialTotalSlots) { // Ensure we don't write beyond original capacity
                newCardsData[index] = card;
            }
        });
        
        this.cardsData = newCardsData;
        this.currentPage = 1;
        this.renderCurrentPage();
        this.saveBinderState();
        this.saveStateToHistory();
        showTemporaryButtonMessage(dom.sortByHueButton, 'Sorted by Hue (Rows)!', 1500);
        console.log("Sorting by Hue (Rows) - AFTER:", JSON.stringify(this.cardsData.map(c => c ? c.name || c.cardNumber : null)));
    }

    /**
     * Sorts the cards in the binder by hue value, arranging them column by column.
     * Empty slots are maintained in their relative positions.
     */
    async sortCardsByHueColumnWise() {
        console.log("Sorting by Hue (Columns) - BEFORE:", JSON.stringify(this.cardsData.map(c => c ? c.name || c.cardNumber : null)));

        if (!this.selectedLayout) {
            showTemporaryButtonMessage(dom.sortByHueColumnButton, 'Select Layout First!', 1500);
            return;
        }

        const initialTotalSlots = this.cardsData.length;
        // Filter out nulls to get only the actual cards for sorting
        const cardsToProcess = this.cardsData.filter(card => card !== null); 

        if (cardsToProcess.length < 2) {
            showTemporaryButtonMessage(dom.sortByHueColumnButton, 'Need 2+ Cards!', 1500);
            return;
        }

        this.showLoading("Calculating hues for sorting...", 0);
        if (dom.cancelImportButton) dom.cancelImportButton.style.display = 'none';

        // Calculate hues for cards if not already present
        let processedCount = 0;
        for (let i = 0; i < cardsToProcess.length; i++) {
            const cardItem = cardsToProcess[i];
            if (cardItem.hue === null && cardItem.isDirectImage) {
                try {
                    cardItem.hue = await this.calculateAverageHue(cardItem.imageUrl);
                } catch (e) {
                    console.error("Error calculating hue for sorting:", e);
                    cardItem.hue = null;
                }
            }
            processedCount++;
            this.showLoading("Calculating hues for sorting...", (processedCount / cardsToProcess.length) * 100);
            await new Promise(resolve => requestAnimationFrame(resolve));
        }
        this.hideLoading();

        // Sort only the actual cards by hue
        cardsToProcess.sort((a, b) => {
            if (a.hue === null && b.hue !== null) return 1;
            if (a.hue !== null && b.hue === null) return -1;
            if (a.hue === null && b.hue === null) return 0;
            return a.hue - b.hue;
        });

        const numRows = this.selectedLayout;
        const numCols = this.selectedLayout; 
        const cardsPerPage = numRows * numCols;

        // Create a fresh array based on the original total slots, filled with nulls
        const newCardsData = new Array(initialTotalSlots).fill(null);
        
        // Iterate through the sorted cards and place each card at its correct column-major position
        for (let k = 0; k < cardsToProcess.length; k++) {
            const card = cardsToProcess[k]; // The k-th card in the hue-sorted list (0-indexed)

            // Determine its logical (column, row) position in the visual column-major grid on a single page
            const visual_col_on_page = Math.floor(k / numRows);
            const visual_row_on_page = k % numRows;

            // Determine which overall page this visual (col, row) falls into
            const page = Math.floor(visual_col_on_page / numCols);
            const actual_col_on_page_for_linear_array = visual_col_on_page % numCols;

            // Calculate the actual global linear index in the newCardsData array
            // This formula translates the (page, visual_row, actual_col_on_page) to a linear index
            // that results in column-major visual order when the grid is rendered row-major.
            const globalIndex = (page * cardsPerPage) + (visual_row_on_page * numCols) + actual_col_on_page_for_linear_array;

            if (globalIndex < initialTotalSlots) { // Ensure we don't write beyond original capacity
                newCardsData[globalIndex] = card;
            }
        }

        this.cardsData = newCardsData;
        this.currentPage = 1; // Go to first page after sorting
        this.renderCurrentPage();
        this.saveBinderState();
        this.saveStateToHistory();
        showTemporaryButtonMessage(dom.sortByHueColumnButton, 'Sorted by Hue (Columns)!', 1500);
        console.log("Sorting by Hue (Columns) - AFTER:", JSON.stringify(this.cardsData.map(c => c ? c.name || c.cardNumber : null)));
    }


    /**
     * Exports the current binder content as a JSON file.
     */
    exportBinder() {
        const nonNullCards = this.cardsData.filter(card => card !== null); 

        if (nonNullCards.length === 0) {
            showTemporaryButtonMessage(dom.exportBinderButton, 'Binder Empty!', 1500);
            return;
        }

        const binderContent = {
            version: APP_VERSION, 
            layout: this.selectedLayout,
            currentPage: this.currentPage, 
            cards: nonNullCards 
        };

        const jsonString = JSON.stringify(binderContent, null, 2); 
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `pokemon_binder_${new Date().toISOString().slice(0,10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url); 

        showTemporaryButtonMessage(dom.exportBinderButton, 'Exported!', 1500);
    }

    /**
     * Imports binder content from a selected JSON file.
     */
    async importBinder(file) {
        if (!file) {
            return;
        }

        if (file.type !== 'application/json') {
            showTemporaryButtonMessage(dom.importBinderButton, 'Not a JSON!', 2000);
            return;
        }

        this.showLoading("Importing binder...", 0);
        if (dom.cancelImportButton) dom.cancelImportButton.style.display = 'block';
        this.cancelImportFlag = false;

        await new Promise(resolve => setTimeout(resolve, 50));

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const importedData = JSON.parse(e.target.result);

                if (importedData && typeof importedData === 'object' &&
                    typeof importedData.layout === 'number' &&
                    Array.isArray(importedData.cards)) {
                    
                    const layoutRadio = document.querySelector(`input[name="gridSize"][value="${importedData.layout}"]`);
                    if (layoutRadio) {
                        layoutRadio.checked = true;
                    }
                    this.selectedLayout = importedData.layout;
                    this.cardsPerPage = this.selectedLayout * this.selectedLayout;
                    
                    if (typeof importedData.currentPage === 'number') {
                        this.currentPage = importedData.currentPage;
                    } else {
                        this.currentPage = 1; 
                    }

                    const skipHueRecalculation = importedData.version === APP_VERSION;

                    const tempCardsData = [];
                    const totalCardsToLoad = importedData.cards.length;
                    let loadedCount = 0;

                    for (const card of importedData.cards) {
                        if (this.cancelImportFlag) {
                            console.log("Import cancelled by user during JSON processing.");
                            break;
                        }
                        if (card && card.imageUrl) {
                            const isLikely = this.isLikelyImageUrl(card.imageUrl);
                            let newHue = card.hue;
                            let newIsDirectImage = isLikely;

                            if (skipHueRecalculation && card.hue !== undefined && card.hue !== null && card.isDirectImage !== undefined) {
                                newHue = card.hue;
                                newIsDirectImage = card.isDirectImage;
                            } else if (isLikely) {
                                newHue = await this.calculateAverageHue(card.imageUrl);
                                newIsDirectImage = true;
                            } else {
                                newHue = null;
                                newIsDirectImage = false;
                            }
                            tempCardsData.push({ ...card, hue: newHue, isDirectImage: newIsDirectImage });
                        } else {
                            tempCardsData.push(null);
                        }
                        loadedCount++;
                        const progress = (loadedCount / totalCardsToLoad) * 100;
                        this.showLoading(`Importing binder...`, progress);
                    }

                    this.cardsData = tempCardsData;

                    const currentLength = this.cardsData.length;
                    if (currentLength % this.cardsPerPage !== 0) {
                        const newAlignedLength = Math.ceil(currentLength / this.cardsPerPage) * this.cardsPerPage;
                        this.cardsData.length = newAlignedLength;
                        this.cardsData.fill(null, currentLength);
                    }

                    this.renderCurrentPage();
                    this.saveBinderState(); 
                    this.saveStateToHistory();

                    if (this.cancelImportFlag) {
                        showTemporaryButtonMessage(dom.importBinderButton, 'Import Cancelled!', 2000);
                    } else {
                        showTemporaryButtonMessage(dom.importBinderButton, 'Imported!', 1500);
                    }

                } else {
                    throw new Error('Invalid binder file format or missing data.');
                }
            }
            catch (error) {
                console.error("Error parsing imported binder file:", error);
                showTemporaryButtonMessage(dom.importBinderButton, 'Import Error!', 2000);
            }
            finally {
                this.hideLoading();
                this.cancelImportFlag = false;
            }
        };
        reader.readAsText(file);
        if (dom.importFileInput) dom.importFileInput.value = '';
    }

    /**
     * Searches for a card on pokemontcg.io and returns its details (image URL, name, set, number) and hue.
     * This function is intended for non-Japanese/Chinese cards.
     * @param {string} cardName - The card name from CSV.
     * @param {string} setName - The set name from CSV.
     * @param {string} cardNumber - The card's number within its set.
     * @returns {Promise<Object|null>} An object with card details and hue, or null if not found.
     */
    async searchPokemonTcgIoCardDetails(cardName, setName, cardNumber) {
        let cleanedCardName = cardName.replace(/#/g, '').trim();
        let cleanedSetName = setName.replace(/pokemon/gi, '').trim();

        const performSearchRequest = async (query) => { 
            await new Promise(resolve => setTimeout(resolve, 500)); // Increased delay to 500ms

            const apiUrl = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(query)}&pageSize=1`;
            try {
                const response = await fetch(apiUrl);
                if (!response.ok) {
                    console.error(`API search failed for query: "${query}" with status: ${response.status}`);
                    return null;
                }
                const data = await response.json();
                return data.data && data.data.length > 0 ? data.data[0] : null;
            } catch (error) {
                console.error(`Error fetching Pokémon card with query "${query}":`, error);
                return null;
            }
        };

        const furtherCleanSetName = (name) => {
            return name
                .replace(/base set|set|edition/i, '')
                .replace(/shadowless/i, '')
                .trim();
        };

        let query = `name:"${cleanedCardName}" set.name:"${cleanedSetName}"`;
        if (cardNumber) query += ` number:"${cardNumber}"`;
        let foundCard = await performSearchRequest(query);

        if (!foundCard && cleanedSetName) {
            const veryCleanedSet = furtherCleanSetName(cleanedSetName);
            if (veryCleanedSet !== cleanedSetName) {
                query = `name:"${cleanedCardName}" set.name:"${veryCleanedSet}"`;
                if (cardNumber) query += ` number:"${cardNumber}"`;
                foundCard = await performSearchRequest(query);
            }
        }
        
        if (!foundCard && cardNumber) {
            query = `name:"${cleanedCardName}" number:"${cardNumber}"`;
            foundCard = await performSearchRequest(query);
        }

        if (!foundCard && cleanedSetName) {
            query = `name:"${cleanedCardName}" set.name:"${cleanedSetName}"`;
            foundCard = await performSearchRequest(query);
        }

        if (!foundCard) {
            query = `name:"${cleanedCardName}"`;
            foundCard = await performSearchRequest(query);
        }

        if (foundCard) {
            const imageUrl = foundCard.images.large || foundCard.images.small;
            const hue = await this.calculateAverageHue(imageUrl);
            console.log(`Matched (via pokemontcg.io): ${cardName} (${setName}) -> ${foundCard.name}`);
            return {
                imageUrl: imageUrl,
                name: foundCard.name,
                setName: foundCard.set ? foundCard.set.name : '',
                cardNumber: foundCard.number,
                hue: hue
            };
        } else {
            return null;
        }
    }
    
    /**
     * Performs a search against the Pokémon TCG API (pokemontcg.io) for the global search bar.
     * @param {string} query The search query string.
     * @returns {Promise<Array<Object>>} An array of card objects found.
     */
    async performSearch(query) {
        const requestId = ++this.currentSearchRequestId; 
        const originalQuery = query.trim();

        if (originalQuery.length < 2) { 
            // Hide dropdown and return empty if query is too short
            if (dom.searchResultsDropdown) {
                dom.searchResultsDropdown.innerHTML = '';
                dom.searchResultsDropdown.style.display = 'none';
            }
            return [];
        }

        // Display "Searching..." message directly in the dropdown
        if (dom.searchResultsDropdown) {
            dom.searchResultsDropdown.innerHTML = '<div class="search-result-item loading-message">Searching...</div>';
            dom.searchResultsDropdown.style.display = 'block';
        }

        // Clean the query for API call: remove punctuation and replace multiple spaces with single space
        const cleanedQueryForApi = originalQuery.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "").replace(/\s{2,}/g, " ");

        try {
            // Use name:* wildcard for broader matching and increased page size
            const apiUrl = `https://api.pokemontcg.io/v2/cards?q=name:*${encodeURIComponent(cleanedQueryForApi)}*&pageSize=20`; 
            console.log(`[Global Search Debug] Fetching from: ${apiUrl} (Request ID: ${requestId})`);
            const response = await fetch(apiUrl);
            console.log(`[Global Search Debug] Fetch response received (Request ID: ${requestId}). Status: ${response.status}`);

            if (!response.ok) {
                console.error(`[Global Search Error] API search failed for query: "${query}" with status: ${response.status} (${response.statusText})`);
                return []; 
            }
            const data = await response.json();
            console.log(`[Global Search Debug] JSON parsed for global search (Request ID: ${requestId}). Data:`, data);

            // Only process if this is the latest request
            if (requestId === this.currentSearchRequestId) {
                console.log(`[Global Search Debug] Processing results for current request (${requestId}).`);
                if (data.data && data.data.length > 0) {
                    const resultsWithHue = await Promise.all(data.data.map(async card => {
                        const imageUrl = card.images.large || card.images.small;
                        const isDirect = this.isLikelyImageUrl(imageUrl);
                        let hue = null;
                        if (isDirect) {
                            hue = await this.calculateAverageHue(imageUrl);
                        }
                        return {
                            imageUrl: imageUrl,
                            name: card.name,
                            setName: card.set ? card.set.name : '',
                            cardNumber: card.number,
                            hue: hue,
                            isDirectImage: isDirect
                        };
                    }));
                    console.log(`[Global Search Debug] Hue calculation complete for request (${requestId}).`);
                    return resultsWithHue;
                } else {
                    console.log(`[Global Search Debug] No data found for request (${requestId}).`);
                    return [];
                }
            } else {
                console.log(`[Global Search] Ignoring old search request (${requestId}). Latest is ${this.currentSearchRequestId}`);
                return []; 
            }
        } catch (error) {
            console.error('[Global Search Error] Exception during search:', error, `(Request ID: ${requestId})`);
            // Display error message in the dropdown for network/fetch failures
            if (dom.searchResultsDropdown) {
                dom.searchResultsDropdown.innerHTML = '<div class="search-result-item no-results-message" style="color: red;">Error searching cards. Please try again.</div>';
                dom.searchResultsDropdown.style.display = 'block';
            }
            return []; 
        }
    }


    /**
     * Imports cards from a PriceCharting CSV file.
     * @param {File} file - The file input change event.
     */
    async importPriceChartingCSV(file) {
        if (!file) {
            showTemporaryButtonMessage(dom.importPriceChartingButton, 'No File Selected!', 1500);
            return;
        }

        if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
            showTemporaryButtonMessage(dom.importPriceChartingButton, 'Not a CSV!', 2000);
            return;
        }

        if (this.selectedLayout === null) {
            showTemporaryButtonMessage(dom.importPriceChartingButton, 'Select Layout First!', 1500);
            return;
        }

        this.bulkImportActive = true;
        this.showLoading("Parsing CSV...", 0);
        if (dom.cancelImportButton) dom.cancelImportButton.style.display = 'block';
        this.cancelImportFlag = false;

        await new Promise(resolve => setTimeout(resolve, 50));

        let successCount = 0;
        let failCount = 0;
        let processedCount = 0;

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const csvContent = e.target.result;
                const lines = csvContent.split('\n').filter(line => line.trim() !== '');

                if (lines.length < 2) {
                    showTemporaryButtonMessage(dom.importPriceChartingButton, 'Empty CSV!', 2000);
                    this.hideLoading();
                    return;
                }

                const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, '').replace(/-/g, '_'));
                const productNameIndex = headers.indexOf('product_name');
                const consoleNameIndex = headers.indexOf('console_name');
                const cardNumIndex = headers.indexOf('card_number');
                const gradeIndex = headers.indexOf('grade'); 

                if (productNameIndex === -1 || consoleNameIndex === -1) {
                    showTemporaryButtonMessage(dom.importPriceChartingButton, 'Missing "product-name" or "console-name" headers in CSV!', 3000);
                    this.hideLoading();
                    return;
                }

                const cardsToFetch = [];
                for (let i = 1; i < lines.length; i++) {
                    if (this.cancelImportFlag) { 
                        console.log("Import cancelled by user during CSV parsing.");
                        break;
                    }
                    const values = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(v => v.trim().replace(/"/g, ''));
                    
                    let fullProductName = values[productNameIndex] || '';
                    let setName = values[consoleNameIndex] || '';
                    let cardNumber = (cardNumIndex !== -1 && values[cardNumIndex]) ? values[cardNumIndex] : '';

                    let cardName = fullProductName;
                    let extractedSuffix = '';

                    const poundSignMatch = fullProductName.match(/#(.+)$/);
                    if (poundSignMatch) {
                        extractedSuffix = poundSignMatch[1].trim();
                        cardName = fullProductName.substring(0, poundSignMatch.index).trim();
                    }

                    if (extractedSuffix && (!cardNumber || (!/^\d+$/.test(cardNumber) && !/^\d+$/.test(extractedSuffix)))) {
                        cardNumber = extractedSuffix;
                    } else if (extractedSuffix && cardNumber && !cardNumber.includes(extractedSuffix)) {
                        cardNumber = `${cardNumber} ${extractedSuffix}`.trim();
                    }

                    if (cardName && setName) {
                        cardsToFetch.push({ cardName, setName, cardNumber, grade: (gradeIndex !== -1 && values[gradeIndex]) ? values[gradeIndex] : '' });
                    } else {
                        console.warn(`Skipping row due to missing name or set: ${lines[i]}`);
                    }
                }
                
                const totalCardsToProcess = cardsToFetch.length;
                const fetchedCards = []; // Store the fully processed card objects here

                for (const cardData of cardsToFetch) {
                    if (this.cancelImportFlag) {
                        console.log("Import interrupted by user during card fetching.");
                        break;
                    }
                    
                    this.showLoading(`Fetching card data... ${processedCount + 1}/${totalCardsToProcess}`, (processedCount / totalCardsToProcess) * 100);

                    // Check if the set name contains "Japanese"
                    if (cardData.setName.toLowerCase().includes('japanese')) {
                        console.log(`Skipping search for Japanese card: ${cardData.cardName} (${cardData.setName})`);
                        fetchedCards.push({
                            imageUrl: `https://placehold.co/150x210/cccccc/333333?text=Japanese+Card+Placeholder`,
                            name: cardData.cardName,
                            setName: cardData.setName,
                            cardNumber: cardData.cardNumber,
                            isDirectImage: false,
                            hue: null
                        });
                        failCount++;
                    } else {
                        // Always try to search via pokemontcg.io
                        const foundCardDetails = await this.searchPokemonTcgIoCardDetails(cardData.cardName, cardData.setName, cardData.cardNumber);
                        if (foundCardDetails) {
                            fetchedCards.push({ ...foundCardDetails, isDirectImage: true });
                            successCount++;
                        } else {
                            // Fallback to generic placeholder if not found
                            fetchedCards.push({
                                imageUrl: `https://placehold.co/150x210/cccccc/333333?text=Card+Not+Found`,
                                name: cardData.cardName,
                                setName: cardData.setName,
                                cardNumber: cardData.cardNumber,
                                isDirectImage: false,
                                hue: null
                            });
                            failCount++;
                        }
                    }
                    processedCount++;
                }

                // --- START OF REVISED CARD INTEGRATION LOGIC ---
                // 1. Get all currently non-null cards from the binder
                const currentNonNullCards = this.cardsData.filter(card => card !== null);

                // 2. Combine existing non-null cards with the newly fetched cards
                const combinedCards = currentNonNullCards.concat(fetchedCards);

                // 3. Calculate the new total number of slots needed, ensuring it's a multiple of cardsPerPage
                let newTotalSlots = combinedCards.length;
                if (newTotalSlots % this.cardsPerPage !== 0) {
                    newTotalSlots = Math.ceil(newTotalSlots / this.cardsPerPage) * this.cardsPerPage;
                }

                // 4. Create a completely new cardsData array of the correct size, filled with nulls
                const newCardsData = new Array(newTotalSlots).fill(null);

                // 5. Populate the new cardsData array with the combined cards
                combinedCards.forEach((card, index) => {
                    newCardsData[index] = card; // Place cards sequentially from the beginning
                });

                this.cardsData = newCardsData; // Overwrite the main cardsData array with the new, properly structured one
                // --- END OF REVISED CARD INTEGRATION LOGIC ---

                this.currentPage = 1; // Always go back to page 1 after a major import/rearrangement
                this.renderCurrentPage(); // Render only once at the end of bulk import
                this.saveBinderState();
                this.saveStateToHistory();
                
                if (this.cancelImportFlag) {
                    showTemporaryButtonMessage(dom.importPriceChartingButton, `Import Cancelled! (${successCount} added, ${failCount} placeholders)`, 4000);
                } else {
                    showTemporaryButtonMessage(dom.importPriceChartingButton, `Imported ${successCount} cards, ${failCount} placeholders!`, 3000);
                }


            } catch (error) {
                console.error("Error processing PriceCharting CSV:", error);
                showTemporaryButtonMessage(dom.importPriceChartingButton, 'CSV Processing Error!', 3000);
            } finally {
                this.bulkImportActive = false;
                this.hideLoading();
                if (dom.importPriceChartingFileInput) dom.importPriceChartingFileInput.value = '';
                this.cancelImportFlag = false;
            }
        };
        reader.readAsText(file);
    }

    /**
     * Renders search results in the dropdown.
     * @param {Array<Object>} results - Array of card objects.
     * @param {string} originalQuery - The original query text for highlighting.
     * @param {string} status - 'loading', 'no-results', 'error', or 'success'.
     */
    renderSearchResults(results, originalQuery, status) {
        if (!dom.searchResultsDropdown) {
            console.warn('Search results dropdown element not found.');
            return;
        }

        dom.searchResultsDropdown.innerHTML = ''; // Clear previous results
        dom.searchResultsDropdown.style.display = 'block'; // Always show dropdown if a message/results are to be displayed

        // Ensure the preview and add button are hidden initially for any status display
        if (dom.addNextButton) dom.addNextButton.style.display = 'none';
        this.selectedCardForAdd = null;
        if (dom.draggableCardPreview) dom.draggableCardPreview.style.display = 'none';
        if (dom.draggableCardPreviewImage) dom.draggableCardPreviewImage.src = '';
        if (dom.draggableCardPreviewImage) dom.draggableCardPreviewImage.style.display = 'none';

        if (status === 'loading') {
            dom.searchResultsDropdown.innerHTML = '<div class="search-result-item loading-message">Searching...</div>';
            return;
        }

        if (status === 'no-results') {
            dom.searchResultsDropdown.innerHTML = '<div class="search-result-item no-results-message">No results found.</div>';
            return;
        }

        if (status === 'error') {
            dom.searchResultsDropdown.innerHTML = '<div class="search-result-item no-results-message" style="color: red;">Error searching cards. Please try again.</div>';
            return;
        }

        // If status is 'success' and results array is populated:
        results.forEach(card => {
            const item = document.createElement('div');
            item.classList.add('search-result-item');
            
            const img = document.createElement('img');
            img.src = card.imageUrl;
            img.alt = card.name;
            img.classList.add('search-result-item-image');
            img.onerror = () => {
                img.src = "https://placehold.co/40x56/cccccc/333333?text=N/A";
                img.style.objectFit = "contain";
            };
            item.appendChild(img);

            const textSpan = document.createElement('span');
            let displayText = card.name;
            if (card.setName) displayText += ` (${card.setName})`;
            if (card.cardNumber) displayText += ` #${card.cardNumber}`;

            const queryParts = originalQuery.split(/\s+/).filter(p => p.length > 0);
            let highlightedText = displayText;
            queryParts.forEach(part => {
                const regex = new RegExp(`(${part})`, 'gi');
                highlightedText = highlightedText.replace(regex, '<span class="highlight">$1</span>');
            });

            textSpan.innerHTML = highlightedText;
            item.appendChild(textSpan);

            item.addEventListener('click', () => {
                this.selectedCardForAdd = card;
                if (dom.draggableCardPreviewImage) {
                    dom.draggableCardPreviewImage.src = card.imageUrl;
                    dom.draggableCardPreviewImage.alt = card.name || 'Selected Card Preview'; // Set alt text
                    dom.draggableCardPreviewImage.style.display = 'block'; // Make the image itself visible
                    // Apply sizing and styling to match card slots
                    dom.draggableCardPreviewImage.style.width = '100%';
                    dom.draggableCardPreviewImage.style.height = '100%';
                    dom.draggableCardPreviewImage.style.objectFit = 'contain';
                    dom.draggableCardPreviewImage.style.borderRadius = '10px'; // Matching slot image border radius
                }
                if (dom.draggableCardPreview) {
                    // Apply container sizing and styling to match card slots
                    dom.draggableCardPreview.style.display = 'flex'; 
                    dom.draggableCardPreview.style.width = '150px'; // Max width of a card slot
                    dom.draggableCardPreview.style.aspectRatio = '150 / 210'; // Aspect ratio for a typical card
                    dom.draggableCardPreview.style.border = '2px solid #B0BEC5';
                    dom.draggableCardPreview.style.borderRadius = '12px';
                    dom.draggableCardPreview.style.boxShadow = '0 4px 8px rgba(0,0,0,0.1)';
                    dom.draggableCardPreview.style.justifyContent = 'center';
                    dom.draggableCardPreview.style.alignItems = 'center';
                    dom.draggableCardPreview.style.overflow = 'hidden';
                    dom.draggableCardPreview.style.backgroundColor = '#ECEFF1';
                    
                    dom.draggableCardPreview.classList.add('active');
                }
                // Show the "Add to Next Empty Slot" button
                if (dom.addNextButton) {
                    dom.addNextButton.style.display = 'inline-block';
                }
                this.updateActionButtonsState();
                if (dom.searchInput) dom.searchInput.value = card.name;
                dom.searchResultsDropdown.style.display = 'none'; // Hide dropdown after selection
            });
            dom.searchResultsDropdown.appendChild(item);
        });
        dom.searchResultsDropdown.style.display = 'block'; // Ensure dropdown is visible for results
    }

    /**
     * Attaches touch event listeners for dragging the selected card preview on mobile.
     */
    addTouchDragListenersToPreview() {
        if (!dom.draggableCardPreview || this.touchListenersAdded) {
            // console.log("Touch listeners already added or preview element not found. Skipping.");
            return; // Prevent duplicate listeners
        }
        console.log("Attaching touch listeners to draggable card preview.");

        const preview = dom.draggableCardPreview;

        const onTouchStart = (e) => {
            if (e.touches.length === 1) {
                e.preventDefault(); // Prevent scrolling and text selection
                e.stopPropagation(); // Stop propagation
                this.isTouchDraggingPreview = true;

                // Calculate offset from touch point to the element's top-left corner
                const rect = preview.getBoundingClientRect();
                this.touchDragOffsetX = e.touches[0].clientX - rect.left;
                this.touchDragOffsetY = e.touches[0].clientY - rect.top;

                // Set position to fixed for dragging freely over the viewport
                preview.style.position = 'fixed'; 
                preview.style.zIndex = '10000'; // Ensure it's on top
                preview.style.cursor = 'grabbing';
                preview.classList.add('dragging'); // Add a class for visual feedback
                // Clear any lingering absolute positioning or transforms from initial display
                preview.style.left = `${rect.left}px`;
                preview.style.top = `${rect.top}px`;
                preview.style.transform = 'none'; // Ensure no default transform interferes with fixed positioning
                
                // Add global listeners for move and end to capture touches outside the element
                document.body.addEventListener('touchmove', onTouchMove, { passive: false });
                document.body.addEventListener('touchend', onTouchEnd, { passive: false }); // Ensure passive: false for touchend
                document.body.addEventListener('touchcancel', onTouchEnd, { passive: false }); // Ensure passive: false for touchcancel
            }
        };

        const onTouchMove = (e) => {
            if (this.isTouchDraggingPreview) {
                e.preventDefault(); // Prevent scrolling while dragging
                e.stopPropagation(); // Stop propagation
                const touch = e.touches[0];
                // Update position relative to the viewport
                preview.style.left = `${touch.clientX - this.touchDragOffsetX}px`;
                preview.style.top = `${touch.clientY - this.touchDragOffsetY}px`;

                // Minimal visual feedback for binder container
                const targetElement = document.elementFromPoint(touch.clientX, touch.clientY);
                if (targetElement && targetElement.closest('#binder-container')) {
                     if (dom.binderContainer) dom.binderContainer.classList.add('highlight');
                } else {
                     if (dom.binderContainer) dom.binderContainer.classList.remove('highlight');
                }
            }
        };

        const onTouchEnd = async (e) => {
            // Log entry to confirm this function is always called on touchend
            console.log(`[TouchEnd Debug] onTouchEnd triggered.`);

            // IMPORTANT: Prevent default and stop propagation from the very beginning of touchend
            // to ensure no default browser action (like opening a link) occurs.
            e.preventDefault(); 
            e.stopPropagation();

            // Remove global listeners regardless of drag state
            document.body.removeEventListener('touchmove', onTouchMove, { passive: false });
            document.body.removeEventListener('touchend', onTouchEnd, { passive: false });
            document.body.removeEventListener('touchcancel', onTouchEnd, { passive: false });

            // Only proceed with drop logic if a drag was actively in progress
            if (!this.isTouchDraggingPreview) {
                console.log(`[TouchEnd Debug] Drag was not active, no drop logic executed.`);
                // Reset and hide preview
                this.selectedCardForAdd = null;
                if (dom.draggableCardPreview) dom.draggableCardPreview.style.display = 'none';
                if (dom.draggableCardPreview) dom.draggableCardPreview.classList.remove('active');
                if (dom.draggableCardPreviewImage) dom.draggableCardPreviewImage.src = '';
                if (dom.draggableCardPreviewImage) dom.draggableCardPreviewImage.style.display = 'none';
                this.updateActionButtonsState();
                return; // Exit if not actively dragging
            }

            this.isTouchDraggingPreview = false;
            
            // Get the touch point coordinates
            const touch = e.changedTouches[0];
            if (!touch) {
                console.log(`[TouchEnd Debug] No changedTouches[0] found.`);
                // Reset and hide preview
                this.selectedCardForAdd = null;
                if (dom.draggableCardPreview) dom.draggableCardPreview.style.display = 'none';
                if (dom.draggableCardPreview) dom.draggableCardPreview.classList.remove('active');
                if (dom.draggableCardPreviewImage) dom.draggableCardPreviewImage.src = '';
                if (dom.draggableCardPreviewImage) dom.draggableCardPreviewImage.style.display = 'none';
                this.updateActionButtonsState();
                return; // Exit if no valid touch point
            }

            console.log(`[TouchEnd Debug] Touch ended at: clientX=${touch.clientX}, clientY=${touch.clientY}`);

            // Temporarily hide the dragging preview from hit testing
            preview.style.pointerEvents = 'none'; 
            const targetElement = document.elementFromPoint(touch.clientX, touch.clientY);
            preview.style.pointerEvents = 'auto'; // Immediately restore pointer-events

            console.log(`[TouchEnd Debug] Element at touch point (through preview):`, targetElement);

            let dropTargetIndex = -1; // Default to 'no valid target'
            if (targetElement && this.selectedCardForAdd) { // Ensure there's a target and a card selected
                const slotElement = targetElement.closest('.card-slot');
                console.log(`[TouchEnd Debug] Closest card slot element:`, slotElement);

                if (slotElement) {
                    // Dropped directly on a card slot - replace or fill this specific slot
                    const localIndex = Array.from(dom.cardSlotsGrid.children).indexOf(slotElement);
                    dropTargetIndex = (this.currentPage - 1) * this.cardsPerPage + localIndex;
                    console.log(`[TouchEnd Debug] Dropped on slot. Local Index: ${localIndex}, Global Index: ${dropTargetIndex}`);
                } else if (targetElement.closest('#binder-container')) {
                    // Dropped on the binder-container but not a specific card slot - find next empty or append
                    let firstEmptyIndex = this.cardsData.indexOf(null);
                    dropTargetIndex = firstEmptyIndex !== -1 ? firstEmptyIndex : this.cardsData.length;
                    console.log(`[TouchEnd Debug] Dropped on binder container. Next empty/append index: ${dropTargetIndex}`);
                } else {
                    console.log(`[TouchEnd Debug] Dropped outside any valid card slot or binder container.`);
                }
            }
            
            // Only add card if a valid drop zone was found (a slot or binder container leading to an index)
            if (dropTargetIndex !== -1 && dropTargetIndex !== undefined) {
                console.log(`[TouchEnd Debug] Calling addCardToBinder with index: ${dropTargetIndex}`);
                await this.addCardToBinder(
                    this.selectedCardForAdd.imageUrl,
                    this.selectedCardForAdd.name,
                    this.selectedCardForAdd.setName,
                    this.selectedCardForAdd.cardNumber,
                    true, // Assume image from API is direct
                    dropTargetIndex // Pass the specific index to replace/fill
                );
            } else {
                console.log(`[TouchEnd Debug] No valid drop target found. Card not added.`);
            }

            // Reset preview styling for its default position (hidden after drop)
            preview.style.position = ''; 
            preview.style.left = '';
            preview.style.top = '';
            preview.style.zIndex = '';
            preview.style.cursor = '';
            preview.classList.remove('dragging');
            if (dom.binderContainer) dom.binderContainer.classList.remove('highlight');

            // Reset and hide preview
            this.selectedCardForAdd = null;
            if (dom.draggableCardPreview) dom.draggableCardPreview.style.display = 'none';
            if (dom.draggableCardPreview) dom.draggableCardPreview.classList.remove('active');
            if (dom.draggableCardPreviewImage) dom.draggableCardPreviewImage.src = '';
            if (dom.draggableCardPreviewImage) dom.draggableCardPreviewImage.style.display = 'none';
            this.updateActionButtonsState();
        };
        
        // Only add the touchstart listener once to the preview element
        // The move/end/cancel listeners are added/removed from document.body within touchstart/touchend
        preview.addEventListener('touchstart', onTouchStart, { passive: false });
        this.touchListenersAdded = true; // Mark listeners as added
    }

    /**
     * Updates the enabled/disabled state of action buttons.
     */
    updateActionButtonsState() {
        const hasCards = this.cardsData.filter(card => card !== null).length > 0;
        const canUndo = this.historyPointer > 0;
        const hasSelectedCardForAdd = this.selectedCardForAdd !== null;
        const hasLayout = this.selectedLayout !== null;

        // Search input is enabled only when a layout is selected
        if (dom.searchInput) {
            dom.searchInput.disabled = !hasLayout;
            console.log('Search input disabled state updated to:', dom.searchInput.disabled);
        }

        if (dom.clearAllButton) dom.clearAllButton.disabled = !hasCards;
        if (dom.exportBinderButton) dom.exportBinderButton.disabled = !hasCards;
        if (dom.undoButton) dom.undoButton.disabled = !canUndo;
        // The addNextButton's display is managed directly in renderSearchResults and addNextButton click handler.
        // Its disabled state is managed here.
        if (dom.addNextButton) dom.addNextButton.disabled = !hasSelectedCardForAdd; 
        
        if (dom.setCapacityButton) dom.setCapacityButton.disabled = !hasLayout;
        if (dom.sortByHueButton) dom.sortByHueButton.disabled = !hasCards;
        if (dom.sortByHueColumnButton) dom.sortByHueColumnButton.disabled = !hasCards;
        // The import buttons should probably always be enabled, or at least if there's a layout.
        // dom.importBinderButton.disabled = !hasLayout;
        // dom.importPricechartingButton.disabled = !hasLayout;
    }

    /**
     * Updates the enabled/disabled state of pagination buttons and the page indicator.
     */
    updatePaginationButtonsState() {
        const totalPages = this.calculateTotalPages();
        const currentPage = this.currentPage;
        
        if (dom.prevPageButton) dom.prevPageButton.disabled = currentPage <= 1;
        if (dom.nextPageButton) dom.nextPageButton.disabled = currentPage >= totalPages;
        if (dom.firstPageButton) dom.firstPageButton.disabled = currentPage <= 1;
        if (dom.lastPageButton) dom.lastPageButton.disabled = currentPage >= totalPages;

        if (dom.pageIndicator) dom.pageIndicator.textContent = `Page ${currentPage} / ${totalPages}`;
    }

    /**
     * Clears all entries from the binder.
     */
    async clearAllEntries() {
        const confirmed = await showCustomConfirm('Are you sure you want to clear ALL cards from your binder? This cannot be undone (except by Undo!).');
        if (!confirmed) {
            return;
        }
        this.cardsData = [];
        this.currentPage = 1;
        this.renderCurrentPage();
        this.saveBinderState();
        this.saveStateToHistory();
        showTemporaryButtonMessage(dom.clearAllButton, 'Cleared!', 1500);
        this.updateTrackerDisplay();
    }

    /**
     * Adds an empty page to the binder, increasing its total capacity.
     */
    addEmptyPage() {
        if (this.selectedLayout === null) {
            showTemporaryButtonMessage(dom.addPageButton, 'Select Layout First!', 1500);
            return;
        }
        const newCapacity = this.cardsData.length + this.cardsPerPage;
        this.cardsData.length = newCapacity;
        this.cardsData.fill(null, newCapacity - this.cardsPerPage); // Fill new slots with null
        this.renderCurrentPage();
        this.saveBinderState();
        this.saveStateToHistory();
        showTemporaryButtonMessage(dom.addPageButton, 'Page Added!', 1500);
        this.updateTrackerDisplay();
    }

    /**
     * Shows and positions the insert highlight element.
     * @param {HTMLElement} targetSlotElement - The card slot element being hovered over.
     * @param {string} insertPosition - 'before' or 'after' the target slot.
     * This method is now effectively unused for drag-and-drop operations,
     * but kept in case other features might use a line highlight.
     */
    showInsertHighlight(targetSlotElement, insertPosition) {
        if (!dom.insertHighlight) {
            console.warn("Insert highlight element not found when trying to show.");
            return;
        }
        if (!dom.cardSlotsGrid) {
            console.warn("cardSlotsGrid not found when trying to show insert highlight.");
            return;
        }

        // Ensure no `is-drop-target` class is active on any slot when insert highlight is shown
        const activeTargetSlot = document.querySelector('.card-slot.is-drop-target');
        if (activeTargetSlot) {
            activeTargetSlot.classList.remove('is-drop-target');
        }

        const slotRect = targetSlotElement.getBoundingClientRect();
        const gridRect = dom.cardSlotsGrid.getBoundingClientRect();

        let top = slotRect.top - gridRect.top;
        let left;

        const highlightThickness = 8; // Pixels for the highlight line

        dom.insertHighlight.style.height = `${slotRect.height}px`; // Highlight height same as card
        dom.insertHighlight.style.width = `${highlightThickness}px`; // Thin vertical line

        if (insertPosition === 'before') {
            left = slotRect.left - gridRect.left - (highlightThickness / 2); // Position before the slot
        } else { // 'after'
            left = slotRect.right - gridRect.left - (highlightThickness / 2); // Position after the slot
        }
        
        dom.insertHighlight.style.top = `${top}px`;
        dom.insertHighlight.style.left = `${left}px`;
        dom.insertHighlight.classList.add('active');

        console.log(`Highlight Debug: Showing highlight at top: ${top}px, left: ${left}px, for position: ${insertPosition}`);
    }

    /**
     * Hides the insert highlight element.
     */
    hideInsertHighlight() {
        if (dom.insertHighlight) {
            dom.insertHighlight.classList.remove('active');
            console.log('Highlight Debug: Hiding highlight.');
        }
    }
}

// Initialize the Binder application once DOM is ready
document.addEventListener('DOMContentLoaded', async () => { 
    console.log('DOMContentLoaded fired. Initializing Binder App...');
    let binderAppInstance;
    try {
        // Instantiate the binder
        binderAppInstance = new Binder();
        // Call and await its asynchronous initialization method
        await binderAppInstance.init(); 
        console.log('Binder App initialized successfully.');
    } catch (e) {
        console.error('Error during Binder App initialization:', e);
        // Display a user-friendly error message if initialization fails
        const appContainer = document.getElementById('app-container');
        if (appContainer) {
            appContainer.innerHTML = '<div style="color: red; text-align: center; padding: 20px;">' +
                                     'An error occurred during application startup. Please check the console for details.' +
                                     '</div>';
        }
        return; // Stop further execution if initialization failed
    }

    console.log('DOM object after initialization:', dom);

    const PAGE_TURN_DELAY = 700; // milliseconds for automatic page turning on drag

    // Event Listeners (all now use binderAppInstance)
    if (dom.clearAllButton) dom.clearAllButton.addEventListener('click', () => binderAppInstance.clearAllEntries());
    if (dom.addPageButton) dom.addPageButton.addEventListener('click', () => binderAppInstance.addEmptyPage());
    if (dom.exportBinderButton) dom.exportBinderButton.addEventListener('click', () => binderAppInstance.exportBinder());
    if (dom.importBinderButton) dom.importBinderButton.addEventListener('click', () => {
        console.log('Import Binder button clicked!');
        if (dom.importFileInput) {
            console.log('Attempting to click hidden import file input...');
            dom.importFileInput.click();
        } else {
            console.error('Import file input (dom.importFileInput) not found!');
        }
    });
    if (dom.importFileInput) dom.importFileInput.addEventListener('change', (e) => binderAppInstance.importBinder(e.target.files[0]));
    if (dom.darkModeToggle) dom.darkModeToggle.addEventListener('click', () => binderAppInstance.toggleDarkMode());
    if (dom.undoButton) dom.undoButton.addEventListener('click', () => binderAppInstance.undoLastAction());
    if (dom.sortByHueButton) dom.sortByHueButton.addEventListener('click', () => binderAppInstance.sortCardsByHue());
    if (dom.sortByHueColumnButton) dom.sortByHueColumnButton.addEventListener('click', () => binderAppInstance.sortCardsByHueColumnWise()); // NEW: Event listener for column sort
    if (dom.addNextButton) dom.addNextButton.addEventListener('click', () => {
        if (binderAppInstance.selectedCardForAdd) {
            binderAppInstance.addCardToBinder( 
                binderAppInstance.selectedCardForAdd.imageUrl,
                binderAppInstance.selectedCardForAdd.name,
                binderAppInstance.selectedCardForAdd.setName,
                binderAppInstance.selectedCardForAdd.cardNumber,
                true // Assume images from API are direct
            );
            binderAppInstance.selectedCardForAdd = null;
            if (dom.draggableCardPreview) dom.draggableCardPreview.style.display = 'none';
            if (dom.draggableCardPreview) dom.draggableCardPreview.classList.remove('active');
            binderAppInstance.updateActionButtonsState();
        }
    });

    if (dom.totalSlotsInput) dom.totalSlotsInput.addEventListener('change', (e) => binderAppInstance.setBinderTotalCapacity(e.target.value));
    if (dom.setCapacityButton) dom.setCapacityButton.addEventListener('click', () => binderAppInstance.setBinderTotalCapacity(dom.totalSlotsInput.value));

    // PriceCharting import
    if (dom.importPricechartingButton) dom.importPricechartingButton.addEventListener('click', () => {
        console.log('Import PriceCharting button clicked!');
        if (dom.importPricechartingFileInput) {
            console.log('Attempting to click hidden PriceCharting file input...');
            dom.importPricechartingFileInput.click();
        } else {
            console.error('Import PriceCharting file input (dom.importPricechartingFileInput) not found!');
        }
    });
    if (dom.importPricechartingFileInput) dom.importPricechartingFileInput.addEventListener('change', (e) => binderAppInstance.importPriceChartingCSV(e.target.files[0]));
    if (dom.cancelImportButton) dom.cancelImportButton.addEventListener('click', () => {
        binderAppInstance.cancelImportFlag = true;
        binderAppInstance.hideLoading();
        showTemporaryButtonMessage(dom.importPricechartingButton, 'Import Canceled!', 1500);
    });

    // Pagination controls
    if (dom.prevPageButton) dom.prevPageButton.addEventListener('click', () => {
        if (binderAppInstance.currentPage > 1) {
            binderAppInstance.currentPage--;
            binderAppInstance.renderCurrentPage();
            binderAppInstance.saveBinderState();
            binderAppInstance.saveStateToHistory();
        }
    });

    if (dom.nextPageButton) dom.nextPageButton.addEventListener('click', () => {
        if (binderAppInstance.currentPage < binderAppInstance.calculateTotalPages()) {
            binderAppInstance.currentPage++;
            binderAppInstance.renderCurrentPage();
            binderAppInstance.saveBinderState();
            binderAppInstance.saveStateToHistory();
        }
    });

    if (dom.firstPageButton) dom.firstPageButton.addEventListener('click', () => {
        if (binderAppInstance.currentPage !== 1) {
            binderAppInstance.currentPage = 1;
            binderAppInstance.renderCurrentPage();
            binderAppInstance.saveBinderState();
            binderAppInstance.saveStateToHistory();
        }
    });

    if (dom.lastPageButton) dom.lastPageButton.addEventListener('click', () => {
        const totalPages = binderAppInstance.calculateTotalPages();
        if (binderAppInstance.currentPage !== totalPages) {
            binderAppInstance.currentPage = totalPages;
            binderAppInstance.renderCurrentPage();
            binderAppInstance.saveBinderState();
            binderAppInstance.saveStateToHistory();
        }
    });

    // Search input event listeners with debouncing
    if (dom.searchInput) dom.searchInput.addEventListener('input', (e) => {
        clearTimeout(binderAppInstance.searchTimeout);
        const query = e.target.value.trim();

        binderAppInstance.searchTimeout = setTimeout(async () => {
            let results = [];
            try {
                results = await binderAppInstance.performSearch(query);
            } catch (error) {
                console.error("Error during debounced search execution:", error);
            } finally {
                binderAppInstance.renderSearchResults(results, query);
            }
        }, 500); // Debounce delay
    });

    // Close search results when clicking outside
    document.addEventListener('click', (e) => {
        if (dom.searchResultsDropdown && !dom.searchResultsDropdown.contains(e.target) && e.target !== dom.searchInput) {
            dom.searchResultsDropdown.style.display = 'none';
        }
    });

    // Drag & Drop Listeners for binderContainer (now includes page turning)
    if (dom.binderContainer) {
        dom.binderContainer.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dom.binderContainer.classList.add('highlight');
            e.dataTransfer.dropEffect = 'move'; // Default to move for internal, but can be copy for external

            const binderRect = dom.binderContainer.getBoundingClientRect();
            const clientX = e.clientX;
            // 15% from either edge of the binder container for page turning
            const edgeThreshold = binderRect.width * 0.15; 

            // Clear any existing timer to prevent rapid page turns
            clearTimeout(binderAppInstance.pageTurnTimer); 

            // Check if dragging to left edge to turn page back
            // console.log(`Dragover: clientX=${clientX}, left=${binderRect.left}, right=${binderRect.right}, edge=${edgeThreshold}`); // Keep for general dragover debug
            if (clientX < binderRect.left + edgeThreshold && binderAppInstance.currentPage > 1) {
                if (binderAppInstance.lastPageTurnedTo !== binderAppInstance.currentPage) { // Only trigger if not already on this page or timer running
                    binderAppInstance.pageTurnTimer = setTimeout(() => {
                        console.log(`Turning page left to ${binderAppInstance.currentPage - 1}`);
                        binderAppInstance.currentPage--;
                        binderAppInstance.renderCurrentPage();
                        binderAppInstance.saveBinderState();
                        binderAppInstance.saveStateToHistory();
                        binderAppInstance.lastPageTurnedTo = binderAppInstance.currentPage; // Update tracking
                        binderAppInstance.pageTurnTimer = null; // Reset timer after action
                    }, PAGE_TURN_DELAY);
                }
            } 
            // Check if dragging to right edge to turn page forward
            else if (clientX > binderRect.right - edgeThreshold && binderAppInstance.currentPage < binderAppInstance.calculateTotalPages()) {
                if (binderAppInstance.lastPageTurnedTo !== binderAppInstance.currentPage) { // Only trigger if not already on this page or timer running
                    binderAppInstance.pageTurnTimer = setTimeout(() => {
                        console.log(`Turning page right to ${binderAppInstance.currentPage + 1}`);
                        binderAppInstance.currentPage++;
                        binderAppInstance.renderCurrentPage();
                        binderAppInstance.saveBinderState();
                        binderAppInstance.saveStateToHistory();
                        binderAppInstance.lastPageTurnedTo = binderAppInstance.currentPage; // Update tracking
                        binderAppInstance.pageTurnTimer = null; // Reset timer after action
                    }, PAGE_TURN_DELAY);
                }
            } else {
                // Not near an edge, or moved away from an edge, clear timer
                binderAppInstance.lastPageTurnedTo = -1; // Reset tracking
                clearTimeout(binderAppInstance.pageTurnTimer);
                binderAppInstance.pageTurnTimer = null;
            }
        });

        dom.binderContainer.addEventListener('dragleave', (e) => {
            e.stopPropagation();
            dom.binderContainer.classList.remove('highlight');
            clearTimeout(binderAppInstance.pageTurnTimer); // Clear timer if drag leaves the container entirely
            binderAppInstance.pageTurnTimer = null; 
            binderAppInstance.lastPageTurnedTo = -1; // Reset tracking
        });

        dom.binderContainer.addEventListener('drop', (e) => binderAppInstance.handleDrop(e));
    }

    // Event delegation for dynamically created delete buttons
    if (dom.cardSlotsGrid) dom.cardSlotsGrid.addEventListener('click', (e) => {
        if (e.target.classList.contains('delete-card-button')) {
            const cardIndex = parseInt(e.target.dataset.cardIndex);
            binderAppInstance.handleDeleteCard(cardIndex);
        }
    });

    // Event delegation for drag highlight on card slots
    if (dom.cardSlotsGrid) {
        dom.cardSlotsGrid.addEventListener('dragstart', (e) => binderAppInstance.handleCardMoveDragStart(e));
        dom.cardSlotsGrid.addEventListener('dragend', (e) => binderAppInstance.handleCardMoveDragEnd(e));

        dom.cardSlotsGrid.addEventListener('dragover', (e) => {
            e.preventDefault(); // Allow drop
            e.stopPropagation();

            const targetSlotElement = e.target.closest('.card-slot');
            
            // Clear any existing highlights first (especially the old "insert" line)
            binderAppInstance.hideInsertHighlight(); 
            const activeTargetSlot = document.querySelector('.card-slot.is-drop-target');
            if (activeTargetSlot) {
                activeTargetSlot.classList.remove('is-drop-target');
            }

            if (targetSlotElement) {
                // Always highlight the target slot itself for any valid drag
                targetSlotElement.classList.add('is-drop-target');
            }
            // If not over a slot, highlights remain hidden, which is desired.
        });

        dom.cardSlotsGrid.addEventListener('dragleave', (e) => {
            e.stopPropagation();
            console.log('Highlight Debug: dragleave on cardSlotsGrid. Related target:', e.relatedTarget);
            
            // Remove insert highlight if truly leaving grid or current slot without entering new
            const newTargetSlot = e.relatedTarget ? e.relatedTarget.closest('.card-slot') : null;
            const isStillInGrid = e.relatedTarget ? e.relatedTarget.closest('#card-slots-grid') : null;
            if (!newTargetSlot && !isStillInGrid) {
                binderAppInstance.hideInsertHighlight();
            }

            // Remove swap highlight from the slot being left
            const currentTargetSlot = e.target.closest('.card-slot');
            if (currentTargetSlot && currentTargetSlot.classList.contains('is-drop-target')) {
                currentTargetSlot.classList.remove('is-drop-target');
            }
        });
        // Add a general dragexit for the grid itself to ensure highlights are hidden
        dom.cardSlotsGrid.addEventListener('dragexit', () => { 
            console.log('Highlight Debug: dragexit on cardSlotsGrid.');
            binderAppInstance.hideInsertHighlight();
            const activeTargetSlot = document.querySelector('.card-slot.is-drop-target');
            if (activeTargetSlot) {
                activeTargetSlot.classList.remove('is-drop-target');
            }
        });
    }

    // Keyboard shortcuts for Undo (Ctrl+Z) and Paste (Ctrl+V)
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
            binderAppInstance.undoLastAction();
            e.preventDefault();
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
            if (binderAppInstance.selectedCardForAdd) {
                binderAppInstance.addCardToBinder( 
                    binderAppInstance.selectedCardForAdd.imageUrl,
                    binderAppInstance.selectedCardForAdd.name,
                    binderAppInstance.selectedCardForAdd.setName,
                    binderAppInstance.selectedCardForAdd.cardNumber,
                    binderAppInstance.isLikelyImageUrl(binderAppInstance.selectedCardForAdd.imageUrl),
                    undefined, // undefined to add to next empty slot
                    false
                );
                e.preventDefault();
            }
        }
    });
});
