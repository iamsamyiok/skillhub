# LaTeX MCP Server

An **MCP (Model Context Protocol) server** that can supercharge your VSCode + LaTex Workshop writing workflow

Currently houses MCP tools, and new tools can be easily added in either Python and TypeScript. The Python process is the MCP server; selected tools are delegated to a small Node/TypeScript module via a bridge.

## LaTex MCP Server + Copilot/Claude/Cursor, what can you do?
- Read your cited papers, verify / add onto your claims
- Access your python scripts to generate new figures / latex tables based on your experiment data, and **place them into latex autonomously** 
- Can verify every step and ensure your pdf compiles 
- Functionally it can autonomously take your outline + experimental results and turn it into a paper (may looks like slop though)

<p align="center">
  <video src="./docs/demo/minimal.mp4" controls width="600">
    Your browser does not support the video tag.
  </video>
</p>



---

### Python Tools

- **list_tex_files**  
  Lists all `.tex` files under your LaTeX workspace (relative paths). Useful for LLMs or agents to discover available chapters and sections.

- **read_file**  
  Reads a text or binary-safe slice of a file given a relative path inside the workspace. Supports specifying a maximum number of bytes to return.

- **extract_bibliography**  
  Parses a BibTeX file and returns structured entry metadata, including download URLs (DOI, arXiv). Helps agents or scripts work with citation data programmatically.

- **download_bibliography**  
  Downloads PDFs for bibliography entries listed in `resources/cited_papers/index.json`. Can force re-downloads and limit the number of new downloads.

- **compile_latex**  
  Runs LaTeX compilation (`pdflatex`/`xelatex` via `latexmk`) on the main document and returns success plus a log snippet. Supports specifying the entry `.tex` file and number of passes.

- **read_pdf**  
  Extracts text and metadata from a PDF filepath using `pypdf`, with page and character limits. Stores a JSON artifact for downstream use.

- **read_pdf_from_citation**  
  Resolves a citation key via `resources/cited_papers/index.json` to its PDF and extracts text (auto-downloads if needed). Returns extracted text, metadata, and the citation key.

---

### TypeScript Bridge Tools

- **summarize_text**  
  Produces a concise natural language summary of provided LaTeX or text content. Accepts a maximum sentence count for the summary.

- **suggest_bib_key**  
  Suggests a stable BibTeX key based on authors, year, and title metadata. Useful for generating consistent citation keys.

---

## Install (with `uv`)

From the repository root:

```bash
cd latex-mcp-server
uv tool install -e .
```
or
```
uv tool install -e ./latex-mcp-server
```

This will make the console script `latex-mcp-server` available on your PATH.

> If you prefer a one-off run without installing as a tool:
>
> ```bash
> uv run latex-mcp-server
> ```

## MCP Configuration Snippet

Add to your `mcp.json` (VS Code / Claude Desktop user settings):

```jsonc
"latex-mcp-server": {
  "command": "uv",
  "args": ["tool", "run", "latex-mcp-server", "--workspace", "ABSOLUTE_PATH_TO_YOUR_PROJECT_ROOT"]
}
```

If you omit `--workspace`, the server will infer the current working directory.

### Windows example

On Windows (PowerShell / Bash), if your paper_1 root is at `C:\Users\User\projects\paper_1`, use:

```jsonc
"latex-mcp-server": {
  "command": "uv",
  "args": [
    "tool", "run", "latex-mcp-server",
    "--workspace", "C:/Users/User/projects/paper_1"
  ]
}
```

Forward slashes are fine; they avoid the need to escape backslashes. Be sure to replace the placeholder `ABSOLUTE_PATH_TO_YOUR_PAPER_1_ROOT` — leaving a placeholder like `WORKSPACE_FOLDER_PATH` will cause the runtime error:

```
Workspace does not exist: C:\Users\User\WORKSPACE_FOLDER_PATH\PAPER_1
```

### Alternative: Install once, then call directly

After running:

```bash
cd latex-mcp-server
uv tool install -e .
```

You can simplify the config to:

```jsonc
"latex-mcp-server": {
  "command": "latex-mcp-server",
  "args": ["--workspace", "C:/Users/User/projects/paper_1"]
}
```

### Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `No solution found when resolving tool dependencies` | The tool name `latex-mcp-server` isn’t published on PyPI and `uv` tried to resolve it as a dependency (often happens if you used a config field like `requires` or didn’t install locally) | Run `uv tool install -e ./latex-mcp-server` from repo root, then update your `mcp.json` to invoke the installed script directly |
| `Workspace does not exist: C:\\Users\\...WORKSPACE_FOLDER_PATH...` | Placeholder path left unchanged | Replace with the real absolute path |
| `TypeScript runtime unavailable` in tool results | Node.js not installed (only needed for TS bridge tools) | Install Node.js 18+ or ignore if you don’t need TS tools |

If you change TypeScript sources, rebuild and re-vendor (`npm run build`) before restarting the server.

## TypeScript Bridge

The TypeScript sources live in `ts_functions/src`. Their compiled JavaScript output is vendored into the Python package under `latex_mcp_server/ts_dist` so users do **not** need `npm` or `tsc` just to run the server. To modify or add TS functions:

```bash
cd latex-mcp-server/ts_functions
npm install
npm run build
```

Then copy (or allow the provided helper script to sync) the `dist/` contents into `latex_mcp_server/ts_dist/`.

## Adding New Python Tools

Add functions in `latex_mcp_server/functions/latex_ops.py` (or new modules) and register them in `server.py` inside `register_python_tools`.

### Citation-Aware PDF Reading

When a user asks about a paper (e.g. “Explain how \cite{smith2023model} differs from …”), the agent should:

1. Parse citation key(s) from the request.
2. Call `read_pdf_from_citation` for each key (fetches / downloads PDF and extracts text snippet + metadata).
3. Ground its answer on the extracted text (and optionally call `summarize_text` for a concise summary).
4. Indicate if extraction was truncated (check the `truncated` flag) and avoid over-claiming beyond available pages/characters.

The `read_pdf_from_citation` tool returns the same schema as `read_pdf` plus `citation_key` so multi-citation responses can attribute snippets correctly.

## Auto-Updating `index.json` (Chosen Method: VS Code Tasks)

This project is configured to refresh `resources/cited_papers/index.json` before each LaTeX build using VS Code tasks (method #3 from the suggested approaches).

Added file: `.vscode/tasks.json` with three tasks:

- `update-index`: Runs a short Python one-liner invoking `extract_bibliography` on `src/references.bib`.
- `latex-build`: Invokes `latexmk -pdf` on `main.tex`.
- `build+index`: Sequentially runs `update-index` then `latex-build`.

### How to Use
1. In VS Code, open the command palette and run “Tasks: Run Task”.
2. Choose `build+index` (recommend marking it as the default build task when prompted).
3. The BibTeX index will regenerate first; then LaTeX compilation proceeds.

If LaTeX Workshop cannot import the package (ModuleNotFoundError), a helper script `latex-mcp-server/update_index.py` is provided. The workspace settings have been updated to call:
```
python latex-mcp-server/update_index.py
```
so that a local editable install is not strictly required.

### Make It the Default Build
When prompted by VS Code after first run, accept setting `build+index` as the default. You can also add to your workspace settings:
```jsonc
// .vscode/settings.json (optional)
{
  "latex-workshop.latex.recipe.default": "build+index"
}
```

### Why This Approach
* No background watcher process.
* Deterministic: index refresh tied explicitly to build command.
* Minimal overhead (BibTeX parsing is fast relative to PDF compilation).

If you later need an alternative (e.g., Makefile or on-demand freshness check), you can still layer it on; the tasks approach is non-invasive.

## Adding New TS Tools

1. Create a new file in `ts_functions/src/functions/` exporting a function.
2. Add it to the export map in `ts_functions/src/index.ts`.
3. Rebuild and sync dist output.
4. Register a Python wrapper in `server.py` using `bridge.register_ts_tool`.

## Protocol Notes

This server follows the MCP JSON-RPC message patterns. If the `mcp` Python package updates its APIs, adjust imports accordingly.

## License

MIT
