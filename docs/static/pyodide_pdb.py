import ast
import copy
from io import StringIO
import sys
import traceback


class ScopeNode:
    """Represents a scope in the code (module, function, class, comprehension, etc.)"""
    def __init__(self, name, scope_type, lineno=None, end_lineno=None, parent=None):
        self.name = name
        self.scope_type = scope_type  # 'module', 'function', 'class', 'comprehension', etc.
        self.lineno = lineno
        self.end_lineno = end_lineno
        self.parent = parent
        self.children = []
        self.variables = {}  # name -> (line_defined, source)

    def add_child(self, child):
        self.children.append(child)
        child.parent = self
        return child

    def add_variable(self, name, lineno, source='assignment'):
        """Record a variable defined in this scope"""
        self.variables[name] = (lineno, source)

    def contains_line(self, lineno):
        """Check if the given line number is within this scope"""
        if self.lineno is None or self.end_lineno is None:
            return False
        return self.lineno <= lineno <= self.end_lineno

    def get_scope_path(self):
        """Get the full path of this scope (e.g., 'module.function.comprehension')"""
        if self.parent is None:
            return self.scope_type
        return f"{self.parent.get_scope_path()}.{self.name}"


class ScopeAnalyzer(ast.NodeVisitor):
    """Analyzes Python code to build a scope tree and track variables"""

    def __init__(self, code):
        self.code = code
        self.lines = code.splitlines()
        self.root = ScopeNode("module", "module", 1, len(self.lines))
        self.current_scope = self.root
        self.node_to_scope = {}
        self.line_to_scope = {}

    def analyze(self):
        """Analyze the code and build the scope tree"""
        try:
            tree = ast.parse(self.code)
            tree = ast.fix_missing_locations(tree)
            self.visit(tree)
            self._build_line_to_scope_map()
            return self.root
        except SyntaxError:
            return self.root

    def _build_line_to_scope_map(self):
        """Build a mapping from line numbers to their most specific scope"""
        self._traverse_scope_tree(self.root)

    def _traverse_scope_tree(self, scope):
        """Recursively traverse scope tree to build line mapping"""
        if self._has_valid_line_range(scope):
            self._map_lines_to_scope(scope)

        for child in scope.children:
            self._traverse_scope_tree(child)

    def _has_valid_line_range(self, scope):
        return scope.lineno and scope.end_lineno

    def _map_lines_to_scope(self, scope):
        """Map each line in scope's range to the most specific scope"""
        for line in range(scope.lineno, scope.end_lineno + 1):
            if self._is_more_specific_scope(scope, line):
                self.line_to_scope[line] = scope

    def _is_more_specific_scope(self, scope, line):
        """Check if this scope is more specific than existing mapping"""
        if line not in self.line_to_scope:
            return True

        current_depth = len(self.line_to_scope[line].get_scope_path().split('.'))
        new_depth = len(scope.get_scope_path().split('.'))
        return new_depth > current_depth

    def visit_FunctionDef(self, node):
        """Visit a function definition"""
        func_scope = ScopeNode(node.name, "function", node.lineno, node.end_lineno)
        self.current_scope.add_child(func_scope)
        self.node_to_scope[node] = func_scope

        # Add function parameters as variables
        for arg in node.args.args:
            func_scope.add_variable(arg.arg, node.lineno, 'parameter')

        # Process function body with the new scope
        old_scope = self.current_scope
        self.current_scope = func_scope
        for stmt in node.body:
            self.visit(stmt)
        self.current_scope = old_scope

    def visit_ClassDef(self, node):
        """Visit a class definition"""
        class_scope = ScopeNode(node.name, "class", node.lineno, node.end_lineno)
        self.current_scope.add_child(class_scope)
        self.node_to_scope[node] = class_scope

        # Process class body with the new scope
        old_scope = self.current_scope
        self.current_scope = class_scope
        for stmt in node.body:
            self.visit(stmt)
        self.current_scope = old_scope

    def visit_ListComp(self, node):
        """Visit a list comprehension"""
        self._handle_comprehension(node, "list_comp")

    def visit_DictComp(self, node):
        """Visit a dict comprehension"""
        self._handle_comprehension(node, "dict_comp")

    def visit_SetComp(self, node):
        """Visit a set comprehension"""
        self._handle_comprehension(node, "set_comp")

    def visit_GeneratorExp(self, node):
        """Visit a generator expression"""
        self._handle_comprehension(node, "generator")

    def _handle_comprehension(self, node, comp_type):
        """Handle any type of comprehension with simplified logic"""
        comp_scope = self._create_comprehension_scope(node, comp_type)

        with self._temporary_scope(comp_scope):
            self._process_comprehension_components(node)

    def _create_comprehension_scope(self, node, comp_type):
        """Create and register a comprehension scope"""
        comp_scope = ScopeNode(comp_type, comp_type,
                              getattr(node, 'lineno', None),
                              getattr(node, 'end_lineno', None))
        self.current_scope.add_child(comp_scope)
        self.node_to_scope[node] = comp_scope
        return comp_scope

    def _temporary_scope(self, new_scope):
        """Context manager for temporary scope switching"""
        class ScopeContext:
            def __init__(self, analyzer, scope):
                self.analyzer = analyzer
                self.new_scope = scope
                self.old_scope = None

            def __enter__(self):
                self.old_scope = self.analyzer.current_scope
                self.analyzer.current_scope = self.new_scope
                return self.new_scope

            def __exit__(self, *args):
                self.analyzer.current_scope = self.old_scope

        return ScopeContext(self, new_scope)

    def _process_comprehension_components(self, node):
        """Process the components of a comprehension"""
        for generator in node.generators:
            self._extract_target_vars(generator.target, getattr(generator, 'lineno', None))
            self.visit(generator.iter)
            for if_clause in generator.ifs:
                self.visit(if_clause)

        self._visit_comprehension_element(node)

    def _visit_comprehension_element(self, node):
        """Visit the element being comprehended"""
        if hasattr(node, 'elt'):
            self.visit(node.elt)
        elif hasattr(node, 'key') and hasattr(node, 'value'):
            self.visit(node.key)
            self.visit(node.value)

    def visit_Assign(self, node):
        """Visit an assignment statement"""
        # First visit the value to handle any nested expressions
        self.visit(node.value)

        # Then extract the variable names being assigned
        for target in node.targets:
            self._extract_target_vars(target, node.lineno)

    def visit_AugAssign(self, node):
        """Visit an augmented assignment (e.g., x += 1)"""
        self.visit(node.value)
        self._extract_target_vars(node.target, node.lineno)

    def visit_For(self, node):
        """Visit a for loop"""
        self.visit(node.iter)
        self._extract_target_vars(node.target, node.lineno)

        # Visit the loop body
        for stmt in node.body:
            self.visit(stmt)

        # Visit the else clause if it exists
        for stmt in node.orelse:
            self.visit(stmt)

    def visit_With(self, node):
        """Visit a with statement, which can introduce new variable bindings"""
        for item in node.items:
            self.visit(item.context_expr)
            if item.optional_vars:
                self._extract_target_vars(item.optional_vars, node.lineno)

        # Visit the body
        for stmt in node.body:
            self.visit(stmt)

    def visit_Lambda(self, node):
        """Visit a lambda expression, which creates a new scope"""
        lambda_scope = ScopeNode("lambda", "lambda", getattr(node, 'lineno', None),
                                getattr(node, 'end_lineno', None))
        self.current_scope.add_child(lambda_scope)
        self.node_to_scope[node] = lambda_scope

        # Add lambda parameters as variables
        for arg in node.args.args:
            lambda_scope.add_variable(arg.arg, getattr(node, 'lineno', None), 'parameter')

        # Process lambda body with the new scope
        old_scope = self.current_scope
        self.current_scope = lambda_scope
        self.visit(node.body)
        self.current_scope = old_scope

    def _extract_target_vars(self, target, lineno):
        """Extract variable names from assignment targets"""
        if isinstance(target, ast.Name):
            self.current_scope.add_variable(target.id, lineno, 'assignment')
        elif isinstance(target, ast.Tuple) or isinstance(target, ast.List):
            # Handle tuple/list unpacking like: a, b = something or [x, y] = something
            for elt in target.elts:
                self._extract_target_vars(elt, lineno)
        elif isinstance(target, ast.Starred):
            # Handle starred expressions like: *args = something
            self._extract_target_vars(target.value, lineno)
        elif isinstance(target, ast.Subscript):
            # Handle subscript assignment like: arr[0] = something
            # We don't track these as new variables, just visit the expression
            pass
        elif isinstance(target, ast.Attribute):
            # Handle attribute assignment like: obj.attr = something
            # We don't track these as new variables, just visit the expression
            pass

    def generic_visit(self, node):
        """Visit a generic node"""
        super().generic_visit(node)


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

        # Build scope tree from AST
        self.scope_analyzer = ScopeAnalyzer(code)
        self.scope_tree = self.scope_analyzer.analyze()
        self.line_to_scope = self.scope_analyzer.line_to_scope

        # Store variable assignments to help recreate iterators
        self.variable_assignments = self._extract_variable_assignments()

        # Compile the code
        try:
            self.compiled_code = compile(code, '<string>', 'exec')
            self._prepare_execution_trace()
        except Exception as e:
            print(f"Compilation error: {e}")
            traceback.print_exc()
            self.finished = True

    def _extract_variable_assignments(self):
        """Extract variable assignments to help recreate iterators"""
        assignments = {}
        try:
            tree = ast.parse(self.code)
            for node in ast.walk(tree):
                if isinstance(node, ast.Assign):
                    for target in node.targets:
                        if isinstance(target, ast.Name):
                            # Store the source code for this assignment
                            if hasattr(node, 'lineno'):
                                line_idx = node.lineno - 1
                                if 0 <= line_idx < len(self.lines):
                                    assignments[target.id] = self.lines[line_idx].strip()
        except:
            pass
        return assignments

    def _prepare_execution_trace(self):
        """Pre-compute the execution trace by running the code with a tracer."""
        self.execution_trace = []
        captured_output = StringIO()
        previous_line = None

        def trace_function(frame, event, arg):
            nonlocal previous_line
            if frame.f_code.co_filename == '<string>':
                line_no = frame.f_lineno - 1  # Convert to 0-based indexing
                if event == 'line' and 0 <= line_no < len(self.lines):
                    # Only add if this is a different line and it's not empty
                    if line_no != previous_line and self.lines[line_no].strip():
                        # Capture state BEFORE executing this line
                        all_vars = {}
                        scope_info = {}
                        type_info = {}

                        # Get the scope for this line (1-based indexing for AST)
                        current_scope = self.line_to_scope.get(line_no + 1)

                        # Combine locals and globals, prioritizing locals
                        all_frame_vars = dict(frame.f_globals)
                        all_frame_vars.update(frame.f_locals)

                        for k, v in all_frame_vars.items():
                            if k in self.varnames and not k.startswith('_'):
                                # Convert iterators to readable format
                                display_value = self._format_value_for_display(v)
                                all_vars[k] = display_value

                                # Capture variable type
                                type_info[k] = self._get_variable_type(v)

                                # Determine scope using AST analysis + runtime info
                                scope_name = self._determine_variable_scope(k, frame, current_scope)
                                scope_info[k] = scope_name

                        # Capture current output (before executing this line)
                        current_output = captured_output.getvalue()

                        self.execution_trace.append({
                            'line': line_no,
                            'locals': all_vars,
                            'scope_info': scope_info,
                            'type_info': type_info,
                            'output': current_output,
                            'pre_execution': True  # This state is BEFORE line execution
                        })

                        previous_line = line_no
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

            # Capture final state after all execution is complete
            if self.execution_trace:
                # Get the final variables state by re-executing up to the end
                final_globals = {}
                sys.stdout = StringIO()  # Capture final output
                try:
                    exec(self.compiled_code, final_globals)
                    final_output = sys.stdout.getvalue()

                    # Create final state entry showing completed execution
                    final_vars = {}
                    final_scope_info = {}
                    final_type_info = {}

                    for k, v in final_globals.items():
                        if k in self.varnames and not k.startswith('_'):
                            display_value = self._format_value_for_display(v)
                            final_vars[k] = display_value
                            final_type_info[k] = self._get_variable_type(v)
                            final_scope_info[k] = 'global'  # After execution, most vars are global

                    # Add final state (after last line execution)
                    self.execution_trace.append({
                        'line': len(self.lines) - 1,  # Last line
                        'locals': final_vars,
                        'scope_info': final_scope_info,
                        'type_info': final_type_info,
                        'output': final_output,
                        'pre_execution': False,  # This state is AFTER execution
                        'final_state': True
                    })
                except:
                    pass
                finally:
                    sys.stdout = original_stdout

    def _determine_variable_scope(self, var_name, frame, current_scope):
        """Determine the scope of a variable using simplified logic"""
        # Check if in global scope
        if frame.f_locals is frame.f_globals:
            return 'global'

        # Use AST analysis first
        scope_from_ast = self._get_scope_from_ast(var_name, current_scope)
        if scope_from_ast:
            return scope_from_ast

        # Fall back to runtime analysis
        return self._get_scope_from_runtime(var_name, frame)

    def _get_scope_from_ast(self, var_name, current_scope):
        """Get scope information from AST analysis"""
        if not current_scope:
            return None

        # Check current scope
        if var_name in current_scope.variables:
            return self._format_scope_name(current_scope)

        # Check parent scopes
        parent_scope = current_scope.parent
        while parent_scope:
            if var_name in parent_scope.variables:
                return self._format_parent_scope_name(parent_scope)
            parent_scope = parent_scope.parent

        return None

    def _format_scope_name(self, scope):
        """Format scope name for display"""
        if scope.scope_type == 'module':
            return 'global'
        return f'local ({scope.name})'

    def _format_parent_scope_name(self, scope):
        """Format parent scope name for display"""
        if scope.scope_type == 'module':
            return 'global'
        return f'outer ({scope.name})'

    def _get_scope_from_runtime(self, var_name, frame):
        """Get scope information from runtime frame analysis"""
        code_name = frame.f_code.co_name
        context_map = {
            '<module>': 'module',
            '<listcomp>': 'list comprehension',
            '<dictcomp>': 'dict comprehension',
            '<setcomp>': 'set comprehension',
            '<genexpr>': 'generator',
            '<lambda>': 'lambda'
        }

        if var_name in frame.f_locals:
            context = context_map.get(code_name, code_name)
            return f'local ({context})'

        return 'global'

    def _get_variable_type(self, value):
        type_name = type(value).__name__
        if hasattr(value, '__iter__') and hasattr(value, '__next__'):
            return f'{type_name} (iter)'
        else:
            return type_name

    def step(self):
        if self.finished or self.step_index >= len(self.execution_trace):
            self.finished = True
            return

        # Get the current execution state
        current_state = self.execution_trace[self.step_index]
        self.current_line = current_state['line']
        self.locals_dict = current_state['locals']
        self.scope_info = current_state['scope_info']
        self.type_info = current_state.get('type_info', {})
        self.output_lines = current_state['output'].splitlines()

        # Advance to next step
        self.step_index += 1

        # Check if we've reached the end or hit the final state
        if (self.step_index >= len(self.execution_trace) or
            current_state.get('final_state', False)):
            self.finished = True

    def reset(self):
        self.current_line = -1
        self.locals_dict = {}
        self.scope_info = {}
        self.type_info = {}
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
            "type_info": self.type_info,
            "output_lines": self.output_lines,
            "lines": self.lines,
            "finished": self.finished
        }
        return state

    def _format_value_for_display(self, value):
        """
        Format values for display, converting iterators to readable format.

        Args:
            value: The Python value to format

        Returns:
            A representation of the value suitable for display
        """
        # Handle zip objects and other iterators
        if hasattr(value, '__iter__') and hasattr(value, '__next__'):
            type_name = type(value).__name__

            # Try to peek at iterator contents without consuming
            try:
                if type_name == 'zip':
                    return self._represent_zip_iterator(value)
                elif type_name == 'enumerate':
                    return self._represent_enumerate_iterator(value)
                elif type_name == 'map':
                    return self._represent_map_iterator(value)
                elif type_name == 'filter':
                    return self._represent_filter_iterator(value)
                elif type_name == 'range':
                    return self._represent_range_object(value)
                else:
                    return f"<{type_name} object>"
            except:
                return f"<{type_name} object>"

        # Handle other types using Python's repr for proper formatting
        try:
            return repr(copy.deepcopy(value))
        except:
            try:
                return repr(value)
            except:
                return str(value)

    def _represent_zip_iterator(self, zip_obj):
        """Represent a zip iterator by showing its structure"""
        try:
            # Try to find the variable name and recreate the zip
            for var_name, assignment in self.variable_assignments.items():
                if 'zip(' in assignment:
                    # Extract the arguments from the zip call
                    import re
                    match = re.search(r'zip\((.*?)\)', assignment)
                    if match:
                        args_str = match.group(1)
                        try:
                            # Create a safe evaluation context
                            safe_globals = {'__builtins__': {}}
                            # Try to evaluate just the arguments to show structure
                            args = eval(f'[{args_str}]', safe_globals, {})

                            # Show first few items from each iterable
                            preview_items = []
                            for arg in args:
                                if hasattr(arg, '__iter__') and not isinstance(arg, str):
                                    items = list(arg)[:3]  # First 3 items
                                    if len(list(arg)) > 3:
                                        preview_items.append(f"{items}...")
                                    else:
                                        preview_items.append(str(items))
                                else:
                                    preview_items.append(str(arg))

                            return f"zip({', '.join(preview_items)})"
                        except:
                            pass

            # Fallback: try to peek at the first item
            import itertools
            zip_copy = itertools.tee(zip_obj, 1)[0]
            try:
                first_item = next(zip_copy)
                return f"zip(... -> {first_item}, ...)"
            except StopIteration:
                return "zip(<empty>)"
        except:
            return "<zip object>"

    def _represent_enumerate_iterator(self, enum_obj):
        """Represent an enumerate iterator"""
        try:
            # Try to find the original iterable
            for var_name, assignment in self.variable_assignments.items():
                if 'enumerate(' in assignment:
                    import re
                    match = re.search(r'enumerate\((.*?)\)', assignment)
                    if match:
                        arg_str = match.group(1)
                        return f"enumerate({arg_str})"
            return "<enumerate object>"
        except:
            return "<enumerate object>"

    def _represent_map_iterator(self, map_obj):
        """Represent a map iterator"""
        return "<map object>"

    def _represent_filter_iterator(self, filter_obj):
        """Represent a filter iterator"""
        return "<filter object>"

    def _represent_range_object(self, range_obj):
        """Represent a range object with its parameters"""
        try:
            start = range_obj.start
            stop = range_obj.stop
            step = range_obj.step

            if step == 1:
                if start == 0:
                    return f"range({stop})"
                else:
                    return f"range({start}, {stop})"
            else:
                return f"range({start}, {stop}, {step})"
        except:
            return "<range object>"

def extract_assigned_variables(code_str):
    """
    Extract all variable names that are assigned in the code.

    Args:
        code_str: The Python code to analyze

    Returns:
        List of variable names that are assigned values in the code
    """
    try:
        tree = ast.parse(code_str)
        assigned_vars = set()

        for node in ast.walk(tree):
            if isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Name):
                        assigned_vars.add(target.id)
                    elif isinstance(target, ast.Tuple):
                        # Handle tuple unpacking like: a, b = something
                        for elt in target.elts:
                            if isinstance(elt, ast.Name):
                                assigned_vars.add(elt.id)
            elif isinstance(node, ast.AugAssign):
                if isinstance(node.target, ast.Name):
                    assigned_vars.add(node.target.id)
            elif isinstance(node, ast.For):
                # Add loop variables (e.g., 'char' in 'for char in a:')
                if isinstance(node.target, ast.Name):
                    assigned_vars.add(node.target.id)
                elif isinstance(node.target, ast.Tuple):
                    # Handle tuple unpacking in for loops like: for letter, number in z:
                    for elt in node.target.elts:
                        if isinstance(elt, ast.Name):
                            assigned_vars.add(elt.id)
            elif isinstance(node, ast.FunctionDef):
                # Add function parameters
                for arg in node.args.args:
                    assigned_vars.add(arg.arg)
            elif isinstance(node, (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)):
                # Add comprehension variables
                for generator in node.generators:
                    if isinstance(generator.target, ast.Name):
                        assigned_vars.add(generator.target.id)
                    elif isinstance(generator.target, ast.Tuple):
                        for elt in generator.target.elts:
                            if isinstance(elt, ast.Name):
                                assigned_vars.add(elt.id)

        return list(assigned_vars)
    except SyntaxError:
        return []
