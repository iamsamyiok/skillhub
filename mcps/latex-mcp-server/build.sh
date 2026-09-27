# Kill running MCP server (Python process running from any uv latex-mcp-server Scripts dir)
set -e

if [[ "$OS" == "Windows_NT" ]]; then
    echo "Killing MCP server on Windows..."
    taskkill //IM uv.exe //F 2>nul || echo "No MCP server running"
else
    echo "Killing MCP server on Linux/macOS..."
    pkill -f "uv tool run latex-mcp-server" 2>/dev/null || echo "No MCP server running"
fi

uv tool uninstall latex-mcp-server
# or to blow away *everything*
uv cache clean

uv tool install --force .
# Write build timestamp into server.py
python -c "from datetime import datetime; ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S'); 
path = 'latex_mcp_server/server.py'; 
with open(path, 'r') as f: lines = f.readlines(); 
found = False; 
for i, line in enumerate(lines): 
    if line.startswith('BUILD_TIMESTAMP ='): 
        lines[i] = f'BUILD_TIMESTAMP = \"{ts}\"\n'; 
        found = True; 
        break; 
if not found: 
    lines.insert(0, f'BUILD_TIMESTAMP = \"{ts}\"\n'); 
with open(path, 'w') as f: f.writelines(lines)"

uv tool run latex-mcp-server --workspace .
