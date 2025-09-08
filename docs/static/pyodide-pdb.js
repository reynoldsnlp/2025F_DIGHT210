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
    // Inject sidebar if missing
    this.sidebar = this.container.querySelector('.sidebar');
    if (!this.sidebar) {
      this.sidebar = document.createElement('div');
      this.sidebar.className = 'sidebar';

      // Create variables section
      this.variablesDiv = document.createElement('div');
      this.variablesDiv.className = 'variables-section';
      this.variablesDiv.innerHTML = '<strong>Variables</strong><p><em>Loading...</em></p>';

      // Create output section
      this.outputDiv = document.createElement('div');
      this.outputDiv.className = 'output-section';
      this.outputDiv.innerHTML = '<strong>Output</strong><div class="output-content"></div>';

      this.sidebar.appendChild(this.variablesDiv);
      this.sidebar.appendChild(this.outputDiv);
      this.container.appendChild(this.sidebar);
    } else {
      this.variablesDiv = this.sidebar.querySelector('.variables-section');
      this.outputDiv = this.sidebar.querySelector('.output-section');
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

      this.completionDiv = document.createElement('div');
      this.completionDiv.className = 'completion-message';
      this.completionDiv.style.display = 'none';
      this.completionDiv.innerHTML = '<strong>Done!</strong>';
      buttonContainer.appendChild(this.completionDiv);

      this.controlsDiv.appendChild(buttonContainer);
      this.codeBlock.parentNode.appendChild(this.controlsDiv);
    } else {
      this.stepBtn = this.controlsDiv.querySelector('.step-btn');
      this.resetBtn = this.controlsDiv.querySelector('.reset-btn');
      this.completionDiv = this.controlsDiv.querySelector('.completion-message');

      // Disable buttons if they exist
      if (this.stepBtn) this.stepBtn.disabled = true;
      if (this.resetBtn) this.resetBtn.disabled = true;
    }
  }

  async init() {
    try {
      this.pyodide = await SharedPyodideManager.loadPDBModule();

      await this._autoDetectVariables();
      await this.reset();

      this._enableControls();
      this._attachEventListeners();
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

      this.state = await this.getState();

      // Reset UI state
      this.stepBtn.disabled = false;
      this.stepBtn.textContent = 'Execute highlighted line';
      this.completionDiv.style.display = 'none';

      // Restore original code content
      this.codeBlock.textContent = this.originalCode;

      // Re-apply syntax highlighting after resetting content
      this._applySyntaxHighlighting();

      this.render();
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

      if (this.state.finished) {
        this.stepBtn.disabled = true;
        this.completionDiv.style.display = 'block';
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

    const html = this._generateLineHTML(lines);
    this.codeBlock.innerHTML = html;
    this._scrollToActiveLine();
  }

  _generateLineHTML(lines) {
    if (window.Prism && this.codeBlock.innerHTML.includes('<span')) {
      return this._generateHighlightedHTML(lines);
    }
    return this._generatePlainHTML(lines);
  }

  _generateHighlightedHTML(lines) {
    const highlightedLines = this.codeBlock.innerHTML.split(/\r\n|\r|\n/);
    return highlightedLines.map((line, idx) => {
      const lineContent = line.trim() === '' ? '&nbsp;' : line;
      const isActive = this._isActiveLine(idx);
      const activeClass = isActive ? ' active' : '';
      return `<div class="code-line${activeClass}" data-line="${idx}">${lineContent}</div>`;
    }).join('');
  }

  _generatePlainHTML(lines) {
    return lines.map((line, idx) => {
      const lineContent = line.trim() === '' ? '&nbsp;' : SharedPyodideManager.escapeHtml(line);
      const isActive = this._isActiveLine(idx);
      const activeClass = isActive ? ' active' : '';
      return `<div class="code-line${activeClass}" data-line="${idx}">${lineContent}</div>`;
    }).join('');
  }

  _isActiveLine(idx) {
    return idx === this.state.current_line && !this.state.finished;
  }

  _scrollToActiveLine() {
    if (this._isActiveLine(this.state.current_line)) {
      setTimeout(() => {
        const activeElement = this.codeBlock.querySelector(`[data-line="${this.state.current_line}"]`);
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
      this.variablesDiv.innerHTML = '<strong>Variables</strong><p><em>No variables declared yet</em></p>';
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
      const displayValue = typeof value === 'string' && value.includes('(') && value.includes(')')
        ? SharedPyodideManager.escapeHtml(value)
        : SharedPyodideManager.escapeHtml(JSON.stringify(value));

      html += `
        <tr>
          <td><strong>${SharedPyodideManager.escapeHtml(varName)}</strong></td>
          <td>${displayValue}</td>
          <td>${SharedPyodideManager.escapeHtml(type)}</td>
          <td>${SharedPyodideManager.escapeHtml(scope)}</td>
        </tr>
      `;
    }

    html += '</tbody></table>';
    this.variablesDiv.innerHTML = html;
  }

  _renderOutput() {
    if (!this.outputDiv) return;

    const outputContent = this.outputDiv.querySelector('.output-content');
    if (this.state.output_lines && this.state.output_lines.length > 0) {
      const outputHtml = this.state.output_lines
        .map(line => SharedPyodideManager.escapeHtml(line))
        .join('<br>');
      outputContent.innerHTML = outputHtml;
    } else {
      outputContent.innerHTML = '<em>No output yet</em>';
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
