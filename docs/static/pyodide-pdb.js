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
import types
import dis
import copy
import traceback

class StepDebugger:
    def __init__(self, code, varnames):
        self.code = code
        self.varnames = varnames
        self.lines = [line.rstrip() for line in code.splitlines()]
        self.current_line = -1
        self.locals_dict = {}
        self.scope_info = {}
        self.finished = False
        self.execution_trace = []
        self.step_index = 0
        self.output_lines = []

        # Compile the code
        try:
            self.compiled_code = compile(code, '<string>', 'exec')
            self._prepare_execution_trace()
        except Exception as e:
            print(f"Compilation error: {e}")
            traceback.print_exc()
            self.finished = True

    def _prepare_execution_trace(self):
        """Pre-compute the execution trace by running the code with a tracer."""
        self.execution_trace = []
        captured_output = StringIO()
        executed_lines = []

        def trace_function(frame, event, arg):
            if frame.f_code.co_filename == '<string>':
                line_no = frame.f_lineno - 1  # Convert to 0-based indexing
                if event == 'line' and 0 <= line_no < len(self.lines):
                    if self.lines[line_no].strip():  # Only non-empty lines
                        # Capture state at this point
                        all_vars = {}
                        scope_info = {}
                        for k, v in frame.f_locals.items():
                            if k in self.varnames and not k.startswith('_'):
                                # Convert iterators to readable format
                                display_value = self._format_value_for_display(v)
                                all_vars[k] = display_value
                                scope_info[k] = 'local' if frame.f_locals is not frame.f_globals else 'global'

                        # Also check globals
                        for k, v in frame.f_globals.items():
                            if k in self.varnames and not k.startswith('_') and k not in all_vars:
                                display_value = self._format_value_for_display(v)
                                all_vars[k] = display_value
                                scope_info[k] = 'global'

                        self.execution_trace.append({
                            'line': line_no,
                            'locals': all_vars,
                            'scope_info': scope_info,
                            'output': captured_output.getvalue()
                        })
            return trace_function

        # Run the code once with tracing to capture everything
        temp_globals = {}
        old_trace = sys.gettrace()
        original_stdout = sys.stdout
        sys.stdout = captured_output

        try:
            sys.settrace(trace_function)
            exec(self.compiled_code, temp_globals)
        except Exception as e:
            print(f"Execution error during trace: {e}")
            traceback.print_exc()
        finally:
            sys.settrace(old_trace)
            sys.stdout = original_stdout

        # Now execute line by line to capture states and output properly
        temp_globals = {}
        current_output = StringIO()
        sys.stdout = current_output

        try:
          for line_no in executed_lines:
              line = self.lines[line_no].strip()
              if line:
                  # Execute the line
                  try:
                      exec(line, temp_globals)
                  except Exception as e:
                      print(f"Error executing line {line_no}: '{line}' - {e}")
                      traceback.print_exc()

                  # Capture state after execution
                  all_vars = {}
                  scope_info = {}
                  for k, v in temp_globals.items():
                      if k in self.varnames and not k.startswith('_'):
                          display_value = self._format_value_for_display(v)
                          all_vars[k] = display_value
                          scope_info[k] = 'global'

                  # Capture output up to this point
                  current_output_str = current_output.getvalue()

                  self.execution_trace.append({
                      'line': line_no,
                      'locals': copy.deepcopy(all_vars),
                      'scope_info': copy.deepcopy(scope_info),
                      'output': current_output_str
                  })
        finally:
            sys.stdout = original_stdout
    def step(self):
        if self.finished or self.step_index >= len(self.execution_trace):
            self.finished = True
            return

        # Get the current execution state
        current_state = self.execution_trace[self.step_index]
        self.current_line = current_state['line']
        self.locals_dict = current_state['locals']
        self.scope_info = current_state['scope_info']
        self.output_lines = current_state['output'].splitlines()

        self.step_index += 1
        if self.step_index >= len(self.execution_trace):
            self.finished = True

    def reset(self):
        self.current_line = -1
        self.locals_dict = {}
        self.scope_info = {}
        self.output_lines = []
        self.finished = False
        self.step_index = 0
        # Re-prepare execution trace
        self._prepare_execution_trace()

    def get_state(self):
        state = {
            "current_line": self.current_line,
            "locals": self.locals_dict,
            "scope_info": self.scope_info,
            "output_lines": self.output_lines,
            "lines": self.lines,
            "finished": self.finished
        }
        return state

    def _format_value_for_display(self, value):
        """Format values for display, converting iterators to readable format."""
        import types

        # Handle zip objects and other iterators
        if hasattr(value, '__iter__') and hasattr(value, '__next__'):
            try:
                # For zip objects, try to get the original iterables if possible
                if type(value).__name__ == 'zip':
                    # Convert zip to list to see its contents
                    items = list(value)
                    return f"zip({items})"
                elif type(value).__name__ in ['enumerate', 'map', 'filter']:
                    # Convert other common iterators
                    items = list(value)
                    return f"{type(value).__name__}({items})"
                else:
                    # Generic iterator handling
                    try:
                        items = list(value)
                        return f"{type(value).__name__}({items})"
                    except:
                        return f"<{type(value).__name__} object>"
            except:
                return f"<{type(value).__name__} object>"

        # Handle other types normally
        return copy.deepcopy(value)
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
            elif isinstance(node, ast.For):
                # Add loop variables (e.g., 'char' in 'for char in a:')
                if isinstance(node.target, ast.Name):
                    assigned_vars.add(node.target.id)
            elif isinstance(node, ast.FunctionDef):
                # Add function parameters
                for arg in node.args.args:
                    assigned_vars.add(arg.arg)

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
      container.appendChild(this.sidebar);
    } else {
      this.variablesDiv = this.sidebar.querySelector('.variables-section');
      this.outputDiv = this.sidebar.querySelector('.output-section');
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
      this.stepBtn.disabled = true; // Disabled until ready

      this.resetBtn = document.createElement('button');
      this.resetBtn.className = 'reset-btn';
      this.resetBtn.textContent = 'Reset';
      this.resetBtn.disabled = true; // Disabled until ready

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
        console.error('Error during reset:', error);
        throw error;
      }

      // Enable buttons after everything is ready
      this.stepBtn.disabled = false;
      this.resetBtn.disabled = false;

      this.stepBtn.addEventListener('click', () => {
        this.step();
      });
      this.resetBtn.addEventListener('click', () => {
        this.reset();
      });
    } catch (error) {
      console.error('Error during initialization:', error);
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
      console.error('Error during reset:', error);
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
    try {
      await this.pyodide.runPythonAsync(`${this.instanceId}.step()`);
      this.state = await this.getState();
      this.render();

      if (this.state.finished) {
        this.stepBtn.disabled = true;
        this.completionDiv.style.display = 'block';
      }
    } catch (error) {
      console.error('Error during step:', error);
    }
  }

  async getState() {
    try {
      const state = await this.pyodide.runPythonAsync(`${this.instanceId}.get_state()`);
      return state;
    } catch (error) {
      console.error('Error getting state:', error);
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

      // Show variables as a table with scope information (only defined variables)
      if (this.variablesDiv) {
        // Filter to only variables that have values and sort them
        const definedVars = this.varNames
          .filter(varName => this.state.locals.hasOwnProperty(varName))
          .sort();

        if (definedVars.length === 0) {
          this.variablesDiv.innerHTML = '<strong>Variables</strong><p><em>No variables declared yet</em></p>';
        } else {
          let html = '<strong>Variables</strong><table><thead><tr><th>Variable</th><th>Value</th><th>Scope</th></tr></thead><tbody>';

          for (const varName of definedVars) {
            const value = this.state.locals[varName];
            const scope = this.state.scope_info[varName] || 'unknown';
            // Handle pre-formatted iterator strings
            const displayValue = typeof value === 'string' && value.includes('(') && value.includes(')')
              ? this.escapeHtml(value)
              : this.escapeHtml(JSON.stringify(value));
            const displayScope = this.escapeHtml(scope);

            html += `<tr><td><strong>${this.escapeHtml(varName)}</strong></td><td>${displayValue}</td><td>${displayScope}</td></tr>`;
          }

          html += '</tbody></table>';
          this.variablesDiv.innerHTML = html;
        }
      }

      // Show output
      if (this.outputDiv) {
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
    } catch (error) {
      console.error('Error during render:', error);
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
      console.error('Failed to load Pyodide:', error);
    };
    document.head.appendChild(script);
  } else {
    document.querySelectorAll('.pyodide-pdb').forEach(container => {
      new InteractiveExample(container);
    });
  }
});
