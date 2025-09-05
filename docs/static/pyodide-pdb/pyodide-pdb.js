// Interactive Python stepping using pyodide and pdb

const PyodidePDB = {
  pyodideInstance: null,
  pyodideReadyPromise: null,
  dependenciesLoaded: false,

  // Get the base path for this script's directory
  getScriptBasePath() {
    // More specific script detection - look for the exact filename and ensure it's the pdb version
    const currentScript = document.currentScript ||
      Array.from(document.getElementsByTagName('script')).find(script =>
        script.src && script.src.includes('pyodide-pdb.js') && !script.src.includes('pyodide-exercises')
      );

    if (currentScript && currentScript.src) {
      const url = new URL(currentScript.src);
      // Ensure we're working with the pyodide-pdb.js script specifically
      if (!url.pathname.includes('pyodide-pdb.js') || url.pathname.includes('pyodide-exercises')) {
        // Manual search for the exact pyodide-pdb.js script (not pyodide-exercises.js)
        const pdbScript = Array.from(document.getElementsByTagName('script')).find(script =>
          script.src && script.src.includes('pyodide-pdb.js') && !script.src.includes('pyodide-exercises')
        );

        if (pdbScript) {
          const pdbUrl = new URL(pdbScript.src);
          const pyodidePdbBasePath = pdbUrl.pathname.substring(0, pdbUrl.pathname.lastIndexOf('/') + 1);
          return pyodidePdbBasePath;
        }
      }

      const pyodidePdbBasePath = url.pathname.substring(0, url.pathname.lastIndexOf('/') + 1);
      return pyodidePdbBasePath;
    }

    // Fallback: try to detect based on current location
    const pathSegments = window.location.pathname.split('/');
    const staticIndex = pathSegments.lastIndexOf('static');

    if (staticIndex >= 0) {
      const fallbackPath = pathSegments.slice(0, staticIndex + 1).join('/') + '/static/pyodide-pdb/';
      return fallbackPath;
    }

    // Last resort fallback
    return './static/pyodide-pdb/';
  },

  // Get the static directory path
  getStaticPath() {
    // Use the same specific script detection logic
    const currentScript = document.currentScript ||
      Array.from(document.getElementsByTagName('script')).find(script =>
        script.src && script.src.includes('pyodide-pdb.js') && !script.src.includes('pyodide-exercises')
      );

    if (currentScript && currentScript.src) {
      const url = new URL(currentScript.src);
      const pathname = url.pathname;
      // Find the static directory in the path
      const staticIndex = pathname.lastIndexOf('/static/');

      if (staticIndex >= 0) {
        const staticPath = pathname.substring(0, staticIndex + 8); // +8 for '/static/'
        return staticPath;
      }
    }

    // Fallback: construct relative path to static directory
    const currentPath = window.location.pathname;
    const pathSegments = currentPath.split('/').filter(segment => segment);

    // Remove 'materials' and any subdirectories after it to get back to docs root
    const materialsIndex = pathSegments.indexOf('materials');

    if (materialsIndex >= 0) {
      const docsSegments = pathSegments.slice(0, materialsIndex);
      const staticPath = '/' + docsSegments.join('/') + '/static/';
      return staticPath;
    }

    // If we're already in static or docs, calculate accordingly
    const staticIndex = pathSegments.indexOf('static');

    if (staticIndex >= 0) {
      const staticPath = '/' + pathSegments.slice(0, staticIndex + 1).join('/') + '/';
      return staticPath;
    }

    // Last resort
    return '/docs/static/';
  },

  // Load all necessary dependencies automatically
  async loadDependencies() {
    if (this.dependenciesLoaded) return;
    
    const pyodidePdbBasePath = this.getScriptBasePath();
    const pyodidePdbStaticPath = this.getStaticPath();

    // Load all CSS files in parallel
    const cssPromises = [
      this.loadCSS(pyodidePdbBasePath + 'pyodide-pdb.css'),
      this.loadCSS(pyodidePdbStaticPath + 'highlight.js/styles/a11y-dark.min.css')
    ];

    // Load Pyodide only once
    const pyodidePromise = window.loadPyodide === undefined ? 
      utils.loadScript(pyodidePdbStaticPath + "pyodide/pyodide.js") : 
      Promise.resolve();

    await Promise.all([...cssPromises, pyodidePromise]);
    this.dependenciesLoaded = true;
  },

  loadCSS(href) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  },

  async ensurePyodide() {
    if (!this.pyodideReadyPromise) {
      this.pyodideReadyPromise = this.loadPyodideAndPackages();
    }
    return this.pyodideReadyPromise;
  },

  async getSharedPyodide() {
    if (!this.pyodideInstance) {
      this.pyodideInstance = await this.ensurePyodide();
    }
    return this.pyodideInstance;
  },

  async loadPyodideAndPackages() {
    try {
      const pyodidePdbBasePath = this.getScriptBasePath();
      const pyodidePdbStaticPath = this.getStaticPath();

      const pyodide = await loadPyodide({ indexURL: pyodidePdbStaticPath + "pyodide/" });
      // Remove micropip loading since it's causing issues and not needed
      // await pyodide.loadPackage(['micropip']);

      // Load the StepDebugger Python code from separate file
      // Use basePath since pyodide_pdb.py is in the same directory as this script
      const response = await fetch(pyodidePdbBasePath + 'pyodide_pdb.py');
      if (!response.ok) {
        throw new Error(`Failed to fetch pyodide_pdb.py: ${response.status} ${response.statusText}`);
      }

      const pythonCode = await response.text();
      await pyodide.runPythonAsync(pythonCode);

      // Create a module namespace to access the classes and functions
      await pyodide.runPythonAsync(`
import types
pyodide_pdb = types.ModuleType('pyodide_pdb')
pyodide_pdb.StepDebugger = StepDebugger
pyodide_pdb.extract_assigned_variables = extract_assigned_variables
`);

      return pyodide;
    } catch (error) {
      console.error('Failed to initialize Pyodide:', error);
      throw error;
    }
  },

  async extractVariableNames(code) {
    const pyodide = await this.ensurePyodide();

    const result = await pyodide.runPythonAsync(`
pyodide_pdb.extract_assigned_variables("""${code.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}""")
`);

    return result.toJs();
  }
};

// Separated utility functions for better modularity
const utils = {
  // Safe HTML escaping function
  escapeHtml(text) {
    if (text === undefined || text === null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  },

  // Load external script with proper error handling
  loadScript(url) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load script: ${url}`));
      document.head.appendChild(script);
    });
  }
};

class InteractiveExample {
  constructor(container) {
    this.container = container;
    this.codeBlock = container.querySelector('pre code');
    this.code = this.codeBlock.textContent.trim();
    this.initialized = false;
    
    this._initializeSidebar();
    this._initializeControls();
    
    // Use intersection observer for lazy loading
    this.setupLazyLoading();
  }

  setupLazyLoading() {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !this.initialized) {
          this.init().catch(() => {
            // Silent error handling
          });
          observer.unobserve(this.container);
        }
      });
    }, { rootMargin: '100px' }); // Start loading 100px before visible

    observer.observe(this.container);
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
      this.stepBtn.textContent = 'Step';
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
      this.pyodide = await PyodidePDB.ensurePyodide();

      // Auto-detect variables if not specified
      let varNames = (this.container.dataset.variables || '').split(',').map(v => v.trim()).filter(Boolean);
      if (varNames.length === 0) {
        const extractedVars = await PyodidePDB.extractVariableNames(this.code);
        varNames = Array.isArray(extractedVars) ? extractedVars : Array.from(extractedVars);
      }
      this.varNames = varNames;

      await this.ensureHighlightJS();
      await this.reset();

      // Enable buttons after everything is ready
      this.stepBtn.disabled = false;
      this.resetBtn.disabled = false;

      this.stepBtn.addEventListener('click', () => this.step());
      this.resetBtn.addEventListener('click', () => this.reset());
    } catch (error) {
      // Silent error handling - buttons remain disabled
    }
  }

  async ensureHighlightJS() {
    if (window.hljs) {
      this.hljsLoaded = true;
      return;
    }

    const staticPath = PyodidePDB.getStaticPath();

    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = staticPath + 'highlight.js/highlight.min.js';
      script.onerror = () => {
        this.hljsLoaded = false;
        resolve();
      };
      script.onload = () => {
        const pyScript = document.createElement('script');
        pyScript.src = staticPath + 'highlight.js/languages/python.min.js';
        pyScript.onerror = () => {
          this.hljsLoaded = false;
          resolve();
        };
        pyScript.onload = () => {
          try {
            if (window.hljs && window.hljsLanguages && window.hljsLanguages.python) {
              window.hljs.registerLanguage('python', window.hljsLanguages.python);
            }
            this.hljsLoaded = true;
            resolve();
          } catch (error) {
            this.hljsLoaded = false;
            resolve();
          }
        };
        document.head.appendChild(pyScript);
      };
      document.head.appendChild(script);
    });
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
      this.stepBtn.textContent = 'Step';
      this.completionDiv.style.display = 'none';

      if (!this.codeBlock.className.includes('language-python')) {
        this.codeBlock.className += ' language-python';
      }

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
    const originalClasses = this.codeBlock.className;

    if (window.hljs && this.hljsLoaded) {
      const tempCode = document.createElement('code');
      tempCode.className = 'language-python';
      tempCode.textContent = this.state.lines.join('\n');
      window.hljs.highlightElement(tempCode);

      const highlightedLines = tempCode.innerHTML.split('\n');

      const html = this.state.lines.map((line, idx) => {
        const highlightedLine = highlightedLines[idx] || this.escapeHtml(line);
        return `<div class="code-line${idx === this.state.current_line ? ' active' : ''}" data-line="${idx}">${highlightedLine}</div>`;
      }).join('');

      this.codeBlock.innerHTML = html;
    } else {
      const html = this.state.lines.map((line, idx) => {
        return `<div class="code-line${idx === this.state.current_line ? ' active' : ''}" data-line="${idx}">${this.escapeHtml(line)}</div>`;
      }).join('');
      this.codeBlock.innerHTML = html;
    }

    this.codeBlock.className = originalClasses;
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
            <th>Scope</th>
          </tr>
        </thead>
        <tbody>
    `;

    for (const varName of definedVars) {
      const value = this.state.locals[varName];
      const scope = this.state.scope_info[varName] || 'unknown';
      const displayValue = typeof value === 'string' && value.includes('(') && value.includes(')')
        ? utils.escapeHtml(value)
        : utils.escapeHtml(JSON.stringify(value));

      html += `
        <tr>
          <td><strong>${utils.escapeHtml(varName)}</strong></td>
          <td>${displayValue}</td>
          <td>${utils.escapeHtml(scope)}</td>
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
        .map(line => this.escapeHtml(line))
        .join('<br>');
      outputContent.innerHTML = outputHtml;
    } else {
      outputContent.innerHTML = '<em>No output yet</em>';
    }
  }

  escapeHtml(text) {
    return utils.escapeHtml(text);
  }
}

// Initialize everything when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
  // Load dependencies in background
  PyodidePDB.loadDependencies().catch(console.warn);
  
  // Initialize UI immediately (without Python functionality)
  document.querySelectorAll('.pyodide-pdb').forEach(container => {
    new InteractiveExample(container);
  });
});
