# Windows 兼容 stub: Unix-only pwd 模块(SearXNG valkeydb 只用 getpwuid 取 home)
import os
try:
    import pwd  # noqa
except ImportError:
    class _Pwd:
        @staticmethod
        def getpwuid(uid):
            class E: pass
            e = E()
            e.pw_dir = os.path.expanduser("~")
            e.pw_name = os.environ.get("USERNAME", "user")
            return e
        @staticmethod
        def getuid(): return 0
    import sys
    sys.modules["pwd"] = _Pwd()
