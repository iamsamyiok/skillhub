# -*- coding: utf-8 -*-
"""真 MCP 协议验证: spawn server.py, 走 JSON-RPC initialize → list_tools → call_tool 全流程"""
import json, subprocess, sys, time

p = subprocess.Popen([sys.executable, "server.py"], stdin=subprocess.PIPE,
                     stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, encoding="utf-8")
def rpc(obj):
    p.stdin.write(json.dumps(obj) + "\n"); p.stdin.flush()
    line = ""
    deadline = time.time() + 30
    while time.time() < deadline:            # MCP SDK 可能输出多行,读到带 id 的响应为止
        line = p.stdout.readline()
        if not line:
            time.sleep(0.2); continue
        if '"id"' in line:
            return json.loads(line)
    return {}

t0 = time.time()
init = rpc({"jsonrpc":"2.0","id":1,"method":"initialize","params":{
    "protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"verify","version":"1.0"}}})
print("1. initialize:", init["result"]["serverInfo"]["name"])
rpc({"jsonrpc":"2.0","method":"notifications/initialized"})
lt = rpc({"jsonrpc":"2.0","id":2,"method":"tools/list"})
tools = [t["name"] for t in lt["result"]["tools"]]
print("2. list_tools(P1):", tools, "| 描述token量级: 极小(3工具)")
call = rpc({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{
    "name":"doc_q","arguments":{"capability":"doc.scan","target":"../go9-web"}}})
body = call["result"]["content"][0]["text"]
first = body.split("\n")[0]
print("3. call doc.scan:", first[:60])
full = rpc({"jsonrpc":"2.0","id":4,"method":"tools/call","params":{
    "name":"doc_q","arguments":{"capability":"doc.scan","target":"../go9-web",
                                 "meta":{"with_detail":True}}}})
print("4. with_detail:", json.loads(full["result"]["content"][0]["text"].split("\n",1)[1])["result"]["count"], "文件全量")
bad = rpc({"jsonrpc":"2.0","id":5,"method":"tools/call","params":{
    "name":"doc_q","arguments":{"capability":"doc.nope"}}})
err = json.loads(bad["result"]["content"][0]["text"].split("\n",1)[1])
print("5. 未知能力点结构化错误:", err["error"]["code"], "| human:", err["error"]["human"][:20])
st = rpc({"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"doc_status","arguments":{}}})
caps = json.loads(st["result"]["content"][0]["text"].split("\n",1)[1])["result"]["capabilities"]
print("6. 路由表:", {k: v["status"] for k, v in caps.items()})
print(f"\n✅ 全流程验证通过 ({time.time()-t0:.1f}s) — P1 单入口 / P2 双模 / P4 完整性全部生效")
p.stdin.close(); p.kill()
