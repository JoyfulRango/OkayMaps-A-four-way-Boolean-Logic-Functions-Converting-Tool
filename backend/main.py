import re
from pathlib import Path
from typing import Dict, FrozenSet, Tuple
import itertools 

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, StrictInt, StrictStr

app = FastAPI()

# Enable CORS for local HTML file access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _detect_global_parity(terms: list['Term']) -> Tuple[str, list[str]] | None:
    """Check whether the SOP's truth table matches n-input XOR or XNOR
    over every variable it actually uses, regardless of algebraic shape."""
    variables = sorted({variable for term in terms for variable, _ in term})
    if len(variables) < 2:
        return None

    odd_matches = True
    even_matches = True

    for bits in itertools.product([False, True], repeat=len(variables)):
        assignment = dict(zip(variables, bits))
        value = any(
            all(assignment[variable] == polarity for variable, polarity in term)
            for term in terms
        )
        popcount_odd = sum(bits) % 2 == 1

        if value != popcount_odd:
            odd_matches = False
        if value != (not popcount_odd):
            even_matches = False
        if not odd_matches and not even_matches:
            return None

    if odd_matches:
        return "xor", variables
    if even_matches:
        return "xnor", variables
    return None

@app.get("/api/hello")
def read_hello():
    return {"message": "Hello from backend"}


class SimplifyExpressionRequest(BaseModel):
    expression: str


class TruthTableRow(BaseModel):
    bits: StrictStr
    value: StrictStr


class TruthTableRequest(BaseModel):
    variables: list[StrictStr]
    outputs: list[TruthTableRow]


class EquationRequest(BaseModel):
    expression: StrictStr


class MuxRequest(BaseModel):
    num_vars: StrictInt
    connections: list[StrictStr]
    mode: StrictStr = "folded"


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content={"detail": "Invalid request: " + str(exc.errors())})


Literal = Tuple[str, bool]
Term = FrozenSet[Literal]


def _mux_connection_for_pair(f_when_0: str, f_when_1: str, folded_var: str) -> str:
    """Return the first folded-input connection compatible with a value pair."""
    candidates = (
        ("0", ("0", "0")),
        ("1", ("1", "1")),
        (folded_var, ("0", "1")),
        (folded_var + "'", ("1", "0")),
    )
    for connection, (expected_zero, expected_one) in candidates:
        if (
            f_when_0 in ("X", expected_zero)
            and f_when_1 in ("X", expected_one)
        ):
            return connection
    raise ValueError("Each MUX input pair must contain only 0, 1, or X values")


def _evaluate_mux_connection(connection: str, folded_value: int, folded_var: str) -> int:
    if connection == "0":
        return 0
    if connection == "1":
        return 1
    if connection == folded_var:
        return folded_value
    if connection == folded_var + "'":
        return 1 - folded_value
    raise ValueError(f"Invalid MUX connection: {connection}")


def _is_all_dontcare(num_vars: int, values: Dict[int, str]) -> bool:
    """True when every one of the 2^n cells is a don't-care (X)."""
    return all(str(values.get(index, "")).upper() == "X" for index in range(2 ** num_vars))


def build_mux(num_vars: int, variables: list[str], values: Dict[int, str]) -> dict:
    """Build the 2:1, 4:1, or 8:1 folded-variable MUX representation."""
    if num_vars not in (2, 3, 4):
        raise ValueError("Number of variables must be 2, 3, or 4")
    if len(variables) != num_vars:
        raise ValueError("MUX variables must match the variable count")

    select_vars = variables[:-1]
    folded_var = variables[-1]
    # An all-don't-care function is resolved to the constant F = 1 (matches the K-map).
    all_dontcare = _is_all_dontcare(num_vars, values)
    inputs = []
    for index in range(2 ** (num_vars - 1)):
        f_when_0 = str(values[2 * index]).upper()
        f_when_1 = str(values[2 * index + 1]).upper()
        connection = "1" if all_dontcare else _mux_connection_for_pair(f_when_0, f_when_1, folded_var)
        used_dontcare = "X" in (f_when_0, f_when_1)
        inputs.append({
            "index": index,
            "select_bits": format(index, f"0{num_vars - 1}b"),
            "f_when_0": f_when_0,
            "f_when_1": f_when_1,
            "connection": connection,
            "used_dontcare": used_dontcare,
        })

    # Internal self-check: a selected input must reproduce every defined cell.
    for minterm, raw_value in values.items():
        value = str(raw_value).upper()
        if value == "X":
            continue
        index, folded_value = divmod(minterm, 2)
        actual = _evaluate_mux_connection(inputs[index]["connection"], folded_value, folded_var)
        assert actual == int(value), f"MUX output differs at minterm {minterm}"

    return {
        "type": f"{2 ** (num_vars - 1)}:1",
        "select_vars": select_vars,
        "folded_var": folded_var,
        "inputs": inputs,
        "has_dontcare_resolution": any(item["used_dontcare"] for item in inputs),
        "all_dontcare": all_dontcare,
    }


def build_unfolded_mux(num_vars: int, variables: list[str], values: Dict[int, str]) -> dict:
    """Build the 2^n:1 unfolded MUX: every variable is a select line and every
    data input I_k is wired to the constant 0 or 1 of minterm k.

    A don't-care (X) cell is resolved to 0.
    """
    if num_vars not in (2, 3, 4):
        raise ValueError("Number of variables must be 2, 3, or 4")
    if len(variables) != num_vars:
        raise ValueError("MUX variables must match the variable count")

    # A lone X is resolved to 0, but an all-don't-care function is resolved to F = 1.
    all_dontcare = _is_all_dontcare(num_vars, values)
    inputs = []
    for index in range(2 ** num_vars):
        value = str(values[index]).upper()
        if value not in ("0", "1", "X"):
            raise ValueError("Each MUX input must contain only 0, 1, or X values")
        inputs.append({
            "index": index,
            "select_bits": format(index, f"0{num_vars}b"),
            "value": value,
            "connection": ("1" if all_dontcare else "0") if value == "X" else value,
            "used_dontcare": value == "X",
        })

    # Internal self-check: every defined cell must be reproduced by its input.
    for minterm, raw_value in values.items():
        value = str(raw_value).upper()
        if value == "X":
            continue
        assert inputs[minterm]["connection"] == value, f"Unfolded MUX output differs at minterm {minterm}"

    return {
        "type": f"{2 ** num_vars}:1",
        "select_vars": list(variables),
        "folded_var": None,
        "inputs": inputs,
        "has_dontcare_resolution": any(item["used_dontcare"] for item in inputs),
        "all_dontcare": all_dontcare,
    }


def _build_mux_payload(num_vars: int, variables: list[str], values: Dict[int, str]) -> dict:
    """Both MUX representations, as returned under the `mux` key of every solve endpoint."""
    return {
        "folded": build_mux(num_vars, variables, values),
        "unfolded": build_unfolded_mux(num_vars, variables, values),
    }


def _parse_sop(expression: str) -> list[Term]:
    """Parse a basic SOP expression into immutable sets of (variable, polarity)."""
    if not isinstance(expression, str) or not expression.strip():
        raise ValueError("expression must be a non-empty SOP expression")

    terms: list[Term] = []
    for raw_term in expression.split("+"):
        compact = re.sub(r"\s+", "", raw_term)
        if not compact:
            raise ValueError("empty product term")

        tokens = re.findall(r"[A-Z]'?|\*", compact)
        if "".join(tokens) != compact:
            raise ValueError("only A-Z variables, apostrophes, *, and + are supported")
        if tokens[0] == "*" or tokens[-1] == "*" or "**" in compact:
            raise ValueError("invalid AND operator placement")

        literals: Dict[str, bool] = {}
        for token in tokens:
            if token == "*":
                continue

            variable = token[0]
            if variable == "X":
                raise ValueError("X is a K-map don't-care value, not an input variable")
            polarity = not token.endswith("'")
            if variable in literals and literals[variable] != polarity:
                # A contradictory product is zero and contributes nothing to an SOP.
                literals = {}
                break
            literals[variable] = polarity

        if literals:
            terms.append(frozenset(literals.items()))

    return list(dict.fromkeys(terms))


def _term_sort_key(term: Term) -> tuple:
    literals = sorted(term, key=lambda literal: literal[0])
    text = "".join(variable + ("" if polarity else "'") for variable, polarity in literals)
    return len(term), text


def _format_term(term: Term) -> str:
    return "".join(
        variable + ("" if polarity else "'")
        for variable, polarity in sorted(term, key=lambda literal: literal[0])
    ) or "1"


def _combine_terms(left: Term, right: Term) -> Term | None:
    """Combine terms differing in exactly one variable polarity."""
    left_by_variable = dict(left)
    right_by_variable = dict(right)
    if set(left_by_variable) != set(right_by_variable):
        return None

    differences = [
        variable for variable in left_by_variable
        if left_by_variable[variable] != right_by_variable[variable]
    ]
    if len(differences) != 1:
        return None

    combined = set(left)
    combined.remove((differences[0], left_by_variable[differences[0]]))
    return frozenset(combined)


def simplify_sop(expression: str) -> str:
    if isinstance(expression, str) and expression.strip() in ("0", "1"):
        return expression.strip()

    terms = _parse_sop(expression)

    # Every term was a contradiction (e.g. AA'), so the function is constant 0.
    if not terms:
        return "0"

    # Variables are ordered alphabetically; the first variable is the MSB,
    # mirroring the variable/bit mapping used by circuitMinimize in index.html.
    variables = sorted({variable for term in terms for variable, _ in term})
    n = len(variables)

    # Build the on-set: every minterm satisfied by at least one product term.
    on_list: list[int] = []
    for minterm in range(2 ** n):
        assignment = {
            variable: bool((minterm >> (n - 1 - index)) & 1)
            for index, variable in enumerate(variables)
        }
        if any(
            all(assignment[variable] == polarity for variable, polarity in term)
            for term in terms
        ):
            on_list.append(minterm)

    if not on_list:
        return "0"

    # ---- Quine-McCluskey: generate all prime implicants ----
    # An implicant is a pair (v, m): m marks the eliminated ("dash") bits and
    # v holds the value of the remaining bits.
    current: Dict[Tuple[int, int], Tuple[int, int]] = {}
    for minterm in on_list:
        current[(minterm, 0)] = (minterm, 0)

    primes: list[Tuple[int, int]] = []
    while current:
        implicants = list(current.values())
        used: set[int] = set()
        next_level: Dict[Tuple[int, int], Tuple[int, int]] = {}
        for i in range(len(implicants)):
            for j in range(i + 1, len(implicants)):
                a_v, a_m = implicants[i]
                b_v, b_m = implicants[j]
                if a_m != b_m:
                    continue
                diff = a_v ^ b_v
                if diff and (diff & (diff - 1)) == 0:
                    new_v = a_v & ~diff
                    new_m = a_m | diff
                    next_level[(new_v, new_m)] = (new_v, new_m)
                    used.add(i)
                    used.add(j)
        for i, implicant in enumerate(implicants):
            if i not in used:
                primes.append(implicant)
        current = next_level

    # ---- Exact minimum cover (branch and bound) ----
    def covers(prime: Tuple[int, int], minterm: int) -> bool:
        return (minterm & ~prime[1]) == prime[0]

    def cost(chosen: list[Tuple[int, int]]) -> int:
        return len(chosen) * 100 + sum(n - bin(m).count("1") for _, m in chosen)

    best: list[Tuple[int, int]] | None = None
    best_cost = float("inf")

    def search(remaining: list[int], chosen: list[Tuple[int, int]]) -> None:
        nonlocal best, best_cost
        chosen_cost = cost(chosen)
        if chosen_cost >= best_cost:
            return
        if not remaining:
            best = chosen
            best_cost = chosen_cost
            return
        candidates = [prime for prime in primes if covers(prime, remaining[0])]
        candidates.sort(key=lambda prime: -sum(1 for x in remaining if covers(prime, x)))
        for prime in candidates:
            search([x for x in remaining if not covers(prime, x)], chosen + [prime])

    search(on_list, [])
    selected = best or []

    # ---- Convert the chosen prime implicants back to Terms ----
    result_terms: list[Term] = []
    for value, mask in selected:
        literals = []
        for index, variable in enumerate(variables):
            bit = n - 1 - index
            if (mask >> bit) & 1:
                continue
            literals.append((variable, bool((value >> bit) & 1)))
        result_terms.append(frozenset(literals))

    result_terms = list(dict.fromkeys(result_terms))
    return " + ".join(_format_term(term) for term in sorted(result_terms, key=_term_sort_key)) or "0"


# Small expression-tree helpers used only for the optional factored presentation.
Expr = tuple


def _expr_key(expression: Expr) -> str:
    kind = expression[0]
    if kind == "literal":
        return expression[1]
    if kind == "and":
        return "(" + "".join(_expr_key(item) for item in expression[1]) + ")"
    if kind == "xor":
        return "(" + "^".join(_expr_key(item) for item in expression[1]) + ")"
    if kind == "xnor":
        return "(" + "~^".join(_expr_key(item) for item in expression[1]) + ")"
    return "(" + "+".join(_expr_key(item) for item in expression[1]) + ")"


def _literal_expression(literal: Literal) -> Expr:
    variable, polarity = literal
    return ("literal", variable + ("" if polarity else "'"))


def _factor_sort_key(expression: Expr) -> tuple:
    # Keep literal factors first so output reads A(B + C), not (B + C)A.
    return (0 if expression[0] == "literal" else 1, _expr_key(expression))


def _make_and(factors: list[Expr]) -> Expr:
    flattened = []
    for factor in factors:
        if factor[0] == "and":
            flattened.extend(factor[1])
        else:
            flattened.append(factor)
    flattened.sort(key=_factor_sort_key)
    unique = list(dict.fromkeys(flattened))
    if len(unique) == 1:
        return unique[0]
    return ("and", tuple(unique))


def _make_or(terms: list[Expr]) -> Expr:
    flattened = []
    for term in terms:
        if term[0] == "or":
            flattened.extend(term[1])
        else:
            flattened.append(term)
    unique = list(dict.fromkeys(flattened))
    unique.sort(key=_expr_key)
    if len(unique) == 1:
        return unique[0]
    return ("or", tuple(unique))


def _product_factors(expression: Expr) -> list[Expr]:
    return list(expression[1]) if expression[0] == "and" else [expression]


def _factor_or(terms: list[Expr]) -> Expr:
    terms = list(dict.fromkeys(terms))
    if len(terms) <= 1:
        return _make_and(_product_factors(terms[0])) if terms else ("literal", "0")

    factored_terms = [_factor_or(list(term[1])) if term[0] == "or" else term for term in terms]
    factor_lists = [_product_factors(term) for term in factored_terms]

    # Pull a factor shared by every product out of the entire sum.
    common_factors = set(factor_lists[0])
    for factors in factor_lists[1:]:
        common_factors.intersection_update(factors)
    if common_factors:
        common = sorted(common_factors, key=_expr_key)
        remainder_terms = []
        for factors in factor_lists:
            remainder_terms.append(_make_and([factor for factor in factors if factor not in common]))
        return _make_and(common + [_factor_or(remainder_terms)])

    # Otherwise, factor the best shared literal or nested expression from a subset.
    factor_occurrences = {}
    for index, factors in enumerate(factor_lists):
        for factor in set(factors):
            factor_occurrences.setdefault(factor, []).append(index)
    possible = [
        (factor, indexes) for factor, indexes in factor_occurrences.items()
        if len(indexes) >= 2 and all(len(factor_lists[index]) > 1 for index in indexes)
    ]
    if possible:
        factor, indexes = sorted(
            possible,
            key=lambda item: (-len(item[1]), _expr_key(item[0]))
        )[0]
        index_set = set(indexes)
        grouped_remainders = [
            _make_and([item for item in factor_lists[index] if item != factor])
            for index in indexes
        ]
        grouped = _make_and([factor, _factor_or(grouped_remainders)])
        remaining = [factored_terms[index] for index in range(len(factored_terms)) if index not in index_set]
        return _factor_or([grouped] + remaining)

    return _make_or(factored_terms)


def _format_factored(expression: Expr, parent_kind: str | None = None) -> str:
    kind = expression[0]
    if kind == "literal":
        return expression[1]
    if kind == "or":
        text = " + ".join(_format_factored(item, "or") for item in expression[1])
        return f"({text})" if parent_kind == "and" else text
    return "".join(_format_factored(item, "and") for item in expression[1])


def factor_sop(sop_expression: str) -> str:
    if sop_expression in ("0", "1"):
        return sop_expression
    terms = _parse_sop(sop_expression)
    term_expressions = [
        _make_and([_literal_expression(literal) for literal in sorted(term, key=lambda item: item[0])])
        for term in sorted(terms, key=_term_sort_key)
    ]
    return _format_factored(_factor_or(term_expressions))


def _expr_vars(expr: Expr) -> set[str]:
    kind = expr[0]
    if kind == "literal":
        if expr[1] in ("0", "1"):
            return set()
        return {expr[1][0]}
    variables = set()
    for child in expr[1]:
        variables.update(_expr_vars(child))
    return variables


def _eval_expr(expr: Expr, env: Dict[str, bool]) -> bool:
    kind = expr[0]
    if kind == "literal":
        if expr[1] == "1": return True
        if expr[1] == "0": return False
        var = expr[1][0]
        polarity = not expr[1].endswith("'")
        return env.get(var, False) if polarity else not env.get(var, False)
    if kind == "and":
        return all(_eval_expr(child, env) for child in expr[1])
    if kind == "or":
        return any(_eval_expr(child, env) for child in expr[1])
    if kind == "xor":
        return _eval_expr(expr[1][0], env) != _eval_expr(expr[1][1], env)
    if kind == "xnor":
        return _eval_expr(expr[1][0], env) == _eval_expr(expr[1][1], env)
    return False


def _tt_to_expr(vars_list: list[str], minterms: list[tuple[bool, ...]]) -> Expr:
    if not minterms:
        return ("literal", "0")
    if len(minterms) == 2 ** len(vars_list):
        return ("literal", "1")
    
    terms = []
    for bits in minterms:
        term = ""
        for i, bit in enumerate(bits):
            term += vars_list[i] + ("" if bit else "'")
        terms.append(term)
    
    sop_str = simplify_sop(" + ".join(terms))
    if sop_str in ("0", "1"):
        return ("literal", sop_str)
        
    parsed_terms = _parse_sop(sop_str)
    term_expressions = [
        _make_and([_literal_expression(literal) for literal in sorted(t, key=lambda item: item[0])])
        for t in sorted(parsed_terms, key=_term_sort_key)
    ]
    return _factor_or(term_expressions)


def _try_full_decompose(expr: Expr) -> Expr | None:
    """Attempts to fully decompose a tree node into a pure XOR or XNOR."""
    vars_list = sorted(list(_expr_vars(expr)))
    n = len(vars_list)
    if n < 2 or n > 4:
        return None

    for r in range(1, n):
        for x_indices in itertools.combinations(range(1, n), r - 1):
            x_idx_set = set(x_indices) | {0}
            x_vars = [vars_list[i] for i in range(n) if i in x_idx_set]
            y_vars = [vars_list[i] for i in range(n) if i not in x_idx_set]

            is_decomposable = True
            for bits in itertools.product([False, True], repeat=n):
                env = dict(zip(vars_list, bits))
                
                env_x0 = env.copy()
                for v in y_vars: env_x0[v] = False
                
                env_0y = env.copy()
                for v in x_vars: env_0y[v] = False
                
                env_00 = {v: False for v in vars_list}

                f_xy = _eval_expr(expr, env)
                f_x0 = _eval_expr(expr, env_x0)
                f_0y = _eval_expr(expr, env_0y)
                f_00 = _eval_expr(expr, env_00)

                if (f_xy ^ f_x0 ^ f_0y ^ f_00) != False:
                    is_decomposable = False
                    break

            if is_decomposable:
                # Successfully partitioned. Rebuild g(X) and h(Y)
                g_minterms = []
                for x_bits in itertools.product([False, True], repeat=len(x_vars)):
                    env = {v: False for v in vars_list}
                    for i, v in enumerate(x_vars): env[v] = x_bits[i]
                    if _eval_expr(expr, env):
                        g_minterms.append(x_bits)
                        
                h_minterms = []
                f_00_val = _eval_expr(expr, {v: False for v in vars_list})
                for y_bits in itertools.product([False, True], repeat=len(y_vars)):
                    env = {v: False for v in vars_list}
                    for i, v in enumerate(y_vars): env[v] = y_bits[i]
                    if _eval_expr(expr, env) ^ f_00_val:
                        h_minterms.append(y_bits)

                g_expr = _tt_to_expr(x_vars, g_minterms)
                h_expr = _tt_to_expr(y_vars, h_minterms)

                # Recursively parse the decomposed subsets
                g_expr = _detect_xor_xnor(g_expr)
                h_expr = _detect_xor_xnor(h_expr)

                is_xnor = False
                # If a side is an inverted literal, absorb the negation into an XNOR
                if h_expr[0] == "literal" and len(h_expr[1]) > 1 and h_expr[1].endswith("'"):
                    h_expr = ("literal", h_expr[1][0])
                    is_xnor = True
                elif g_expr[0] == "literal" and len(g_expr[1]) > 1 and g_expr[1].endswith("'"):
                    g_expr = ("literal", g_expr[1][0])
                    is_xnor = True

                operands = [g_expr, h_expr]
                operands.sort(key=_factor_sort_key)

                return ("xnor" if is_xnor else "xor", tuple(operands))
    return None


def _detect_xor_xnor(expression: Expr) -> Expr:
    """Replace nested XOR/XNOR patterns in an Expr tree using exact truth-table decomposition."""
    kind = expression[0]
    if kind == "literal":
        return expression

    # Evaluate everything bottom-up first
    children = tuple(_detect_xor_xnor(item) for item in expression[1])
    rebuilt = (kind, children)

    if kind not in ("and", "or"):
        return rebuilt

    # 1. Try to decompose the whole branch
    full_decomp = _try_full_decompose(rebuilt)
    if full_decomp:
        return full_decomp

    # 2. Try partial decomposition (if it's an OR node containing multiple terms)
    if kind == "or":
        n_children = len(children)
        if n_children > 2:
            # Iterate from largest subset down to 2 to get maximum simplification
            for subset_size in range(n_children - 1, 1, -1):
                for subset in itertools.combinations(children, subset_size):
                    subset_expr = _make_or(list(subset))
                    partial_decomp = _try_full_decompose(subset_expr)
                    
                    if partial_decomp:
                        # Found a partial match!
                        # Replace the terms inside 'subset' with 'partial_decomp', append remainder.
                        remaining_children = [c for c in children if c not in subset]
                        new_children = remaining_children + [partial_decomp]
                        new_or = _make_or(new_children)
                        # Recurse on the new tree in case there are further partial decompositions
                        return _detect_xor_xnor(new_or)

    return rebuilt


def _format_with_xor_xnor(expression: Expr, parent_kind: str | None = None) -> str:
    """Format a factored Expr tree, including Unicode XOR/XNOR nodes."""
    kind = expression[0]
    if kind == "literal":
        return expression[1]
    if kind == "xor":
        left = _format_with_xor_xnor(expression[1][0], "xor")
        right = _format_with_xor_xnor(expression[1][1], "xor")
        text = f"{left} ⊕ {right}"
        return f"({text})" if parent_kind in ("and", "xor", "xnor") else text
    if kind == "xnor":
        left = _format_with_xor_xnor(expression[1][0], "xnor")
        right = _format_with_xor_xnor(expression[1][1], "xnor")
        text = f"{left} ⊙ {right}"
        return f"({text})" if parent_kind in ("and", "xor", "xnor") else text
    if kind == "or":
        text = " + ".join(_format_with_xor_xnor(item, "or") for item in expression[1])
        return f"({text})" if parent_kind in ("and", "xor", "xnor") else text
    return "".join(_format_with_xor_xnor(item, "and") for item in expression[1])


def detect_xor_xnor_form(sop_expression: str) -> str | None:
    """Return a display form for any XOR/XNOR pattern in the factored SOP tree."""
    if sop_expression in ("0", "1"):
        return None

    terms = _parse_sop(sop_expression)

    global_pattern = _detect_global_parity(terms)
    if global_pattern:
        kind, variables = global_pattern
        if kind == "xor":
            return " ⊕ ".join(variables)
        # XOR/XNOR chains associate left to right, so "A ⊙ B ⊙ C" is NOT the
        # complement of A ⊕ B ⊕ C (each ⊙ adds one negation: n-1 in total).
        # The complement of the parity is exactly (V1 ⊕ ... ⊕ Vn-1) ⊙ Vn for any n,
        # which is also what the parser reads back from "V1 ⊕ ... ⊕ Vn-1 ⊙ Vn".
        return " ⊕ ".join(variables[:-1]) + " ⊙ " + variables[-1]

    term_expressions = [
        _make_and([_literal_expression(literal) for literal in sorted(term, key=lambda item: item[0])])
        for term in sorted(terms, key=_term_sort_key)
    ]
    factored = _factor_or(term_expressions)
    detected = _detect_xor_xnor(factored)

    def contains_pattern(expression: Expr) -> bool:
        if expression[0] in ("xor", "xnor"):
            return True
        if expression[0] in ("and", "or"):
            return any(contains_pattern(item) for item in expression[1])
        return False

    return _format_with_xor_xnor(detected) if contains_pattern(detected) else None


@app.post("/api/simplify_expression")
def simplify_expression(request: SimplifyExpressionRequest):
    try:
        simplified_sop = simplify_sop(request.expression)
        factored = factor_sop(simplified_sop)
        xor_xnor_form = detect_xor_xnor_form(simplified_sop)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error

    return {
        "original": request.expression,
        "simplified_sop": simplified_sop,
        "factored": factored,
        "xor_xnor_form": xor_xnor_form,
    }


@app.post("/api/solve_truth_table")
def solve_truth_table(request: TruthTableRequest):
    num_vars = len(request.variables)
    expected_variables = [chr(ord("A") + index) for index in range(num_vars)]
    if num_vars not in (2, 3, 4):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Number of variables must be 2, 3, or 4")
    if request.variables != expected_variables:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Variable names must be {expected_variables} in alphabetical order"
        )

    expected_rows = 2 ** num_vars
    if len(request.outputs) != expected_rows:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Expected exactly {expected_rows} truth-table rows"
        )

    seen_bits = set()
    minterms = []
    dontcares = []
    truth_table = []
    values = {}

    for row in request.outputs:
        if len(row.bits) != num_vars or any(bit not in "01" for bit in row.bits):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Each bits value must contain exactly {num_vars} characters, using only 0 and 1"
            )
        if row.bits in seen_bits:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Duplicate truth-table row: {row.bits}")
        if row.value not in ("0", "1", "X"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Each value must be exactly "0", "1", or "X"')

        seen_bits.add(row.bits)
        minterm = int(row.bits, 2)
        values[minterm] = row.value
        numeric_inputs = {variable: int(bit) for variable, bit in zip(request.variables, row.bits)}
        output_value = row.value if row.value == "X" else int(row.value)
        truth_table.append({"inputs": numeric_inputs, "output": output_value})
        if row.value == "1":
            minterms.append(minterm)
        elif row.value == "X":
            dontcares.append(minterm)

    if len(seen_bits) != expected_rows:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Truth-table rows must contain every input combination exactly once")

    truth_table.sort(key=lambda row: tuple(row["inputs"].values()))
    minterms.sort()
    dontcares.sort()
    return {
        "variables": request.variables,
        "num_vars": num_vars,
        "minterms": minterms,
        "dontcares": dontcares,
        "truth_table": truth_table,
        "mux": _build_mux_payload(num_vars, request.variables, values),
    }


class EquationParser:
    """Small recursive-descent parser for Boolean equations."""

    def __init__(self, expression: str):
        self.expression = expression
        self.tokens = self._tokenize(expression)
        self.index = 0

    @staticmethod
    def _tokenize(expression: str):
        if not expression or not expression.strip():
            raise ValueError("Invalid expression: expression is empty")

        tokens = []
        position = 0
        while position < len(expression):
            char = expression[position]
            if char.isspace():
                position += 1
            elif "A" <= char <= "Z":
                tokens.append(("VAR", char))
                position += 1
            elif char in ("⊕", "^"):
                tokens.append(("XOR", char))
                position += 1
            elif char == "⊙":
                tokens.append(("XNOR", char))
                position += 1
            elif char in "+*()'":
                tokens.append((char, char))
                position += 1
            else:
                raise ValueError(f"Invalid expression: unsupported character '{char}'")
        tokens.append(("EOF", ""))
        return tokens

    def _peek(self):
        return self.tokens[self.index][0]

    def _consume(self, token_type=None):
        token = self.tokens[self.index]
        if token_type is not None and token[0] != token_type:
            raise ValueError(f"Invalid expression: expected '{token_type}'")
        self.index += 1
        return token

    def parse(self):
        tree = self._parse_or()
        if self._peek() != "EOF":
            if self._peek() == ")":
                raise ValueError("Invalid expression: unmatched closing parenthesis")
            raise ValueError("Invalid expression: missing operator")
        return tree

    # Precedence (loosest to tightest): OR (+) < XOR/XNOR < AND (*, juxtaposition) < NOT (')
    _NON_OPERAND = ("+", "*", ")", "XOR", "XNOR", "EOF")

    def _parse_or(self):
        terms = [self._parse_xor()]
        while self._peek() == "+":
            self._consume("+")
            if self._peek() in self._NON_OPERAND:
                raise ValueError("Invalid expression: expected operand after '+'")
            terms.append(self._parse_xor())
        return terms[0] if len(terms) == 1 else ("or", terms)

    def _parse_xor(self):
        """XOR / XNOR share one precedence level and associate left to right."""
        expression = self._parse_and()
        while self._peek() in ("XOR", "XNOR"):
            operator = self._consume()
            if self._peek() in self._NON_OPERAND:
                raise ValueError(f"Invalid expression: expected operand after '{operator[1]}'")
            right = self._parse_and()
            kind = "xor" if operator[0] == "XOR" else "xnor"
            expression = (kind, [expression, right])
        return expression

    def _parse_and(self):
        if self._peek() in self._NON_OPERAND:
            raise ValueError("Invalid expression: expected operand")

        factors = [self._parse_postfix()]
        while self._peek() in ("VAR", "(", "*"):
            if self._peek() == "*":
                self._consume("*")
                if self._peek() not in ("VAR", "("):
                    raise ValueError("Invalid expression: expected operand after '*'")
            factors.append(self._parse_postfix())
        return factors[0] if len(factors) == 1 else ("and", factors)

    def _parse_postfix(self):
        expression = self._parse_atom()
        while self._peek() == "'":
            self._consume("'")
            expression = ("not", expression)
        return expression

    def _parse_atom(self):
        if self._peek() == "VAR":
            return ("var", self._consume("VAR")[1])
        if self._peek() == "(":
            self._consume("(")
            if self._peek() == ")":
                raise ValueError("Invalid expression: empty parentheses")
            expression = self._parse_or()
            if self._peek() != ")":
                raise ValueError("Invalid expression: unmatched parenthesis")
            self._consume(")")
            return expression
        raise ValueError("Invalid expression: expected operand")


def _evaluate_equation(tree, assignment):
    kind = tree[0]
    if kind == "var":
        return bool(assignment[tree[1]])
    if kind == "not":
        return not _evaluate_equation(tree[1], assignment)
    if kind == "and":
        return all(_evaluate_equation(child, assignment) for child in tree[1])
    if kind == "or":
        return any(_evaluate_equation(child, assignment) for child in tree[1])
    if kind in ("xor", "xnor"):
        # XOR is true when an odd number of operands are true; XNOR negates it.
        odd = sum(_evaluate_equation(child, assignment) for child in tree[1]) % 2 == 1
        return odd if kind == "xor" else not odd
    raise ValueError("Invalid expression: unsupported operation")


def _equation_variables(tree):
    if tree[0] == "var":
        return {tree[1]}
    if tree[0] == "not":
        return _equation_variables(tree[1])
    variables = set()
    for child in tree[1]:
        variables.update(_equation_variables(child))
    return variables


def _equation_truth_table(variables, tree):
    minterms = []
    truth_table = []
    for minterm in range(2 ** len(variables)):
        bits = format(minterm, f"0{len(variables)}b")
        inputs = {variable: int(bit) for variable, bit in zip(variables, bits)}
        output = int(_evaluate_equation(tree, inputs))
        truth_table.append({"inputs": inputs, "output": output})
        if output == 1:
            minterms.append(minterm)
    return minterms, truth_table


@app.post("/api/solve_equation")
def solve_equation(request: EquationRequest):
    try:
        tree = EquationParser(request.expression).parse()
        variables = sorted(_equation_variables(tree))
        if len(variables) not in (2, 3, 4):
            raise ValueError("Invalid expression: use exactly 2, 3, or 4 distinct variables")
        minterms, truth_table = _equation_truth_table(variables, tree)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error

    values = {
        minterm: str(row["output"])
        for minterm, row in enumerate(truth_table)
    }
    return {
        "variables": variables,
        "num_vars": len(variables),
        "minterms": minterms,
        "dontcares": [],
        "truth_table": truth_table,
        "mux": _build_mux_payload(len(variables), variables, values),
    }


def _solve_unfolded_mux(num_vars: int, variables: list[str], connections: list[str]) -> dict:
    """Solve an unfolded 2^n:1 MUX input: I_k maps directly to minterm k."""
    expected_count = 2 ** num_vars
    if len(connections) != expected_count:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Expected exactly {expected_count} MUX connections for a {expected_count}:1 MUX"
        )

    for index, connection in enumerate(connections):
        if connection not in ("0", "1", "X"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Connection I{index} must be one of: 0, 1, X"
            )

    values = {minterm: connection for minterm, connection in enumerate(connections)}
    minterms = [minterm for minterm, value in values.items() if value == "1"]
    dontcares = [minterm for minterm, value in values.items() if value == "X"]
    truth_table = []
    for minterm in range(expected_count):
        bits = format(minterm, f"0{num_vars}b")
        value = values[minterm]
        truth_table.append({
            "inputs": {variable: int(bit) for variable, bit in zip(variables, bits)},
            "output": value if value == "X" else int(value),
        })

    return {
        "variables": variables,
        "num_vars": num_vars,
        "minterms": minterms,
        "dontcares": dontcares,
        "truth_table": truth_table,
        "mux": _build_mux_payload(num_vars, variables, values),
    }


@app.post("/api/solve_mux")
def solve_mux(request: MuxRequest):
    num_vars = request.num_vars
    if num_vars not in (2, 3, 4):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Number of variables must be 2, 3, or 4")

    if request.mode not in ("folded", "unfolded"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Mode must be "folded" or "unfolded"')

    variables = [chr(ord("A") + index) for index in range(num_vars)]
    if request.mode == "unfolded":
        return _solve_unfolded_mux(num_vars, variables, request.connections)

    folded_var = variables[-1]
    expected_count = 2 ** (num_vars - 1)
    if len(request.connections) != expected_count:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Expected exactly {expected_count} MUX connections for a {2 ** (num_vars - 1)}:1 MUX"
        )

    valid_connections = {"0", "1", folded_var, folded_var + "'"}
    for index, connection in enumerate(request.connections):
        if connection not in valid_connections:
            allowed = ", ".join(("0", "1", folded_var, folded_var + "'"))
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Connection I{index} must be one of: {allowed}"
            )

    values = {}
    for index, connection in enumerate(request.connections):
        values[2 * index] = str(_evaluate_mux_connection(connection, 0, folded_var))
        values[2 * index + 1] = str(_evaluate_mux_connection(connection, 1, folded_var))

    minterms = [minterm for minterm, value in values.items() if value == "1"]
    truth_table = []
    for minterm in range(2 ** num_vars):
        bits = format(minterm, f"0{num_vars}b")
        truth_table.append({
            "inputs": {variable: int(bit) for variable, bit in zip(variables, bits)},
            "output": int(values[minterm]),
        })

    return {
        "variables": variables,
        "num_vars": num_vars,
        "minterms": minterms,
        "dontcares": [],
        "truth_table": truth_table,
        "mux": _build_mux_payload(num_vars, variables, values),
    }


# Serve the frontend (index.html, style.css, script.js) from the same origin as the API.
# This mount must stay below every @app.get/@app.post route, because "/" matches everything.
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
