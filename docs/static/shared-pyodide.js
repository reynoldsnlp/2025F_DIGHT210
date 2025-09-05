// Shared Pyodide instance manager for both exercises and PDB

window.SharedPyodideManager = {
    pyodideInstance: null,
    pyodidePromise: null,
    dependenciesLoaded: false,
    uiDependenciesLoaded: false,

    // Get the static directory path
    getStaticPath() {
        // Get the current page's location
        const currentPath = window.location.pathname;

        // Handle the case where we're serving from file:// protocol
        if (window.location.protocol === 'file:') {
            // For local file serving, determine relative path based on current location
            const pathSegments = currentPath.split('/').filter(segment => segment);

            // If we're in materials/unit_X, need to go back to docs/static
            if (pathSegments.includes('materials')) {
                return '../../static/';
            }
            // If we're in docs root, static is ./static/
            if (pathSegments.includes('docs') || pathSegments.length === 0) {
                return './static/';
            }
            return './static/';
        }

        // For HTTP serving, use absolute or relative paths
        // Split path into segments, removing empty ones
        const pathSegments = currentPath.split('/').filter(segment => segment);

        // If we're already in static directory, return current directory
        if (pathSegments.includes('static')) {
            const staticIndex = pathSegments.indexOf('static');
            return '/' + pathSegments.slice(0, staticIndex + 1).join('/') + '/';
        }

        // If we're in materials directory, calculate relative path back to static
        const materialsIndex = pathSegments.findIndex(segment => segment === 'materials');
        if (materialsIndex >= 0) {
            // Count how deep we are after materials (unit_X folders)
            const depthAfterMaterials = pathSegments.length - materialsIndex - 1;
            // Go back that many levels plus one more to get to docs, then into static
            const backSteps = '../'.repeat(depthAfterMaterials + 1);
            return backSteps + 'static/';
        }

        // If we're in docs directory, add static
        const docsIndex = pathSegments.findIndex(segment => segment === 'docs');
        if (docsIndex >= 0) {
            const docsSegments = pathSegments.slice(0, docsIndex + 1);
            return '/' + docsSegments.join('/') + '/static/';
        }

        // Default fallback: try relative paths that should work in most cases
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

        try {
            // Load all UI dependencies in parallel, but don't fail if some are missing
            await Promise.allSettled([
                // Prism CSS and JavaScript
                this.loadCSS(staticPath + 'vendor/prism/themes/a11y-light-on-light-dark-on-dark.min.css'),
                window.Prism ? Promise.resolve() : this.loadScript(staticPath + 'vendor/prism/prism.js').catch(() => console.warn('Prism not available')),

                // CodeJar for exercises - try multiple versions
                this.loadCodeJar(staticPath).catch(() => console.warn('CodeJar not available'))
            ]);

            // Wait for Prism to be ready
            if (!window.Prism) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        } catch (error) {
            console.warn('Some UI dependencies failed to load:', error);
        }

        this.uiDependenciesLoaded = true;
    },

    // Load CodeJar as a module
    async loadCodeJar(staticPath) {
        // Load CodeJar as a module
        const codejarPath = staticPath + 'vendor/codejar/codejar.js';

        try {
            // Import CodeJar as a module
            const module = await import(codejarPath);
            // CodeJar should be the default export
            window.CodeJar = module.default || module.CodeJar;

            if (!window.CodeJar) {
                throw new Error('CodeJar not available after loading');
            }
        } catch (error) {
            console.error(`Failed to load CodeJar from ${codejarPath}:`, error);
            throw error;
        }
    },

    // Load core dependencies (Prism and Pyodide)
    async loadCoreDependencies() {
        if (this.dependenciesLoaded) return;

        // First ensure UI dependencies are loaded
        await this.loadUIDependencies();

        const staticPath = this.getStaticPath();

        // Load Pyodide if not already loaded
        if (typeof window.loadPyodide === 'undefined') {
            try {
                await this.loadScript(staticPath + "vendor/pyodide/pyodide.js");
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
                        break;
                    } catch (e) {
                        console.warn(`Failed to load Pyodide from ${altPath}`);
                    }
                }

                if (!loaded) {
                    throw new Error('Failed to load Pyodide from any path');
                }
            }
        }

        this.dependenciesLoaded = true;
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

        const staticPath = this.getStaticPath();
        this.pyodideInstance = await loadPyodide({ indexURL: staticPath + "vendor/pyodide/" });

        return this.pyodideInstance;
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
