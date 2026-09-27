# -*- coding: utf-8 -*-
"""SearXNG 启动器: 源码路径 + 配置路径注入"""
import os, sys
from pathlib import Path
ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT / "searxng-src"))
os.environ["SEARXNG_SETTINGS_PATH"] = str(ROOT / "searx-settings.yml")
from searx.webapp import app
app.run(host="127.0.0.1", port=8888, debug=False, threaded=True)
