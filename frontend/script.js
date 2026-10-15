        let activeAnimationTimeouts = [];
        let currentNumVars = null;
        let currentMintermValues = {};
        let activeMapGeneration = 0;
        let currentInputMode = "truth";
        let currentLogicData = null;
        let truthTableNumVars = 2;
        let kmapInputNumVars = 2;
        let kmapInputValues = {};
        let muxInputNumVars = 2;
        let muxInputMode = "folded";   // input format: "folded" | "unfolded"
        let muxOutputView = "folded";  // output view: "folded" | "unfolded"
        let isKMapGeneratedSolution = false;

        function cancelCurrentAnimation() {
            activeAnimationTimeouts.forEach(t => clearTimeout(t));
            activeAnimationTimeouts = [];
        }

        function clearSolutionState(hideKMap = false) {
            cancelCurrentAnimation();
            activeMapGeneration++;
            currentMintermValues = {};
            currentLogicData = null;
            const svg = document.getElementById("kmap-svg");
            if (svg) svg.innerHTML = "";
            const explanation = document.getElementById("group-explanation");
            if (explanation) {
                explanation.innerHTML = "";
                explanation.hidden = true;
            }
            const kmapContainer = document.getElementById("kmap-container");
            if (kmapContainer && hideKMap) kmapContainer.hidden = true;
            const posKmapContainer = document.getElementById("pos-kmap-container");
            if (posKmapContainer) {
                const posSvg = document.getElementById("pos-kmap-svg");
                const posExplanation = document.getElementById("pos-explanation");
                if (posSvg) posSvg.innerHTML = "";
                if (posExplanation) posExplanation.innerHTML = "";
                posKmapContainer.hidden = true;
            }
            const muxContainer = document.getElementById("mux-container");
            if (muxContainer) {
                muxContainer.innerHTML = "";
                muxContainer.hidden = true;
            }
            const circuitContainer = document.getElementById("circuit-container");
            if (circuitContainer) circuitContainer.hidden = true;
            circuitForms = null;
            setExportToolbarVisible(false);
        }

        function getKMapConfig(numVars) {
            const configs = {
                2: {
                    variables: ["A", "B"], rowVars: "A", colVars: "B",
                    rowLabels: ["0", "1"], colLabels: ["0", "1"]
                },
                3: {
                    variables: ["A", "B", "C"], rowVars: "A", colVars: "BC",
                    rowLabels: ["0", "1"], colLabels: ["00", "01", "11", "10"]
                },
                4: {
                    variables: ["A", "B", "C", "D"], rowVars: "AB", colVars: "CD",
                    rowLabels: ["00", "01", "11", "10"], colLabels: ["00", "01", "11", "10"]
                }
            };
            const config = configs[numVars];
            if (!config) return null;
            return {
                ...config,
                numRows: config.rowLabels.length,
                numCols: config.colLabels.length
            };
        }

        function setInputMode(mode) {
            if (!["truth", "equation", "kmap", "mux"].includes(mode)) return;
            currentInputMode = mode;
            clearSolutionState(true);

            document.getElementById("mode-truth").classList.toggle("active", mode === "truth");
            document.getElementById("mode-equation").classList.toggle("active", mode === "equation");
            document.getElementById("mode-kmap").classList.toggle("active", mode === "kmap");
            document.getElementById("mode-mux").classList.toggle("active", mode === "mux");
            document.getElementById("truth-controls").hidden = mode !== "truth";
            document.getElementById("equation-controls").hidden = mode !== "equation";
            document.getElementById("kmap-input-controls").hidden = mode !== "kmap";
            document.getElementById("mux-input-controls").hidden = mode !== "mux";
            document.getElementById("truth-error").textContent = "";
            document.getElementById("equation-error").textContent = "";
            document.getElementById("kmap-input-error").textContent = "";
            document.getElementById("mux-error").textContent = "";

            if (mode === "truth") {
                selectTruthVariables(truthTableNumVars);
            } else if (mode === "kmap") {
                selectKMapInputVariables(kmapInputNumVars);
            } else if (mode === "mux") {
                selectMuxVariables(muxInputNumVars);
            }
        }

        function drawKMap(numVars, logicData = null, targetSvg = null, valuesOverride = null, renderOptions = {}) {
            const isPrimaryMap = !targetSvg;
            let mapGeneration = activeMapGeneration;
            if (isPrimaryMap) {
                cancelCurrentAnimation();
                mapGeneration = ++activeMapGeneration;
                currentNumVars = numVars;
                currentMintermValues = {};
                currentLogicData = logicData;

                const kmapContainer = document.getElementById("kmap-container");
                if (kmapContainer) kmapContainer.hidden = false;

                const explanation = document.getElementById("group-explanation");
                if (explanation) {
                    explanation.innerHTML = "";
                    explanation.hidden = true;
                }
            }

            if (![2, 3, 4].includes(numVars)) {
                console.error("Supported numVars are 2, 3, or 4");
                return;
            }

            const svg = targetSvg || document.getElementById("kmap-svg");
            if (!svg) return;
            svg.innerHTML = "";

            const config = getKMapConfig(numVars);
            const { rowVars, colVars, rowLabels, colLabels } = config;
            let cellValues;
            const hasLogicData = logicData && logicData.num_vars === numVars;
            const isKMapMode = isPrimaryMap && currentInputMode === "kmap";
            const isKMapInput = isKMapMode && !isKMapGeneratedSolution;
            const valuesAreByMinterm = valuesOverride !== null || !!logicData;
            if (valuesOverride !== null) {
                cellValues = valuesOverride;
            } else if (isKMapInput) {
                if (Object.keys(kmapInputValues).length !== 2 ** numVars) {
                    kmapInputValues = Object.fromEntries(
                        Array.from({ length: 2 ** numVars }, (_, minterm) => [minterm, "0"])
                    );
                }
                cellValues = Array.from({ length: 2 ** numVars }, (_, minterm) => kmapInputValues[minterm] || "0");
            } else if (hasLogicData) {
                const minterms = new Set(logicData.minterms || []);
                const dontcares = new Set(logicData.dontcares || []);
                cellValues = Array.from({ length: 2 ** numVars }, (_, minterm) =>
                    minterms.has(minterm) ? "1" : (dontcares.has(minterm) ? "X" : "0")
                );
            } else {
                cellValues = Array.from({ length: 2 ** numVars }, () => "0");
            }

            const numRows = rowLabels.length;
            const numCols = colLabels.length;

            const cellSize = 80;
            const headerWidth = 80;
            const headerHeight = 50;
            const startX = 25;
            const startY = 25;

            const gridX = startX + headerWidth;
            const gridY = startY + headerHeight;

            const totalWidth = gridX + numCols * cellSize + startX;
            const totalHeight = gridY + numRows * cellSize + startY;

            svg.setAttribute("width", totalWidth);
            svg.setAttribute("height", totalHeight);
            svg.setAttribute("viewBox", `0 0 ${totalWidth} ${totalHeight}`);

            const svgNS = "http://www.w3.org/2000/svg";

            // Diagonal header divider line
            const cornerLine = document.createElementNS(svgNS, "line");
            cornerLine.setAttribute("x1", startX);
            cornerLine.setAttribute("y1", startY);
            cornerLine.setAttribute("x2", gridX);
            cornerLine.setAttribute("y2", gridY);
            cornerLine.setAttribute("stroke", "#000000");
            cornerLine.setAttribute("stroke-width", "1.5");
            svg.appendChild(cornerLine);

            // Column variable name label (top-right of corner cell)
            const colVarText = document.createElementNS(svgNS, "text");
            colVarText.setAttribute("x", gridX - 8);
            colVarText.setAttribute("y", startY + 22);
            colVarText.setAttribute("text-anchor", "end");
            colVarText.setAttribute("font-family", "sans-serif");
            colVarText.setAttribute("font-size", "15");
            colVarText.setAttribute("font-weight", "bold");
            colVarText.setAttribute("fill", "#000000");
            colVarText.textContent = colVars;
            svg.appendChild(colVarText);

            // Row variable name label (bottom-left of corner cell)
            const rowVarText = document.createElementNS(svgNS, "text");
            rowVarText.setAttribute("x", startX + 8);
            rowVarText.setAttribute("y", gridY - 12);
            rowVarText.setAttribute("text-anchor", "start");
            rowVarText.setAttribute("font-family", "sans-serif");
            rowVarText.setAttribute("font-size", "15");
            rowVarText.setAttribute("font-weight", "bold");
            rowVarText.setAttribute("fill", "#000000");
            rowVarText.textContent = rowVars;
            svg.appendChild(rowVarText);

            // Column value labels
            for (let c = 0; c < numCols; c++) {
                const colX = gridX + c * cellSize;
                const colLabelText = document.createElementNS(svgNS, "text");
                colLabelText.setAttribute("x", colX + cellSize / 2);
                colLabelText.setAttribute("y", gridY - 14);
                colLabelText.setAttribute("text-anchor", "middle");
                colLabelText.setAttribute("font-family", "sans-serif");
                colLabelText.setAttribute("font-size", "15");
                colLabelText.setAttribute("font-weight", "bold");
                colLabelText.setAttribute("fill", "#000000");
                colLabelText.setAttribute("class", "col-label");
                colLabelText.textContent = colLabels[c];
                svg.appendChild(colLabelText);
            }

            // Row value labels
            for (let r = 0; r < numRows; r++) {
                const rowY = gridY + r * cellSize;
                const rowLabelText = document.createElementNS(svgNS, "text");
                rowLabelText.setAttribute("x", gridX - 16);
                rowLabelText.setAttribute("y", rowY + cellSize / 2 + 5);
                rowLabelText.setAttribute("text-anchor", "end");
                rowLabelText.setAttribute("font-family", "sans-serif");
                rowLabelText.setAttribute("font-size", "15");
                rowLabelText.setAttribute("font-weight", "bold");
                rowLabelText.setAttribute("fill", "#000000");
                rowLabelText.setAttribute("class", "row-label");
                rowLabelText.textContent = rowLabels[r];
                svg.appendChild(rowLabelText);
            }

            // Draw cells and minterm numbers
            let maxCellDelay = 0;
            for (let r = 0; r < numRows; r++) {
                for (let c = 0; c < numCols; c++) {
                    const cellX = gridX + c * cellSize;
                    const cellY = gridY + r * cellSize;

                    // Calculate minterm from row and column bits
                    const binStr = rowLabels[r] + colLabels[c];
                    const minterm = parseInt(binStr, 2);
                    const val = valuesAreByMinterm ? cellValues[minterm] : cellValues[r * numCols + c];
                    if (isPrimaryMap) currentMintermValues[minterm] = val;

                    // Cell rectangle with clear black borders
                    const cellRect = document.createElementNS(svgNS, "rect");
                    cellRect.setAttribute("x", cellX);
                    cellRect.setAttribute("y", cellY);
                    cellRect.setAttribute("width", cellSize);
                    cellRect.setAttribute("height", cellSize);
                    cellRect.setAttribute("fill", "#ffffff");
                    cellRect.setAttribute("stroke", "#000000");
                    cellRect.setAttribute("stroke-width", "1.5");
                    cellRect.setAttribute("class", "kmap-cell");
                    cellRect.setAttribute("data-minterm", minterm);
                    cellRect.setAttribute("data-value", val);
                    cellRect.setAttribute("data-row", r);
                    cellRect.setAttribute("data-col", c);
                    if (isKMapMode) {
                        cellRect.style.cursor = "pointer";
                    }
                    svg.appendChild(cellRect);

                    // Minterm number in top-left corner
                    const mintermText = document.createElementNS(svgNS, "text");
                    mintermText.setAttribute("x", cellX + 7);
                    mintermText.setAttribute("y", cellY + 16);
                    mintermText.setAttribute("fill", "#666666");
                    mintermText.setAttribute("font-family", "sans-serif");
                    mintermText.setAttribute("font-size", "12");
                    mintermText.setAttribute("class", "minterm-label");
                    mintermText.setAttribute("pointer-events", "none");
                    mintermText.textContent = minterm;
                    svg.appendChild(mintermText);

                    // Cell value centered (bold black text, or orange for X)
                    const isDontCare = String(val).toUpperCase() === "X";
                    const valText = document.createElementNS(svgNS, "text");
                    valText.setAttribute("x", cellX + cellSize / 2);
                    valText.setAttribute("y", cellY + cellSize / 2);
                    valText.setAttribute("text-anchor", "middle");
                    valText.setAttribute("dominant-baseline", "central");
                    valText.setAttribute("font-family", "sans-serif");
                    valText.setAttribute("font-size", "26");
                    valText.setAttribute("font-weight", "bold");
                    valText.setAttribute("fill", isDontCare ? "#ea580c" : "#000000");
                    valText.setAttribute("class", "cell-value" + (isDontCare ? " dont-care" : ""));
                    valText.setAttribute("pointer-events", "none");
                    valText.textContent = val;
                    svg.appendChild(valText);

                    if (isKMapInput) {
                        valText.classList.add("visible");
                        cellRect.addEventListener("click", () => {
                            const cycle = { "0": "1", "1": "X", "X": "0" };
                            const nextValue = cycle[kmapInputValues[minterm] || "0"];
                            kmapInputValues[minterm] = nextValue;
                            cellRect.setAttribute("data-value", nextValue);
                            valText.textContent = nextValue;
                            valText.setAttribute("fill", nextValue === "X" ? "#ea580c" : "#000000");
                            valText.setAttribute("class", "cell-value visible" + (nextValue === "X" ? " dont-care" : ""));
                        });
                    } else {
                        if (isKMapMode) {
                            cellRect.addEventListener("click", () => {
                                const cycle = { "0": "1", "1": "X", "X": "0" };
                                const nextValue = cycle[kmapInputValues[minterm] || String(val)];
                                kmapInputValues[minterm] = nextValue;
                                isKMapGeneratedSolution = false;
                                clearSolutionState(true);
                                drawKMap(numVars);
                            });
                        }
                        if (renderOptions.immediateValues) {
                            valText.classList.add("visible");
                            continue;
                        }
                        // Fade in cell values in sequence (row by row, left to right) with ~180ms delay
                        const cellIndex = r * numCols + c;
                        const delay = 150 + cellIndex * 500;
                        if (delay > maxCellDelay) {
                            maxCellDelay = delay;
                        }
                        const timerId = setTimeout(() => {
                            if (
                                mapGeneration !== activeMapGeneration ||
                                currentNumVars !== numVars ||
                                !svg.isConnected
                            ) return;
                            valText.classList.add("visible");
                        }, delay);
                        activeAnimationTimeouts.push(timerId);
                    }
                }
            }

            // Outer border around the entire cell grid
            const outerBorder = document.createElementNS(svgNS, "rect");
            outerBorder.setAttribute("x", gridX);
            outerBorder.setAttribute("y", gridY);
            outerBorder.setAttribute("width", numCols * cellSize);
            outerBorder.setAttribute("height", numRows * cellSize);
            outerBorder.setAttribute("fill", "none");
            outerBorder.setAttribute("stroke", "#000000");
            outerBorder.setAttribute("stroke-width", "2.5");
            outerBorder.setAttribute("class", "grid-outer-border");
            svg.appendChild(outerBorder);

            if (isPrimaryMap && !isKMapInput) {
                const originalValues = Object.fromEntries(
                    Array.from({ length: 2 ** numVars }, (_, minterm) => [minterm, currentMintermValues[minterm] || "0"])
                );
                startSynchronizedPOSMap(numVars, mapGeneration, originalValues, {
                    immediateValues: false,
                    groupStartDelay: maxCellDelay + 250
                });
            }

            // Schedule group overlays from the same solution timeline as the POS map.
            if (!isPrimaryMap) return;
            const groupStartDelay = isKMapInput ? 250 : maxCellDelay + 250;
            if (!cellValues.some(value => value === "1" || value === "X")) {
                const posTextTimerId = setTimeout(() => {
                    const posContainer = document.getElementById("pos-kmap-container");
                    if (
                        mapGeneration !== activeMapGeneration ||
                        currentNumVars !== numVars ||
                        !posContainer ||
                        !posContainer.isConnected ||
                        posContainer.hidden
                    ) return;
                    appendPOSSection(null, numVars, mapGeneration);
                }, groupStartDelay);
                activeAnimationTimeouts.push(posTextTimerId);
                return;
            }
            const groupsToDraw = minimizeKMap(numVars);
            drawGroups(numVars, groupsToDraw, null, null, { startDelay: groupStartDelay });
        }

        function truthVariables(numVars) {
            return Array.from({ length: numVars }, (_, index) => String.fromCharCode(65 + index));
        }

        function renderTruthTable(rows = null) {
            const numVars = truthTableNumVars;
            const variables = truthVariables(numVars);
            const container = document.getElementById("truth-table-container");
            if (!container) return;

            const table = document.createElement("table");
            table.className = "truth-table";
            const header = document.createElement("thead");
            const headerRow = document.createElement("tr");
            ["Minterm"].concat(variables, ["F"]).forEach(label => {
                const cell = document.createElement("th");
                cell.textContent = label;
                headerRow.appendChild(cell);
            });
            header.appendChild(headerRow);
            table.appendChild(header);

            const body = document.createElement("tbody");
            for (let rowIndex = 0; rowIndex < 2 ** numVars; rowIndex++) {
                const bits = rowIndex.toString(2).padStart(numVars, "0");
                const mintermNumber = parseInt(bits, 2);
                const row = document.createElement("tr");
                const mintermCell = document.createElement("td");
                mintermCell.textContent = `m${mintermNumber}`;
                row.appendChild(mintermCell);
                bits.split("").forEach(bit => {
                    const cell = document.createElement("td");
                    cell.textContent = bit;
                    row.appendChild(cell);
                });

                const outputCell = document.createElement("td");
                const output = document.createElement("select");
                output.setAttribute("data-bits", bits);
                ["0", "1", "X"].forEach(value => {
                    const option = document.createElement("option");
                    option.value = value;
                    option.textContent = value;
                    output.appendChild(option);
                });
                const returnedRow = rows && rows[mintermNumber];
                output.value = returnedRow ? String(returnedRow.output) : "0";
                const updateOutputStyle = () => {
                    output.classList.toggle("output-one", output.value === "1");
                    output.classList.toggle("output-dont-care", output.value === "X");
                };
                output.addEventListener("change", () => {
                    clearSolutionState(true);
                    document.getElementById("truth-error").textContent = "";
                    updateOutputStyle();
                });
                updateOutputStyle();
                outputCell.appendChild(output);
                row.appendChild(outputCell);
                body.appendChild(row);
            }
            table.appendChild(body);
            container.innerHTML = "";
            container.appendChild(table);
        }

        function selectTruthVariables(numVars) {
            if (![2, 3, 4].includes(numVars)) return;
            truthTableNumVars = numVars;
            clearSolutionState(true);
            [2, 3, 4].forEach(value => {
                document.getElementById(`truth-btn-${value}`).classList.toggle("active", value === numVars);
            });
            renderTruthTable();
        }

        function renderUnfoldedMuxInputTable() {
            const numVars = muxInputNumVars;
            const variables = truthVariables(numVars);
            const container = document.getElementById("mux-mapping-container");
            if (!container) return;

            const table = document.createElement("table");
            table.className = "truth-table";
            const header = document.createElement("thead");
            const headerRow = document.createElement("tr");
            ["Data input", "Select bits", "Connect to"].forEach(label => {
                const cell = document.createElement("th");
                cell.textContent = label;
                headerRow.appendChild(cell);
            });
            header.appendChild(headerRow);
            table.appendChild(header);

            const body = document.createElement("tbody");
            for (let index = 0; index < 2 ** numVars; index++) {
                const row = document.createElement("tr");
                const inputCell = document.createElement("td");
                inputCell.textContent = `I${index}`;
                row.appendChild(inputCell);
                const bitsCell = document.createElement("td");
                bitsCell.textContent = `${variables.join("")} = ${index.toString(2).padStart(numVars, "0")}`;
                row.appendChild(bitsCell);
                const connectionCell = document.createElement("td");
                const connection = document.createElement("select");
                connection.setAttribute("data-mux-index", index);
                ["0", "1", "X"].forEach(value => {
                    const option = document.createElement("option");
                    option.value = value;
                    option.textContent = value;
                    connection.appendChild(option);
                });
                const updateConnectionStyle = () => {
                    connection.classList.toggle("output-one", connection.value === "1");
                    connection.classList.toggle("output-dont-care", connection.value === "X");
                };
                connection.addEventListener("change", () => {
                    clearSolutionState(true);
                    document.getElementById("mux-error").textContent = "";
                    updateConnectionStyle();
                });
                updateConnectionStyle();
                connectionCell.appendChild(connection);
                row.appendChild(connectionCell);
                body.appendChild(row);
            }
            table.appendChild(body);
            container.innerHTML = "";
            container.appendChild(table);
        }

        function syncMuxFormatButtons() {
            ["folded", "unfolded"].forEach(mode => {
                const button = document.getElementById(`mux-format-${mode}`);
                if (button) button.classList.toggle("active", mode === muxInputMode);
            });
        }

        function selectMuxInputFormat(mode) {
            if (!["folded", "unfolded"].includes(mode)) return;
            muxInputMode = mode;
            clearSolutionState(true);
            syncMuxFormatButtons();
            document.getElementById("mux-error").textContent = "";
            renderMuxInputTable();
        }

        function renderMuxInputTable() {
            if (muxInputMode === "unfolded") {
                renderUnfoldedMuxInputTable();
                return;
            }
            const numVars = muxInputNumVars;
            const selectVars = truthVariables(numVars).slice(0, -1);
            const foldedVar = truthVariables(numVars)[numVars - 1];
            const container = document.getElementById("mux-mapping-container");
            if (!container) return;

            const table = document.createElement("table");
            table.className = "truth-table";
            const header = document.createElement("thead");
            const headerRow = document.createElement("tr");
            ["Data input", "Select bits", "Connect to"].forEach(label => {
                const cell = document.createElement("th");
                cell.textContent = label;
                headerRow.appendChild(cell);
            });
            header.appendChild(headerRow);
            table.appendChild(header);

            const body = document.createElement("tbody");
            for (let index = 0; index < 2 ** (numVars - 1); index++) {
                const row = document.createElement("tr");
                const inputCell = document.createElement("td");
                inputCell.textContent = `I${index}`;
                row.appendChild(inputCell);
                const bitsCell = document.createElement("td");
                bitsCell.textContent = `${selectVars.join("")} = ${index.toString(2).padStart(numVars - 1, "0")}`;
                row.appendChild(bitsCell);
                const connectionCell = document.createElement("td");
                const connection = document.createElement("select");
                connection.setAttribute("data-mux-index", index);
                ["0", "1", foldedVar, foldedVar + "'"].forEach(value => {
                    const option = document.createElement("option");
                    option.value = value;
                    option.textContent = value;
                    connection.appendChild(option);
                });
                const updateConnectionStyle = () => {
                    connection.classList.toggle("output-one", connection.value === "1");
                    connection.classList.toggle("mux-variable-connection", connection.value === foldedVar || connection.value === foldedVar + "'");
                };
                connection.addEventListener("change", () => {
                    clearSolutionState(true);
                    document.getElementById("mux-error").textContent = "";
                    updateConnectionStyle();
                });
                updateConnectionStyle();
                connectionCell.appendChild(connection);
                row.appendChild(connectionCell);
                body.appendChild(row);
            }
            table.appendChild(body);
            container.innerHTML = "";
            container.appendChild(table);
        }

        function selectMuxVariables(numVars) {
            if (![2, 3, 4].includes(numVars)) return;
            muxInputNumVars = numVars;
            clearSolutionState(true);
            [2, 3, 4].forEach(value => {
                document.getElementById(`mux-btn-${value}`).classList.toggle("active", value === numVars);
            });
            syncMuxFormatButtons();
            document.getElementById("mux-error").textContent = "";
            renderMuxInputTable();
        }

        function selectKMapInputVariables(numVars) {
            if (![2, 3, 4].includes(numVars)) return;
            kmapInputNumVars = numVars;
            isKMapGeneratedSolution = false;
            truthTableNumVars = numVars;
            clearSolutionState(true);
            kmapInputValues = Object.fromEntries(
                Array.from({ length: 2 ** numVars }, (_, minterm) => [minterm, "0"])
            );
            [2, 3, 4].forEach(value => {
                document.getElementById(`kmap-btn-${value}`).classList.toggle("active", value === numVars);
            });
            document.getElementById("kmap-input-error").textContent = "";
            drawKMap(numVars);
        }

        function generateKMapInputSolution() {
            const numVars = kmapInputNumVars;
            const variables = truthVariables(numVars);
            const outputs = [];
            let hasOneOrDontCare = false;

            for (let minterm = 0; minterm < 2 ** numVars; minterm++) {
                const value = kmapInputValues[minterm] || "0";
                const bits = minterm.toString(2).padStart(numVars, "0");
                outputs.push({ bits, value });
                if (value === "1" || value === "X") hasOneOrDontCare = true;
            }

            clearSolutionState(true);
            const requestGeneration = activeMapGeneration;
            const error = document.getElementById("kmap-input-error");
            error.textContent = "";
            if (!hasOneOrDontCare) {
                error.textContent = "Function is always 0 (F = 0). No groups to display.";
            }

            fetch("/api/solve_truth_table", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ variables, outputs })
            })
                .then(async response => {
                    if (!response.ok) {
                        const body = await response.json().catch(() => ({}));
                        throw new Error(body.detail || "Unable to solve K-map input");
                    }
                    return response.json();
                })
                .then(data => applyNormalizedLogicData(data, "kmap", requestGeneration))
                .catch(reason => {
                    if (activeMapGeneration === requestGeneration && currentInputMode === "kmap") {
                        error.textContent = reason.message || "Unable to solve K-map input.";
                    }
                });
        }

        function generateMuxSolution() {
            const mapping = document.getElementById("mux-mapping-container");
            const error = document.getElementById("mux-error");
            if (!mapping || !error) return;

            const connections = Array.from(mapping.querySelectorAll("select[data-mux-index]"))
                .map(select => select.value);
            clearSolutionState(true);
            const requestGeneration = activeMapGeneration;
            error.textContent = "";

            fetch("/api/solve_mux", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ num_vars: muxInputNumVars, connections, mode: muxInputMode })
            })
                .then(async response => {
                    if (!response.ok) {
                        const body = await response.json().catch(() => ({}));
                        throw new Error(body.detail || "Unable to solve MUX input");
                    }
                    return response.json();
                })
                .then(data => applyNormalizedLogicData(data, "mux", requestGeneration))
                .catch(reason => {
                    if (activeMapGeneration === requestGeneration && currentInputMode === "mux") {
                        error.textContent = reason.message || "Unable to solve MUX input.";
                    }
                });
        }

        function setMuxOutputView(view) {
            if (!["folded", "unfolded"].includes(view)) return;
            muxOutputView = view;
            if (currentLogicData && currentLogicData.mux) {
                renderMuxImplementation(currentLogicData.mux, activeMapGeneration);
            }
        }

        function renderMuxImplementation(muxPayload, generation, exportOptions = null) {
            // exportOptions ({ view, container, title }) renders one static view into a detached container for the PDF export.
            if (activeMapGeneration !== generation || !muxPayload) return;
            // The backend returns { folded, unfolded }; a bare folded object is still tolerated.
            const payload = (muxPayload.folded || muxPayload.unfolded) ? muxPayload : { folded: muxPayload };
            const isUnfolded = (exportOptions ? exportOptions.view : muxOutputView) === "unfolded" && !!payload.unfolded;
            const mux = isUnfolded ? payload.unfolded : payload.folded;
            if (!mux || !Array.isArray(mux.inputs)) return;
            const foldedVar = mux.folded_var || null;
            const container = exportOptions ? exportOptions.container : document.getElementById("mux-container");
            if (!container) return;
            container.innerHTML = "";

            const title = document.createElement("h2");
            title.textContent = exportOptions && exportOptions.title ? exportOptions.title : "Multiplexer Implementation";
            container.appendChild(title);

            const switcher = document.createElement("div");
            switcher.className = "truth-variable-selector mux-two-way mux-view-switcher";
            switcher.setAttribute("aria-label", "MUX output view");
            [["folded", "Folded MUX (2ⁿ⁻¹:1)"], ["unfolded", "Unfolded MUX (2ⁿ:1)"]].forEach(([view, label]) => {
                const button = document.createElement("button");
                button.textContent = label;
                button.classList.toggle("active", (view === "unfolded") === isUnfolded);
                button.addEventListener("click", () => setMuxOutputView(view));
                switcher.appendChild(button);
            });
            if (!exportOptions) container.appendChild(switcher);

            const caption = document.createElement("p");
            caption.className = "mux-caption";
            const selectDescription = mux.select_vars
                .map((variable, index) => `${variable} (S${mux.select_vars.length - index - 1})`)
                .join(", ");
            caption.textContent = isUnfolded
                ? `${mux.type} MUX - selects: ${selectDescription}; every variable drives a select line, so each data input is a constant 0 or 1.`
                : `${mux.type} MUX - selects: ${selectDescription}; ${foldedVar} is folded into the data inputs.`;
            container.appendChild(caption);

            const muxLayout = document.createElement("div");
            muxLayout.className = "mux-layout";
            const muxLeft = document.createElement("div");
            muxLeft.className = "mux-left";
            const muxRight = document.createElement("div");
            muxRight.className = "mux-right";
            muxLayout.appendChild(muxLeft);
            muxLayout.appendChild(muxRight);
            container.appendChild(muxLayout);

            const tableWrapper = document.createElement("div");
            tableWrapper.className = "truth-table-wrapper";
            const table = document.createElement("table");
            table.className = "truth-table";
            const header = document.createElement("thead");
            const headerRow = document.createElement("tr");
            const headerLabels = isUnfolded
                ? ["Data input", "Select bits", "F (minterm)", "Connect to"]
                : ["Data input", "Select bits", `F when ${foldedVar}=0`, `F when ${foldedVar}=1`, "Connect to"];
            headerLabels.forEach(label => {
                const cell = document.createElement("th");
                cell.textContent = label;
                headerRow.appendChild(cell);
            });
            header.appendChild(headerRow);
            table.appendChild(header);
            const body = document.createElement("tbody");
            mux.inputs.forEach(input => {
                const row = document.createElement("tr");
                const cellValues = isUnfolded
                    ? [`I${input.index}`, input.select_bits, input.value]
                    : [`I${input.index}`, input.select_bits, input.f_when_0, input.f_when_1];
                cellValues.forEach(value => {
                    const cell = document.createElement("td");
                    cell.textContent = value;
                    row.appendChild(cell);
                });
                const connection = document.createElement("td");
                connection.className = "mux-connect-cell";
                connection.textContent = input.connection;
                row.appendChild(connection);
                body.appendChild(row);
            });
            table.appendChild(body);
            tableWrapper.appendChild(table);
            muxLeft.appendChild(tableWrapper);

            const resolvedInputs = mux.inputs.filter(input => input.used_dontcare);
            if (mux.has_dontcare_resolution && resolvedInputs.length > 0) {
                const note = document.createElement("p");
                note.className = "mux-note";
                note.textContent = `X cells were resolved to: ${resolvedInputs.map(input => `I${input.index} → ${input.connection}`).join(", ")}.`;
                muxLeft.appendChild(note);
            }

            const derivation = document.createElement("details");
            derivation.className = "group-explanation";
            if (exportOptions) derivation.setAttribute("open", "true");
            const derivationTitle = document.createElement("summary");
            derivationTitle.textContent = "Input Derivation";
            derivation.appendChild(derivationTitle);
            const derivationGrid = document.createElement("div");
            derivationGrid.className = "mux-derivation-grid";
            derivation.appendChild(derivationGrid);
            mux.inputs.forEach(input => {
                const section = document.createElement("section");
                section.className = "group-explanation-group";
                const heading = document.createElement("h3");
                heading.textContent = `I${input.index} (${input.select_bits})`;
                section.appendChild(heading);

                const line = document.createElement("p");
                if (isUnfolded) {
                    line.textContent = `F = ${input.value} at minterm ${input.index} → connect to ${input.connection}` +
                        (input.used_dontcare ? ` (the X cell was resolved to ${mux.all_dontcare ? "1, since every cell is X" : "0"})` : "");
                } else {
                    const folded = foldedVar;
                    let reason;
                    if (input.connection === "0") reason = "F is always 0";
                    else if (input.connection === "1") reason = "F is always 1";
                    else if (input.connection === folded) reason = `F follows ${folded}`;
                    else reason = `F is the opposite of ${folded}`;
                    line.textContent = `F = ${input.f_when_0} when ${folded}=0, F = ${input.f_when_1} when ${folded}=1 → ${reason} → connect to ${input.connection}` +
                        (input.used_dontcare ? " (an X cell was resolved to simplify this input)" : "");
                }
                section.appendChild(line);
                derivationGrid.appendChild(section);
            });
            container.appendChild(derivation);

            const diagramWrapper = document.createElement("div");
            diagramWrapper.className = "mux-diagram-wrapper";
            const svgNS = "http://www.w3.org/2000/svg";
            const svg = document.createElementNS(svgNS, "svg");
            svg.classList.add("mux-diagram");

            // Scale the drawing to the input count: up to 8 inputs keep the original
            // spacing; 16 inputs (4-variable unfolded) use a tighter pitch and smaller fonts.
            const inputCount = mux.inputs.length;
            const selectCount = mux.select_vars.length;
            const rowPitch = inputCount > 8 ? 28 : 34;
            const compact = rowPitch < 30;
            const idFontSize = compact ? 11 : 14;
            const connFontSize = compact ? 12 : 15;
            const labelLift = compact ? 4 : 7;
            const wideBody = selectCount > 3; // 4 select lines need a wider body to stay apart
            const selectStart = wideBody ? 270 : 285;
            const selectGap = wideBody ? 46 : 42;

            const width = 620;
            const height = Math.max(220, 90 + inputCount * rowPitch);
            const top = 30;
            const bottom = height - 58;
            const bodyLeft = 250;
            const bodyRight = wideBody ? 425 : 390;
            svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
            svg.setAttribute("width", width);
            svg.setAttribute("height", height);
            svg.setAttribute("role", "img");
            svg.setAttribute("aria-label", `${mux.type} multiplexer diagram`);

            const makeSvg = (tag, attrs = {}, text = null) => {
                const element = document.createElementNS(svgNS, tag);
                Object.entries(attrs).forEach(([name, value]) => element.setAttribute(name, value));
                if (text !== null) element.textContent = text;
                return element;
            };
            svg.appendChild(makeSvg("polygon", {
                points: `${bodyLeft},${top} ${bodyRight},${top + 18} ${bodyRight},${bottom - 18} ${bodyLeft},${bottom}`,
                fill: "#f1f5f9", stroke: "#2563eb", "stroke-width": "3", "stroke-linejoin": "round"
            }));
            svg.appendChild(makeSvg("text", {
                x: (bodyLeft + bodyRight) / 2, y: (top + bottom) / 2, "text-anchor": "middle",
                "font-family": "sans-serif", "font-size": "18", "font-weight": "700", fill: "#1e293b"
            }, `${mux.type} MUX`));

            const inputSpacing = (bottom - top - 40) / Math.max(1, inputCount - 1);
            mux.inputs.forEach((input, index) => {
                const y = top + 20 + index * inputSpacing;
                const variableWire = foldedVar !== null && (input.connection === foldedVar || input.connection === foldedVar + "'");
                const color = variableWire ? "#2563eb" : "#64748b";
                svg.appendChild(makeSvg("line", { x1: 80, y1: y, x2: bodyLeft, y2: y, stroke: color, "stroke-width": "2" }));
                svg.appendChild(makeSvg("text", {
                    x: 70, y: y + (compact ? 4 : 5), "text-anchor": "end", "font-family": "sans-serif", "font-size": idFontSize, "font-weight": "700", fill: "#334155"
                }, `I${input.index}`));
                if (input.connection.endsWith("'")) {
                    svg.appendChild(makeSvg("circle", { cx: 220, cy: y, r: 5, fill: "#ffffff", stroke: "#2563eb", "stroke-width": "2" }));
                }
                svg.appendChild(makeSvg("text", {
                    x: 155, y: y - labelLift, "text-anchor": "middle", "font-family": "sans-serif", "font-size": connFontSize, "font-weight": "700", fill: color
                }, input.connection));
            });

            const outputY = (top + bottom) / 2;
            svg.appendChild(makeSvg("line", { x1: bodyRight, y1: outputY, x2: 535, y2: outputY, stroke: "#334155", "stroke-width": "2.5" }));
            svg.appendChild(makeSvg("text", {
                x: 548, y: outputY + 5, "font-family": "sans-serif", "font-size": "16", "font-weight": "700", fill: "#1e293b"
            }, "F"));

            mux.select_vars.forEach((variable, index) => {
                const x = selectStart + index * selectGap;
                // The trapezoid's bottom edge slopes up by 18px from bodyLeft to bodyRight,
                // so each select line must end on that slanted edge.
                const edgeY = bottom - 18 * (x - bodyLeft) / (bodyRight - bodyLeft);
                svg.appendChild(makeSvg("line", { x1: x, y1: height - 14, x2: x, y2: edgeY, stroke: "#334155", "stroke-width": "2" }));
                svg.appendChild(makeSvg("text", {
                    x, y: height - 18, "text-anchor": "middle", "font-family": "sans-serif", "font-size": wideBody ? "12" : "13", "font-weight": "700", fill: "#334155"
                }, `S${mux.select_vars.length - index - 1} (${variable})`));
            });
            diagramWrapper.appendChild(svg);
            muxRight.appendChild(diagramWrapper);
            if (activeMapGeneration === generation) container.hidden = false;
        }

        // ---------- Persistent history (last 3 solutions) ----------
        const HISTORY_STORAGE_KEY = "okaymaps.solutionHistory.v1";
        const HISTORY_MAX_ITEMS = 3;
        let isRestoringHistory = false;
        let lastEquationExpression = "";

        function loadSolutionHistory() {
            try {
                const parsed = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) || "[]");
                if (!Array.isArray(parsed)) return [];
                return parsed
                    .filter(item => item && typeof item.mode === "string" && item.data && [2, 3, 4].includes(item.data.num_vars))
                    .slice(-HISTORY_MAX_ITEMS);
            } catch (_) {
                return [];
            }
        }

        function saveSolutionToHistory(mode, data) {
            try {
                const entry = { mode, data, timestamp: Date.now() };
                if (mode === "equation") entry.expression = lastEquationExpression;
                const history = loadSolutionHistory();
                history.push(entry);
                while (history.length > HISTORY_MAX_ITEMS) history.shift(); // FIFO
                localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
            } catch (error) {
                console.warn("Unable to save solution history:", error);
            }
            renderSolutionHistory();
        }

        function clearSolutionHistory() {
            try { localStorage.removeItem(HISTORY_STORAGE_KEY); } catch (_) { /* ignore */ }
            renderSolutionHistory();
        }

        function historyModeLabel(item) {
            const vars = item.data.num_vars;
            switch (item.mode) {
                case "truth": return `Truth Table (${vars} Vars)`;
                case "kmap": return `K-map (${vars} Vars)`;
                case "mux": return `MUX Solution (${vars} Vars)`;
                case "equation": return `Equation (${vars} Vars)`;
                default: return `Solution (${vars} Vars)`;
            }
        }

        function formatHistoryTime(timestamp) {
            const date = new Date(timestamp);
            if (isNaN(date.getTime())) return "";
            const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
            if (date.toDateString() === new Date().toDateString()) return `Today, ${time}`;
            return `${date.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
        }

        function renderSolutionHistory() {
            const panel = document.getElementById("history-panel");
            const list = document.getElementById("history-list");
            if (!panel || !list) return;
            const history = loadSolutionHistory();
            list.innerHTML = "";
            panel.hidden = history.length === 0;
            // Newest first in the UI; keep the storage index so restoring maps back correctly.
            for (let i = history.length - 1; i >= 0; i--) {
                const item = history[i];
                const button = document.createElement("button");
                button.type = "button";
                button.className = "history-item";
                button.title = "Restore this solution";

                const label = document.createElement("span");
                label.className = "history-label";
                label.textContent = historyModeLabel(item);
                button.appendChild(label);

                if (item.mode === "equation" && item.expression) {
                    const detail = document.createElement("span");
                    detail.className = "history-detail";
                    detail.textContent = item.expression;
                    button.appendChild(detail);
                }

                const time = document.createElement("span");
                time.className = "history-time";
                time.textContent = formatHistoryTime(item.timestamp);
                button.appendChild(time);

                button.addEventListener("click", () => restoreSolutionFromHistory(i));
                list.appendChild(button);
            }
        }

        function restoreSolutionFromHistory(index) {
            const item = loadSolutionHistory()[index];
            if (!item) return;
            const savedMode = item.mode;
            const savedData = item.data;

            isRestoringHistory = true; // don't re-record a restored solution as a new entry
            try {
                setInputMode(savedMode);
                if (savedMode === "equation") {
                    const input = document.getElementById("equation-input");
                    if (input) input.value = item.expression || "";
                }
                applyNormalizedLogicData(savedData, savedMode, activeMapGeneration);
            } finally {
                isRestoringHistory = false;
            }
        }

        function applyNormalizedLogicData(data, expectedMode, requestGeneration) {
            if (
                currentInputMode !== expectedMode ||
                activeMapGeneration !== requestGeneration ||
                !data ||
                ![2, 3, 4].includes(data.num_vars)
            ) return false;

            truthTableNumVars = data.num_vars;
            currentLogicData = data;
            muxOutputView = "folded";
            isKMapGeneratedSolution = expectedMode === "kmap";
            if (expectedMode === "equation" || expectedMode === "kmap" || expectedMode === "mux") {
                document.getElementById("truth-controls").hidden = false;
            }
            renderTruthTable(data.truth_table);
            drawKMap(data.num_vars, data);
            renderMuxImplementation(data.mux, activeMapGeneration);
            renderCircuitSection(data, activeMapGeneration);
            if (!isRestoringHistory) saveSolutionToHistory(expectedMode, data);
            setExportToolbarVisible(true);
            return true;
        }

        function generateTruthTableSolution() {
            const table = document.getElementById("truth-table-container");
            const error = document.getElementById("truth-error");
            if (!table || !error) return;

            const variables = truthVariables(truthTableNumVars);
            const outputs = Array.from(table.querySelectorAll("select[data-bits]"))
                .map(select => ({ bits: select.getAttribute("data-bits"), value: select.value }));
            clearSolutionState(true);
            const requestGeneration = activeMapGeneration;
            error.textContent = "";

            fetch("/api/solve_truth_table", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ variables, outputs })
            })
                .then(response => {
                    if (!response.ok) throw new Error("Unable to solve truth table");
                    return response.json();
                })
                .then(data => {
                    applyNormalizedLogicData(data, "truth", requestGeneration);
                })
                .catch(reason => {
                    if (activeMapGeneration === requestGeneration && currentInputMode === "truth") {
                        error.textContent = reason.message || "Unable to solve truth table.";
                    }
                });
        }

        function insertSymbolIntoEquation(symbol) {
            const input = document.getElementById("equation-input");
            if (!input) return;
            const start = input.selectionStart ?? input.value.length;
            const end = input.selectionEnd ?? input.value.length;
            input.focus();
            // Replaces the selection (or inserts at the caret) and moves the caret after the symbol.
            input.setRangeText(symbol, start, end, "end");
            input.dispatchEvent(new Event("input", { bubbles: true }));
        }

        function generateEquationSolution() {
            const input = document.getElementById("equation-input");
            const error = document.getElementById("equation-error");
            if (!input || !error) return;

            clearSolutionState(true);
            const requestGeneration = activeMapGeneration;
            const expression = input.value.trim();
            lastEquationExpression = expression;
            error.textContent = "";
            if (!expression) {
                error.textContent = "Could not parse expression: expression is empty";
                return;
            }

            fetch("/api/solve_equation", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ expression })
            })
                .then(async response => {
                    if (!response.ok) {
                        let detail = "Unable to solve equation";
                        try {
                            const body = await response.json();
                            detail = body.detail || detail;
                        } catch (_) {
                            // Keep the human-readable fallback.
                        }
                        throw new Error(detail);
                    }
                    return response.json();
                })
                .then(data => {
                    applyNormalizedLogicData(data, "equation", requestGeneration);
                })
                .catch(reason => {
                    if (activeMapGeneration === requestGeneration && currentInputMode === "equation") {
                        error.textContent = `Could not parse expression: ${reason.message}`;
                    }
                });
        }

        const GROUP_PALETTE = [
            { fill: "rgba(59, 130, 246, 0.3)", stroke: "#2563eb" }, // Blue
            { fill: "rgba(16, 185, 129, 0.3)", stroke: "#059669" }, // Green
            { fill: "rgba(245, 158, 11, 0.3)", stroke: "#d97706" }, // Orange
            { fill: "rgba(239, 68, 68, 0.3)", stroke: "#dc2626" }   // Red
        ];

        // True when every one of the 2^n K-map cells is a don't-care (X).
        function isAllDontCare(numVars, values = currentMintermValues) {
            const total = 2 ** numVars;
            for (let m = 0; m < total; m++) {
                const raw = values[m];
                if (raw === undefined || String(raw).trim().toUpperCase() !== "X") return false;
            }
            return true;
        }

        function findGroups(numVars = (currentNumVars || 4)) {
            const config = getKMapConfig(numVars);
            if (!config) return [];
            const { rowLabels, colLabels, numRows, numCols } = config;

            // Possible rectangular shapes (H x W), bounded by this grid's actual dimensions,
            // searched in descending size order so bigger groups are found first.
            const heights = Array.from({ length: numRows }, (_, index) => index + 1);
            const widths = Array.from({ length: numCols }, (_, index) => index + 1);
            const shapes = [];
            for (const H of heights) {
                for (const W of widths) {
                    const size = H * W;
                    if ((size & (size - 1)) === 0) shapes.push([H, W]);
                }
            }
            shapes.sort((a, b) => (b[0] * b[1]) - (a[0] * a[1]));

            const candidateGroups = [];
            const seenGroupKeys = new Set();

            for (const [H, W] of shapes) {
                for (let r0 = 0; r0 < numRows; r0++) {
                    for (let c0 = 0; c0 < numCols; c0++) {
                        const cells = [];
                        let hasActualOne = false;
                        let hasZero = false;
                        let hasX = false;

                        for (let i = 0; i < H; i++) {
                            const r = (r0 + i) % numRows;
                            for (let j = 0; j < W; j++) {
                                const c = (c0 + j) % numCols;
                                const binStr = rowLabels[r] + colLabels[c];
                                const m = parseInt(binStr, 2);
                                cells.push(m);

                                const rawVal = currentMintermValues[m];
                                const val = rawVal !== undefined ? String(rawVal).trim().toUpperCase() : "";
                                if (val === "1") {
                                    hasActualOne = true;
                                } else if (val === "X") {
                                    hasX = true;
                                } else {
                                    hasZero = true;
                                }
                            }
                        }

                        // Rules:
                        // 1. Must not contain any 0 cell
                        // 2. Must contain at least one actual 1 cell (no X-only groups)
                        if (!hasZero && hasActualOne) {
                            cells.sort((a, b) => a - b);
                            const key = cells.join(",");

                            if (!seenGroupKeys.has(key)) {
                                seenGroupKeys.add(key);
                                candidateGroups.push({
                                    id: candidateGroups.length + 1,
                                    cells: cells,
                                    size: cells.length,
                                    includesX: hasX
                                });
                            }
                        }
                    }
                }
            }

            candidateGroups.sort((a, b) => b.size - a.size || a.id - b.id);
            return candidateGroups;
        }

        function minimizeKMap(numVars = (currentNumVars || 4)) {
            // All cells are X: resolve them all to 1 -> one group covering the whole map (F = 1).
            if (isAllDontCare(numVars)) {
                const palette = GROUP_PALETTE[0];
                const total = 2 ** numVars;
                return [{
                    id: 1,
                    cells: Array.from({ length: total }, (_, minterm) => minterm),
                    size: total,
                    includesX: true,
                    allDontCare: true,
                    color: palette.fill,
                    borderColor: palette.stroke
                }];
            }
            const candidates = findGroups(numVars);
            const actualOnes = new Set(Object.entries(currentMintermValues)
                .filter(([, value]) => String(value).trim().toUpperCase() === "1")
                .map(([minterm]) => parseInt(minterm, 10)));
            const containsAll = (outer, inner) => inner.every(cell => outer.includes(cell));

            // A prime implicant is a valid group that is not contained in a larger valid group.
            const primeGroups = candidates.filter(group => !candidates.some(other =>
                other.size > group.size && containsAll(other.cells, group.cells)
            ));

            const finalGroups = [];
            const covered = new Set();
            const usedActualOnes = new Set();
            const groupsCoveringOne = minterm => primeGroups.filter(group => group.cells.includes(minterm));
            const canAddWithoutOverlap = group => group.cells.every(cell =>
                !actualOnes.has(cell) || !usedActualOnes.has(cell)
            );
            const addGroup = group => {
                finalGroups.push(group);
                group.cells.forEach(cell => {
                    if (actualOnes.has(cell)) {
                        covered.add(cell);
                        usedActualOnes.add(cell);
                    }
                });
            };

            // Add essential prime implicants first when they preserve clean, non-overlapping coverage.
            for (const minterm of actualOnes) {
                const coveringGroups = groupsCoveringOne(minterm);
                const essential = coveringGroups.length === 1 ? coveringGroups[0] : null;
                if (essential && !finalGroups.includes(essential) && canAddWithoutOverlap(essential)) {
                    addGroup(essential);
                }
            }

            const chooseBestGroup = allowOverlap => primeGroups
                .filter(group => !finalGroups.includes(group))
                .filter(group => allowOverlap || canAddWithoutOverlap(group))
                .map(group => ({
                    group,
                    newCoverage: group.cells.filter(cell => actualOnes.has(cell) && !covered.has(cell)).length
                }))
                .filter(entry => entry.newCoverage > 0)
                .sort((a, b) => b.group.size - a.group.size || b.newCoverage - a.newCoverage)[0];

            // Prefer the largest clean group. Only allow overlap as a last resort to cover a 1.
            while (covered.size < actualOnes.size) {
                const bestGroup = chooseBestGroup(false) || chooseBestGroup(true);
                if (!bestGroup) break;
                addGroup(bestGroup.group);
            }

            // Keep the final overlays ordered from largest to smallest for a clean render.
            finalGroups.sort((a, b) => b.size - a.size || a.id - b.id);
            finalGroups.forEach((group, index) => {
                const palette = GROUP_PALETTE[index % GROUP_PALETTE.length];
                group.id = index + 1;
                group.color = palette.fill;
                group.borderColor = palette.stroke;
            });
            return finalGroups;
        }
        
                function computePOS(numVars = (currentNumVars || 4)) {
            const total = 2 ** numVars;
            const variables = getKMapConfig(numVars).variables;
            const original = currentMintermValues;
            const inverted = {};
            const zeros = [];

            for (let m = 0; m < total; m++) {
                const v = String(original[m] ?? "0").trim().toUpperCase();
                if (v === "1") {
                    inverted[m] = "0";
                } else if (v === "X") {
                    inverted[m] = "X";
                } else {
                    inverted[m] = "1";
                    zeros.push(m);
                }
            }

            if (zeros.length === 0) return { expression: "1", zeros, groups: [] };

            let zeroGroups;
            currentMintermValues = inverted;
            try {
                zeroGroups = minimizeKMap(numVars);
            } finally {
                currentMintermValues = original;
            }

            const groups = zeroGroups.map((group, index) => {
                const minterms = group.cells.slice();
                const binaryForms = minterms.map(minterm => ({
                    minterm,
                    binary: minterm.toString(2).padStart(numVars, "0")
                }));

                const constantParts = [];
                const changingParts = [];
                const literals = [];

                variables.forEach((variable, bitIndex) => {
                    const bitValues = binaryForms.map(entry => entry.binary[bitIndex]);
                    const isConstant = bitValues.every(bit => bit === bitValues[0]);
                    if (isConstant) {
                        const val = bitValues[0];
                        if (val === "0") {
                            constantParts.push(`${variable}=0 constant → ${variable}`);
                            literals.push(variable);
                        } else {
                            constantParts.push(`${variable}=1 constant → ${variable}'`);
                            literals.push(variable + "'");
                        }
                    } else {
                        changingParts.push(`${variable} changes → eliminated`);
                    }
                });

                const explanationText = [
                    constantParts.length > 0 ? constantParts.join("; ") : "No variables remain constant",
                    ...changingParts
                ].join("; ");

                return {
                    number: index + 1,
                    cells: minterms,
                    binaryForms,
                    explanation: explanationText,
                    literals,
                    sumTerm: literals.length > 0 ? literals.join(" + ") : "0",
                    color: group.color,
                    borderColor: group.borderColor,
                };
            });

            const expression = groups.some(g => g.literals.length === 0)
                ? "0"
                : groups.map(g => g.literals.length === 1 ? g.literals[0] : `(${g.sumTerm})`).join("");

            return { expression, zeros, groups };
        }

        function startSynchronizedPOSMap(numVars, generation, originalValues, options = {}) {
            if (currentNumVars !== numVars || activeMapGeneration !== generation) return;
            const posContainer = document.getElementById("pos-kmap-container");
            const posSvg = document.getElementById("pos-kmap-svg");
            const posExplanation = document.getElementById("pos-explanation");
            if (!posContainer || !posSvg || !posExplanation) return;

            const pos = computePOS(numVars);
            posContainer.hidden = false;
            posExplanation.innerHTML = "";
            drawKMap(numVars, null, posSvg, originalValues, {
                immediateValues: options.immediateValues === true
            });

            drawGroups(numVars, pos.groups, posSvg, originalValues, {
                allowedValues: ["0", "X"],
                startDelay: options.groupStartDelay || 0
            });
        }

        function appendPOSSection(explanation, numVars, generation) {
    if (currentNumVars !== numVars || activeMapGeneration !== generation) return;
    const pos = computePOS(numVars);
    const posExplanation = document.getElementById("pos-explanation");
    if (!posExplanation || !posExplanation.isConnected) return;
    posExplanation.innerHTML = "";

    if (isAllDontCare(numVars)) {
        const allXNote = document.createElement("p");
        allXNote.appendChild(document.createTextNode("Product of Sums (POS): Resolving all don't-care cells to "));
        const one = document.createElement("code");
        one.textContent = "1";
        allXNote.appendChild(one);
        allXNote.appendChild(document.createTextNode(" leaves no "));
        const zero = document.createElement("code");
        zero.textContent = "0";
        allXNote.appendChild(zero);
        allXNote.appendChild(document.createTextNode(" cells."));
        posExplanation.appendChild(allXNote);

        const allXEquation = document.createElement("p");
        allXEquation.className = "final-equation";
        allXEquation.appendChild(document.createTextNode("Final POS Expression: F = "));
        const equationOne = document.createElement("code");
        equationOne.textContent = "1";
        allXEquation.appendChild(equationOne);
        posExplanation.appendChild(allXEquation);
        return;
    }

    if (pos.zeros.length === 0) {
        const heading = document.createElement("h3");
        heading.textContent = "Product of Sums (POS) from the 0s";
        posExplanation.appendChild(heading);

        const note = document.createElement("p");
        note.style.marginTop = "0.5rem";
        note.textContent = "No 0s present in the K-map: F = 1";
        posExplanation.appendChild(note);
        return;
    }

    const heading = document.createElement("h3");
    heading.textContent = "Product of Sums (POS) from the 0s";
    posExplanation.appendChild(heading);

    const maxterms = document.createElement("p");
    maxterms.style.marginTop = "0.35rem";
    maxterms.appendChild(document.createTextNode("Maxterm cells (0s): "));
    const maxCode = document.createElement("code");
    maxCode.textContent = pos.zeros.length > 0 ? `ΠM(${pos.zeros.join(", ")})` : "none";
    maxterms.appendChild(maxCode);
    posExplanation.appendChild(maxterms);

    // Detailed 0-group breakdown matching SOP structure
    pos.groups.forEach(group => {
        const groupSection = document.createElement("section");
        groupSection.className = "group-explanation-group";

        const gHeading = document.createElement("h3");
        gHeading.textContent = `0-Group ${group.number}: cells [${group.cells.join(", ")}] — ${({1:"Single",2:"Pair",4:"Quad",8:"Octet",16:"Hexadecet"}[group.cells.length] || group.cells.length + "-cell group")}`;
        groupSection.appendChild(gHeading);

        const binaries = document.createElement("p");
        binaries.appendChild(document.createTextNode("Binary forms: "));
        const binaryCode = document.createElement("code");
        binaryCode.textContent = group.binaryForms
            .map(entry => `m${entry.minterm} = ${entry.binary}`)
            .join(", ");
        binaries.appendChild(binaryCode);
        groupSection.appendChild(binaries);

        const constants = document.createElement("p");
        constants.textContent = group.explanation;
        groupSection.appendChild(constants);

        const term = document.createElement("p");
        term.appendChild(document.createTextNode("Sum Term = "));
        const termCode = document.createElement("code");
        termCode.textContent = group.sumTerm;
        term.appendChild(termCode);
        groupSection.appendChild(term);

        posExplanation.appendChild(groupSection);
    });

    // Final POS Equation
    const equation = document.createElement("p");
    equation.className = "final-equation";
    equation.appendChild(document.createTextNode("K-map POS: F = "));
    const equationCode = document.createElement("code");
    equationCode.textContent = pos.expression;
    equation.appendChild(equationCode);
    posExplanation.appendChild(equation);
}


        function explainGroups(groups, numVars = (currentNumVars || 4)) {
            const explanation = document.getElementById("group-explanation");
            if (!explanation || ![2, 3, 4].includes(numVars) || !Array.isArray(groups) || groups.length === 0) {
                return [];
            }
            const explanationGeneration = activeMapGeneration;

            if (groups.length === 1 && groups[0].allDontCare) {
                const totalCells = 2 ** numVars;
                explanation.innerHTML = "";
                const allXTitle = document.createElement("h2");
                allXTitle.textContent = "Final Group Explanations";
                explanation.appendChild(allXTitle);

                const allXSection = document.createElement("section");
                allXSection.className = "group-explanation-group";
                const allXHeading = document.createElement("h3");
                allXHeading.textContent = `Group 1: minterms [${groups[0].cells.join(", ")}] — ${totalCells}-cell group (entire map)`;
                allXSection.appendChild(allXHeading);

                const allXMessage = document.createElement("p");
                const addCode = (parent, text) => {
                    const code = document.createElement("code");
                    code.textContent = text;
                    parent.appendChild(code);
                };
                allXMessage.appendChild(document.createTextNode("All cells are Don't-Care ("));
                addCode(allXMessage, "X");
                allXMessage.appendChild(document.createTextNode("): Resolving all don't-care cells to "));
                addCode(allXMessage, "1");
                allXMessage.appendChild(document.createTextNode(` forms a single ${totalCells}-cell group covering the entire map.`));
                allXSection.appendChild(allXMessage);
                explanation.appendChild(allXSection);

                const allXEquation = document.createElement("p");
                allXEquation.className = "final-equation";
                allXEquation.appendChild(document.createTextNode("Final SOP Expression: F = "));
                addCode(allXEquation, "1");
                explanation.appendChild(allXEquation);
                explanation.hidden = false;

                appendPOSSection(explanation, numVars, explanationGeneration);
                return groups;
            }

            const variables = getKMapConfig(numVars).variables;
            const explainedGroups = groups.map((group, index) => {
                const minterms = group.cells.slice();
                const binaryForms = minterms.map(minterm => ({
                    minterm,
                    binary: minterm.toString(2).padStart(numVars, "0")
                }));
                const constantParts = [];
                const changingParts = [];
                const termParts = [];

                variables.forEach((variable, bitIndex) => {
                    const bitValues = binaryForms.map(entry => entry.binary[bitIndex]);
                    const isConstant = bitValues.every(bit => bit === bitValues[0]);
                    if (isConstant) {
                        constantParts.push(`${variable}=${bitValues[0]}`);
                        termParts.push(variable + (bitValues[0] === "0" ? "'" : ""));
                    } else {
                        changingParts.push(`${variable} changes → eliminated`);
                    }
                });

                return {
                    number: index + 1,
                    minterms,
                    binaryForms,
                    explanation: [
                        constantParts.length > 0 ? `${constantParts.join(", ")} constant` : "No variables remain constant",
                        ...changingParts
                    ].join("; "),
                    term: termParts.length > 0 ? termParts.join("") : "1"
                };
            });

            explanation.innerHTML = "";
            const title = document.createElement("h2");
            title.textContent = "Sum of Products (SOP) from the 1s";
            explanation.appendChild(title);

            explainedGroups.forEach(group => {
                const groupSection = document.createElement("section");
                groupSection.className = "group-explanation-group";

                const heading = document.createElement("h3");
                heading.textContent = `Group ${group.number}: minterms [${group.minterms.join(", ")}] — ${({1:"Single",2:"Pair",4:"Quad",8:"Octet",16:"Hexadecet"}[group.minterms.length] || group.minterms.length + "-cell group")}`;
                groupSection.appendChild(heading);

                const binaries = document.createElement("p");
                binaries.appendChild(document.createTextNode("Binary forms: "));
                const binaryCode = document.createElement("code");
                binaryCode.textContent = group.binaryForms
                    .map(entry => `m${entry.minterm} = ${entry.binary}`)
                    .join(", ");
                binaries.appendChild(binaryCode);
                groupSection.appendChild(binaries);

                const constants = document.createElement("p");
                constants.textContent = group.explanation;
                groupSection.appendChild(constants);

                const term = document.createElement("p");
                term.appendChild(document.createTextNode("Term = "));
                const termCode = document.createElement("code");
                termCode.textContent = group.term;
                term.appendChild(termCode);
                groupSection.appendChild(term);

                explanation.appendChild(groupSection);
            });

            const equation = document.createElement("p");
            equation.className = "final-equation";
            equation.appendChild(document.createTextNode("K-map SOP: F = "));
            const equationCode = document.createElement("code");
            const originalExpression = explainedGroups.map(group => group.term).join(" + ");
            equationCode.textContent = originalExpression;
            equation.appendChild(equationCode);
            explanation.appendChild(equation);
            explanation.hidden = false;

            fetch("/api/simplify_expression", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ expression: originalExpression })
            })
                .then(async response => {
                    if (!response.ok) {
                        const body = await response.text().catch(() => "");
                        throw new Error(`Simplification request failed (${response.status}): ${body}`);
                    }
                    return response.json();
                })
                .then(result => {
                    if (
                        currentNumVars !== numVars ||
                        activeMapGeneration !== explanationGeneration ||
                        result.original !== originalExpression
                    ) {
                        return;
                    }

                    const simplifiedSop = result.simplified_sop;
                    const factored = result.factored;
                    const xorXnorForm = result.xor_xnor_form;
                    const literalCount = expression =>
                        (expression.match(/[A-Z]'?/g) || []).length;
                    const factoredIsUseful = factored &&
                        factored !== simplifiedSop &&
                        (literalCount(factored) < literalCount(simplifiedSop) ||
                            (factored.includes("(") && factored.length <= simplifiedSop.length + 2));
                    const bestForm = factoredIsUseful ? factored : simplifiedSop;
                    const label = bestForm === originalExpression
                        ? "Already in simplest form: F = "
                        : "Algebraically simplified: F = ";

                    const simplified = document.createElement("p");
                    simplified.className = "final-equation algebraic-equation";
                    simplified.appendChild(document.createTextNode(label));
                    const simplifiedCode = document.createElement("code");
                    simplifiedCode.textContent = bestForm;
                    simplified.appendChild(simplifiedCode);
                    explanation.appendChild(simplified);

                    if (xorXnorForm) {
                        const recognized = document.createElement("p");
                        recognized.className = "final-equation";
                        recognized.appendChild(document.createTextNode("Recognized pattern: F = "));
                        const recognizedCode = document.createElement("code");
                        recognizedCode.textContent = xorXnorForm;
                        recognized.appendChild(recognizedCode);
                        explanation.appendChild(recognized);
                    }
                    appendPOSSection(explanation, numVars, explanationGeneration);
                })
                .catch(error => {
                    // Surfaced in devtools instead of failing silently - check here if the
                    // algebraic-simplification line doesn't show up.
                    console.error("Algebraic simplification pass failed:", error);
                    appendPOSSection(explanation, numVars, explanationGeneration);
                });

            return explainedGroups;
        }

        function renderGroupOverlayPieces(groupLayer, grp, numVars, targetSvg = null, valuesMap = null) {
            const svgNS = "http://www.w3.org/2000/svg";
            const cellSize = 80;
            const headerWidth = 80;
            const headerHeight = 50;
            const startX = 25;
            const startY = 25;
            const gridX = startX + headerWidth;
            const gridY = startY + headerHeight;

            const config = getKMapConfig(numVars);
            if (!config) return;
            const { numRows, numCols } = config;

            const rowSet = new Set();
            const colSet = new Set();
            const svg = targetSvg || document.getElementById("kmap-svg");
            if (!svg || !svg.isConnected) return;

            for (const m of grp.cells) {
                const cellEl = svg.querySelector(`.kmap-cell[data-minterm="${m}"]`);
                if (cellEl) {
                    const r = parseInt(cellEl.getAttribute("data-row"), 10);
                    const c = parseInt(cellEl.getAttribute("data-col"), 10);
                    rowSet.add(r);
                    colSet.add(c);
                }
            }

            if (rowSet.size === 0 || colSet.size === 0) return;

            // Determine continuous segments for rows and columns, splitting only when the
            // indices genuinely wrap around a gap (not merely because the group spans the
            // full dimension, which also happens to touch both index 0 and maxIdx).
            const makeSegments = (set, maxIdx) => {
                const arr = Array.from(set).sort((a, b) => a - b);

                // Covers every index in this dimension - one full segment, no wrap.
                if (arr.length === maxIdx + 1) {
                    return [[0, maxIdx]];
                }

                // A simple contiguous run (e.g. [1,2]) - no wrap, regardless of whether
                // it happens to touch 0 or maxIdx.
                if (arr[arr.length - 1] - arr[0] + 1 === arr.length) {
                    return [[arr[0], arr[arr.length - 1]]];
                }

                // Genuine wraparound: find the single gap in sorted order and split there
                // into a low chunk (starting at 0) and a high chunk (ending at maxIdx).
                for (let i = 0; i < arr.length - 1; i++) {
                    if (arr[i + 1] - arr[i] > 1) {
                        return [[0, arr[i]], [arr[i + 1], arr[arr.length - 1]]];
                    }
                }

                // Fallback - shouldn't be reachable for valid rectangular cyclic groups.
                return [[arr[0], arr[arr.length - 1]]];
            };

            const rowSegments = makeSegments(rowSet, numRows - 1);
            const colSegments = makeSegments(colSet, numCols - 1);

            const inset = 4;
            for (const rSeg of rowSegments) {
                for (const cSeg of colSegments) {
                    const x = gridX + cSeg[0] * cellSize;
                    const y = gridY + rSeg[0] * cellSize;
                    const w = (cSeg[1] - cSeg[0] + 1) * cellSize;
                    const h = (rSeg[1] - rSeg[0] + 1) * cellSize;

                    const rectX = x + inset;
                    const rectY = y + inset;
                    const rectW = w - (inset * 2);
                    const rectH = h - (inset * 2);

                    const groupRect = document.createElementNS(svgNS, "rect");
                    groupRect.setAttribute("x", rectX);
                    groupRect.setAttribute("y", rectY);
                    groupRect.setAttribute("width", rectW);
                    groupRect.setAttribute("height", rectH);
                    groupRect.setAttribute("rx", "8");
                    groupRect.setAttribute("ry", "8");
                    groupRect.setAttribute("fill", grp.color || "rgba(59, 130, 246, 0.3)");
                    groupRect.setAttribute("stroke", grp.borderColor || "#2563eb");
                    groupRect.setAttribute("stroke-width", "2.5");
                    groupRect.setAttribute("class", "kmap-group-rect");
                    if (grp.id) {
                        groupRect.setAttribute("data-group-id", grp.id);
                    }
                    groupLayer.appendChild(groupRect);
                }
            }
        }

        function drawGroups(numVars, groups, targetSvg = null, valuesMap = null, renderOptions = {}) {
            if (currentNumVars !== numVars) return;

            if (!Array.isArray(groups) || groups.length === 0) return;

            const svg = targetSvg || document.getElementById("kmap-svg");
            if (!svg) return;

            const svgNS = "http://www.w3.org/2000/svg";

            // Remove any existing groups layer if redrawing
            const existingGroupLayer = svg.querySelector(".kmap-groups-layer");
            if (existingGroupLayer) {
                existingGroupLayer.remove();
            }

            const groupLayer = document.createElementNS(svgNS, "g");
            groupLayer.setAttribute("class", "kmap-groups-layer");
            svg.appendChild(groupLayer);
            const drawGeneration = activeMapGeneration;

            groups.forEach((grp, groupIndex) => {
                if (!grp.cells || grp.cells.length === 0) return;

                // Validate every minterm in the group: must contain "1" or "X"
                let groupValid = true;
                for (const m of grp.cells) {
                    const cellEl = svg.querySelector(`.kmap-cell[data-minterm="${m}"]`);
                    const val = cellEl ? cellEl.getAttribute("data-value") : (valuesMap || currentMintermValues)[m];
                    if (val === undefined || val === null) {
                        groupValid = false;
                        break;
                    }
                    const normVal = String(val).trim().toUpperCase();
                    const allowedValues = renderOptions.allowedValues || ["1", "X"];
                    if (!allowedValues.includes(normVal)) {
                        groupValid = false;
                        break;
                    }
                }

                if (!groupValid) {
                    return;
                }

                // Stagger each group animation by approximately 100ms
                const staggerDelay = (renderOptions.startDelay || 0) + groupIndex * 1200;
                const timerId = setTimeout(() => {
                    if (
                        currentNumVars !== numVars ||
                        drawGeneration !== activeMapGeneration ||
                        !svg.isConnected
                    ) return;
                    renderGroupOverlayPieces(groupLayer, grp, numVars, svg, valuesMap);
                }, staggerDelay);
                activeAnimationTimeouts.push(timerId);
            });

            if (targetSvg) return;
            const explanationTimerId = setTimeout(() => {
                if (currentNumVars !== numVars || drawGeneration !== activeMapGeneration) return;
                explainGroups(groups, numVars);
            }, (renderOptions.startDelay || 0) + Math.max(0, (groups.length - 1) * 100 + 350));
            activeAnimationTimeouts.push(explanationTimerId);
        }

        /* ===================== LOGIC CIRCUIT DIAGRAM GENERATOR ===================== */
        var circuitView = "sop";      // var (not let): clearSolutionState() may run before this block executes
        var circuitForms = null;
        const CIRCUIT_THEME = { wire: "#334155", stroke: "#2563eb", fill: "#f1f5f9" };
        const CIRCUIT_GATE_W = 80;

        function circuitPopcount(n) { let c = 0; while (n) { c += n & 1; n >>= 1; } return c; }

        /* ---------- 1. Minimiser (Quine-McCluskey + exact minimum cover) ---------- */
        function circuitMinimize(n, onList, dcList) {
            if (!onList.length) return [];
            let current = new Map();
            onList.concat(dcList).forEach(t => current.set(t + "|0", { v: t, m: 0 }));
            const primes = [];
            while (current.size) {
                const list = Array.from(current.values()), used = new Set(), next = new Map();
                for (let i = 0; i < list.length; i++) {
                    for (let j = i + 1; j < list.length; j++) {
                        const a = list[i], b = list[j];
                        if (a.m !== b.m) continue;
                        const diff = a.v ^ b.v;
                        if (diff && (diff & (diff - 1)) === 0) {
                            const nv = a.v & ~diff, nm = a.m | diff;
                            next.set(nv + "|" + nm, { v: nv, m: nm });
                            used.add(i); used.add(j);
                        }
                    }
                }
                list.forEach((t, i) => { if (!used.has(i)) primes.push(t); });
                current = next;
            }
            const covers = (p, t) => (t & ~p.m) === p.v;
            const cost = set => set.length * 100 + set.reduce((s, p) => s + n - circuitPopcount(p.m), 0);
            let best = null, bestCost = Infinity;
            const search = (remaining, chosen) => {
                const c = cost(chosen);
                if (c >= bestCost) return;
                if (!remaining.length) { best = chosen; bestCost = c; return; }
                primes.filter(p => covers(p, remaining[0]))
                    .sort((a, b) => remaining.filter(x => covers(b, x)).length - remaining.filter(x => covers(a, x)).length)
                    .forEach(p => search(remaining.filter(x => !covers(p, x)), chosen.concat([p])));
            };
            search(onList, []);
            return best || [];
        }

        /* Builds the SOP / POS / XOR expression strings for the current solution payload. */
        function circuitBuildForms(data) {
            const n = data.num_vars;
            const vars = (data.variables && data.variables.length === n) ? data.variables : ["A", "B", "C", "D"].slice(0, n);
            const total = 1 << n, on = data.minterms || [], dc = data.dontcares || [];
            const onSet = new Set(on), dcSet = new Set(dc), zeros = [];
            for (let m = 0; m < total; m++) if (!onSet.has(m) && !dcSet.has(m)) zeros.push(m);

            const literals = (p, flip) => {
                const out = [];
                vars.forEach((name, i) => {
                    const bit = n - 1 - i;
                    if ((p.m >> bit) & 1) return;
                    const isOne = (p.v >> bit) & 1;
                    out.push(name + ((flip ? isOne : !isOne) ? "'" : ""));
                });
                return out;
            };

            let sop, pos;
            if (!on.length) { sop = pos = (dc.length === total ? "1" : "0"); }
            else if (!zeros.length) { sop = pos = "1"; }
            else {
                sop = circuitMinimize(n, on, dc).map(p => literals(p, false).join("")).join(" + ");
                pos = circuitMinimize(n, zeros, dc).map(p => {
                    const l = literals(p, true);
                    return l.length === 1 ? l[0] : "(" + l.join("+") + ")";
                }).join("");
            }

            // XOR / XNOR detection: F equals the parity of a subset of >= 2 variables (optionally complemented).
            let xor = null;
            if (!dc.length && on.length && zeros.length) {
                search: for (let mask = 1; mask < total; mask++) {
                    if (circuitPopcount(mask) < 2) continue;
                    for (const inv of [0, 1]) {
                        let ok = true;
                        for (let m = 0; m < total; m++) {
                            if (!!((circuitPopcount(m & mask) & 1) ^ inv) !== onSet.has(m)) { ok = false; break; }
                        }
                        if (ok) {
                            const names = vars.filter((_, i) => (mask >> (n - 1 - i)) & 1);
                            xor = names.length === 2
                                ? names.join(inv ? " ⊙ " : " ⊕ ")
                                : (inv ? "(" + names.join(" ⊕ ") + ")'" : names.join(" ⊕ "));
                            break search;
                        }
                    }
                }
            }
            return { sop, pos, xor, vars };
        }

        /* ---------- 2. Expression parser -> gate tree ---------- */
        function circuitNormalize(expr) {
            return String(expr || "").replace(/[’′‘`]/g, "'").replace(/[·*•&∧\s]/g, "").replace(/∨/g, "+");
        }
        function circuitLiterals(text) {
            const out = [], re = /([A-Z])('?)/g;
            let m, consumed = "";
            while ((m = re.exec(text))) { out.push({ kind: "lit", name: m[1], neg: m[2] === "'" }); consumed += m[0]; }
            if (!out.length || consumed !== text) throw new Error('Cannot parse "' + text + '"');
            return out;
        }
        function circuitSingleLiteral(text) {
            const l = circuitLiterals(text);
            if (l.length !== 1) throw new Error('Expected a single literal, got "' + text + '"');
            return l[0];
        }
        const circuitFlat = (type, items) => items.length === 1 ? items[0] : { kind: "gate", type, children: items };

        function parseCircuitExpression(expression, mode) {
            const text = circuitNormalize(expression);
            if (text === "0" || text === "1") return { kind: "const", value: text };
            let root;
            if (mode === "xor") {
                root = circuitParseSimplified(text);
            } else if (mode === "pos") {
                const groups = [];
                if (!text.includes("(")) {
                    if (text.includes("+")) groups.push(text.split("+").map(circuitSingleLiteral));
                    else circuitLiterals(text).forEach(l => groups.push([l]));
                } else {
                    let i = 0;
                    while (i < text.length) {
                        if (text[i] === "(") {
                            const j = text.indexOf(")", i);
                            if (j < 0) throw new Error("Unbalanced parentheses");
                            groups.push(text.slice(i + 1, j).split("+").map(circuitSingleLiteral));
                            i = j + 1;
                        } else {
                            const m = /^([A-Z])('?)/.exec(text.slice(i));
                            if (!m) throw new Error("Cannot parse expression");
                            groups.push([{ kind: "lit", name: m[1], neg: m[2] === "'" }]);
                            i += m[0].length;
                        }
                    }
                }
                root = circuitFlat("and", groups.map(g => circuitFlat("or", g)));
            } else {
                root = circuitFlat("or", text.split("+").map(t => circuitFlat("and", circuitLiterals(t))));
            }
            return { kind: root.kind === "lit" ? "literal" : "tree", root };
        }
        /* ---------- XOR / XNOR expression parser ----------
           Grammar (same precedence the backend formatter uses):
             sum     := xorExpr ('+' xorExpr)*          lowest
             xorExpr := product (('⊕' | '⊙') product)*
             product := atom+                           implicit AND
             atom    := LETTER | '(' sum ')'  followed by any number of "'"                */
        const circuitGate = (type, children) => ({ kind: "gate", type, children });
        const CIRCUIT_INVERT = { and: "nand", nand: "and", or: "nor", nor: "or", xor: "xnor", xnor: "xor" };

        function circuitInvertNode(node) {
            if (node.kind === "lit") return { kind: "lit", name: node.name, neg: !node.neg };
            return circuitGate(CIRCUIT_INVERT[node.type], node.children);
        }
        /* Balanced tree of 2-input XOR gates (XOR is associative, so any grouping is equivalent). */
        function circuitXorTree(nodes, inverted) {
            while (nodes.length > 1) {
                const next = [];
                for (let i = 0; i < nodes.length; i += 2) {
                    if (i + 1 < nodes.length) next.push(circuitGate((nodes.length === 2 && inverted) ? "xnor" : "xor", [nodes[i], nodes[i + 1]]));
                    else next.push(nodes[i]);
                }
                nodes = next;
            }
            return nodes[0];
        }
        function circuitBuildXor(operands, ops) {
            if (operands.length === 1) return operands[0];
            if (ops.every(o => o === "⊕")) return circuitXorTree(operands, false);
            // A chain of ⊙ is NOT the complement of the parity for 3+ operands (it reads left to right,
            // so n operands carry n-1 negations); it is folded left like any mixed chain below.
            let acc = operands[0];                                   // otherwise fold left, one 2-input gate each
            ops.forEach((o, i) => { acc = circuitGate(o === "⊙" ? "xnor" : "xor", [acc, operands[i + 1]]); });
            return acc;
        }
        function circuitParseSimplified(text) {
            let pos = 0;
            const peek = () => text[pos];
            const fail = () => { throw new Error(pos < text.length ? `Unexpected "${text[pos]}" in expression` : "Unexpected end of expression"); };
            function parseAtom() {
                let node;
                if (peek() === "(") {
                    pos++; node = parseSum();
                    if (peek() !== ")") throw new Error("Unbalanced parentheses");
                    pos++;
                } else if (/[A-Z]/.test(peek() || "")) {
                    node = { kind: "lit", name: text[pos++], neg: false };
                } else fail();
                while (peek() === "'") { pos++; node = circuitInvertNode(node); }
                return node;
            }
            function parseProduct() {
                const items = [parseAtom()];
                while (pos < text.length && /[A-Z(]/.test(peek())) items.push(parseAtom());
                return circuitFlat("and", items);
            }
            function parseXor() {
                const operands = [parseProduct()], ops = [];
                while (peek() === "⊕" || peek() === "⊙" || peek() === "^") {
                    ops.push(text[pos++] === "⊙" ? "⊙" : "⊕");
                    operands.push(parseProduct());
                }
                return circuitBuildXor(operands, ops);
            }
            function parseSum() {
                const items = [parseXor()];
                while (peek() === "+") { pos++; items.push(parseXor()); }
                return circuitFlat("or", items);
            }
            const root = parseSum();
            if (pos < text.length) fail();
            return root;
        }
        function circuitAssignDepth(n) {
            if (n.kind === "lit") return (n.depth = 0);
            return (n.depth = 1 + Math.max(...n.children.map(circuitAssignDepth)));
        }

        /* ---------- 3. IEEE 91-1984 gate symbols ---------- */
        const circuitGateHeight = k => Math.max(60, (k + 1) * 22.5);

        /* Returns { svg, outX, pinX(py) } for and/nand/or/nor/xor/xnor. (x, y) = top-left of the symbol box. */
        function circuitGateShape(type, x, y, H) {
            const T = CIRCUIT_THEME, W = CIRCUIT_GATE_W, yc = y + H / 2;
            const bubble = type === "nand" || type === "nor" || type === "xnor";
            const base = { nand: "and", nor: "or", xnor: "xor" }[type] || type;
            const b = Math.min(17.5, H * 0.14);              // depth of the concave back
            const gap = base === "xor" ? 11.25 : 0;            // spacing of the extra XOR rail
            const xb = x + gap, bw = W - gap;
            const style = `fill="${T.fill}" stroke="${T.stroke}" stroke-width="2.5" stroke-linejoin="round"`;
            let d;
            if (base === "and") {                          // straight back + semicircular nose
                const rx = Math.min(H / 2, W / 2);
                d = `M ${x} ${y} H ${x + W - rx} A ${rx} ${H / 2} 0 0 1 ${x + W - rx} ${y + H} H ${x} Z`;
            } else {                                       // concave back + pointed shield nose
                d = `M ${xb} ${y} C ${xb + bw * 0.5} ${y} ${xb + bw * 0.82} ${y + H * 0.2} ${xb + bw} ${yc} ` +
                    `C ${xb + bw * 0.82} ${y + H * 0.8} ${xb + bw * 0.5} ${y + H} ${xb} ${y + H} Q ${xb + 2 * b} ${yc} ${xb} ${y} Z`;
            }
            let svg = `<path d="${d}" ${style}/>`;
            if (base === "xor") {
                svg += `<path d="M ${x} ${y} Q ${x + 2 * b} ${yc} ${x} ${y + H}" fill="none" stroke="${T.stroke}" stroke-width="2.5" stroke-linecap="round"/>`;
            }
            if (bubble) svg += `<circle cx="${x + W + 5}" cy="${yc}" r="5" ${style}/>`;
            return {
                svg,
                outX: x + W + (bubble ? 10 : 0),
                // x where an input wire meets the back of the symbol at height py (follows the concave curve for OR/XOR)
                pinX: py => base === "and" ? x : x + 4 * b * ((py - y) / H) * (1 - (py - y) / H)
            };
        }
        /* Inverter: triangle + inversion bubble. Input at x, output at x + 40. */
        function circuitNotSvg(x, yc) {
            const T = CIRCUIT_THEME, style = `fill="${T.fill}" stroke="${T.stroke}" stroke-width="2.5" stroke-linejoin="round"`;
            return `<path d="M ${x} ${yc - 15} L ${x + 30} ${yc} L ${x} ${yc + 15} Z" ${style}/>` +
                   `<circle cx="${x + 35}" cy="${yc}" r="5" ${style}/>`;
        }

        /* ---------- 4. Schematic layout + wiring ---------- */
        function circuitWrapSvg(w, h, inner) {
            return `<svg class="circuit-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" ` +
                   `style="max-width:100%;height:auto" role="img" aria-label="Logic circuit diagram">${inner}</svg>`;
        }

        function circuitBuildSvg(parsed) {
            const T = CIRCUIT_THEME, W = CIRCUIT_GATE_W;
            const wires = [], gates = [], dots = [], labels = [];
            const line = d => wires.push(`<path d="${d}" fill="none" stroke="${T.wire}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`);
            const dot = (x, y) => dots.push(`<circle cx="${x}" cy="${y}" r="3.75" fill="${T.wire}"/>`);
            const text = (x, y, s, cls, anchor = "middle") => labels.push(`<text class="${cls}" x="${x}" y="${y}" text-anchor="${anchor}">${s}</text>`);
            const assemble = (w, h) => circuitWrapSvg(w, h, wires.join("") + gates.join("") + dots.join("") + labels.join(""));

            if (parsed.kind === "const") {                       // F = 0 / F = 1
                text(37.5, 56.25, parsed.value, "circuit-label");
                line("M 57.5 50 H 187.5");
                text(207.5, 56.25, "F", "circuit-out", "start");
                return assemble(250, 100);
            }
            if (parsed.kind === "literal") {                     // F = A or F = A'
                const l = parsed.root;
                text(37.5, 56.25, l.name, "circuit-label");
                let x = 57.5;
                line("M 57.5 50 H 70");
                if (l.neg) { gates.push(circuitNotSvg(70, 50)); x = 110; } else x = 70;
                line(`M ${x} 50 H ${x + 62.5}`);
                text(x + 82.5, 56.25, "F", "circuit-out", "start");
                return assemble(x + 125, 100);
            }

            const root = parsed.root;
            circuitAssignDepth(root);
            const lits = [];
            (function walk(n) { if (n.kind === "lit") lits.push(n); else n.children.forEach(walk); })(root);

            // Left column: vertical rails for each variable (true) and its complement (through a NOT gate).
            const names = Array.from(new Set(lits.map(l => l.name))).sort();
            const rails = {};
            let rx = 42.5, anyInv = false;
            names.forEach(name => {
                const needT = lits.some(l => l.name === name && !l.neg), needI = lits.some(l => l.name === name && l.neg);
                rails[name] = { needT, needI, tx: rx, ix: needI ? rx + 57.5 : null, maxT: 0, maxI: 0 };
                rx += needI ? 87.5 : 57.5;
                anyInv = anyInv || needI;
            });
            const railsRight = Math.max(...names.map(n => rails[n].ix || rails[n].tx));
            const bandY = 77.5, startY = anyInv ? 120 : 67.5;

            // Stage 1 slots: depth-1 gates, plus bare literals that must travel to a deeper gate on their own lane.
            const slots = [];
            (function collect(n) {
                if (n.kind === "gate" && n.depth === 1) slots.push({ node: n });
                else if (n.kind === "gate") n.children.forEach(collect);
                else slots.push({ node: n, lane: true });
            })(root);
            let y = startY, bottom = startY;
            slots.forEach(s => {
                if (s.lane) { s.node.outY = y + 11.25; bottom = Math.max(bottom, y + 22.5); y += 42.5; }
                else {
                    const g = s.node;
                    g.H = circuitGateHeight(g.children.length); g.y0 = y; g.outY = y + g.H / 2;
                    bottom = Math.max(bottom, y + g.H); y += g.H + 27.5;
                }
            });

            // Columns (one per gate depth).
            const gatesAt = {};
            (function walk(n) { if (n.kind === "gate") { (gatesAt[n.depth] = gatesAt[n.depth] || []).push(n); n.children.forEach(walk); } })(root);
            const bubbleAt = d => (gatesAt[d] || []).some(g => ["nand", "nor", "xnor"].includes(g.type)) ? 10 : 0;
            const colX = { 1: railsRight + 55 }, colOut = { 1: railsRight + 55 + W + bubbleAt(1) };
            for (let d = 2; d <= root.depth; d++) {
                const wiresIn = (gatesAt[d] || []).reduce((s, g) => s + g.children.length, 0);
                colX[d] = colOut[d - 1] + 27.5 + wiresIn * 10;
                colOut[d] = colX[d] + W + bubbleAt(d);
            }
            for (let d = 2; d <= root.depth; d++) {              // centre deeper gates on the signals they combine
                gatesAt[d].forEach(g => {
                    const ys = g.children.map(c => c.outY);
                    g.H = circuitGateHeight(g.children.length);
                    g.y0 = Math.max(startY, (Math.min(...ys) + Math.max(...ys)) / 2 - g.H / 2);
                    g.outY = g.y0 + g.H / 2;
                });
                const col = gatesAt[d].slice().sort((a, b) => a.y0 - b.y0);   // keep gates in one column from overlapping
                col.forEach((g, i) => {
                    if (i && g.y0 < col[i - 1].y0 + col[i - 1].H + 20) { g.y0 = col[i - 1].y0 + col[i - 1].H + 20; g.outY = g.y0 + g.H / 2; }
                    bottom = Math.max(bottom, g.y0 + g.H);
                });
            }

            const tapRail = (lit, py, toX) => {
                const r = rails[lit.name], x = lit.neg ? r.ix : r.tx;
                if (lit.neg) r.maxI = Math.max(r.maxI, py); else r.maxT = Math.max(r.maxT, py);
                line(`M ${x} ${py} H ${toX}`);
                dot(x, py);
                bottom = Math.max(bottom, py);
            };

            const wireLanes = {};
            // Gates + orthogonal wiring, shallowest column first.
            for (let d = 1; d <= root.depth; d++) {
                (gatesAt[d] || []).forEach(g => {
                    const k = g.children.length, shape = circuitGateShape(g.type, colX[d], g.y0, g.H);
                    g.outX = shape.outX;
                    gates.push(shape.svg);
                    const pinY = j => g.y0 + g.H * (j + 1) / (k + 1);
                    if (d === 1) {                                  // inputs tap straight off the rails
                        g.children.forEach((c, j) => tapRail(c, pinY(j), shape.pinX(pinY(j))));
                        return;
                    }
                    const items = g.children.map((c, j) => {
                        const sy = c.outY, py = pinY(j);
                        let sx;
                        if (c.kind === "lit") { sx = colOut[1]; tapRail(c, sy, sx); } else sx = c.outX;
                        return { sx, sy, py, px: shape.pinX(py) };
                    });
                    const laneOffset = wireLanes[d] || 0;                       // each gate in a column gets its own vertical lanes
                    wireLanes[d] = laneOffset + k * 10;
                    const xBase = Math.max(...items.map(i => i.sx)) + 15 + laneOffset;
                    const down = items.filter(i => i.py > i.sy + 0.5), up = items.filter(i => i.py < i.sy - 0.5);
                    down.forEach((i, r) => { i.vx = xBase + (down.length - 1 - r) * 10; });   // top wires turn last -> no crossings
                    up.forEach((i, r) => { i.vx = xBase + r * 10; });
                    items.forEach(i => {
                        if (i.vx === undefined) line(`M ${i.sx} ${i.sy} H ${i.px}`);
                        else line(`M ${i.sx} ${i.sy} H ${i.vx} V ${i.py} H ${i.px}`);
                    });
                });
            }

            // Final output F.
            line(`M ${root.outX} ${root.outY} H ${root.outX + 45}`);
            text(root.outX + 57.5, root.outY + 7.5, "F", "circuit-out", "start");

            // Rails, junction dots and inverters.
            names.forEach(name => {
                const r = rails[name];
                text(r.tx, 25, name, "circuit-label");
                const trueBottom = Math.max(r.maxT, r.needI ? bandY : 0);
                if (trueBottom > 0) line(`M ${r.tx} 35 V ${trueBottom}`);
                if (r.needI) {
                    if (r.needT) dot(r.tx, bandY);
                    line(`M ${r.tx} ${bandY} H ${r.tx + 10}`);
                    gates.push(circuitNotSvg(r.tx + 10, bandY));
                    line(`M ${r.tx + 50} ${bandY} H ${r.ix}`);
                    line(`M ${r.ix} ${bandY} V ${Math.max(r.maxI, bandY)}`);
                    text(r.ix, bandY - 12.5, name + "'", "circuit-label");
                }
            });
            return assemble(root.outX + 100, bottom + 35);
        }

        /* Public engine: expression string + mode ("sop" | "pos" | "xor"). Returns the SVG markup;
           if `target` (an element) is given the SVG is also inserted into it. */
        function renderCircuitDiagram(expression, mode = "sop", target = null) {
            let markup;
            try {
                markup = circuitBuildSvg(parseCircuitExpression(expression, mode));
            } catch (err) {
                markup = `<p class="circuit-error">Unable to draw this circuit: ${String(err.message).replace(/</g, "&lt;")}</p>`;
            }
            if (target) target.innerHTML = markup;
            return markup;
        }

        /* ---------- 5. UI: static tab bar in #circuit-container + dynamic XOR tab ---------- */
        var circuitUserPicked = false;   // true once the user clicks a tab, so a late backend answer never overrides their choice

        function renderCircuitSection(data, generation) {
            const container = document.getElementById("circuit-container");
            if (!container || !data || activeMapGeneration !== generation) return;
            circuitForms = circuitBuildForms(data);                 // circuitForms.xor = local parity detection (pure XOR/XNOR)
            if (data.xor_xnor_form) circuitForms.xor = data.xor_xnor_form;
            circuitUserPicked = false;
            circuitView = circuitForms.xor ? "xor" : "sop";
            updateCircuitSection();
            container.hidden = false;
            if (data.xor_xnor_form === undefined && !circuitForms.xor) circuitFetchXorForm(data, generation);
        }

        /* The solve endpoints don't return xor_xnor_form (only /api/simplify_expression does), so ask for it
           and cache it on the payload (currentLogicData.xor_xnor_form). */
        function circuitFetchXorForm(data, generation) {
            const sop = circuitForms && circuitForms.sop;
            if (!sop || sop === "0" || sop === "1") return;
            fetch("/api/simplify_expression", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ expression: sop })
            })
                .then(r => { if (!r.ok) throw new Error("simplify_expression failed (" + r.status + ")"); return r.json(); })
                .then(result => {
                    if (activeMapGeneration !== generation || !circuitForms) return;
                    const form = result.xor_xnor_form || null;
                    data.xor_xnor_form = form;
                    if (!form) return;
                    try { parseCircuitExpression(form, "xor"); }      // only reveal the tab if we can actually draw it
                    catch (err) { console.warn("XOR/XNOR form not drawable:", form, err); return; }
                    circuitForms.xor = form;
                    if (!circuitUserPicked) circuitView = "xor";
                    updateCircuitSection();
                })
                .catch(err => console.warn("XOR/XNOR lookup failed:", err));
        }

        function setCircuitView(view) {
            circuitUserPicked = true;
            circuitView = view;
            updateCircuitSection();
        }

        function updateCircuitSection() {
            const container = document.getElementById("circuit-container");
            const diagram = document.getElementById("circuit-diagram");
            const caption = document.getElementById("circuit-expression");
            const tabs = document.getElementById("circuit-tabs");
            if (!container || !diagram || !caption || !tabs || !circuitForms) return;
            const hasXor = !!circuitForms.xor;
            document.getElementById("circuit-tab-xor").hidden = !hasXor;
            if (circuitView === "xor" && !hasXor) circuitView = "sop";
            tabs.style.gridTemplateColumns = `repeat(${hasXor ? 3 : 2}, minmax(0, 1fr))`;
            tabs.querySelectorAll("button[data-view]").forEach(button => {
                const active = button.dataset.view === circuitView;
                button.classList.toggle("active", active);
                button.setAttribute("aria-selected", String(active));
            });
            const expression = circuitForms[circuitView];
            renderCircuitDiagram(expression, circuitView, diagram);
            caption.textContent = "F = ";
            const code = document.createElement("code");
            code.textContent = expression;
            caption.appendChild(code);
        }

        // ---------- PDF export (native browser print) ----------
const PDF_EXPORT_TITLE = "OKayMaps_Comprehensive_Solution";
const KMAP_QUIET_MS = 1500;        // K-map reveals/groups are staggered <= 1.2s apart
const KMAP_MAX_WAIT_MS = 25000;
let kmapLastMutationAt = 0;
let isExportingPdf = false;

// Tracks DOM activity in the K-map area so the export can wait for the staggered reveal animation to finish.
function installKMapActivityObserver() {
    const target = document.getElementById("kmap-pair");
    if (!target || typeof MutationObserver === "undefined") return;
    new MutationObserver(() => { kmapLastMutationAt = Date.now(); })
        .observe(target, { childList: true, subtree: true, attributes: true, characterData: true });
}

function waitForKMapAnimations() {
    return new Promise(resolve => {
        const started = Date.now();
        (function poll() {
            const now = Date.now();
            if (now - kmapLastMutationAt >= KMAP_QUIET_MS || now - started >= KMAP_MAX_WAIT_MS) return resolve();
            setTimeout(poll, 150);
        })();
    });
}

function setExportToolbarVisible(visible) {
    const toolbar = document.getElementById("export-toolbar");
    if (toolbar) toolbar.hidden = !visible;
    if (!visible) setExportStatus("");
}

function setExportStatus(message, isError = false) {
    const status = document.getElementById("export-status");
    if (!status) return;
    status.textContent = message || "";
    status.classList.toggle("error", !!isError);
}

// Builds a print-only block holding BOTH MUX views and EVERY circuit form, so they all appear in sequence
// in the printed document regardless of which tab/view is currently selected on screen.
function buildPrintExtras(data) {
    const host = document.createElement("div");
    host.id = "print-extras";

    const muxPayload = data.mux;
    if (muxPayload) {
        const payload = (muxPayload.folded || muxPayload.unfolded) ? muxPayload : { folded: muxPayload };
        [
            ["folded", "Multiplexer Implementation — Folded MUX (2ⁿ⁻¹:1)"],
            ["unfolded", "Multiplexer Implementation — Unfolded MUX (2ⁿ:1)"]
        ].forEach(([view, title]) => {
            if (!payload[view] || !Array.isArray(payload[view].inputs)) return;
            const section = document.createElement("div");
            section.className = "mux-container print-section";
            renderMuxImplementation(muxPayload, activeMapGeneration, { view, container: section, title });
            section.hidden = false;
            if (section.childNodes.length) host.appendChild(section);
        });
    }

    if (circuitForms) {
        [
            ["sop", "SOP Logic Circuit (AND-OR)"],
            ["pos", "POS Logic Circuit (OR-AND)"],
            ["xor", "Simplified Logic Circuit (XOR/XNOR)"]
        ].forEach(([mode, title]) => {
            const expression = circuitForms[mode];
            if (typeof expression !== "string" || !expression) return;
            const section = document.createElement("div");
            section.className = "mux-container circuit-container print-section";
            const heading = document.createElement("h2");
            heading.textContent = title;
            section.appendChild(heading);
            const diagram = document.createElement("div");
            diagram.className = "circuit-scroll";
            diagram.innerHTML = renderCircuitDiagram(expression, mode);
            section.appendChild(diagram);
            const caption = document.createElement("p");
            caption.className = "circuit-expr";
            caption.appendChild(document.createTextNode("F = "));
            const code = document.createElement("code");
            code.textContent = expression;
            caption.appendChild(code);
            section.appendChild(caption);
            host.appendChild(section);
        });
    }
    return host;
}

async function exportToPDF() {
    if (isExportingPdf || !currentLogicData) return;
    const button = document.getElementById("export-pdf-btn");
    const generation = activeMapGeneration;
    const previousTitle = document.title;
    let extras = null;

    isExportingPdf = true;
    if (button) button.disabled = true;
    try {
        setExportStatus("Waiting for the K-map animation to finish…");
        await waitForKMapAnimations();
        if (activeMapGeneration !== generation || !currentLogicData) {
            setExportStatus("Export cancelled because the solution changed.");
            return;
        }
        setExportStatus("");
        extras = buildPrintExtras(currentLogicData);
        document.body.appendChild(extras);
        document.title = PDF_EXPORT_TITLE;   // becomes the suggested file name in "Save as PDF"
        document.body.classList.add("printing-mode");
        window.print();
    } catch (error) {
        console.error("PDF export failed:", error);
        setExportStatus(`Export failed: ${error && error.message ? error.message : "unknown error"}`, true);
    } finally {
        document.body.classList.remove("printing-mode");
        if (extras && extras.parentNode) extras.parentNode.removeChild(extras);
        document.title = previousTitle;
        isExportingPdf = false;
        if (button) button.disabled = false;
    }
}

// Attach public helpers and initialize the default Truth Table input state.
        window.drawKMap = drawKMap;
        window.drawGroups = drawGroups;
        window.minimizeKMap = minimizeKMap;
        window.explainGroups = explainGroups;
        window.exportToPDF = exportToPDF;
        window.addEventListener("DOMContentLoaded", () => {
            setInputMode("truth");
            renderSolutionHistory();
            installKMapActivityObserver();
        });
