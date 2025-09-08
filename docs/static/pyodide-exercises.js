class PyodideExercise {
    static idCounter = 0;

    generateId() {
        return ++PyodideExercise.idCounter;
    }

    constructor(containerElement) {
        this.container = containerElement;
        this.initialCode = (this.container.textContent || '').trim();
        this.expectedOutput = this.container.dataset.expectedOutput || '';
        this.answer = this.container.dataset.answer || '';
        this.exerciseId = this._generateExerciseId();

        this._initializeExercise();
    }

    _generateExerciseId() {
        return this.container.dataset.exerciseId || this.generateId();
    }

    _initializeExercise() {
        this.container.dataset.exerciseId = this.exerciseId;
        this.pyodide = null;
        this.isCorrect = false;
        this.codeJar = null;

        this.createUI();
        this._safeInit();
    }

    async _safeInit() {
        try {
            await this.init();
        } catch (error) {
            console.error('Exercise initialization failed:', error);
        }
    }

    createUI() {
        // Clear container and create exercise structure
        this.container.innerHTML = `
            <div class="exercise-container">
                <div class="editor-section">
                    <pre class="editor" id="editor-${this.exerciseId}"><code class="language-python"></code></pre>
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

        // Initialize CodeJar with syntax highlighting - make this async
        this.initCodeJar().catch(console.error);
    }

    async initCodeJar() {
        // Wait for UI dependencies to load
        await SharedPyodideManager.loadUIDependencies();

        // CodeJar should be available now
        if (!window.CodeJar) {
            throw new Error('CodeJar is not available');
        }

        try {
            // Add language class to editor for Prism
            this.editorDiv.classList.add('language-python');
            const codeElement = this.editorDiv.querySelector('code');

            // CodeJar with syntax highlighting using Prism
            this.codeJar = window.CodeJar(codeElement, (editor) => {
                // Apply syntax highlighting if Prism is available
                if (window.Prism) {
                    // Ensure the editor has the language class
                    editor.parentElement.classList.add('language-python');
                    // Apply Prism highlighting
                    SharedPyodideManager.highlightCode(editor);
                }
            });

            // Set initial code
            this.codeJar.updateCode(this.initialCode);

            // Force initial highlighting
            if (window.Prism) {
                this.editorDiv.classList.add('language-python');
                SharedPyodideManager.highlightCode(codeElement);
            }
        } catch (error) {
            console.error('CodeJar initialization failed:', error);
            throw error;
        }
    }

    async init() {
        try {
            this.output.textContent = "Loading Python environment...";
            this.runBtn.disabled = true;

            // Use shared instance instead of creating new one
            this.pyodide = await SharedPyodideManager.getSharedPyodide();

            await this.validateAnswer();
            this.output.textContent = "Click \"Run\" to execute your code...";
            this.runBtn.disabled = false;

            this.runBtn.addEventListener('click', () => this.runCode());
            this.revealAnswer.addEventListener('click', () => this.showAnswer());
        } catch (error) {
            this.output.textContent = "Error loading Python environment: " + error.message;
            console.error("Pyodide initialization error:", error);
        }
    }

    async validateAnswer() {
        if (!this._hasValidationData()) return;

        try {
            await this._setupPythonEnvironment();
            const actualOutput = await this._executeAnswer();
            this._checkValidationResult(actualOutput);
        } catch (error) {
            this._logValidationError(error);
        } finally {
            await this._restorePythonEnvironment();
        }
    }

    _hasValidationData() {
        return this.answer && this.expectedOutput;
    }

    async _setupPythonEnvironment() {
        this.pyodide.runPython(`
import sys
from io import StringIO
sys.stdout = StringIO()
sys.stderr = StringIO()
        `);
    }

    async _executeAnswer() {
        this.pyodide.runPython(this.answer);
        return this.pyodide.runPython("sys.stdout.getvalue()");
    }

    _checkValidationResult(actualOutput) {
        if (actualOutput.trim() !== this.expectedOutput) {
            this._logValidationMismatch(actualOutput);
        }
    }

    _logValidationMismatch(actualOutput) {
        console.warn(`Exercise validation failed for ID: ${this.exerciseId}
Expected: "${this.expectedOutput}"
Actual: "${actualOutput.trim()}"
Answer: ${this.answer}`);
    }

    _logValidationError(error) {
        const errorOutput = this.pyodide.runPython("sys.stderr.getvalue()");
        console.warn(`Exercise validation error for ID: ${this.exerciseId}
Error: ${error.message}
Traceback: ${errorOutput}
Answer code: ${this.answer}
Expected output: "${this.expectedOutput}"
Container element:`, this.container);
            }

    async _restorePythonEnvironment() {
        this.pyodide.runPython(`
sys.stdout = sys.__stdout__
sys.stderr = sys.__stderr__
        `);
    }

    async runCode() {
        if (!this.pyodide) {
            this._showNotReadyMessage();
            return;
        }

        this._prepareForExecution();

        try {
            const code = this._getUserCode();
            if (!code) {
                this._handleEmptyCode();
                return;
            }

            const result = await this._executeUserCode(code);
            this._displayResult(result);
            this.checkAnswer(result.trim());
        } catch (error) {
            this._handleExecutionError(error);
        } finally {
            this.runBtn.disabled = false;
        }
    }

    _prepareForExecution() {
        this.runBtn.disabled = true;
        this.output.textContent = "Running...";
        this.resetFeedback();
    }

    _getUserCode() {
        return this.codeJar.toString().trim();
    }

    _handleEmptyCode() {
        this.output.textContent = "<No code provided>";
        this.markIncorrect();
    }

    async _executeUserCode(code) {
        // Setup output capture
        this.pyodide.runPython(`
import sys
from io import StringIO
sys.stdout = StringIO()
        `);

        // Execute user code
        this.pyodide.runPython(code);

        // Get result and restore stdout
        const result = this.pyodide.runPython("sys.stdout.getvalue()");
        this.pyodide.runPython("sys.stdout = sys.__stdout__");

        return result;
    }

    _displayResult(result) {
        this.output.textContent = result || "(no output)";
    }

    _handleExecutionError(error) {
        this.output.textContent = "Error: " + error.message;
        this.markIncorrect();
    }

    _showNotReadyMessage() {
        this.output.textContent = "Python environment not ready. Please wait...";
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

        // First add the show-solution class
        this.answerDiv.classList.add('show-solution');

        // Apply syntax highlighting to the answer using Prism
        if (window.Prism) {
            // Ensure all necessary classes are present
            this.answerDiv.classList.add('answer', 'language-python', 'show-solution');
            SharedPyodideManager.highlightCode(this.answerDiv);
        } else {
            // Fallback if Prism is not available
            this.answerDiv.className = 'answer show-solution';
        }
    }

    addLineNumbers(editor) {
        // This is now handled by Prism's line-number plugin if enabled.
        // This function can be removed or left empty.
    }
}

// Initialize dependencies and exercises when DOM is ready
document.addEventListener('DOMContentLoaded', async function () {
    try {
        // Load UI dependencies first for immediate styling
        await SharedPyodideManager.loadUIDependencies();

        // Initialize exercises immediately with UI
        const exercises = document.querySelectorAll('.pyodide-exercise');
        exercises.forEach(container => {
            new PyodideExercise(container);
        });
    } catch (error) {
        console.error('Failed to load UI dependencies:', error);
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
