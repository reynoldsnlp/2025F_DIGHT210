// Load dependencies function
function loadDependencies() {
    const dependencies = [
        { type: 'css', src: 'pyodide-exercises.css' },
        { type: 'css', src: '../highlight.js/styles/default.min.css' },
        { type: 'script', src: '../highlight.js/highlight.min.js' },
        { type: 'module', src: '../codejar/codejar.js' },
        { type: 'script', src: '../pyodide/pyodide.js' }
    ];

    return Promise.all(dependencies.map(dep => {
        return new Promise((resolve, reject) => {
            if (dep.type === 'css') {
                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = dep.src;
                link.onload = resolve;
                link.onerror = reject;
                document.head.appendChild(link);
            } else {
                const script = document.createElement('script');
                script.src = dep.src;
                if (dep.type === 'module') {
                    script.type = 'module';
                }
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            }
        });
    }));
}

class PyodideExercise {
    static idCounter = 0;

    constructor(containerElement) {
        this.container = containerElement;
        this.initialCode = (this.container.textContent || '').trim();
        this.expectedOutput = this.container.dataset.expectedOutput || '';
        this.answer = this.container.dataset.answer || '';

        // Generate unique ID for this exercise
        this.exerciseId = this.container.dataset.exerciseId || this.generateId();
        this.container.dataset.exerciseId = this.exerciseId;

        this.pyodide = null;
        this.isCorrect = false;
        this.codeJar = null;

        this.createUI();
        this.init();
    }

    createUI() {
        // Clear container and create exercise structure
        this.container.innerHTML = `
            <div class="exercise-container">
                <div class="editor-section">
                    <div class="editor" id="editor-${this.exerciseId}"></div>
                    <div class="answer" style="display: none;"></div>
                </div>
                <div class="output-section">
                    <div class="output">Output (click "Run" to execute your code!)</div>
                </div>
                <br>
                <div class="controls">
                    <button class="run-btn">Run</button>
                    <span class="checkmark">✓</span>
                    <button class="reveal-answer-btn" style="display: none;">Show Answer</button>
                </div>
            </div>
        `;

        // Get references to created elements
        this.editorDiv = this.container.querySelector('.editor');
        this.output = this.container.querySelector('.output');
        this.runBtn = this.container.querySelector('.run-btn');
        this.checkmark = this.container.querySelector('.checkmark');
        this.revealAnswer = this.container.querySelector('.reveal-answer-btn');
        this.answerDiv = this.container.querySelector('.answer');

        // Set up answer content
        if (this.answer) {
            this.answerDiv.textContent = this.answer;
        }

        // Initialize CodeJar with syntax highlighting
        this.initCodeJar();
    }

    async initCodeJar() {
        // Wait for dependencies to load
        await this.waitForDependencies();

        // Try to get CodeJar from window object or import it
        let CodeJarClass = window.CodeJar;

        if (!CodeJarClass) {
            try {
                // Try to import CodeJar as a module
                const module = await import('../codejar/codejar.js');
                CodeJarClass = module.CodeJar || module.default;
            } catch (error) {
                console.warn('Could not import CodeJar as module:', error);
            }
        }

        if (!CodeJarClass) {
            console.error('CodeJar is not available. Creating fallback editor.');
            this.createFallbackEditor();
            return;
        }

        // CodeJar with syntax highlighting using highlight.js
        this.codeJar = CodeJarClass(this.editorDiv, (editor) => {
            // Apply syntax highlighting if hljs is available
            if (typeof hljs !== 'undefined') {
                editor.textContent = editor.textContent;
                // Reset highlighted state before re-highlighting
                delete editor.dataset.highlighted;
                hljs.highlightElement(editor);
            }

            // Add line numbers
            this.addLineNumbers(editor);
        });

        // Set initial code
        this.codeJar.updateCode(this.initialCode);
    }

    waitForDependencies() {
        return new Promise((resolve) => {
            const checkDependencies = () => {
                if (typeof hljs !== 'undefined' && typeof loadPyodide !== 'undefined') {
                    resolve();
                } else {
                    setTimeout(checkDependencies, 100);
                }
            };
            checkDependencies();
        });
    }

    createFallbackEditor() {
        // Create a simple textarea as fallback
        const textarea = document.createElement('textarea');
        textarea.value = this.initialCode;
        textarea.style.width = '100%';
        textarea.style.height = '300px';
        textarea.style.fontFamily = '"Courier New", monospace';
        textarea.style.fontSize = '14px';
        textarea.style.border = '2px solid #ccc';
        textarea.style.borderRadius = '4px';
        textarea.style.padding = '10px';
        textarea.style.resize = 'vertical';

        this.editorDiv.innerHTML = '';
        this.editorDiv.appendChild(textarea);

        // Create simple API for getting code
        this.codeJar = {
            toString: () => textarea.value
        };
    }

    addLineNumbers(editor) {
        const lines = editor.textContent.split('\n');
        const lineNumbersDiv = editor.parentElement.querySelector('.line-numbers') ||
                              document.createElement('div');

        if (!editor.parentElement.querySelector('.line-numbers')) {
            lineNumbersDiv.className = 'line-numbers';
            editor.parentElement.insertBefore(lineNumbersDiv, editor);
            editor.parentElement.classList.add('with-line-numbers');
        }

        lineNumbersDiv.innerHTML = lines.map((_, i) =>
            `<span>${i + 1}</span>`
        ).join('');
    }

    generateId() {
        return ++PyodideExercise.idCounter;
    }

    async init() {
        try {
            // Initialize Pyodide
            this.output.textContent = "Loading Python environment...";
            this.runBtn.disabled = true;

            this.pyodide = await loadPyodide({ indexURL: "../pyodide/" });

            // Validate the provided answer once Pyodide is ready
            await this.validateAnswer();

            this.output.textContent = "Click \"Run\" to execute your code...";
            this.runBtn.disabled = false;

            // Set up event listeners
            this.runBtn.addEventListener('click', () => this.runCode());
            this.revealAnswer.addEventListener('click', () => this.showAnswer());

        } catch (error) {
            this.output.textContent = "Error loading Python environment: " + error.message;
            console.error("Pyodide initialization error:", error);
        }
    }

    async validateAnswer() {
        if (!this.answer || !this.expectedOutput) {
            return; // Skip validation if no answer or expected output provided
        }

        try {
            // Capture stdout and stderr
            this.pyodide.runPython(`
import sys
from io import StringIO
import traceback
sys.stdout = StringIO()
sys.stderr = StringIO()
            `);

            // Run the provided answer
            try {
                this.pyodide.runPython(this.answer);

                // Get the output
                const actualOutput = this.pyodide.runPython("sys.stdout.getvalue()");

                // Check if answer produces expected output
                if (actualOutput.trim() !== this.expectedOutput) {
                    console.warn(`Exercise validation failed for exercise ID: ${this.exerciseId}
Expected output: "${this.expectedOutput}"
Actual output: "${actualOutput.trim()}"
Answer code: ${this.answer}
Container element:`, this.container);
                }
            } catch (pythonError) {
                // Get the traceback from stderr
                const errorOutput = this.pyodide.runPython("sys.stderr.getvalue()");
                console.warn(`Exercise validation failed with exception for exercise ID: ${this.exerciseId}
Python exception: ${pythonError.message}
Traceback: ${errorOutput}
Answer code: ${this.answer}
Expected output: "${this.expectedOutput}"
Container element:`, this.container);
            }

            // Restore stdout and stderr
            this.pyodide.runPython(`
sys.stdout = sys.__stdout__
sys.stderr = sys.__stderr__
            `);

        } catch (error) {
            console.warn(`Exercise validation error for exercise ID: ${this.exerciseId}
Error: ${error.message}
Answer code: ${this.answer}
Expected output: "${this.expectedOutput}"
Container element:`, this.container);
        }
    }

    async runCode() {
        if (!this.pyodide) {
            this.output.textContent = "Python environment not ready. Please wait...";
            return;
        }

        this.runBtn.disabled = true;
        this.output.textContent = "Running...";
        this.resetFeedback();

        try {
            const code = this.codeJar.toString().trim();

            // Check if code is empty
            if (!code) {
                this.output.textContent = "<No code provided>";
                this.output.classList.add('incorrect');
                this.output.classList.remove('correct');
                this.checkmark.style.display = 'none';
                if (this.answer) {
                    this.revealAnswer.style.display = 'inline-block';
                }
                return;
            }

            // Capture stdout
            this.pyodide.runPython(`
import sys
from io import StringIO
sys.stdout = StringIO()
            `);

            // Run user code
            this.pyodide.runPython(code);

            // Get the output
            const result = this.pyodide.runPython("sys.stdout.getvalue()");

            // Restore stdout
            this.pyodide.runPython("sys.stdout = sys.__stdout__");

            this.output.textContent = result || "(no output)";

            // Check if the answer is correct
            this.checkAnswer(result.trim());

        } catch (error) {
            this.output.textContent = "Error: " + error.message;
            this.markIncorrect();
        } finally {
            this.runBtn.disabled = false;
        }
    }

    checkAnswer(actualOutput) {
        if (actualOutput === this.expectedOutput) {
            this.markCorrect();
        } else {
            this.markIncorrect();
        }
    }

    markCorrect() {
        this.isCorrect = true;
        this.output.classList.add('correct');
        this.output.classList.remove('incorrect');
        this.checkmark.style.display = 'inline';
        this.revealAnswer.style.display = 'none';
    }

    markIncorrect() {
        this.isCorrect = false;
        this.output.classList.add('incorrect');
        this.output.classList.remove('correct');
        this.checkmark.style.display = 'none';
        if (this.answer) {
            this.revealAnswer.style.display = 'inline-block';
        }
    }

    resetFeedback() {
        this.output.classList.remove('correct', 'incorrect');
        this.checkmark.style.display = 'none';
        this.revealAnswer.style.display = 'none';
        this.answerDiv.style.display = 'none';
    }

    showAnswer() {
        this.answerDiv.style.display = 'block';
        this.revealAnswer.style.display = 'none';

        // Apply syntax highlighting to the answer
        if (typeof hljs !== 'undefined') {
            // Reset highlighted state before re-highlighting
            delete this.answerDiv.dataset.highlighted;
            this.answerDiv.className = 'answer language-python';
            hljs.highlightElement(this.answerDiv);
        }
    }
}

// Initialize dependencies and exercises when DOM is ready
document.addEventListener('DOMContentLoaded', async function() {
    try {
        // Load all dependencies first
        await loadDependencies();

        // Wait a bit for scripts to initialize
        await new Promise(resolve => setTimeout(resolve, 100));

        // Initialize exercises
        const exercises = document.querySelectorAll('.pyodide-exercise');
        exercises.forEach(container => {
            new PyodideExercise(container);
        });
    } catch (error) {
        console.error('Failed to load dependencies:', error);
        // Initialize exercises anyway with fallback
        const exercises = document.querySelectorAll('.pyodide-exercise');
        exercises.forEach(container => {
            new PyodideExercise(container);
        });
    }
});

// Export for use in other modules if needed
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PyodideExercise;
}
