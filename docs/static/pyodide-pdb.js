// Interactive Python stepping using pyodide and pdb

let pyodideReadyPromise = null;

async function ensurePyodide() {
  if (!pyodideReadyPromise) {
    pyodideReadyPromise = loadPyodideAndPackages();
  }
  return pyodideReadyPromise;
}

async function loadPyodideAndPackages() {
  const pyodide = await loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.28.2/full/" });
  await pyodide.loadPackage(['micropip']);
  await pyodide.runPythonAsync(`
import sys
import ast
from io import StringIO

class StepDebugger:
    def __init__(self, code, varnames):
        self.code = code
        self.varnames = varnames
        self.lines = [line for line in code.splitlines() if line.strip()]
        self.current_line = 0
        self.locals_dict = {}
        self.finished = False

    def step(self):
        if self.finished or self.current_line >= len(self.lines):
            self.finished = True
            return

        line = self.lines[self.current_line].strip()
        if line:
            try:
                exec(line, {}, self.locals_dict)
            except Exception as e:
                pass

        self.current_line += 1
        if self.current_line >= len(self.lines):
            self.finished = True

    def reset(self):
        self.current_line = 0
        self.locals_dict = {}
        self.finished = False

    def get_state(self):
        state = {
            "current_line": self.current_line,
            "locals": {k: v for k, v in self.locals_dict.items() if k in self.varnames},
            "lines": self.lines,
            "finished": self.finished
        }
        return state
`);
  return pyodide;
}

async function extractVariableNames(code) {
  const pyodide = await ensurePyodide();

  const result = await pyodide.runPythonAsync(`
def extract_assigned_variables(code_str):
    """Extract all variable names that are assigned in the code."""
    try:
        tree = ast.parse(code_str)
        assigned_vars = set()

        for node in ast.walk(tree):
            if isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Name):
                        assigned_vars.add(target.id)
            elif isinstance(node, ast.AugAssign):
                if isinstance(node.target, ast.Name):
                    assigned_vars.add(node.target.id)

        return list(assigned_vars)
    except SyntaxError:
        return []

extract_assigned_variables("""${code.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}""")
`);

  return result.toJs();
}

class InteractiveExample {
  constructor(container) {
    this.container = container;
    this.codeBlock = container.querySelector('pre code');
    this.code = this.codeBlock.textContent.trim();
    this.varNames = [];

    // Create a unique ID for this instance to avoid variable collisions in Pyodide
    InteractiveExample.instanceCounter = (InteractiveExample.instanceCounter || 0) + 1;
    this.instanceId = 'dbg_' + InteractiveExample.instanceCounter;

    // Inject sidebar if missing
    this.sidebar = container.querySelector('.sidebar');
    if (!this.sidebar) {
      this.sidebar = document.createElement('div');
      this.sidebar.className = 'sidebar';
      this.sidebar.innerHTML = '<strong>Variables</strong><p><em>Loading...</em></p>';
      container.appendChild(this.sidebar);
    }

    // Inject controls if missing
    this.controlsDiv = container.querySelector('.controls');
    if (!this.controlsDiv) {
      this.controlsDiv = document.createElement('div');
      this.controlsDiv.className = 'controls';

      const buttonContainer = document.createElement('div');
      buttonContainer.className = 'button-container';

      this.stepBtn = document.createElement('button');
      this.stepBtn.className = 'step-btn';
      this.stepBtn.textContent = 'Step';
      this.resetBtn = document.createElement('button');
      this.resetBtn.className = 'reset-btn';
      this.resetBtn.textContent = 'Reset';

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
    }

    this.state = null;
    this.pyodide = null;
    this.init().catch(error => {
      // Silent error handling
    });
  }

  async init() {
    try {
      this.pyodide = await ensurePyodide();

      // Auto-detect variables if not specified
      let varNames = (this.container.dataset.variables || '').split(',').map(v => v.trim()).filter(Boolean);
      if (varNames.length === 0) {
        const extractedVars = await extractVariableNames(this.code);
        varNames = Array.isArray(extractedVars) ? extractedVars : Array.from(extractedVars);
      }
      this.varNames = varNames;

      await this.ensureHighlightJS();

      try {
        await this.reset();
      } catch (error) {
        throw error;
      }

      this.stepBtn.addEventListener('click', () => {
        this.step();
      });
      this.resetBtn.addEventListener('click', () => {
        this.reset();
      });
    } catch (error) {
      // Silent error handling
    }
  }

  async ensureHighlightJS() {
    if (window.hljs) {
      this.hljsLoaded = true;
      return;
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js';
      script.onerror = (error) => {
        this.hljsLoaded = false;
        resolve();
      };
      script.onload = () => {
        const pyScript = document.createElement('script');
        pyScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/python.min.js';
        pyScript.onerror = (error) => {
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

  highlightCode() {
    if (window.hljs && this.codeBlock) {
      this.codeBlock.classList.add('python');
      window.hljs.highlightElement(this.codeBlock);
    }
  }

  async reset() {
    if (!this.pyodide) {
      return;
    }
    try {
      await this.pyodide.runPythonAsync(`
${this.instanceId} = StepDebugger("""${this.code.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}""", ${JSON.stringify(this.varNames)})
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
    if (!this.pyodide) {
      return;
    }
    if (this.state && this.state.finished) {
      return;
    }
    await this.pyodide.runPythonAsync(`${this.instanceId}.step()`);
    this.state = await this.getState();
    this.render();

    if (this.state.finished) {
      this.stepBtn.disabled = true;
      this.completionDiv.style.display = 'block';
    }
  }

  async getState() {
    try {
      const state = await this.pyodide.runPythonAsync(`${this.instanceId}.get_state()`);
      return state;
    } catch (error) {
      throw error;
    }
  }

  render() {
    if (!this.state) {
      return;
    }

    try {
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

      // Show variables as a table
      if (this.sidebar) {
        const declaredVars = this.varNames
          .filter(v => this.state.locals.hasOwnProperty(v))
          .sort();

        if (declaredVars.length === 0) {
          this.sidebar.innerHTML = '<strong>Variables</strong><p><em>No variables declared yet</em></p>';
        } else {
          let html = '<strong>Variables</strong><table><thead><tr><th>Variable</th><th>Value</th></tr></thead><tbody>';
          for (const v of declaredVars) {
            const value = this.state.locals[v];
            const displayValue = this.escapeHtml(JSON.stringify(value));
            html += `<tr><td><strong>${this.escapeHtml(v)}</strong></td><td>${displayValue}</td></tr>`;
          }
          html += '</tbody></table>';
          this.sidebar.innerHTML = html;
        }
      }
    } catch (error) {
      // Silent error handling
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}


document.addEventListener('DOMContentLoaded', () => {
  // Load highlight.js CSS with error handling
  const hljsCss = document.createElement('link');
  hljsCss.rel = 'stylesheet';
  hljsCss.href = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css';
  document.head.appendChild(hljsCss);

  if (window.loadPyodide === undefined) {
    const script = document.createElement('script');
    script.src = "https://cdn.jsdelivr.net/pyodide/v0.28.2/full/pyodide.js";
    script.onload = () => {
      document.querySelectorAll('.pyodide-pdb').forEach(container => {
        new InteractiveExample(container);
      });
    };
    script.onerror = (error) => {
      // Silent error handling
    };
    document.head.appendChild(script);
  } else {
    document.querySelectorAll('.pyodide-pdb').forEach(container => {
      new InteractiveExample(container);
    });
  }
});
