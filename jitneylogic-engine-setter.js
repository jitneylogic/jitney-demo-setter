// =========================================================================
// JITNEYLOGIC ENGINE — client-agnostic plumbing.
//
// This file is meant to be identical across every client deployment.
// Nothing in here should ever need to change when onboarding a new client.
// Client-specific values (Vault URL, package naming, pest facts, deposit
// rules) live in a JITNEYLOGIC_CONFIG object defined in each client's own
// HTML file, BEFORE this script is loaded.
//
// Expected shape of window.JITNEYLOGIC_CONFIG (set by the client HTML):
// {
//   vaultUrl: "https://...run.app/",
//   packageDisplayToVault: { "Client's Package Name": "Vault's Package Name", ... },
//   depositRules: [ { keywords: ["german roaches","rodent"], amount: 99 }, ... ],
//   defaultDeposit: 39
// }
// =========================================================================

let stats = {
    dayCalls: 0, daySold: 0, dayComm: 0.0, dayTcv: 0.0,
    weekCalls: 0, weekSold: 0, weekComm: 0.0, weekTcv: 0.0
};

let currentVaultPackage = "";
let currentVaultPricing = null;
let currentAddressComponents = null;

function getConfig() {
    if (!window.JITNEYLOGIC_CONFIG) {
        console.error("JITNEYLOGIC_CONFIG is not defined. Set it in the client HTML before loading jitneylogic-engine.js");
        return {};
    }
    return window.JITNEYLOGIC_CONFIG;
}

// =========================================================================
// VAULT CONNECTION
// =========================================================================
async function fetchVaultQuote(payload) {
    const config = getConfig();
    if (!config.vaultUrl) {
        console.error("JITNEYLOGIC_CONFIG.vaultUrl is not set.");
        return null;
    }
    if (!config.clientId) {
        console.error("JITNEYLOGIC_CONFIG.clientId is not set — the Vault can't look up pricing without it.");
        return null;
    }
    try {
        const resp = await fetch(config.vaultUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...payload, client_id: config.clientId })
        });
        const data = await resp.json();
        if (!resp.ok || data.status !== "success") return null;
        return data;
    } catch (err) {
        console.error("Vault fetch failed:", err);
        return null;
    }
}

function evaluatePestCombinationMatrix() {
    const checkedNames = Array.from(document.querySelectorAll('.pest-checkbox:checked')).map(cb => cb.getAttribute('data-display'));
    const packageSelect = document.getElementById('package-select');

    if (checkedNames.length === 0) {
        packageSelect.value = "";
        runDynamicGuardrails();
        return;
    }

    fetchVaultQuote({ selectedPests: checkedNames }).then(data => {
        const config = getConfig();
        if (!data) {
            packageSelect.value = "";
            runDynamicGuardrails();
            return;
        }
        const vaultToDisplay = Object.fromEntries(
            Object.entries(config.packageDisplayToVault || {}).map(([display, vault]) => [vault, display])
        );
        const displayName = vaultToDisplay[data.package] || "";
        packageSelect.value = displayName;
        currentVaultPackage = displayName;
        currentVaultPricing = data.pricing;
        runDynamicGuardrails();
    });
}

function runDynamicGuardrails() {
    const config = getConfig();
    const currentTier = document.getElementById('package-select').value;
    const initialDropdown = document.getElementById('initial-price');
    const monthlyDropdown = document.getElementById('monthly-price');
    const packageTextEl = document.getElementById('inject-package-text');
    if (packageTextEl) packageTextEl.innerText = currentTier !== "" ? currentTier : "[package selection]";

    const clearDropdowns = () => {
        currentVaultPackage = "";
        currentVaultPricing = null;
        initialDropdown.innerHTML = '<option value="0">0.00</option>';
        monthlyDropdown.innerHTML = '<option value="0">0.00</option>';
        const agreementLengthEl = document.getElementById('agreement-length-select');
        if (agreementLengthEl) agreementLengthEl.value = "";
        executeRealtimeCalculations();
    };

    if (!currentTier) return clearDropdowns();

    if (currentTier === currentVaultPackage && currentVaultPricing) {
        renderPriceDropdowns(applySqftAdjustment(currentVaultPricing, currentSqftTier));
        return;
    }

    const vaultPkgName = (config.packageDisplayToVault || {})[currentTier];
    if (!vaultPkgName) return clearDropdowns();

    fetchVaultQuote({ package: vaultPkgName }).then(data => {
        if (!data) return clearDropdowns();
        currentVaultPackage = currentTier;
        currentVaultPricing = data.pricing;
        renderPriceDropdowns(applySqftAdjustment(currentVaultPricing, currentSqftTier));
    });
}

// =========================================================================
// SQUARE FOOTAGE PRICING ADJUSTMENT — flat add-on applied on top of
// whatever the vault already quoted, never a second vault call. Kept
// simple on purpose ("until we have an actual pricing matrix with a real
// client" — Tyler's words): a flat dollar amount per tier, added equally
// to start/target/floor, not a percentage or a formula. currentVaultPricing
// itself is never mutated — this always returns a fresh adjusted copy, so
// switching sqft tiers back and forth never compounds or drifts.
// =========================================================================
let currentSqftTier = ""; // "", "0-3000", "3001-5000", or "5001+"

const SQFT_SURCHARGES = {
    "0-3000": { initial: 0, monthly: 0 },
    "3001-5000": { initial: 100, monthly: 50 },
    "5001+": { initial: 150, monthly: 75 } // open-ended on purpose — no fourth tier exists yet
};

function applySqftAdjustment(basePricing, tier) {
    const surcharge = SQFT_SURCHARGES[tier] || { initial: 0, monthly: 0 };
    if (!basePricing) return basePricing;
    return {
        initial: {
            starting: basePricing.initial.starting + surcharge.initial,
            target: basePricing.initial.target + surcharge.initial,
            floor: basePricing.initial.floor + surcharge.initial
        },
        monthly: {
            starting: basePricing.monthly.starting + surcharge.monthly,
            target: basePricing.monthly.target + surcharge.monthly,
            floor: basePricing.monthly.floor + surcharge.monthly
        }
    };
}

function syncSqft(value) {
    const a = document.getElementById('sqft-select');
    const b = document.getElementById('sqft-select-script');
    if (a) a.value = value;
    if (b) b.value = value;
}
window.syncSqft = syncSqft;

function handleSqftChange(value) {
    currentSqftTier = value;
    syncSqft(value);
    if (currentVaultPricing) renderPriceDropdowns(applySqftAdjustment(currentVaultPricing, currentSqftTier));
}
window.handleSqftChange = handleSqftChange;

window.resetSqftState = function () {
    currentSqftTier = "";
    syncSqft("");
};

function renderPriceDropdowns(pricing) {
    const initialDropdown = document.getElementById('initial-price');
    const monthlyDropdown = document.getElementById('monthly-price');
    initialDropdown.innerHTML = `
        <option value="${pricing.initial.starting}">Starting ($${pricing.initial.starting.toFixed(2)})</option>
        <option value="${pricing.initial.target}">Target ($${pricing.initial.target.toFixed(2)})</option>
        <option value="${pricing.initial.floor}">Floor ($${pricing.initial.floor.toFixed(2)})</option>
    `;
    monthlyDropdown.innerHTML = `
        <option value="${pricing.monthly.starting}">Starting ($${pricing.monthly.starting.toFixed(2)})</option>
        <option value="${pricing.monthly.target}">Target ($${pricing.monthly.target.toFixed(2)})</option>
        <option value="${pricing.monthly.floor}">Floor ($${pricing.monthly.floor.toFixed(2)})</option>
    `;
    const agreementLengthEl = document.getElementById('agreement-length-select');
    if (agreementLengthEl && !agreementLengthEl.value) {
        agreementLengthEl.value = "24 Month";
    }
    executeRealtimeCalculations();
}

// =========================================================================
// DROPDOWN MECHANICS (generic multi-select checkbox widgets)
// =========================================================================
function toggleScriptDropdownWindow(event) {
    event.stopPropagation();
    const panel = document.getElementById('script-dropdown-checkbox-panel');
    const wrapper = document.getElementById('script-pest-dropdown-wrapper');
    if (panel.style.display === 'block') {
        panel.style.display = 'none';
        wrapper.classList.remove('active');
        parseScriptPestLogicHandshake();
    } else {
        panel.style.display = 'block';
        wrapper.classList.add('active');
    }
}

function updateScriptDisplayBoxText() {
    const checkedBoxes = Array.from(document.querySelectorAll('.script-pest-cb:checked')).map(cb => cb.value);
    const textDisplayNode = document.getElementById('display-script-selected-text');
    if (checkedBoxes.length > 0) {
        textDisplayNode.innerText = checkedBoxes.join(', ');
    } else {
        textDisplayNode.innerText = '-- Select Active Infestations --';
    }
}

function toggleDropdownWindow(event) {
    event.stopPropagation();
    const panel = document.getElementById('dropdown-checkbox-panel');
    const wrapper = document.getElementById('pest-dropdown-wrapper');
    if (panel.style.display === 'block') {
        panel.style.display = 'none';
        wrapper.classList.remove('active');
        evaluatePestCombinationMatrix();
    } else {
        panel.style.display = 'block';
        wrapper.classList.add('active');
    }
}

function updateDisplayBoxText() {
    const checkedBoxes = Array.from(document.querySelectorAll('.pest-checkbox:checked')).map(cb => cb.getAttribute('data-display'));
    const textDisplayNode = document.getElementById('display-selected-text');
    if (checkedBoxes.length > 0) {
        textDisplayNode.innerText = checkedBoxes.join(', ');
    } else {
        textDisplayNode.innerText = '-- Select Active Infestations --';
    }
}

window.addEventListener('click', function(event) {
    const dropdownWrapper = document.getElementById('pest-dropdown-wrapper');
    const dropdownPanel = document.getElementById('dropdown-checkbox-panel');
    const scriptWrapper = document.getElementById('script-pest-dropdown-wrapper');

    if (dropdownWrapper && !dropdownWrapper.contains(event.target)) {
        if (dropdownPanel.style.display === 'block') {
            dropdownPanel.style.display = 'none';
            dropdownWrapper.classList.remove('active');
            evaluatePestCombinationMatrix();
        }
    }
    if (scriptWrapper && !scriptWrapper.contains(event.target)) {
        const panel = document.getElementById('script-dropdown-checkbox-panel');
        if (panel && panel.style.display === 'block') {
            panel.style.display = 'none';
            scriptWrapper.classList.remove('active');
            parseScriptPestLogicHandshake();
        }
    }
});

function copyField(elementId) {
    const copyTarget = document.getElementById(elementId);
    copyTarget.select();
    copyTarget.setSelectionRange(0, 99999);
    navigator.clipboard.writeText(copyTarget.value).catch(() => {
        console.log("Clipboard allocation block failure intercept.");
    });
}

// =========================================================================
// STANDARD CUSTOMER FIELD SYNCING — same fields collected for every client
// =========================================================================
function updateConsolidatedAppointmentNotes() {
    const firstName = document.getElementById('first-name').value.trim();
    const location = document.getElementById('script-location-input').value.trim();
    const duration = document.getElementById('script-duration-input').value.trim();
    const checkedScriptPests = Array.from(document.querySelectorAll('.script-pest-cb:checked')).map(cb => cb.value);
    const leftNotesEl = document.getElementById('appointment-notes-consolidated-left');

    if (!firstName && !location && !duration && checkedScriptPests.length === 0) {
        document.getElementById('appointment-notes-consolidated').value = "";
        if (leftNotesEl) leftNotesEl.value = "";
        return;
    }

    const pFirst = firstName || "[Customer first name]";
    const pLocation = location || "[location of infestation]";
    const pDuration = duration || "[duration of infestation]";
    const pestsString = checkedScriptPests.length > 0 ? checkedScriptPests.join(', ') : "[pests]";

    const notesValue = `${pFirst} has been dealing with ${pestsString} in the ${pLocation} for ${pDuration}`;
    document.getElementById('appointment-notes-consolidated').value = notesValue;
    if (leftNotesEl) leftNotesEl.value = notesValue;
}

function syncCustomerName(val) {
    document.getElementById('script-first-name').value = val;
    document.getElementById('first-name').value = val;
    document.querySelectorAll('.inject-script-name').forEach(el => { el.innerText = val !== "" ? val : "____"; });
    document.querySelectorAll('.inject-name-final').forEach(el => { el.innerText = val !== "" ? val : "Customer"; });
    updateConsolidatedAppointmentNotes();
}

function syncLastName(val) {
    document.getElementById('script-last-name').value = val;
    document.getElementById('last-name').value = val;
}

function syncEmailValue(val) {
    document.getElementById('script-email-input').value = val;
    document.getElementById('customer-email').value = val;
}

function syncPhoneValue(val) {
    document.getElementById('script-phone-input').value = val;
    document.getElementById('phone').value = val;
}

function parsePlaceComponents(place) {
    const get = (type) => {
        const comp = (place.addressComponents || []).find(c => c.types.includes(type));
        return comp ? comp.longText : "";
    };
    const streetNumber = get("street_number");
    const route = get("route");
    return {
        street: [streetNumber, route].filter(Boolean).join(" "),
        city: get("locality") || get("sublocality") || get("postal_town"),
        state: (place.addressComponents || []).find(c => c.types.includes("administrative_area_level_1"))?.shortText || "",
        zip: get("postal_code")
    };
}

let addressSessionToken = null;
let addressDebounceTimers = {};
let addressHighlightIndex = {}; // keyed by input id — which suggestion row is currently highlighted

function closeAddressDropdown(inputEl) {
    const existing = document.getElementById(inputEl.id + "-suggest-panel");
    if (existing) existing.remove();
    addressHighlightIndex[inputEl.id] = -1;
}

async function selectAddressSuggestion(inputEl, suggestion) {
    let finalValue;
    try {
        const place = suggestion.placePrediction.toPlace();
        await place.fetchFields({ fields: ["addressComponents", "formattedAddress"] });
        currentAddressComponents = parsePlaceComponents(place);
        finalValue = place.formattedAddress || suggestion.placePrediction.text.text;
    } catch (err) {
        console.error("Address selection: fetchFields failed, using raw prediction text instead:", err.message);
        currentAddressComponents = null;
        finalValue = suggestion.placePrediction.text.text;
    }
    // Update the field that actually triggered this directly — guaranteed
    // correct regardless of its id — then also run syncAddressValue() for
    // the closer cockpit's dual-pane mirroring (now null-safe, so it's a
    // harmless no-op on any page that doesn't have those two fields).
    inputEl.value = finalValue;
    syncAddressValue(finalValue);
    closeAddressDropdown(inputEl);
    addressSessionToken = null; // session ends on selection

    // Optional hook, guarded by existence check — same pattern as
    // window.renderIncomingBanner. Used by the setter cockpit to
    // auto-fill the zip eligibility field from the selected address;
    // harmless no-op on any page that doesn't define it.
    if (window.onAddressSelected) window.onAddressSelected(currentAddressComponents);
}

function updateAddressHighlight(inputEl) {
    const panel = document.getElementById(inputEl.id + "-suggest-panel");
    if (!panel) return;
    const rows = Array.from(panel.children);
    const activeIndex = addressHighlightIndex[inputEl.id] ?? -1;
    rows.forEach((row, i) => {
        row.style.background = (i === activeIndex) ? "#f1f5f9" : "#fff";
    });
    if (activeIndex >= 0 && rows[activeIndex]) {
        rows[activeIndex].scrollIntoView({ block: "nearest" });
    }
}

function renderAddressSuggestions(inputEl, suggestions) {
    closeAddressDropdown(inputEl);
    if (!suggestions.length) return;

    const panel = document.createElement("div");
    panel.id = inputEl.id + "-suggest-panel";
    panel.style.cssText = "position:absolute; z-index:200; background:#fff; border:1px solid var(--color-sage-accent, #4C9170); border-radius:4px; box-shadow:0 10px 25px rgba(0,0,0,0.25); max-height:220px; overflow-y:auto; font-size:14px;";

    const rect = inputEl.getBoundingClientRect();
    panel.style.width = rect.width + "px";
    panel.style.left = (rect.left + window.scrollX) + "px";
    panel.style.top = (rect.bottom + window.scrollY + 2) + "px";

    suggestions.forEach((suggestion, index) => {
        const row = document.createElement("div");
        row.textContent = suggestion.placePrediction.text.text;
        row.style.cssText = "padding:8px 10px; cursor:pointer; color:#1e293b;";
        row.addEventListener("mouseenter", () => {
            addressHighlightIndex[inputEl.id] = index;
            updateAddressHighlight(inputEl);
        });
        row.addEventListener("click", () => selectAddressSuggestion(inputEl, suggestion));
        panel.appendChild(row);
    });

    panel._suggestions = suggestions; // stash for keyboard access
    document.body.appendChild(panel);
    addressHighlightIndex[inputEl.id] = -1;
}

async function handleAddressInput(inputEl) {
    const query = inputEl.value.trim();
    if (query.length < 4) {
        closeAddressDropdown(inputEl);
        return;
    }
    try {
        const { AutocompleteSuggestion, AutocompleteSessionToken } = await google.maps.importLibrary("places");
        if (!addressSessionToken) addressSessionToken = new AutocompleteSessionToken();

        const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
            input: query,
            includedRegionCodes: ["us"],
            sessionToken: addressSessionToken
        });
        renderAddressSuggestions(inputEl, suggestions || []);
    } catch (err) {
        console.error("Address autocomplete request failed:", err);
    }
}

function handleAddressKeydown(event, inputEl) {
    const panel = document.getElementById(inputEl.id + "-suggest-panel");
    if (!panel || !panel._suggestions || panel._suggestions.length === 0) return;

    const count = panel._suggestions.length;
    const current = addressHighlightIndex[inputEl.id] ?? -1;

    if (event.key === "ArrowDown") {
        event.preventDefault();
        addressHighlightIndex[inputEl.id] = (current + 1) % count;
        updateAddressHighlight(inputEl);
    } else if (event.key === "ArrowUp") {
        event.preventDefault();
        addressHighlightIndex[inputEl.id] = (current - 1 + count) % count;
        updateAddressHighlight(inputEl);
    } else if (event.key === "Enter") {
        if (current >= 0) {
            event.preventDefault();
            selectAddressSuggestion(inputEl, panel._suggestions[current]);
        }
        // If nothing is highlighted yet, let Enter behave normally (e.g. submit
        // elsewhere) rather than silently swallowing the keypress.
    } else if (event.key === "Escape") {
        closeAddressDropdown(inputEl);
    }
}

function initAddressAutocomplete(ids) {
    (ids || ["script-address-input", "right-address"]).forEach(id => {
        const inputEl = document.getElementById(id);
        if (!inputEl) return;
        inputEl.addEventListener("input", () => {
            clearTimeout(addressDebounceTimers[id]);
            addressDebounceTimers[id] = setTimeout(() => handleAddressInput(inputEl), 250);
        });
        inputEl.addEventListener("keydown", (event) => handleAddressKeydown(event, inputEl));
    });
    document.addEventListener("click", (event) => {
        (ids || ["script-address-input", "right-address"]).forEach(id => {
            const inputEl = document.getElementById(id);
            const panel = document.getElementById(id + "-suggest-panel");
            if (panel && inputEl && !inputEl.contains(event.target) && !panel.contains(event.target)) {
                panel.remove();
            }
        });
    });
}
window.initAddressAutocomplete = initAddressAutocomplete;

function syncAddressValue(val) {
    // Null-safe on purpose — this used to assume both closer-cockpit fields
    // always exist and crash (TypeError on .value of null) anywhere else,
    // which is exactly what was breaking address selection on the setter
    // cockpit: the crash happened before closeAddressDropdown() ever ran,
    // so the dropdown looked unresponsive instead of erroring visibly.
    const scriptField = document.getElementById('script-address-input');
    const rightField = document.getElementById('right-address');
    if (scriptField) scriptField.value = val;
    if (rightField) rightField.value = val;
}

function syncDateValue(val) {
    document.getElementById('script-date-input').value = val;
    document.getElementById('appointment-date').value = val;
    syncScheduleDetails();
}

function syncWindowValue(val) {
    document.getElementById('script-window-input').value = val;
    document.getElementById('time-window').value = val;
    syncScheduleDetails();
}

function syncScheduleDetails() {
    const rawDate = document.getElementById('appointment-date').value;
    const rawWindow = document.getElementById('time-window').value;
    const scheduleTextEl = document.getElementById('inject-schedule-text');
    const finalWindowEl = document.getElementById('inject-final-window');
    if (scheduleTextEl) scheduleTextEl.innerText = rawDate !== "" ? rawDate : "(DATE)";
    if (finalWindowEl) finalWindowEl.innerText = (rawDate !== "" || rawWindow !== "") ? `${rawDate} (${rawWindow} Time Window)` : "(DAY & TIME WINDOW)";
}

// =========================================================================
// PRICING / DEPOSIT MATH — deposit tiers are config-driven per client
// =========================================================================
function executeRealtimeCalculations() {
    const config = getConfig();
    const initialValue = parseFloat(document.getElementById('initial-price').value) || 0;
    const monthlyValue = parseFloat(document.getElementById('monthly-price').value) || 0;
    const commissionPercentage = parseFloat(document.getElementById('commission-input').value) || 0;
    const currentPackage = document.getElementById('package-select').value;

    const totalContractValue = initialValue + (monthlyValue * 11);
    const calculatedPayoutValue = totalContractValue * (commissionPercentage / 100);

    document.getElementById('tcv-display').value = "$" + totalContractValue.toFixed(2);
    document.getElementById('payout-display').value = "$" + calculatedPayoutValue.toFixed(2);

    const setIfPresent = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.innerText = text;
    };

    setIfPresent('inject-initial-text', "$" + initialValue.toFixed(2));
    setIfPresent('inject-monthly-text', "$" + monthlyValue.toFixed(2));

    // Both figures here are the real, currently-selected/charged prices —
    // no separate "normal vs. discounted" anchor framing for the demo
    // script. Revisit per-client if a real anchor-price flow is needed;
    // that requires a genuine stored anchor price per package, not a
    // markup computed from whatever's currently selected (see roadmap).
    //
    // NOTE: these are CSS classes in cockpit.html, not ids (same pattern
    // as inject-script-name), so they need querySelectorAll — getElementById
    // silently finds nothing for a class, which is why this was stuck at
    // $0.00 even though the calculation itself was always correct.
    document.querySelectorAll('.inject-pitch-normal').forEach(el => { el.innerText = "$" + initialValue.toFixed(2); });
    document.querySelectorAll('.inject-pitch-monthly').forEach(el => { el.innerText = "$" + monthlyValue.toFixed(2); });

    let depositAmount = config.defaultDeposit ?? 39;
    const lowerPackageStr = currentPackage.toLowerCase();
    (config.depositRules || []).forEach(rule => {
        if (rule.keywords.some(kw => lowerPackageStr.includes(kw))) {
            depositAmount = rule.amount;
        }
    });

    const balanceRemaining = Math.max(0, initialValue - depositAmount);
    setIfPresent('inject-deposit-text', "$" + depositAmount);
    setIfPresent('inject-balance-text', "$" + balanceRemaining.toFixed(2));
}

// =========================================================================
// CREATE CUSTOMER — sends the account+lead payload to Ardenus (Stage 2 of
// the sales flow). Independent of final sale outcome; can be called on a
// call that never closes.
// =========================================================================
async function fireCreateCustomer() {
    const config = getConfig();
    const statusEl = document.getElementById('create-customer-status');
    const btn = document.getElementById('create-customer-btn');

    const requiredEls = {
        "First Name": document.getElementById('first-name').value.trim(),
        "Last Name": document.getElementById('last-name').value.trim(),
        "Phone": document.getElementById('phone').value.trim(),
        "Address": document.getElementById('right-address').value.trim(),
        "Package": document.getElementById('package-select').value
    };
    const missing = Object.entries(requiredEls).filter(([, v]) => !v).map(([k]) => k);
    if (missing.length > 0) {
        statusEl.style.color = "#f59e0b";
        statusEl.innerText = "Missing before creating customer: " + missing.join(", ");
        return;
    }

    if (!window.currentCallId) {
        window.currentCallId = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
    }

    const payload = {
        event_type: "create_account_and_lead",
        transaction_id: window.currentCallId,
        submitted_at: new Date().toISOString(),
        account: {
            first_name: document.getElementById('first-name').value.trim(),
            last_name: document.getElementById('last-name').value.trim(),
            phone: document.getElementById('phone').value.trim(),
            email: document.getElementById('customer-email').value.trim() || null,
            address: currentAddressComponents || { street: document.getElementById('right-address').value.trim(), city: "", state: "", zip: "" }
        },
        lead: {
            package_type: document.getElementById('package-select').value,
            initial_price: parseFloat(document.getElementById('initial-price').value) || 0,
            monthly_price: parseFloat(document.getElementById('monthly-price').value) || 0,
            appointment_notes: document.getElementById('appointment-notes-consolidated').value
        }
    };

    btn.disabled = true;
    statusEl.style.color = "var(--color-mint-soft)";
    statusEl.innerText = "Creating customer in FieldRoutes...";

    try {
        const authHeader = await getAuthHeader();
        const resp = await fetch(config.ardenusUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeader },
            body: JSON.stringify(payload)
        });
        const data = await resp.json();

        if (!resp.ok || data.status !== "success") {
            throw new Error(data.message || "Ardenus returned an error.");
        }

        // account-number field was removed from the UI (replaced with the
        // square footage dropdown) — window.currentFieldroutesAccountNumber
        // right below is the real source of truth other code reads from,
        // this was always just a visible mirror of it.
        const accountNumberEl = document.getElementById('account-number');
        if (accountNumberEl) accountNumberEl.value = data.fieldroutes_account_number;
        window.currentFieldroutesAccountNumber = data.fieldroutes_account_number;
        statusEl.style.color = "#4ade80";
        statusEl.innerText = "Customer created — Account #" + data.fieldroutes_account_number;

    } catch (err) {
        console.error("Create Customer failed:", err);
        statusEl.style.color = "#ef4444";
        statusEl.innerText = "Failed to create customer: " + err.message;
    } finally {
        btn.disabled = false;
    }
}
window.fireCreateCustomer = fireCreateCustomer;


// =========================================================================
// REP AUTHENTICATION — real login via Firebase Auth. rep_id/rep_name come
// from custom claims set at account-creation time (see the rep-admin
// script), never from anything the rep can type or edit in the browser.
// =========================================================================
let currentRepClaims = null;

function getRepId() {
    return (currentRepClaims && currentRepClaims.rep_id) || null;
}
function getRepName() {
    return (currentRepClaims && currentRepClaims.rep_name) || null;
}

async function getAuthHeader() {
    const user = firebase.auth().currentUser;
    if (!user) return {};
    const token = await user.getIdToken();
    return { "Authorization": "Bearer " + token };
}

function attemptLogin() {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');
    errorEl.innerText = "";

    firebase.auth().signInWithEmailAndPassword(email, password)
        .catch(err => { errorEl.innerText = err.message; });
}

function sendCockpitResetEmail() {
    const email = document.getElementById('login-email').value.trim();
    const errorEl = document.getElementById('login-error');
    if (!email) {
        errorEl.style.color = "#ef4444";
        errorEl.innerText = "Enter your email above first, then click Forgot password.";
        return;
    }
    firebase.auth().sendPasswordResetEmail(email)
        .then(() => {
            errorEl.style.color = "#4ade80";
            errorEl.innerText = "Reset email sent — check your inbox.";
        })
        .catch(err => {
            errorEl.style.color = "#ef4444";
            errorEl.innerText = err.message;
        });
}
window.sendCockpitResetEmail = sendCockpitResetEmail;

// Fire-and-forget: persists the rep's current theme choice so it can be
// aggregated later ("which theme gets used most"). Self-service only —
// jitneyadmin's set_theme_preference action only ever touches the calling
// rep's own account, verified from their own token. Failure here should
// never block the UI switch itself, so errors are swallowed after logging.
async function syncThemePreference(theme) {
    const config = getConfig();
    if (!config.adminUrl) return;
    try {
        const user = firebase.auth().currentUser;
        if (!user) return;
        const token = await user.getIdToken();
        await fetch(config.adminUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
            body: JSON.stringify({ action: "set_theme_preference", theme })
        });
    } catch (err) {
        console.error("Theme preference sync failed (non-blocking):", err.message);
    }
}
window.syncThemePreference = syncThemePreference;

function attemptLogout() {
    firebase.auth().signOut();
}
window.attemptLogin = attemptLogin;
window.attemptLogout = attemptLogout;

async function attemptForcedReset() {
    const newPassword = document.getElementById('reset-new-password').value;
    const confirmPassword = document.getElementById('reset-confirm-password').value;
    const errorEl = document.getElementById('reset-error');
    errorEl.innerText = "";

    if (newPassword.length < 8) {
        errorEl.innerText = "Password must be at least 8 characters.";
        return;
    }
    if (!/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword) || !/[^a-zA-Z0-9]/.test(newPassword)) {
        errorEl.innerText = "Password must include at least one letter, one number, and one special character.";
        return;
    }
    if (newPassword !== confirmPassword) {
        errorEl.innerText = "Passwords don't match.";
        return;
    }

    const config = getConfig();
    if (!config.adminUrl) {
        errorEl.innerText = "Setup error: adminUrl is not configured. Contact your administrator.";
        return;
    }

    try {
        const user = firebase.auth().currentUser;
        await user.updatePassword(newPassword);

        const token = await user.getIdToken(true);
        const resp = await fetch(config.adminUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
            body: JSON.stringify({ action: "clear_password_reset_flag" })
        });
        if (!resp.ok) {
            const data = await resp.json().catch(() => ({}));
            errorEl.innerText = "Password was set, but couldn't finish setup: " + (data.message || "unknown error") + ". Contact your administrator.";
            return;
        }

        // Force a fresh token so the cleared claim is reflected immediately,
        // then re-run the gate check directly (NOT initAuthGate(), which
        // would register a second onAuthStateChanged listener).
        await user.getIdToken(true);
        evaluateAuthGateState(firebase.auth().currentUser);
    } catch (err) {
        errorEl.innerText = err.message;
    }
}
window.attemptForcedReset = attemptForcedReset;

function startAppAfterLogin() {
    initTurnkeyEnvironment();
    initAddressAutocomplete();
    initLiveLeaderboard();
    runDynamicGuardrails();
    updateConsolidatedAppointmentNotes();
}

async function evaluateAuthGateState(user) {
    const loginGate = document.getElementById('login-gate');
    const appContent = document.getElementById('app-content');

    if (!user) {
        currentRepClaims = null;
        if (loginGate) loginGate.style.display = "flex";
        if (appContent) appContent.style.display = "none";
        return;
    }

    const tokenResult = await user.getIdTokenResult();
    if (!tokenResult.claims.rep_id || !tokenResult.claims.rep_name) {
        document.getElementById('login-error').innerText =
            "This account has no rep profile attached. Contact your administrator.";
        firebase.auth().signOut();
        return;
    }

    currentRepClaims = { rep_id: tokenResult.claims.rep_id, rep_name: tokenResult.claims.rep_name };

    const forceResetGate = document.getElementById('force-reset-gate');
    if (tokenResult.claims.must_reset_password) {
        if (loginGate) loginGate.style.display = "none";
        if (appContent) appContent.style.display = "none";
        if (forceResetGate) forceResetGate.style.display = "flex";
        return;
    }
    if (forceResetGate) forceResetGate.style.display = "none";

    if (loginGate) loginGate.style.display = "none";
    if (appContent) appContent.style.display = "flex";

    const displayEl = document.getElementById('logged-in-rep-display');
    if (displayEl) displayEl.innerText = currentRepClaims.rep_name;

    startAppAfterLogin();
}

function initAuthGate() {
    const config = getConfig();
    if (!config.firebaseConfig || !window.firebase) {
        console.error("Firebase config missing or SDK not loaded — cannot initialize login.");
        return;
    }
    if (!firebase.apps.length) {
        firebase.initializeApp(config.firebaseConfig);
    }
    firebase.auth().onAuthStateChanged(evaluateAuthGateState);
}
window.initAuthGate = initAuthGate;

// =========================================================================
// LIVE LEADERBOARD — Firestore realtime listener. Reads only; all writes
// go through jitneylogger's Admin SDK, which is the only thing with
// permission to write under the locked-down firestore.rules.
// =========================================================================
function getLocalDateKey(d, timeZone) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
    const map = {};
    parts.forEach(p => { map[p.type] = p.value; });
    return `${map.year}-${map.month}-${map.day}`;
}

function dateKeysForToday() {
    const config = getConfig();
    const timeZone = config.businessTimezone || "America/Denver";
    const d = new Date();
    const daily = getLocalDateKey(d, timeZone);

    // Build a UTC-equivalent Date from the LOCAL calendar date, so week-number
    // math (which needs a stable Date object) is based on Utah's calendar day,
    // not whatever UTC day happens to be at this exact instant.
    const [y, m, day] = daily.split('-').map(Number);
    const localAsUtc = new Date(Date.UTC(y, m - 1, day));

    const target = new Date(localAsUtc.valueOf());
    const dayNr = (localAsUtc.getUTCDay() + 6) % 7;
    target.setUTCDate(target.getUTCDate() - dayNr + 3);
    const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
    const weekNr = 1 + Math.round(((target - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
    const weekly = `${target.getUTCFullYear()}-W${String(weekNr).padStart(2, "0")}`;
    const monthly = daily.slice(0, 7);
    return { daily, weekly, monthly };
}

function renderPersonalStats(prefix, statsDoc) {
    const repBreakdown = (statsDoc && statsDoc.rep_breakdown && statsDoc.rep_breakdown[getRepId()]) || {};
    const callsTaken = repBreakdown.calls_taken || 0;
    const callsSold = repBreakdown.calls_sold || 0;
    const revenue = repBreakdown.revenue || 0;

    const setText = (id, text) => { const el = document.getElementById(id); if (el) el.innerText = text; };
    setText(`${prefix}-calls`, callsTaken);
    setText(`${prefix}-sold`, callsSold);
    setText(`${prefix}-rate`, callsTaken > 0 ? ((callsSold / callsTaken) * 100).toFixed(1) + "%" : "0.0%");
    setText(`${prefix}-tcv`, "$" + revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    setText(`${prefix}-acv`, callsSold > 0 ? "$" + (revenue / callsSold).toFixed(2) : "$0.00");
    setText(`${prefix}-rpc`, callsTaken > 0 ? "$" + (revenue / callsTaken).toFixed(2) : "$0.00");

    // Approximation: applies the CURRENT commission-input rate against total
    // revenue. Accurate if commission % stays consistent; doesn't retroactively
    // account for calls logged under a different rate. Good enough for now —
    // the precise fix is tracking commission per-call server-side (fast-follow).
    const commissionPercent = parseFloat(document.getElementById('commission-input')?.value) || 0;
    setText(`${prefix}-comm`, "$" + (revenue * (commissionPercent / 100)).toFixed(2));
}

// Which stat ranks the leaderboard — set via config.leaderboardMetric.
// "revenue" (default), "calls_sold", or "close_rate".
function getLeaderboardMetricValue(data) {
    const config = getConfig();
    const metric = config.leaderboardMetric || "revenue";
    const callsTaken = data.calls_taken || 0;
    const callsSold = data.calls_sold || 0;
    const revenue = data.revenue || 0;

    if (metric === "calls_sold") {
        return { value: callsSold, display: String(callsSold) };
    }
    if (metric === "close_rate") {
        const rate = callsTaken > 0 ? (callsSold / callsTaken) * 100 : 0;
        return { value: rate, display: rate.toFixed(1) + "%" };
    }
    return { value: revenue, display: "$" + revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) };
}

function renderLeaderboard(dailyStatsDoc) {
    const container = document.getElementById('leaderboard-grid');
    if (!container) return;

    const repBreakdown = (dailyStatsDoc && dailyStatsDoc.rep_breakdown) || {};
    const rows = Object.entries(repBreakdown)
        .map(([repId, data]) => {
            const metric = getLeaderboardMetricValue(data);
            return { repId, displayName: data.display_name || repId, metricValue: metric.value, metricDisplay: metric.display };
        })
        .sort((a, b) => b.metricValue - a.metricValue);

    if (rows.length === 0) {
        container.innerHTML = `<div class="leaderboard-row"><span style="opacity:0.6;">Waiting for today's activity...</span></div>`;
        return;
    }

    const currentRepId = getRepId();
    container.innerHTML = rows.map((row, index) => {
        const isUser = row.repId === currentRepId;
        const rankClass = index === 0 ? "rank-1" : "";
        const userClass = isUser ? "user-row" : "";
        const label = isUser ? `${row.displayName} (You)` : row.displayName;
        return `
            <div class="leaderboard-row ${rankClass} ${userClass}">
                <div><span class="rep-rank-badge">${index + 1}</span>${label}</div>
                <span class="metrics-val ${isUser ? 'val-highlight' : ''}">${row.metricDisplay}</span>
            </div>
        `;
    }).join('');
}

let latestDailyStatsDoc = null;
let latestWeeklyStatsDoc = null;

function refreshCommissionDisplay() {
    if (latestDailyStatsDoc !== null) renderPersonalStats('day', latestDailyStatsDoc);
    if (latestWeeklyStatsDoc !== null) renderPersonalStats('week', latestWeeklyStatsDoc);
}
window.refreshCommissionDisplay = refreshCommissionDisplay;

function initLiveLeaderboard() {
    const config = getConfig();
    if (!config.firebaseConfig || !window.firebase) {
        console.error("Firebase config missing or Firebase SDK not loaded — live leaderboard disabled.");
        return;
    }
    if (!config.clientId) {
        console.error("JITNEYLOGIC_CONFIG.clientId is not set — live leaderboard disabled.");
        return;
    }

    if (!firebase.apps.length) {
        firebase.initializeApp(config.firebaseConfig);
    }
    const db = firebase.firestore();
    const clientRef = db.collection('clients').doc(config.clientId);
    const { daily, weekly } = dateKeysForToday();

    clientRef.collection('daily_stats').doc(daily).onSnapshot(doc => {
        const data = doc.data();
        latestDailyStatsDoc = data;
        renderPersonalStats('day', data);
        renderLeaderboard(data);
    }, err => console.error("Daily stats listener error:", err));

    clientRef.collection('weekly_stats').doc(weekly).onSnapshot(doc => {
        latestWeeklyStatsDoc = doc.data();
        renderPersonalStats('week', latestWeeklyStatsDoc);
    }, err => console.error("Weekly stats listener error:", err));
}
window.initLiveLeaderboard = initLiveLeaderboard;

// =========================================================================
// EXECUTIVE DASHBOARD — same Firestore data as the cockpit leaderboard,
// different presentation (office-wide department cards + a full rep table,
// no "current user" concept since an executive isn't any one rep).
// =========================================================================
function renderDepartmentCard(prefix, statsDoc) {
    const callsTaken = (statsDoc && statsDoc.calls_taken) || 0;
    const callsSold = (statsDoc && statsDoc.calls_sold) || 0;
    const revenue = (statsDoc && statsDoc.total_revenue) || 0;

    const setText = (id, text) => { const el = document.getElementById(id); if (el) el.innerText = text; };
    setText(`${prefix}-calls`, callsTaken);
    setText(`${prefix}-closed`, callsSold);
    setText(`${prefix}-rate`, callsTaken > 0 ? ((callsSold / callsTaken) * 100).toFixed(1) + "%" : "0.0%");
    setText(`${prefix}-rev`, "$" + revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    setText(`${prefix}-rpc`, callsTaken > 0 ? "$" + (revenue / callsTaken).toFixed(2) : "$0.00");
}

function renderRepStandingsTable(statsDoc) {
    const tbody = document.getElementById('rep-standings-tbody');
    if (!tbody) return;

    const repBreakdown = (statsDoc && statsDoc.rep_breakdown) || {};
    const rows = Object.entries(repBreakdown)
        .map(([repId, data]) => ({
            repId,
            displayName: data.display_name || repId,
            callsTaken: data.calls_taken || 0,
            callsSold: data.calls_sold || 0,
            revenue: data.revenue || 0,
            metricValue: getLeaderboardMetricValue(data).value
        }))
        .sort((a, b) => b.metricValue - a.metricValue);

    if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; opacity:0.6;">Waiting for today's activity...</td></tr>`;
        return;
    }

    tbody.innerHTML = rows.map((row, index) => {
        const rate = row.callsTaken > 0 ? ((row.callsSold / row.callsTaken) * 100).toFixed(1) + "%" : "0.0%";
        const rpc = row.callsTaken > 0 ? "$" + (row.revenue / row.callsTaken).toFixed(2) : "$0.00";
        const rankClass = index === 0 ? "rank-row-1" : (index === 1 ? "rank-row-2" : "");
        return `
            <tr class="${rankClass}">
                <td><span class="rank-badge">${index + 1}</span>${row.displayName}</td>
                <td class="monospaced-cell">${row.callsTaken}</td>
                <td class="monospaced-cell">${row.callsSold}</td>
                <td class="monospaced-cell">${rate}</td>
                <td class="monospaced-cell money-cell">$${row.revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td class="monospaced-cell">${rpc}</td>
            </tr>
        `;
    }).join('');
}

function initExecutiveDashboard() {
    const config = getConfig();
    if (!config.firebaseConfig || !window.firebase) {
        console.error("Firebase config missing or Firebase SDK not loaded — executive dashboard disabled.");
        return;
    }
    if (!config.clientId) {
        console.error("JITNEYLOGIC_CONFIG.clientId is not set — executive dashboard disabled.");
        return;
    }

    if (!firebase.apps.length) {
        firebase.initializeApp(config.firebaseConfig);
    }
    const db = firebase.firestore();
    const clientRef = db.collection('clients').doc(config.clientId);
    const { daily, weekly, monthly } = dateKeysForToday();

    // Cached here, not just rendered immediately — the day/week/month
    // toggle on the dashboard needs to re-render either table on demand
    // without waiting for a new Firestore snapshot, so the latest doc for
    // each timeframe has to be available outside this listener's scope.
    window.latestDeptStats = window.latestDeptStats || { daily: null, weekly: null, monthly: null };

    clientRef.collection('daily_stats').doc(daily).onSnapshot(doc => {
        const data = doc.data();
        window.latestDeptStats.daily = data;
        renderDepartmentCard('global-today', data);
        if (window.onDeptStatsUpdated) window.onDeptStatsUpdated('daily', data);
    }, err => console.error("Daily stats listener error:", err));

    clientRef.collection('weekly_stats').doc(weekly).onSnapshot(doc => {
        const data = doc.data();
        window.latestDeptStats.weekly = data;
        renderDepartmentCard('global-week', data);
        if (window.onDeptStatsUpdated) window.onDeptStatsUpdated('weekly', data);
    }, err => console.error("Weekly stats listener error:", err));

    clientRef.collection('monthly_stats').doc(monthly).onSnapshot(doc => {
        const data = doc.data();
        window.latestDeptStats.monthly = data;
        renderDepartmentCard('global-month', data);
        if (window.onDeptStatsUpdated) window.onDeptStatsUpdated('monthly', data);
    }, err => console.error("Monthly stats listener error:", err));
}
window.initExecutiveDashboard = initExecutiveDashboard;



async function fireRevenuePipelineTracking(event) {
    event.preventDefault();

    const outcome = document.getElementById('call-outcome').value;

    // Native `required` validation can get visually clipped inside
    // scrollable/flex containers (which this layout uses throughout),
    // so browsers sometimes correctly block submission without ever
    // showing their bubble. Don't rely on that alone — check explicitly.
    if (!outcome) {
        alert("Please select a Call Outcome before submitting.");
        return;
    }
    const phoneEl = document.getElementById('phone') || document.getElementById('script-phone-input');
    if (phoneEl && !phoneEl.value.trim()) {
        alert("Please enter a customer phone number before submitting.");
        return;
    }

    // Every call needs a phone number and an outcome (enforced via HTML
    // `required`, already checked by the browser before we get here).
    // A "Sold" outcome additionally requires the full customer record,
    // since that's what actually gets used to create the account/schedule
    // the job. A lost/callback call doesn't need any of this.
    if (outcome === "Sold") {
        const missing = [];
        if (!document.getElementById('first-name').value.trim()) missing.push("First Name");
        if (!document.getElementById('last-name').value.trim()) missing.push("Last Name");
        if (!document.getElementById('right-address').value.trim()) missing.push("Service Address");
        if (!document.getElementById('appointment-date').value) missing.push("Service Date");
        if (!document.getElementById('package-select').value) missing.push("Package");

        if (missing.length > 0) {
            alert("Before marking this call Sold, please fill in: " + missing.join(", "));
            return;
        }
    }

    const assignedPackage = document.getElementById('package-select').value || "No Package Mapped";
    const currentTcvValue = parseFloat(document.getElementById('tcv-display').value.replace('$', '')) || 0;
    const commissionEarned = parseFloat(document.getElementById('payout-display').value.replace('$', '')) || 0;
    const initialValue = parseFloat(document.getElementById('initial-price').value) || 0;
    const monthlyValue = parseFloat(document.getElementById('monthly-price').value) || 0;

    const clientFirst = document.getElementById('first-name').value.trim() || "Unknown";
    const clientLast = document.getElementById('last-name').value.trim() || "Client";
    // account-number field was removed from the UI (replaced with square
    // footage) — this used to read the account number from that field, but
    // window.currentFieldroutesAccountNumber is the real source of truth
    // (set directly wherever FieldRoutes actually returns one), so read
    // from there instead of a DOM element that no longer exists. This was
    // a real bug: reading .value off a null element would have thrown on
    // every single call submission, not just ones involving this field.
    const clientAccount = window.currentFieldroutesAccountNumber || "N/A";

    if (!window.currentCallId) {
        window.currentCallId = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
    }

    const loggerPayload = {
        call_id: window.currentCallId,
        client_id: getConfig().clientId,
        rep_id: getRepId(),
        rep_name: getRepName(),
        pest_type: Array.from(document.querySelectorAll('.pest-checkbox:checked')).map(cb => cb.getAttribute('data-display')).join(', ') || null,
        zip_code: (currentAddressComponents && currentAddressComponents.zip) || null,
        package_quoted: assignedPackage,
        agreement_length_quoted: null,
        initial_price_quoted: initialValue,
        monthly_price_quoted: monthlyValue,
        lead_source: document.getElementById('lead-source') ? document.getElementById('lead-source').value : null,
        outcome: outcome,
        fieldroutes_account_number: window.currentFieldroutesAccountNumber || null
    };

    const config = getConfig();
    if (config.loggerUrl) {
        const authHeader = await getAuthHeader();
        fetch(config.loggerUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeader },
            body: JSON.stringify(loggerPayload)
        }).catch(err => console.error("jitneylogger POST failed:", err));
        // Not awaited on purpose — the realtime listener will reflect the
        // write within a moment; we don't want to block form reset on it.
    }

    // Setter -> closer handoff: whatever lead this call was for is resolved
    // now, one way or another. "Release Lead" is a distinct outcome, not a
    // separate button anymore — selecting it and submitting puts the lead
    // back in the queue instead of marking it complete, so it becomes
    // claimable again (by this closer or anyone else) rather than
    // permanently stuck as "theirs." Still goes through the normal
    // jitneylogger POST above first, on purpose — that's what makes "how
    // often is this happening, and to which reps" a real, visible stat
    // later, the same way every other incentive problem in this system
    // gets caught by being in the data, not by intuition.
    if (window.currentActiveLeadId) {
        if (outcome === "Release Lead" && window.fireReleaseLead) {
            fireReleaseLead(window.currentActiveLeadId).catch(err =>
                console.error("release_lead failed (non-blocking):", err.message));
        } else if (window.fireCompleteLead) {
            fireCompleteLead(window.currentActiveLeadId);
        }
    }

    const logTableBody = document.getElementById('tracker-log-tbody');
    if (logTableBody) {
        const timestampString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const resultStyleBadge = outcome === "Sold" ? "color:#4ade80; font-weight:bold;" : (outcome === "Scheduled Callback" ? "color:#f59e0b;" : "color:#ef4444;");

        logTableBody.insertAdjacentHTML('afterbegin', `
            <tr>
                <td>${timestampString}</td>
                <td><strong>${clientFirst} ${clientLast}</strong></td>
                <td style="font-family:monospace;">${clientAccount}</td>
                <td>${assignedPackage}</td>
                <td style="font-weight:bold;">$${currentTcvValue.toFixed(2)}</td>
                <td style="color:var(--color-mint-soft); font-weight:bold;">$${commissionEarned.toFixed(2)}</td>
                <td style="${resultStyleBadge}">${outcome}</td>
            </tr>
        `);
    }

    document.getElementById('closer-portal-form').reset();
    runDynamicGuardrails();
    document.getElementById('script-location-input').value = "";
    document.getElementById('script-duration-input').value = "";
    document.getElementById('script-address-input').value = "";
    document.getElementById('script-date-input').value = "";
    document.getElementById('script-window-input').value = "AT";

    document.getElementById('display-selected-text').innerText = '-- Select Active Infestations --';
    document.getElementById('display-script-selected-text').innerText = '-- Select Active Infestations --';

    document.querySelectorAll('.script-pest-cb, .pest-checkbox').forEach(cb => cb.checked = false);

    syncCustomerName("");
    syncLastName("");
    syncEmailValue("");
    syncPhoneValue("");
    syncAddressValue("");
    currentAddressComponents = null;
    const accountNumberElReset = document.getElementById('account-number');
    if (accountNumberElReset) accountNumberElReset.value = ""; // element removed from UI, kept null-safe in case it's ever reintroduced
    document.getElementById('create-customer-status').innerText = "";
    window.currentCallId = null;
    window.currentFieldroutesAccountNumber = null;
    window.currentActiveLeadId = null;
    document.querySelectorAll('.setter-notes-box').forEach(box => box.style.display = 'none');
    document.querySelectorAll('.inject-setter-name').forEach(el => { el.innerText = 'your setter'; });
    document.querySelectorAll('.inject-pest-list').forEach(el => { el.innerText = 'some pest issues'; });
    if (window.resetSqftState) window.resetSqftState(); // optional hook, guarded — defined per-file where the sqft dropdown exists
    document.querySelectorAll('#next-lead-status, #next-lead-status-script').forEach(el => el.innerText = '');
    if (window.renderIncomingBanner) window.renderIncomingBanner(); // a pending transfer may now be free to show
    syncScheduleDetails();
    runDynamicGuardrails();
    parseScriptPestLogicHandshake();

    // Fields are cleared above, but scroll position isn't — a rep coming off
    // a long call would otherwise land back on a blank form still scrolled
    // partway down from the previous one.
    const scriptPaneEl = document.getElementById('script-pane');
    const inputPaneEl = document.getElementById('input-pane');
    if (scriptPaneEl) scriptPaneEl.scrollTop = 0;
    if (inputPaneEl) inputPaneEl.scrollTop = 0;
}

// =====================================================================
// SETTER → CLOSER HANDOFF — added for the HomeShield pilot build.
// Talks to the jitneyleads Cloud Run service (config.leadsUrl), one
// endpoint routed by an `action` field, same convention as adminUrl.
// =====================================================================

// SETTER SIDE — submit a lead, either a live transfer or into the blind queue.
async function fireSubmitLead(leadData, transferType) {
    const config = getConfig();
    if (!config.leadsUrl) throw new Error("Setup error: leadsUrl is not configured.");

    const payload = {
        action: "submit_lead",
        clientId: config.clientId,
        transferType: transferType === "live" ? "live" : "queue",
        customerName: leadData.customerName || null,
        customerPhone: leadData.customerPhone || null,
        address: leadData.address || null,
        pestTypes: leadData.pestTypes || [],
        notes: leadData.notes || "",
        qualified: typeof leadData.qualified === "boolean" ? leadData.qualified : null,
        unqualifiedReason: leadData.unqualifiedReason || null,
        setterId: getRepId(),
        setterName: getRepName()
    };

    const authHeader = await getAuthHeader();
    const resp = await fetch(config.leadsUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify(payload)
    });
    const data = await resp.json();
    if (!resp.ok || data.status !== "success") {
        throw new Error(data.message || "Couldn't submit the lead.");
    }

    // Only fires for live transfers, and only if a dialer webhook is
    // actually configured. Skipped safely until we know the client's
    // real dialer — the lead still reaches the closer via the Firestore
    // banner below either way.
    if (transferType === "live" && config.dialerWebhookUrl) {
        fetch(config.dialerWebhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                event: "live_transfer",
                lead_id: data.leadId,
                customer_phone: payload.customerPhone
            })
        }).catch(err => console.warn("Dialer webhook not reachable (non-blocking):", err.message));
    }

    return { leadId: data.leadId, leadStatus: data.leadStatus };
}
window.fireSubmitLead = fireSubmitLead;

// CLOSER SIDE — claim the oldest queued lead. Assignment happens
// server-side inside a Firestore transaction (see leads-service.js),
// which is what actually prevents two closers claiming the same lead —
// this function just calls it and reports the result.
async function fireClaimNextQueuedLead() {
    const config = getConfig();
    if (!config.leadsUrl) throw new Error("Setup error: leadsUrl is not configured.");

    const authHeader = await getAuthHeader();
    const resp = await fetch(config.leadsUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ action: "claim_queue_lead", clientId: config.clientId })
    });

    if (resp.status === 204) return null; // queue is empty right now
    const data = await resp.json();
    if (!resp.ok || data.status !== "success") {
        throw new Error(data.message || "Couldn't claim a lead.");
    }
    return data.lead;
}
window.fireClaimNextQueuedLead = fireClaimNextQueuedLead;

// CLOSER SIDE — claim a specific live-transfer lead the moment it's
// tapped in the incoming banner. First tap wins.
async function fireClaimTransferLead(leadId) {
    const config = getConfig();
    const authHeader = await getAuthHeader();
    const resp = await fetch(config.leadsUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ action: "claim_transfer_lead", clientId: config.clientId, leadId })
    });
    const data = await resp.json();
    // Two different reasons can produce a 409: someone else claimed this
    // exact transfer first (silent — the banner just moves on), or this
    // closer already has a different lead active (real error, must be shown
    // rather than swallowed, or they'd never learn why nothing happened).
    if (resp.status === 409 && data.reason === "claimed_by_other") return null;
    if (!resp.ok || data.status !== "success") {
        throw new Error(data.message || "Couldn't claim this transfer.");
    }
    return data.lead;
}
window.fireClaimTransferLead = fireClaimTransferLead;

// CLOSER SIDE — real-time banner for incoming live transfers, same
// onSnapshot pattern the leaderboard already uses.
function initIncomingTransferBanner(onIncoming) {
    const config = getConfig();
    const db = firebase.firestore();
    db.collection("clients").doc(config.clientId).collection("leads")
        .where("status", "==", "transferring")
        .onSnapshot(snap => {
            snap.docChanges().forEach(change => {
                if (change.type === "added") {
                    onIncoming(change.doc.id, change.doc.data());
                }
                if (change.type === "removed" || (change.type === "modified" && change.doc.data().status !== "transferring")) {
                    onIncoming(change.doc.id, null); // signals "remove from banner"
                }
            });
        });
}
// CLOSER SIDE — mark the currently-claimed lead done. Called automatically
// right after a call is submitted (see the edit to fireRevenuePipelineTracking
// below) — this is what actually frees the closer to claim another lead.
async function fireCompleteLead(leadId) {
    const config = getConfig();
    if (!config.leadsUrl || !leadId) return;
    try {
        const authHeader = await getAuthHeader();
        await fetch(config.leadsUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeader },
            body: JSON.stringify({ action: "complete_lead", clientId: config.clientId, leadId })
        });
    } catch (err) {
        // Non-blocking on purpose, same as the loggerUrl call right above it
        // in fireRevenuePipelineTracking — a rep's next claim attempt will
        // surface a clear error if this silently failed, rather than
        // blocking form reset on it.
        console.error("complete_lead failed (non-blocking):", err.message);
    }
}
// CLOSER SIDE — check whether this closer already has a lead claimed,
// server-side. Called on page load, not just when claiming — this is what
// lets the cockpit recover its state after a reload instead of leaving
// someone stuck with a server-side lock and no client-side memory of it.
async function fireGetActiveLead() {
    const config = getConfig();
    if (!config.leadsUrl) return null;
    try {
        const authHeader = await getAuthHeader();
        const resp = await fetch(config.leadsUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeader },
            body: JSON.stringify({ action: "get_active_lead", clientId: config.clientId })
        });
        if (resp.status === 204) return null;
        const data = await resp.json();
        if (!resp.ok || data.status !== "success") return null;
        return data.lead;
    } catch (err) {
        console.error("get_active_lead check failed (non-blocking):", err.message);
        return null;
    }
}
window.fireGetActiveLead = fireGetActiveLead;

// CLOSER SIDE — "Pull Lead." Searches both queues server-side by phone
// number (see leads-service.js for why digits-only matching happens
// there, not here). 409 with reason "already_active" is a real error to
// show, not silence — same distinction as the other claim paths.
async function firePullLead(phone) {
    const config = getConfig();
    if (!config.leadsUrl) throw new Error("Setup error: leadsUrl is not configured.");
    const authHeader = await getAuthHeader();
    const resp = await fetch(config.leadsUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ action: "pull_lead", clientId: config.clientId, phone })
    });
    const data = await resp.json();
    if (!resp.ok || data.status !== "success") {
        throw new Error(data.message || "Couldn't pull a lead for that number.");
    }
    return data.lead;
}
window.firePullLead = firePullLead;

// SHARED — live count of leads sitting in the callback queue
// (status=="queued"). Used by both the closer cockpit (next to the Next
// Available Lead button) and the executive dashboard. One listener
// definition instead of duplicating the same Firestore query in two
// files. Firestore rules already allow any authenticated rep at this
// client to read the leads collection, so no rule changes needed for
// this to work.
function initCallbackQueueCounter(elementId) {
    const config = getConfig();
    const db = firebase.firestore();
    const el = document.getElementById(elementId);
    if (!el) return;
    // Reads the queue_stats aggregate, not the leads collection directly.
    // The leads collection correctly requires authentication (individual
    // documents carry real contact info) — but the executive dashboard
    // never logs a user in at all (same as daily_stats/weekly_stats, it's
    // meant to run unattended on a TV). Querying leads directly from an
    // unauthenticated page silently failed the permission check and left
    // this stuck at 0 forever. queue_stats is a bare count with no PII,
    // public-read the same way daily_stats already is.
    db.collection("clients").doc(config.clientId).collection("queue_stats").doc("callback")
        .onSnapshot(doc => {
            el.innerText = doc.exists ? (doc.data().count || 0) : 0;
        }, err => {
            console.error("Callback queue counter listener failed:", err.message);
        });
}
window.initCallbackQueueCounter = initCallbackQueueCounter;

// SETTER SIDE — zip eligibility check.
async function fireCheckZipEligibility(zip) {
    const config = getConfig();
    if (!config.leadsUrl) throw new Error("Setup error: leadsUrl is not configured.");
    const authHeader = await getAuthHeader();
    const resp = await fetch(config.leadsUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ action: "check_zip_eligibility", clientId: config.clientId, zip })
    });
    const data = await resp.json();
    if (!resp.ok || data.status !== "success") {
        throw new Error(data.message || "Couldn't check that zip code.");
    }
    return data.eligible;
}
window.fireCheckZipEligibility = fireCheckZipEligibility;

// EXEC ADMIN — bulk add zips from a parsed CSV (array of strings), and
// list the current serviceable-zip list for export. Both go through the
// backend (Admin SDK) rather than direct client Firestore access — see
// firestore.rules comment on serviceable_zips for why.
async function fireBulkAddZips(zips) {
    const config = getConfig();
    const authHeader = await getAuthHeader();
    const resp = await fetch(config.leadsUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ action: "bulk_add_zips", clientId: config.clientId, zips })
    });
    const data = await resp.json();
    if (!resp.ok || data.status !== "success") {
        throw new Error(data.message || "Couldn't add those zip codes.");
    }
    return data; // { added, skipped }
}
window.fireBulkAddZips = fireBulkAddZips;

async function fireListZips() {
    const config = getConfig();
    const authHeader = await getAuthHeader();
    const resp = await fetch(config.leadsUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ action: "list_zips", clientId: config.clientId })
    });
    const data = await resp.json();
    if (!resp.ok || data.status !== "success") {
        throw new Error(data.message || "Couldn't load the zip list.");
    }
    return data.zips;
}
window.fireListZips = fireListZips;

// EXEC ADMIN — end-of-day export + clear for the callback queue. See the
// backend function's comment for why this is the deliberate exception to
// the no-PII-retention rule everywhere else in this system.
async function fireExportAndClearQueue() {
    const config = getConfig();
    const authHeader = await getAuthHeader();
    const resp = await fetch(config.leadsUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ action: "export_and_clear_queue", clientId: config.clientId })
    });
    const data = await resp.json();
    if (!resp.ok || data.status !== "success") {
        throw new Error(data.message || "Couldn't export and clear the queue.");
    }
    return data; // { leads, cleared }
}
window.fireExportAndClearQueue = fireExportAndClearQueue;

window.fireCompleteLead = fireCompleteLead;

// CLOSER SIDE — release a claimed lead back to the queue without
// submitting a call for it (wrong number, no answer, etc).
async function fireReleaseLead(leadId) {
    const config = getConfig();
    if (!config.leadsUrl) throw new Error("Setup error: leadsUrl is not configured.");
    const authHeader = await getAuthHeader();
    const resp = await fetch(config.leadsUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ action: "release_lead", clientId: config.clientId, leadId })
    });
    const data = await resp.json();
    if (!resp.ok || data.status !== "success") {
        throw new Error(data.message || "Couldn't release this lead.");
    }
}
window.fireReleaseLead = fireReleaseLead;

window.initIncomingTransferBanner = initIncomingTransferBanner;
