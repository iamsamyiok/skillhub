# 逐步安装命令 (Windows PowerShell / Git Bash)

## 1. 隔离环境 + SearXNG 官方源码
python -m venv searx-venv
searx-venv/Scripts/pip install --upgrade pip
git clone --depth 1 https://github.com/searxng/searxng.git searxng-src
# (git 装不上时: curl zip + python 过滤解包, 见本 skill README 踩坑2)
searx-venv/Scripts/pip install -r searxng-src/requirements.txt

## 2. Windows pwd stub
copy scripts/windows-pwd-stub.py searx-venv/Lib/site-packages/sitecustomize.py

## 3. 配置
copy scripts/searx-settings.yml .      # 改 secret_key; 代理按需

## 4. 启动
python scripts/start-searxng.py        # http://127.0.0.1:8888

## 5. searxNcrawl MCP
git clone --depth 1 https://github.com/DasDigitaleMomentum/searxNcrawl.git
searx-venv/Scripts/pip install fastmcp crawl4ai
searx-venv/Scripts/pip install -e ./searxNcrawl
# 验证: python scripts/test-searxncrawl.py  (需先 start-searxng)

## 6. 自启(可选)
schtasks /Create /TN SearXNG-Local /TR "<python.exe 绝对路径> <start-searxng.py 绝对路径>" /SC ONLOGON /F
