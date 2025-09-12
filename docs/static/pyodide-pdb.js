// Interactive Python stepping using pyodide and pdb

const PyodidePDB = {
  // Remove individual dependency management - use shared manager
  async extractVariableNames(code) {
    const pyodide = await SharedPyodideManager.loadPDBModule();

    const result = await pyodide.runPythonAsync(`
pyodide_pdb.extract_assigned_variables("""${code.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}""")
`);

    return result.toJs();
  }
};

class InteractiveExample {
  constructor(container) {
    this.container = container;
    this.codeBlock = container.querySelector('pre code');
    this.code = this.codeBlock.textContent.trim();
    this.originalCode = this.code;
    this.initialized = false;
    this.instanceId = `debugger_${Math.random().toString(36).substr(2, 9)}`;
    this.scrollListener = null;

    this._initializeUI();
    this._applySyntaxHighlighting();
    this._setupLazyLoading();
  }

  _initializeUI() {
    this._initializeSidebar();
    this._initializeControls();
  }

  _applySyntaxHighlighting() {
    // Apply syntax highlighting immediately if Prism is available
    if (window.Prism && this.codeBlock) {
      this._ensureLanguageClass();
      SharedPyodideManager.highlightCode(this.codeBlock, 'python');
    }
  }

  _ensureLanguageClass() {
    // Ensure the code block has the correct language class
    if (!this.codeBlock.className.includes('language-python')) {
      this.codeBlock.className += ' language-python';
    }
    // Also apply to parent pre for prism themes
    if (this.codeBlock.parentElement && !this.codeBlock.parentElement.className.includes('language-python')) {
      this.codeBlock.parentElement.className += ' language-python';
    }
  }

  _setupLazyLoading() {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !this.initialized) {
          this._safeInit();
          observer.unobserve(this.container);
        }
      });
    }, { rootMargin: '100px' }); // Start loading 100px before visible

    observer.observe(this.container);
  }

  async _safeInit() {
    try {
      await this.init();
    } catch (error) {
      console.warn('Failed to initialize interactive example:', error);
    }
  }

  _initializeSidebar() {
    // Create variables section as direct child if missing
    this.variablesDiv = this.container.querySelector('.variables-section');
    if (!this.variablesDiv) {
      this.variablesDiv = document.createElement('div');
      this.variablesDiv.className = 'variables-section';
      this.variablesDiv.innerHTML = '<strong>Variables</strong><p><em>Loading...</em></p>';
      this.container.appendChild(this.variablesDiv);
    }

    // Create output section as direct child if missing
    this.outputDiv = this.container.querySelector('.output-section');
    if (!this.outputDiv) {
      this.outputDiv = document.createElement('div');
      this.outputDiv.className = 'output-section';
      this.outputDiv.innerHTML = '<strong>Output</strong><div class="output-content"></div>';
      this.container.appendChild(this.outputDiv);
    }
  }

  _initializeControls() {
    // Inject controls if missing
    this.controlsDiv = this.container.querySelector('.controls');
    if (!this.controlsDiv) {
      this.controlsDiv = document.createElement('div');
      this.controlsDiv.className = 'controls';

      const buttonContainer = document.createElement('div');
      buttonContainer.className = 'button-container';

      this.stepBtn = document.createElement('button');
      this.stepBtn.className = 'step-btn';
      this.stepBtn.textContent = 'Execute highlighted line';
      this.stepBtn.disabled = true;

      this.resetBtn = document.createElement('button');
      this.resetBtn.className = 'reset-btn';
      this.resetBtn.textContent = 'Reset';
      this.resetBtn.disabled = true;

      buttonContainer.appendChild(this.stepBtn);
      buttonContainer.appendChild(this.resetBtn);

      this.controlsDiv.appendChild(buttonContainer);

      // Insert controls div inside the pre element
      const preElement = this.codeBlock.parentNode;
      preElement.appendChild(this.controlsDiv);
    } else {
      this.stepBtn = this.controlsDiv.querySelector('.step-btn');
      this.resetBtn = this.controlsDiv.querySelector('.reset-btn');

      // Disable buttons if they exist
      if (this.stepBtn) this.stepBtn.disabled = true;
      if (this.resetBtn) this.resetBtn.disabled = true;
    }

    // Setup floating controls behavior
    this._setupFloatingControls();
  }

  _setupFloatingControls() {
    // Create throttled scroll handler
    let ticking = false;
    this.scrollListener = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          this._updateControlsVisibilityAndPosition();
          ticking = false;
        });
        ticking = true;
      }
    };

    // Add scroll listener
    window.addEventListener('scroll', this.scrollListener, { passive: true });
    window.addEventListener('resize', this.scrollListener, { passive: true });

    // Initial position check
    setTimeout(() => this._updateControlsVisibilityAndPosition(), 100);
  }

  _updateControlsVisibilityAndPosition() {
    if (!this.controlsDiv || !this.codeBlock) return;

    const preElement = this.codeBlock.parentNode; // The <pre> element
    const preRect = preElement.getBoundingClientRect();
    const viewportHeight = window.innerHeight;

    // Check if pre is in viewport
    const preInViewport = preRect.bottom > 0 && preRect.top < viewportHeight;

    // Always show controls when pre is visible
    if (preInViewport) {
      this.controlsDiv.classList.remove('invisible');
    } else {
      this.controlsDiv.classList.add('invisible');
      return; // Don't update floating state if invisible
    }

    // Determine if controls should float
    const preBottomBelowViewport = preRect.bottom > viewportHeight;
    const preTallerThanHalfViewport = preRect.height > viewportHeight * 0.5;

    const shouldFloat = preBottomBelowViewport &&
                       preTallerThanHalfViewport &&
                       preInViewport;

    if (shouldFloat && !this.controlsDiv.classList.contains('floating')) {
      this.controlsDiv.classList.add('floating');
      this._positionFloatingControls(preRect);
    } else if (!shouldFloat && this.controlsDiv.classList.contains('floating')) {
      this.controlsDiv.classList.remove('floating');
      this._clearFloatingPosition();
    } else if (shouldFloat && this.controlsDiv.classList.contains('floating')) {
      // Update position if already floating (handles window resize/scroll)
      this._positionFloatingControls(preRect);
    }
  }

  _positionFloatingControls(preRect) {
    // Position controls to align with the right edge of the pre element
    // Skip positioning on mobile (let CSS handle it)
    if (window.innerWidth <= 768) {
      return;
    }

    const rightPosition = window.innerWidth - preRect.right;
    this.controlsDiv.style.right = `${rightPosition}px`;
  }

  _clearFloatingPosition() {
    // Clear any inline positioning when not floating
    this.controlsDiv.style.right = '';
  }

  async init() {
    try {
      this.pyodide = await SharedPyodideManager.loadPDBModule();

      await this._autoDetectVariables();
      await this.reset();

      this._enableControls();
      this._attachEventListeners();

      // Update controls position after initialization
      this._updateControlsVisibilityAndPosition();
    } catch (error) {
      console.warn('Initialization failed:', error);
    }
  }

  async _autoDetectVariables() {
    // Auto-detect variables if not specified
    let varNames = this._getDatasetVariables();
    if (varNames.length === 0) {
      const extractedVars = await PyodidePDB.extractVariableNames(this.code);
      varNames = Array.isArray(extractedVars) ? extractedVars : Array.from(extractedVars);
    }
    this.varNames = varNames;
  }

  _getDatasetVariables() {
    return (this.container.dataset.variables || '')
      .split(',')
      .map(v => v.trim())
      .filter(Boolean);
  }

  _enableControls() {
    // Enable buttons after everything is ready
    this.stepBtn.disabled = false;
    this.resetBtn.disabled = false;
  }

  _attachEventListeners() {
    this.stepBtn.addEventListener('click', () => this.step());
    this.resetBtn.addEventListener('click', () => this.reset());
  }

  async reset() {
    if (!this.pyodide) {
      return;
    }
    try {
      await this.pyodide.runPythonAsync(`
${this.instanceId} = pyodide_pdb.StepDebugger("""${this.code.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}""", ${JSON.stringify(this.varNames)})
${this.instanceId}.reset()
`);

      // Get initial state - this should show the first line ready to execute
      this.state = await this.getState();

      // Reset UI state
      this.stepBtn.disabled = false;
      this.stepBtn.textContent = this.state.current_line >= 0 ? 'Execute highlighted line' : 'Start execution';

      // Restore original code content and clear any existing overlay structure
      this.codeBlock.textContent = this.originalCode;

      // Re-apply syntax highlighting after resetting content
      this._applySyntaxHighlighting();

      this.render();

      // Update controls visibility and position after reset
      setTimeout(() => this._updateControlsVisibilityAndPosition(), 100);
    } catch (error) {
      throw error;
    }
  }

  async step() {
    if (!this.pyodide || (this.state && this.state.finished)) {
      return;
    }

    try {
      await this.pyodide.runPythonAsync(`${this.instanceId}.step()`);
      this.state = await this.getState();
      this.render();

      // Update button text and check if finished
      if (this.state.finished) {
        this.stepBtn.disabled = true;
        this.stepBtn.textContent = 'Finished';
      } else {
        this.stepBtn.textContent = 'Execute highlighted line';
      }
    } catch (error) {
      // Silent error handling
    }
  }

  async getState() {
    try {
      const state = await this.pyodide.runPythonAsync(`${this.instanceId}.get_state()`);
      // Return the state directly without explicit conversion
      return state;
    } catch (error) {
      console.error(`Error getting debugger state: ${error}`);
      throw error;
    }
  }

  render() {
    if (!this.state) {
      return;
    }

    try {
      this._renderCode();
      this._renderVariables();
      this._renderOutput();
    } catch (error) {
      // Silent error handling
    }
  }

  _renderCode() {
    const lines = this.originalCode.split(/\r\n|\r|\n/);

    // Create overlay container if it doesn't exist
    if (!this.codeBlock.querySelector('.code-overlay-container')) {
      this._createOverlayStructure();
    }

    // Update both layers
    this._updateSteppingLayer(lines);
    this._updatePrismLayer(lines);
    this._scrollToActiveLine();
  }

  _createOverlayStructure() {
    // Clear existing content
    this.codeBlock.innerHTML = '';

    // Create container
    const container = document.createElement('div');
    container.className = 'code-overlay-container';

    // Create stepping layer (background)
    const steppingLayer = document.createElement('div');
    steppingLayer.className = 'code-stepping-layer';

    // Create prism layer (foreground)
    const prismLayer = document.createElement('div');
    prismLayer.className = 'code-prism-layer language-python';

    // Assemble structure
    container.appendChild(steppingLayer);
    container.appendChild(prismLayer);
    this.codeBlock.appendChild(container);

    // Store references
    this.steppingLayer = steppingLayer;
    this.prismLayer = prismLayer;
  }

  _updateSteppingLayer(lines) {
    // Generate stepping markup (with active line highlighting)
    const steppingHTML = lines.map((line, idx) => {
      const lineContent = line.trim() === '' ? '&nbsp;' : SharedPyodideManager.escapeHtml(line);
      const isActive = this._isActiveLine(idx);
      const activeClass = isActive ? ' active' : '';
      return `<div class="code-line${activeClass}" data-line="${idx}">${lineContent}</div>`;
    }).join('');

    this.steppingLayer.innerHTML = steppingHTML;
  }

  _updatePrismLayer(lines) {
    // Set the original code for Prism highlighting
    this.prismLayer.textContent = this.originalCode;

    // Apply Prism highlighting
    if (window.Prism) {
      this.prismLayer.className = 'code-prism-layer language-python';
      // Reset highlighted state
      delete this.prismLayer.dataset.highlighted;
      SharedPyodideManager.highlightCode(this.prismLayer, 'python');
    }
  }

  _generateLineHTML(lines) {
    // This method is no longer used - we use the overlay approach instead
    return this._generatePlainHTML(lines);
  }

  _generatePlainHTML(lines) {
    // Fallback for when overlay structure isn't available
    const html = lines.map((line, idx) => {
      const lineContent = line.trim() === '' ? '&nbsp;' : SharedPyodideManager.escapeHtml(line);
      const isActive = this._isActiveLine(idx);
      const activeClass = isActive ? ' active' : '';
      return `<div class="code-line${activeClass}" data-line="${idx}">${lineContent}</div>`;
    }).join('');

    return html;
  }

  _isActiveLine(idx) {
    // Show active line only if not finished, current_line is valid, and we're in a pre-execution state
    return (idx === this.state.current_line &&
            !this.state.finished &&
            this.state.current_line >= 0);
  }

  _scrollToActiveLine() {
    if (this._isActiveLine(this.state.current_line)) {
      setTimeout(() => {
        // Try to find active element in stepping layer first
        let activeElement = this.steppingLayer?.querySelector(`[data-line="${this.state.current_line}"]`);

        // Fallback to main code block if stepping layer not available
        if (!activeElement) {
          activeElement = this.codeBlock.querySelector(`[data-line="${this.state.current_line}"]`);
        }

        activeElement?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 0);
    }
  }

  _renderVariables() {
    if (!this.variablesDiv) return;

    // Filter to only variables that have values and sort them
    const definedVars = this.varNames
      .filter(varName => this.state.locals.hasOwnProperty(varName))
      .sort();

    if (definedVars.length === 0) {
      this.variablesDiv.innerHTML = '<strong>Variables</strong><p><em>No variables defined yet</em></p>';
      return;
    }

    // Use template literals for cleaner HTML construction
    let html = `
      <strong>Variables</strong>
      <table>
        <thead>
          <tr>
            <th>Variable</th>
            <th>Value</th>
            <th>Type</th>
            <th>Scope</th>
          </tr>
        </thead>
        <tbody>
    `;

    for (const varName of definedVars) {
      const value = this.state.locals[varName];
      const scope = this.state.scope_info[varName] || 'unknown';
      const type = this.state.type_info && this.state.type_info[varName] || 'unknown';

      // Use the value directly since Python backend now formats it properly
      const displayValue = typeof value === 'string'
        ? SharedPyodideManager.escapeHtml(value)
        : SharedPyodideManager.escapeHtml(String(value));

      // Apply smart wrapping to variable name and type
      const wrappedVarName = this._addSmartHyphens(SharedPyodideManager.escapeHtml(varName));
      const wrappedType = this._addSmartHyphens(SharedPyodideManager.escapeHtml(type));

      // Handle scope with newlines - escape HTML first, then convert newlines to <br>
      const escapedScope = SharedPyodideManager.escapeHtml(scope);
      const scopeWithBreaks = escapedScope.replace(/\n/g, '<br>');
      const wrappedScope = this._addSmartHyphens(scopeWithBreaks);

      html += `
        <tr>
          <td class="smart-wrap"><strong>${wrappedVarName}</strong></td>
          <td>${displayValue}</td>
          <td class="smart-wrap">${wrappedType}</td>
          <td class="smart-wrap">${wrappedScope}</td>
        </tr>
      `;
    }

    html += '</tbody></table>';
    this.variablesDiv.innerHTML = html;
  }

  _addSmartHyphens(text) {
    /**
     * Add soft hyphens (&shy;) at strategic points for better wrapping:
     * - Before underscores: avg_word_len becomes avg&shy;_word&shy;_len
     * - Before capital letters in camelCase: MyClass becomes My&shy;Class
     */
    return text
      // Add soft hyphen before underscores
      .replace(/_/g, '&shy;_')
      // Add soft hyphen before capital letters (but not at the start)
      .replace(/([a-z])([A-Z])/g, '$1&shy;$2')
      // Add soft hyphen before numbers after letters
      .replace(/([a-zA-Z])(\d)/g, '$1&shy;$2')
      // Add soft hyphen after numbers before letters
      .replace(/(\d)([a-zA-Z])/g, '$1&shy;$2');
  }

  _renderOutput() {
    if (!this.outputDiv) return;

    const outputContent = this.outputDiv.querySelector('.output-content');
    if (this.state.output_lines && this.state.output_lines.length > 0) {
      const outputHtml = this.state.output_lines
        .map(line => SharedPyodideManager.escapeHtml(line))
        .join('<br>');
      outputContent.innerHTML = outputHtml;
      outputContent.style.minHeight = 'auto'; /* Remove fixed min-height when there's content */
    } else {
      outputContent.innerHTML = '<em style="color: var(--pdb-text-muted);">No output yet</em>';
      outputContent.style.minHeight = '30px'; /* Minimal height when empty */
    }
  }
}

// Initialize everything when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
  // Load UI dependencies first (CSS, Prism) for immediate styling
  await SharedPyodideManager.loadUIDependencies();

  // Initialize UI immediately (with immediate syntax highlighting)
  document.querySelectorAll('.pyodide-pdb').forEach(container => {
    new InteractiveExample(container);
  });
});
