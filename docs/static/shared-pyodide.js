// Shared Pyodide instance manager for both exercises and PDB

window.SharedPyodideManager = {
    pyodideInstance: null,
    pyodidePromise: null,
    dependenciesLoaded: false,
    uiDependenciesLoaded: false,

    // Get the static directory path
    getStaticPath() {
        const currentPath = window.location.pathname;

        // Handle file:// protocol
        if (window.location.protocol === 'file:') {
            return this._getFileProtocolPath(currentPath);
        }

        // Handle HTTP(S) protocols
        return this._getHttpProtocolPath(currentPath);
    },

    _getFileProtocolPath(currentPath) {
        const pathSegments = currentPath.split('/').filter(segment => segment);

        // If we're in the static directory itself
        if (pathSegments.includes('static')) {
            const staticIndex = pathSegments.indexOf('static');
            const staticPath = '/' + pathSegments.slice(0, staticIndex + 1).join('/') + '/';
            return staticPath;
        }

        // If we're in materials directory (nested under docs)
        if (pathSegments.includes('materials')) {
            const materialsIndex = pathSegments.findIndex(segment => segment === 'materials');
            const depthAfterMaterials = pathSegments.length - materialsIndex - 1;
            return '../'.repeat(depthAfterMaterials + 1) + 'static/';
        }

        // If we're in lectures directory (nested under docs)
        if (pathSegments.includes('lectures')) {
            const lecturesIndex = pathSegments.findIndex(segment => segment === 'lectures');
            const depthAfterLectures = pathSegments.length - lecturesIndex - 1;
            return '../'.repeat(depthAfterLectures + 1) + 'static/';
        }

        // If we're directly in docs
        if (pathSegments.includes('docs') && pathSegments[pathSegments.length - 1] === 'docs') {
            return './static/';
        }

        // Default fallback
        return './static/';
    },

    _getHttpProtocolPath(currentPath) {
        const pathSegments = currentPath.split('/').filter(segment => segment);

        // If already in static directory
        if (pathSegments.includes('static')) {
            const staticIndex = pathSegments.indexOf('static');
            return '/' + pathSegments.slice(0, staticIndex + 1).join('/') + '/';
        }

        // If in materials directory (calculate relative path)
        if (pathSegments.includes('materials')) {
            const materialsIndex = pathSegments.findIndex(segment => segment === 'materials');
            const depthAfterMaterials = pathSegments.length - materialsIndex - 1;
            return '../'.repeat(depthAfterMaterials + 1) + 'static/';
        }

        // If in lectures directory (calculate relative path)
        if (pathSegments.includes('lectures')) {
            const lecturesIndex = pathSegments.findIndex(segment => segment === 'lectures');
            const depthAfterLectures = pathSegments.length - lecturesIndex - 1;
            return '../'.repeat(depthAfterLectures + 1) + 'static/';
        }

        // If in docs directory (absolute path)
        if (pathSegments.includes('docs')) {
            const docsIndex = pathSegments.findIndex(segment => segment === 'docs');
            const docsSegments = pathSegments.slice(0, docsIndex + 1);
            return '/' + docsSegments.join('/') + '/static/';
        }

        // Default fallback
        return './static/';
    },

    // Load CSS dependencies
    async loadCSS(href) {
        return new Promise((resolve, reject) => {
            // Check if CSS is already loaded
            const existingLink = document.querySelector(`link[href="${href}"]`);
            if (existingLink) {
                resolve();
                return;
            }

            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = href;
            link.onload = () => resolve();
            link.onerror = () => {
                console.warn(`Failed to load CSS: ${href}`);
                resolve(); // Don't reject, just warn and continue
            };
            document.head.appendChild(link);
        });
    },

    // Load JavaScript dependencies
    async loadScript(url) {
        return new Promise((resolve, reject) => {
            // Check if script is already loaded
            const existingScript = document.querySelector(`script[src="${url}"]`);
            if (existingScript) {
                resolve();
                return;
            }

            const script = document.createElement('script');
            script.src = url;
            script.onload = () => resolve();
            script.onerror = () => {
                console.warn(`Failed to load script: ${url}`);
                reject(new Error(`Failed to load script: ${url}`));
            };
            document.head.appendChild(script);
        });
    },

    // Load UI dependencies first (CSS, Prism, CodeJar) - no Pyodide yet
    async loadUIDependencies() {
        if (this.uiDependenciesLoaded) return;

        const staticPath = this.getStaticPath();
        const dependencies = [
            this.loadCSS(staticPath + 'vendor/prism/themes/a11y-light-on-light-dark-on-dark.css'),
            this._loadPrismIfNeeded(staticPath),
            this._loadCodeJar(staticPath)
        ];

        try {
            await Promise.allSettled(dependencies);
            this._waitForPrism();
        } catch (error) {
            console.warn('Some UI dependencies failed to load:', error);
        }

        this.uiDependenciesLoaded = true;
    },

    async _loadPrismIfNeeded(staticPath) {
        if (window.Prism) return Promise.resolve();

        try {
            return await this.loadScript(staticPath + 'vendor/prism/prism.js');
        } catch (error) {
            console.warn('Prism not available');
            return Promise.resolve();
        }
    },

    async _loadCodeJar(staticPath) {
        try {
            const codejarPath = staticPath + 'vendor/codejar/codejar.js';
            const module = await import(codejarPath);
            window.CodeJar = module.default || module.CodeJar;
        } catch (error) {
            console.warn('CodeJar failed to load:', error);
        }
    },

    async _waitForPrism() {
        if (!window.Prism) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    },

    // Load core dependencies (Prism and Pyodide)
    async loadCoreDependencies() {
        if (this.dependenciesLoaded) return;

        // First ensure UI dependencies are loaded
        await this.loadUIDependencies();

        // Load Pyodide if not already loaded
        if (typeof window.loadPyodide === 'undefined') {
            await this._loadPyodideFromCDNOrVendor();
        }

        this.dependenciesLoaded = true;
    },

    async _loadPyodideFromCDNOrVendor() {
        // Try CDN first
        try {
            console.log('Attempting to load Pyodide from CDN...');
            await this.loadScript('https://cdn.jsdelivr.net/pyodide/v0.28.2/full/pyodide.js');
            console.log('Successfully loaded Pyodide from CDN');
            return;
        } catch (cdnError) {
            console.warn('Failed to load Pyodide from CDN, falling back to vendor copy:', cdnError);
        }

        // Fallback to vendor copy
        const staticPath = this.getStaticPath();
        try {
            await this.loadScript(staticPath + "vendor/pyodide/pyodide.js");
            console.log('Successfully loaded Pyodide from vendor copy');
        } catch (error) {
            // Try alternative paths if the main path fails
            const alternatePaths = [
                "./vendor/pyodide/pyodide.js",
                "../vendor/pyodide/pyodide.js",
                "../../vendor/pyodide/pyodide.js",
                "/vendor/pyodide/pyodide.js"
            ];

            let loaded = false;
            for (const altPath of alternatePaths) {
                try {
                    await this.loadScript(altPath);
                    loaded = true;
                    console.log(`Successfully loaded Pyodide from ${altPath}`);
                    break;
                } catch (e) {
                    console.warn(`Failed to load Pyodide from ${altPath}`);
                }
            }

            if (!loaded) {
                throw new Error('Failed to load Pyodide from CDN and any vendor path');
            }
        }
    },

    // Get or create shared Pyodide instance
    async getSharedPyodide() {
        if (!this.pyodidePromise) {
            this.pyodidePromise = this.initializePyodide();
        }
        return this.pyodidePromise;
    },

    // Initialize Pyodide instance
    async initializePyodide() {
        if (this.pyodideInstance) return this.pyodideInstance;

        // Ensure dependencies are loaded
        await this.loadCoreDependencies();

        // Wait for loadPyodide to be available
        let attempts = 0;
        while (typeof window.loadPyodide === 'undefined' && attempts < 50) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }

        if (typeof window.loadPyodide === 'undefined') {
            throw new Error('loadPyodide is not available after loading dependencies');
        }

        // Determine the indexURL based on how Pyodide was loaded
        const indexURL = this._getPyodideIndexURL();
        this.pyodideInstance = await loadPyodide({ indexURL });

        return this.pyodideInstance;
    },

    _getPyodideIndexURL() {
        // Check if we loaded from CDN by looking for CDN script tag
        const cdnScript = document.querySelector('script[src*="cdn.jsdelivr.net/pyodide"]');
        if (cdnScript) {
            return 'https://cdn.jsdelivr.net/pyodide/v0.28.2/full/';
        }

        // Otherwise use vendor path
        const staticPath = this.getStaticPath();
        return staticPath + "vendor/pyodide/";
    },

    // Load pyodide_pdb.py for PDB functionality
    async loadPDBModule() {
        const pyodide = await this.getSharedPyodide();

        // Check if already loaded
        const isLoaded = await pyodide.runPythonAsync(`
try:
    import pyodide_pdb
    True
except (ImportError, NameError):
    False
`);

        if (isLoaded) return pyodide;

        const staticPath = this.getStaticPath();

        // Try multiple paths for the PDB module
        const pdbPaths = [
            staticPath + 'pyodide_pdb.py',
            './pyodide_pdb.py',
            '../pyodide_pdb.py',
            '../../pyodide_pdb.py'
        ];

        let pythonCode = null;
        for (const path of pdbPaths) {
            try {
                const response = await fetch(path);
                if (response.ok) {
                    pythonCode = await response.text();
                    break;
                }
            } catch (error) {
                console.warn(`Failed to fetch pyodide_pdb.py from ${path}`);
            }
        }

        if (!pythonCode) {
            throw new Error('Failed to fetch pyodide_pdb.py from any path');
        }

        await pyodide.runPythonAsync(pythonCode);

        // Create a module namespace to access the classes and functions
        await pyodide.runPythonAsync(`
import types
pyodide_pdb = types.ModuleType('pyodide_pdb')
pyodide_pdb.StepDebugger = StepDebugger
pyodide_pdb.extract_assigned_variables = extract_assigned_variables
`);

        return pyodide;
    },

    // Utility: Safe HTML escaping
    escapeHtml(text) {
        if (text === undefined || text === null) return '';
        const div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
    },

    // Utility: Apply Prism syntax highlighting
    highlightCode(element, language = 'python') {
        if (!window.Prism) return;

        element.className = `language-${language}`;
        // Reset highlighted state before re-highlighting
        delete element.dataset.highlighted;
        window.Prism.highlightElement(element);
    }
};
