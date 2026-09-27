# -*- coding: utf-8 -*-
"""L1 契约(冻结): 单源双通道渲染器 + 标准化错误 —— 宿主与全部工具 import 这一份"""
def render(result: dict, human: str) -> dict:
    return {"result": result, "human": human}

class ToolError(Exception):
    def __init__(self, code: str, human: str, detail: str = "", retryable: bool = False):
        super().__init__(human)
        self.code, self.human, self.detail, self.retryable = code, human, detail, retryable
        self.payload = {"error": {"code": code, "human": human,
                                  "detail": detail, "retryable": retryable}}
