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
            // CodeJar with syntax highlighting using Prism
            this.codeJar = window.CodeJar(this.editorDiv, (editor) => {
                // Apply syntax highlighting if Prism is available
                if (window.Prism) {
                    SharedPyodideManager.highlightCode(editor);
                }

                // Add line numbers
                this.addLineNumbers(editor);
            });

            // Set initial code
            this.codeJar.updateCode(this.initialCode);
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

        // Apply syntax highlighting to the answer using Prism
        if (window.Prism) {
            this.answerDiv.className = 'answer language-python';
            SharedPyodideManager.highlightCode(this.answerDiv);
        }
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
